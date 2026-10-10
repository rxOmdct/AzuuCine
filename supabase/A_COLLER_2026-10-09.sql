-- ════════════════════════════════════════════════════════════════════════════
-- AzuuCine — mise à jour du 9 octobre 2026 : À COLLER EN UNE FOIS
-- Supabase → SQL Editor → New query → coller TOUT ce fichier → Run.
--
-- Contient, dans l'ordre :
--   1. 20261009130000_review_spoilers_comments.sql  (spoilers, commentaires)
--   2. 20261009130100_shared_lists.sql              (listes partagées)
--   3. 20261009150000_web_push.sql                  (notifications push + pg_net)
--   4. 20261009160000_moderation.sql                (signalements, blocages, modération)
--   5. 20261009160100_bugs_errors.sql               (signaler un bug, remontée d'erreurs)
--   6. l'adresse de la fonction send-push dans Vault (pas un secret)
-- Déjà appliqués par Claude : 20261009110000_private_tags.sql, 20261009140000_challenges.sql.
-- Tout est idempotent : relancer le fichier ne casse rien.
-- ════════════════════════════════════════════════════════════════════════════


-- ▼▼▼ 20261009130000_review_spoilers_comments.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- AzuuCine — Avis : spoilers et commentaires (9 octobre 2026)
--  1. Spoilers : l'avis peut être marqué « contient des spoilers ». Le drapeau vit dans la
--     fiche synchronisée (items.data->'notesSpoiler', comme l'avis lui-même) ; title_reviews
--     le renvoie pour que l'app masque le texte jusqu'au tap.
--  2. Commentaires sous les avis (≤ 500 caractères) : visibles par ceux qui voient l'avis
--     (can_view sur l'auteur de l'avis, comptes suspendus exclus), anti-spam (10/minute),
--     suppression par l'auteur du commentaire, l'auteur de l'avis ou un admin.
--     Notification « review_comment » à l'auteur de l'avis (préférence notifPrefs.comments).
--  3. Nouveaux types de notification : review_comment, shared_list_invite (listes partagées,
--     voir …130100_shared_lists.sql) + préférences notifPrefs.comments / notifPrefs.lists.
--
-- À coller dans Supabase → SQL Editor → Run, APRÈS …20261007120000_social_notifications.sql.
-- Idempotent (réexécutable sans risque).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Nouveaux types de notification ──
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('follow_request','follow_accepted','new_follower','reaction','new_episode','new_season',
                  'review_comment','shared_list_invite'));

-- Préférences (oui par défaut) : settings.data.notifPrefs = { episodes, follows, accepted, reactions, comments, lists }
create or replace function public.azuu_wants(p_user uuid, p_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (s.data->'notifPrefs'->>(case p_kind
              when 'follow_request' then 'follows'
              when 'new_follower' then 'follows'
              when 'follow_accepted' then 'accepted'
              when 'reaction' then 'reactions'
              when 'review_comment' then 'comments'
              when 'shared_list_invite' then 'lists'
              else 'episodes' end)) is distinct from 'false'
    from public.settings s where s.user_id = p_user
  ), true)
$$;
revoke all on function public.azuu_wants(uuid, text) from public, anon, authenticated;

-- ── Commentaires ──
create table if not exists public.review_comments (
  id bigint generated always as identity primary key,
  author_id uuid not null references auth.users(id) on delete cascade,  -- auteur de l'avis
  item_id text not null check (item_id ~ '^[A-Za-z0-9_-]{1,64}$'),      -- fiche de l'auteur
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,  -- qui commente
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists review_comments_target_idx on public.review_comments (author_id, item_id, created_at);
create index if not exists review_comments_user_idx on public.review_comments (user_id, created_at desc);
alter table public.review_comments enable row level security;
alter table public.review_comments force row level security;
-- Aucun accès direct : tout passe par les fonctions ci-dessous (qui vérifient les droits)
revoke all on public.review_comments from public, anon, authenticated;

-- L'avis (auteur, fiche) existe-t-il et suis-je autorisé à le voir ?
create or replace function public.azuu_review_visible(p_author uuid, p_item text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and p_author is not null and p_item is not null
    and public.can_view(p_author)
    and exists (
      select 1 from public.items i join public.profiles pr on pr.id = i.user_id
      where i.user_id = p_author and i.id = p_item and not i.deleted
        and coalesce(i.data->>'notes', '') <> ''
        and (not pr.suspended or p_author = auth.uid())
    )
$$;
revoke all on function public.azuu_review_visible(uuid, text) from public, anon, authenticated;

-- Fil de commentaires d'un avis (200 derniers, du plus ancien au plus récent)
create or replace function public.get_review_comments(p_author uuid, p_item text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  moderator boolean;
begin
  if not public.azuu_review_visible(p_author, p_item) then
    return jsonb_build_object('visible', false, 'can_moderate', false, 'comments', '[]'::jsonb);
  end if;
  moderator := p_author = me or public.is_admin();
  return jsonb_build_object(
    'visible', true,
    'can_moderate', moderator,
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', c.id, 'body', c.body, 'created_at', c.created_at,
          'user', jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url),
          'mine', c.user_id = me,
          'can_delete', moderator or c.user_id = me
        ) order by c.created_at, c.id)
      from (
        select * from public.review_comments rc
        where rc.author_id = p_author and rc.item_id = p_item
        order by rc.created_at desc, rc.id desc
        limit 200
      ) c
      join public.profiles p on p.id = c.user_id
      where not p.suspended or c.user_id = me
    ), '[]'::jsonb)
  );
end;
$$;

-- Écrire un commentaire (renvoie le commentaire créé)
create or replace function public.add_review_comment(p_author uuid, p_item text, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  b text;
  c public.review_comments;
  p public.profiles;
begin
  if me is null then raise exception 'auth'; end if;
  if not public.azuu_review_visible(p_author, p_item) then raise exception 'review not found'; end if;
  select * into p from public.profiles where id = me;
  if not found or p.suspended then raise exception 'forbidden'; end if;
  -- Caractères de contrôle retirés (sauf retours à la ligne), pas plus de 2 lignes vides d'affilée
  b := regexp_replace(coalesce(p_body, ''), '\r\n?', E'\n', 'g');
  b := regexp_replace(b, '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g');
  b := regexp_replace(b, '\n{3,}', E'\n\n', 'g');
  b := regexp_replace(b, '^\s+|\s+$', '', 'g');  -- espaces ET retours à la ligne en début / fin
  if char_length(b) < 1 or char_length(b) > 500 then raise exception 'invalid comment'; end if;
  -- Anti-spam : 10 commentaires par minute, 300 par jour
  if (select count(*) from public.review_comments where user_id = me and created_at > now() - interval '1 minute') >= 10
     or (select count(*) from public.review_comments where user_id = me and created_at > now() - interval '1 day') >= 300 then
    raise exception 'rate limit';
  end if;
  if (select count(*) from public.review_comments where author_id = p_author and item_id = p_item) >= 1000 then
    raise exception 'too many comments';
  end if;
  insert into public.review_comments (author_id, item_id, user_id, body)
  values (p_author, p_item, me, b)
  returning * into c;
  -- Notifie l'auteur de l'avis (jamais soi-même ; selon ses préférences)
  perform public.azuu_notify(p_author, 'review_comment', me, p_item, null);
  return jsonb_build_object(
    'id', c.id, 'body', c.body, 'created_at', c.created_at,
    'user', jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url),
    'mine', true, 'can_delete', true
  );
end;
$$;

-- Supprimer un commentaire : le sien, ceux sous son avis, ou tout (admin)
create or replace function public.delete_review_comment(p_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  n integer;
begin
  if me is null then raise exception 'auth'; end if;
  delete from public.review_comments c
  where c.id = p_id and (c.user_id = me or c.author_id = me or public.is_admin());
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end;
$$;

-- Avis effacé (texte vidé, fiche supprimée, modération) : ses commentaires partent avec lui
create or replace function public.azuu_review_cleanup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.review_comments where author_id = new.user_id and item_id = new.id;
  return null;
end;
$$;
drop trigger if exists items_review_cleanup on public.items;
create trigger items_review_cleanup after update on public.items
  for each row
  when (coalesce(old.data->>'notes', '') <> '' and (new.deleted or coalesce(new.data->>'notes', '') = ''))
  execute function public.azuu_review_cleanup();

-- ── Tous les avis sur un titre : + drapeau spoiler et nombre de commentaires ──
create or replace function public.title_reviews(p_external_id text, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); res jsonb;
begin
  if me is null or p_external_id !~ '^(tmdb:(movie|tv):[0-9]{1,10}|anilist:[0-9]{1,10})$' then
    return jsonb_build_object('friends', '[]'::jsonb, 'others', '[]'::jsonb);
  end if;
  with revs as (
    select i.user_id, i.id as item_id, i.updated_at,
           nullif(i.data->>'rating','')::numeric as rating,
           i.data->>'notes' as notes,
           coalesce(i.data->>'notesSpoiler', '') = 'true' as spoiler,
           pr,
           exists(select 1 from public.follows f where f.follower_id = me and f.following_id = i.user_id and f.status = 'accepted') as friend
    from public.items i
    join public.profiles pr on pr.id = i.user_id
    where i.data->>'externalId' = p_external_id
      and not i.deleted and coalesce(i.data->>'notes','') <> ''
      and i.user_id <> me and not pr.suspended
      and (not pr.is_private
           or exists(select 1 from public.follows f where f.follower_id = me and f.following_id = i.user_id and f.status = 'accepted'))
  ),
  enriched as (
    select r.*,
      (select coalesce(jsonb_object_agg(e.emoji, e.c), '{}'::jsonb)
         from (select emoji, count(*) c from public.review_reactions rr
               where rr.author_id = r.user_id and rr.item_id = r.item_id group by emoji) e) as reactions,
      (select count(*) from public.review_reactions rr where rr.author_id = r.user_id and rr.item_id = r.item_id) as total,
      (select emoji from public.review_reactions rr where rr.author_id = r.user_id and rr.item_id = r.item_id and rr.user_id = me) as mine,
      (select count(*) from public.review_comments rc join public.profiles cp on cp.id = rc.user_id
         where rc.author_id = r.user_id and rc.item_id = r.item_id and (not cp.suspended or rc.user_id = me)) as comments
    from revs r
  )
  select jsonb_build_object(
    'friends', coalesce((select jsonb_agg(entry order by total desc, updated_at desc) from (
        select jsonb_build_object('user', public.profile_card(pr), 'user_id', user_id, 'item_id', item_id,
               'updated_at', updated_at, 'rating', rating, 'notes', notes, 'spoiler', spoiler,
               'reactions', reactions, 'total', total, 'mine', mine, 'comments', comments) entry, total, updated_at
        from enriched where friend offset greatest(p_offset, 0) limit 40) f), '[]'::jsonb),
    'others', coalesce((select jsonb_agg(entry order by total desc, updated_at desc) from (
        select jsonb_build_object('user', public.profile_card(pr), 'user_id', user_id, 'item_id', item_id,
               'updated_at', updated_at, 'rating', rating, 'notes', notes, 'spoiler', spoiler,
               'reactions', reactions, 'total', total, 'mine', mine, 'comments', comments) entry, total, updated_at
        from enriched where not friend offset greatest(p_offset, 0) limit 40) o), '[]'::jsonb)
  ) into res;
  return res;
end;
$$;

-- ── Droits (gate interne : auth.uid() / can_view / is_admin) ──
revoke all on function public.azuu_review_cleanup() from public, anon, authenticated;
revoke all on function public.get_review_comments(uuid, text) from public, anon;
revoke all on function public.add_review_comment(uuid, text, text) from public, anon;
revoke all on function public.delete_review_comment(bigint) from public, anon;
revoke all on function public.title_reviews(text, integer) from public, anon;
grant execute on function public.get_review_comments(uuid, text) to authenticated;
grant execute on function public.add_review_comment(uuid, text, text) to authenticated;
grant execute on function public.delete_review_comment(bigint) to authenticated;
grant execute on function public.title_reviews(text, integer) to authenticated;

-- ▼▼▼ 20261009130100_shared_lists.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- AzuuCine — Listes partagées / collaboratives (9 octobre 2026)
--  - Le propriétaire crée une liste et invite des membres (parmi ceux qu'il suit ou qui le suivent).
--  - Invitation = notification « shared_list_invite » ; le membre doit accepter.
--  - Chaque membre ajoute / retire des titres (instantané minimal : référence TMDB/AniList, titre,
--    affiche, type, année) et voit qui a ajouté quoi. On peut quitter une liste ; le propriétaire
--    peut retirer un membre, renommer ou supprimer la liste.
--  - Les listes perso (public.lists) ne changent pas : elles restent privées.
--
-- Sécurité : RLS activé, AUCUN accès direct aux tables ; tout passe par des fonctions
-- security definer qui vérifient l'appartenance (seuls les membres lisent / écrivent).
--
-- À coller dans Supabase → SQL Editor → Run, APRÈS …20261009130000_review_spoilers_comments.sql.
-- Idempotent (réexécutable sans risque).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Tables ──
create table if not exists public.shared_lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shared_lists_owner_idx on public.shared_lists (owner_id, created_at desc);

-- Le propriétaire est aussi membre (status 'accepted') : une seule règle d'appartenance.
create table if not exists public.shared_list_members (
  list_id uuid not null references public.shared_lists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  -- Qui a invité : gardé en « set null » pour que la liste survive à la suppression d'un compte
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (list_id, user_id)
);
create index if not exists shared_list_members_user_idx on public.shared_list_members (user_id, status);
create index if not exists shared_list_members_inviter_idx on public.shared_list_members (invited_by, created_at desc);

create table if not exists public.shared_list_items (
  list_id uuid not null references public.shared_lists(id) on delete cascade,
  external_id text not null check (external_id ~ '^(tmdb:(movie|tv):[0-9]{1,10}|anilist:[0-9]{1,10})$'),
  title text not null check (char_length(title) between 1 and 300),
  poster text check (poster is null or (char_length(poster) <= 300
    and poster ~ '^https://(image\.tmdb\.org|s4\.anilist\.co)/[A-Za-z0-9/_.-]+$')),
  type text not null check (type in ('film', 'serie', 'anime', 'kdrama', 'cdrama', 'autre')),
  year integer check (year is null or year between 1870 and 2200),
  -- Qui l'a ajouté : « set null » à la suppression du compte (le titre reste pour les autres membres)
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (list_id, external_id)
);
create index if not exists shared_list_items_list_idx on public.shared_list_items (list_id, added_at desc);
create index if not exists shared_list_items_adder_idx on public.shared_list_items (added_by, added_at desc);

alter table public.shared_lists enable row level security;
alter table public.shared_lists force row level security;
alter table public.shared_list_members enable row level security;
alter table public.shared_list_members force row level security;
alter table public.shared_list_items enable row level security;
alter table public.shared_list_items force row level security;
revoke all on public.shared_lists, public.shared_list_members, public.shared_list_items from public, anon, authenticated;

-- ── Outils internes ──
-- Suis-je membre (accepté) de cette liste ?
create or replace function public.azuu_sl_member(p_list uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.shared_list_members m
    where m.list_id = p_list and m.user_id = auth.uid() and m.status = 'accepted'
  )
$$;

create or replace function public.azuu_sl_owner(p_list uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (select 1 from public.shared_lists l where l.id = p_list and l.owner_id = auth.uid())
$$;

-- Nom propre : sans caractères de contrôle, espaces superflus retirés
create or replace function public.azuu_sl_name(p_name text)
returns text language sql immutable set search_path = '' as $$
  select trim(regexp_replace(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'), '[[:cntrl:]]', '', 'g'))
$$;

create or replace function public.azuu_mini_card(p public.profiles)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p.id is null then null else
    jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url) end
$$;

create or replace function public.azuu_me_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (select 1 from public.profiles p where p.id = auth.uid() and not p.suspended)
$$;

-- ── Lecture ──
-- Mes listes partagées (+ invitations en attente). p_external_id : indique si ce titre est déjà dans chaque liste.
create or replace function public.get_shared_lists(p_external_id text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then
    return jsonb_build_object('lists', '[]'::jsonb, 'invites', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'lists', coalesce((
      select jsonb_agg(s.entry order by s.updated_at desc)
      from (
        select l.updated_at, jsonb_build_object(
          'id', l.id, 'name', l.name, 'is_owner', l.owner_id = me,
          'owner', public.azuu_mini_card(op),
          'count', (select count(*) from public.shared_list_items i where i.list_id = l.id),
          'members', (select count(*) from public.shared_list_members mm where mm.list_id = l.id and mm.status = 'accepted'),
          'posters', coalesce((select jsonb_agg(x.poster) from (
              select i.poster from public.shared_list_items i
              where i.list_id = l.id and i.poster is not null order by i.added_at desc limit 4) x), '[]'::jsonb),
          'has', p_external_id is not null and exists (
              select 1 from public.shared_list_items i where i.list_id = l.id and i.external_id = p_external_id),
          'updated_at', l.updated_at
        ) as entry
        from public.shared_list_members m
        join public.shared_lists l on l.id = m.list_id
        join public.profiles op on op.id = l.owner_id
        where m.user_id = me and m.status = 'accepted'
        limit 200
      ) s
    ), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(s.entry order by s.created_at desc)
      from (
        select m.created_at, jsonb_build_object(
          'id', l.id, 'name', l.name,
          'owner', public.azuu_mini_card(op),
          'members', (select count(*) from public.shared_list_members mm where mm.list_id = l.id and mm.status = 'accepted'),
          'created_at', m.created_at
        ) as entry
        from public.shared_list_members m
        join public.shared_lists l on l.id = m.list_id
        join public.profiles op on op.id = l.owner_id
        where m.user_id = me and m.status = 'pending' and not op.suspended
        limit 100
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

-- Une liste : membres et titres (membres acceptés uniquement)
create or replace function public.get_shared_list(p_list uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  l public.shared_lists;
begin
  if not public.azuu_sl_member(p_list) then return null; end if;
  select * into l from public.shared_lists where id = p_list;
  return jsonb_build_object(
    'id', l.id, 'name', l.name, 'is_owner', l.owner_id = me, 'owner_id', l.owner_id,
    'created_at', l.created_at, 'updated_at', l.updated_at,
    'members', coalesce((
      select jsonb_agg(public.azuu_mini_card(p) || jsonb_build_object('status', m.status, 'is_owner', m.user_id = l.owner_id)
                       order by (m.user_id = l.owner_id) desc, m.status, m.created_at)
      from public.shared_list_members m join public.profiles p on p.id = m.user_id
      where m.list_id = l.id
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'external_id', s.external_id, 'title', s.title, 'poster', s.poster, 'type', s.type, 'year', s.year,
          'added_at', s.added_at, 'added_by', public.azuu_mini_card(p)
        ) order by s.added_at desc)
      from (select * from public.shared_list_items i where i.list_id = l.id order by i.added_at desc limit 500) s
      left join public.profiles p on p.id = s.added_by
    ), '[]'::jsonb)
  );
end;
$$;

-- Personnes que je peux inviter : abonnés / abonnements acceptés, pas déjà dans la liste
create or replace function public.shared_list_candidates(p_list uuid, p_q text default '')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  term text := lower(trim(coalesce(p_q, '')));
  pattern text;
begin
  if not public.azuu_sl_owner(p_list) or char_length(term) > 40 then return '[]'::jsonb; end if;
  pattern := replace(replace(replace(ltrim(term, '@'), '\', '\\'), '%', '\%'), '_', '\_');
  return coalesce((
    select jsonb_agg(public.profile_card(p) order by p.username)
    from (
      select pr.* from public.profiles pr
      where pr.id <> me and not pr.suspended
        and exists (
          select 1 from public.follows f where f.status = 'accepted'
            and ((f.follower_id = me and f.following_id = pr.id) or (f.follower_id = pr.id and f.following_id = me))
        )
        and not exists (select 1 from public.shared_list_members m where m.list_id = p_list and m.user_id = pr.id)
        and (pattern = '' or pr.username like pattern || '%' or lower(pr.display_name) like '%' || pattern || '%')
      order by pr.username
      limit 30
    ) p
  ), '[]'::jsonb);
end;
$$;

-- ── Écriture ──
create or replace function public.create_shared_list(p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  n text := public.azuu_sl_name(p_name);
  new_id uuid;
begin
  if not public.azuu_me_active() then raise exception 'forbidden'; end if;
  if char_length(n) < 1 or char_length(n) > 80 then raise exception 'invalid name'; end if;
  if (select count(*) from public.shared_lists where owner_id = me) >= 50 then raise exception 'too many lists'; end if;
  if (select count(*) from public.shared_lists where owner_id = me and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'rate limit';
  end if;
  if (select count(*) from public.shared_list_members where user_id = me and status = 'accepted') >= 100 then
    raise exception 'too many lists';
  end if;
  insert into public.shared_lists (owner_id, name) values (me, n) returning id into new_id;
  insert into public.shared_list_members (list_id, user_id, status, invited_by) values (new_id, me, 'accepted', me);
  return jsonb_build_object('id', new_id);
end;
$$;

create or replace function public.rename_shared_list(p_list uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n text := public.azuu_sl_name(p_name);
begin
  if not public.azuu_sl_owner(p_list) or not public.azuu_me_active() then raise exception 'forbidden'; end if;
  if char_length(n) < 1 or char_length(n) > 80 then raise exception 'invalid name'; end if;
  update public.shared_lists set name = n, updated_at = now() where id = p_list;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.delete_shared_list(p_list uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not (public.azuu_sl_owner(p_list) or public.is_admin()) then raise exception 'forbidden'; end if;
  delete from public.notifications where kind = 'shared_list_invite' and item_id = p_list::text;
  delete from public.shared_lists where id = p_list;  -- membres et titres : en cascade
  return jsonb_build_object('ok', true);
end;
$$;

-- Inviter quelqu'un (propriétaire seulement, parmi ses abonnés / abonnements)
create or replace function public.invite_to_shared_list(p_list uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  n integer;
begin
  if not public.azuu_sl_owner(p_list) or not public.azuu_me_active() then raise exception 'forbidden'; end if;
  if p_user is null or p_user = me then raise exception 'invalid user'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user and not p.suspended) then raise exception 'profile not found'; end if;
  if not exists (
    select 1 from public.follows f where f.status = 'accepted'
      and ((f.follower_id = me and f.following_id = p_user) or (f.follower_id = p_user and f.following_id = me))
  ) then
    raise exception 'not connected';
  end if;
  if (select count(*) from public.shared_list_members where list_id = p_list) >= 30 then raise exception 'too many members'; end if;
  if (select count(*) from public.shared_list_members where invited_by = me and user_id <> me and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'rate limit';
  end if;
  insert into public.shared_list_members (list_id, user_id, status, invited_by)
  values (p_list, p_user, 'pending', me)
  on conflict (list_id, user_id) do nothing;
  get diagnostics n = row_count;
  if n > 0 then
    perform public.azuu_notify(p_user, 'shared_list_invite', me, p_list::text, null);
  end if;
  return jsonb_build_object('ok', true, 'invited', n > 0);
end;
$$;

-- Accepter / refuser une invitation
create or replace function public.respond_shared_list_invite(p_list uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'auth'; end if;
  if not exists (select 1 from public.shared_list_members where list_id = p_list and user_id = me and status = 'pending') then
    raise exception 'invite not found';
  end if;
  if p_accept then
    if not public.azuu_me_active() then raise exception 'forbidden'; end if;
    if (select count(*) from public.shared_list_members where user_id = me and status = 'accepted') >= 100 then
      raise exception 'too many lists';
    end if;
    update public.shared_list_members set status = 'accepted' where list_id = p_list and user_id = me;
  else
    delete from public.shared_list_members where list_id = p_list and user_id = me;
    delete from public.notifications where user_id = me and kind = 'shared_list_invite' and item_id = p_list::text;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Quitter une liste (le propriétaire, lui, la supprime)
create or replace function public.leave_shared_list(p_list uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'auth'; end if;
  if public.azuu_sl_owner(p_list) then raise exception 'owner cannot leave'; end if;
  delete from public.shared_list_members where list_id = p_list and user_id = me;
  delete from public.notifications where user_id = me and kind = 'shared_list_invite' and item_id = p_list::text;
  return jsonb_build_object('ok', true);
end;
$$;

-- Retirer un membre (ou annuler une invitation) : propriétaire seulement
create or replace function public.remove_shared_list_member(p_list uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.azuu_sl_owner(p_list) then raise exception 'forbidden'; end if;
  if p_user = auth.uid() then raise exception 'owner cannot leave'; end if;
  delete from public.shared_list_members where list_id = p_list and user_id = p_user;
  delete from public.notifications where user_id = p_user and kind = 'shared_list_invite' and item_id = p_list::text;
  return jsonb_build_object('ok', true);
end;
$$;

-- Ajouter un titre : p_item = { external_id, title, poster?, type, year? }
create or replace function public.add_shared_list_item(p_list uuid, p_item jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  ext text := p_item->>'external_id';
  ttl text := left(public.azuu_sl_name(p_item->>'title'), 300);
  pst text := nullif(p_item->>'poster', '');
  typ text := coalesce(p_item->>'type', 'autre');
  yr integer;
  n integer;
begin
  if not public.azuu_sl_member(p_list) or not public.azuu_me_active() then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_item) is distinct from 'object' then raise exception 'invalid item'; end if;
  if ext is null or ext !~ '^(tmdb:(movie|tv):[0-9]{1,10}|anilist:[0-9]{1,10})$' or char_length(ttl) < 1 then
    raise exception 'invalid item';
  end if;
  if typ not in ('film', 'serie', 'anime', 'kdrama', 'cdrama', 'autre') then typ := 'autre'; end if;
  if pst is not null and (char_length(pst) > 300 or pst !~ '^https://(image\.tmdb\.org|s4\.anilist\.co)/[A-Za-z0-9/_.-]+$') then
    pst := null;
  end if;
  if coalesce(p_item->>'year', '') ~ '^[0-9]{4}$' and (p_item->>'year')::int between 1870 and 2200 then
    yr := (p_item->>'year')::int;
  end if;
  if (select count(*) from public.shared_list_items where list_id = p_list) >= 500 then raise exception 'list full'; end if;
  if (select count(*) from public.shared_list_items where added_by = me and added_at > now() - interval '1 minute') >= 30 then
    raise exception 'rate limit';
  end if;
  insert into public.shared_list_items (list_id, external_id, title, poster, type, year, added_by)
  values (p_list, ext, ttl, pst, typ, yr, me)
  on conflict (list_id, external_id) do nothing;
  get diagnostics n = row_count;
  if n > 0 then update public.shared_lists set updated_at = now() where id = p_list; end if;
  return jsonb_build_object('ok', true, 'added', n > 0);
end;
$$;

create or replace function public.remove_shared_list_item(p_list uuid, p_external_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not public.azuu_sl_member(p_list) or not public.azuu_me_active() then raise exception 'forbidden'; end if;
  delete from public.shared_list_items where list_id = p_list and external_id = p_external_id;
  get diagnostics n = row_count;
  if n > 0 then update public.shared_lists set updated_at = now() where id = p_list; end if;
  return jsonb_build_object('ok', true, 'removed', n > 0);
end;
$$;

-- ── Notifications : titres des nouveaux types + état de l'invitation ──
create or replace function public.get_notifications(p_offset integer default 0)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by created_at desc), '[]'::jsonb)
  from (
    select n.id, n.kind, n.created_at, n.read_at, n.emoji, n.item_id, n.episode, n.ep_count,
      case when p.id is null then null else
        jsonb_build_object('username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url) end as actor,
      case
        when n.kind in ('reaction', 'review_comment', 'new_episode', 'new_season')
          then (select it.data->>'title' from public.items it where it.user_id = n.user_id and it.id = n.item_id)
        when n.kind = 'shared_list_invite'
          then (select sl.name from public.shared_lists sl where sl.id::text = n.item_id)
      end as title,
      case when n.kind = 'shared_list_invite'
        then (select m.status from public.shared_list_members m where m.list_id::text = n.item_id and m.user_id = n.user_id)
      end as invite_status
    from public.notifications n
    left join public.profiles p on p.id = n.actor_id
    where n.user_id = auth.uid() and public.azuu_wants(n.user_id, n.kind)
    order by n.created_at desc
    offset greatest(p_offset, 0) limit 30
  ) x
$$;

-- ── Droits ──
revoke all on function public.azuu_sl_member(uuid), public.azuu_sl_owner(uuid), public.azuu_sl_name(text),
  public.azuu_mini_card(public.profiles), public.azuu_me_active()
  from public, anon, authenticated;
revoke all on function public.get_shared_lists(text), public.get_shared_list(uuid), public.shared_list_candidates(uuid, text),
  public.create_shared_list(text), public.rename_shared_list(uuid, text), public.delete_shared_list(uuid),
  public.invite_to_shared_list(uuid, uuid), public.respond_shared_list_invite(uuid, boolean), public.leave_shared_list(uuid),
  public.remove_shared_list_member(uuid, uuid), public.add_shared_list_item(uuid, jsonb), public.remove_shared_list_item(uuid, text),
  public.get_notifications(integer)
  from public, anon;
grant execute on function public.get_shared_lists(text), public.get_shared_list(uuid), public.shared_list_candidates(uuid, text),
  public.create_shared_list(text), public.rename_shared_list(uuid, text), public.delete_shared_list(uuid),
  public.invite_to_shared_list(uuid, uuid), public.respond_shared_list_invite(uuid, boolean), public.leave_shared_list(uuid),
  public.remove_shared_list_member(uuid, uuid), public.add_shared_list_item(uuid, jsonb), public.remove_shared_list_item(uuid, text),
  public.get_notifications(integer)
  to authenticated;

-- ▼▼▼ 20261009150000_web_push.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- AzuuCine — Notifications push (Web Push), même app fermée (9 octobre 2026)
--  1. push_subscriptions : les appareils où chacun a activé les notifications.
--  2. Inscription / désinscription sûres (hôtes des services push connus uniquement : anti-SSRF).
--  3. À chaque nouvelle notification (cloche), la base appelle la fonction serveur « send-push »
--     (extension pg_net), avec un secret partagé lu dans Supabase Vault (jamais écrit ici).
--
-- Prérequis : 20261007120000_social_notifications.sql appliqué.
-- À coller dans Supabase → SQL Editor → Run. Idempotent (réexécutable sans risque).
-- Étapes manuelles (secrets, Vault, déploiement) : voir supabase/PUSH_SETUP.md
-- ════════════════════════════════════════════════════════════════════════════

-- pg_net : appels HTTP asynchrones depuis la base (envoyés après la validation de la transaction)
create extension if not exists pg_net;

-- ── Abonnements push (un par appareil / navigateur) ──
create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 1024),
  p256dh text not null check (p256dh ~ '^B[A-Za-z0-9_-]{86}=?$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{22}(==)?$'),
  -- Langue des messages envoyés à cet appareil
  lang text not null default 'fr' check (lang in ('fr','en','es','it','de','pt','nl','pl','ru','tr','ar','hi','id','th','vi','zh','ja','ko')),
  -- Petit libellé de l'appareil (« Chrome · Android »), pour s'y retrouver
  user_agent text check (user_agent is null or char_length(user_agent) <= 60),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;

-- Chacun ne voit / supprime que ses propres appareils (l'ajout passe par la fonction ci-dessous)
drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

-- ── Notifications : marque « déjà envoyée en push » ──
alter table public.notifications add column if not exists pushed_at timestamptz;
create index if not exists notifications_unpushed_idx on public.notifications (user_id, created_at) where pushed_at is null;
-- L'historique existant n'est jamais envoyé en push
update public.notifications set pushed_at = created_at
where pushed_at is null and created_at < now() - interval '15 minutes';

-- ── Inscription d'un appareil ──
create or replace function public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_lang text default 'fr', p_ua text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v_host text;
  v_lang text;
  v_ua text;
begin
  if me is null then raise exception 'auth'; end if;

  -- Adresse d'envoi : https uniquement, vers un service push connu (sinon le serveur pourrait
  -- être utilisé pour contacter n'importe quelle adresse : SSRF)
  if p_endpoint is null or char_length(p_endpoint) > 1024
     or p_endpoint !~ '^https://[A-Za-z0-9.-]+(:443)?/[^[:space:]]*$' then
    raise exception 'bad endpoint';
  end if;
  v_host := lower(substring(p_endpoint from '^https://([A-Za-z0-9.-]+)'));
  if not (
    v_host in ('fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com')
    or v_host ~ '^([a-z0-9-]{1,63}\.)+push\.apple\.com$'
    or v_host ~ '^([a-z0-9-]{1,63}\.)+notify\.windows\.com$'
  ) then
    raise exception 'push service not allowed';
  end if;
  if p_p256dh is null or p_p256dh !~ '^B[A-Za-z0-9_-]{86}=?$' then raise exception 'bad key'; end if;
  if p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22}(==)?$' then raise exception 'bad auth'; end if;

  v_lang := case when p_lang in ('fr','en','es','it','de','pt','nl','pl','ru','tr','ar','hi','id','th','vi','zh','ja','ko') then p_lang else 'fr' end;
  v_ua := nullif(left(regexp_replace(coalesce(p_ua, ''), '[^A-Za-z0-9 ._()/·-]', '', 'g'), 60), '');

  -- Anti-abus : 10 nouveaux appareils max en 10 minutes
  if (select count(*) from public.push_subscriptions s
      where s.user_id = me and s.created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'rate';
  end if;

  -- Même navigateur réinscrit (ou changement de compte sur l'appareil) : on met à jour.
  -- Un abonnement d'un autre compte n'est repris que si l'on prouve le posséder (mêmes clés).
  insert into public.push_subscriptions as s (user_id, endpoint, p256dh, auth, lang, user_agent, last_used_at)
  values (me, p_endpoint, p_p256dh, p_auth, v_lang, v_ua, now())
  on conflict (endpoint) do update
    set user_id = me, p256dh = excluded.p256dh, auth = excluded.auth, lang = excluded.lang,
        user_agent = excluded.user_agent, last_used_at = now()
    where s.user_id = me or (s.p256dh = excluded.p256dh and s.auth = excluded.auth);
  if not found then raise exception 'endpoint taken'; end if;

  -- 10 appareils max par compte : les plus anciens sont retirés
  delete from public.push_subscriptions
  where user_id = me and id not in (
    select id from public.push_subscriptions where user_id = me
    order by coalesce(last_used_at, created_at) desc limit 10
  );
  return jsonb_build_object('ok', true);
end;
$$;

-- ── Désinscription d'un appareil ──
create or replace function public.unregister_push_subscription(p_endpoint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  delete from public.push_subscriptions where user_id = auth.uid() and endpoint = p_endpoint;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── Fonction serveur (service_role) : prend les notifications à envoyer d'un compte ──
-- Les notifications arrivées ensemble (plusieurs épisodes) sont prises d'un coup, ce qui permet
-- de les regrouper ; une notification n'est prise qu'une seule fois (pushed_at).
create or replace function public.push_claim(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare res jsonb;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'forbidden'; end if;
  with claimed as (
    update public.notifications n set pushed_at = now()
    where n.user_id = p_user and n.pushed_at is null and n.read_at is null
      and n.created_at > now() - interval '15 minutes'
    returning n.id, n.user_id, n.kind, n.actor_id, n.item_id, n.emoji, n.episode, n.ep_count, n.created_at
  )
  select jsonb_build_object(
    'subs', coalesce((
      select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'lang', s.lang))
      from public.push_subscriptions s where s.user_id = p_user), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'kind', c.kind, 'emoji', c.emoji, 'item_id', c.item_id,
        'episode', c.episode, 'ep_count', c.ep_count,
        'actor', case when p.id is null then null
                 else jsonb_build_object('username', p.username, 'display_name', p.display_name) end,
        'title', case when c.kind = 'shared_list_invite'
                   then (select l.name from public.shared_lists l where l.id::text = c.item_id)
                   else (select it.data->>'title' from public.items it where it.user_id = c.user_id and it.id = c.item_id) end
      ) order by c.created_at)
      from claimed c left join public.profiles p on p.id = c.actor_id
      where public.azuu_wants(c.user_id, c.kind)), '[]'::jsonb)
  ) into res;
  return res;
end;
$$;

-- ── Fonction serveur (service_role) : bilan d'un envoi ──
create or replace function public.push_done(p_user uuid, p_gone text[], p_ok text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'forbidden'; end if;
  -- Abonnements expirés (404 / 410) : supprimés
  delete from public.push_subscriptions where user_id = p_user and endpoint = any(coalesce(p_gone, '{}'));
  update public.push_subscriptions set last_used_at = now()
  where user_id = p_user and endpoint = any(coalesce(p_ok, '{}'));
end;
$$;

-- ── Déclencheur : nouvelle notification → appel de « send-push » ──
-- Adresse et secret dans Vault (voir PUSH_SETUP.md) :
--   azuu_push_url    = https://<ref>.supabase.co/functions/v1/send-push
--   azuu_push_secret = la même valeur que le secret PUSH_WEBHOOK_SECRET de la fonction
-- Un seul appel par compte et par transaction (plusieurs épisodes d'un coup = 1 appel, regroupé).
-- Toute erreur (pg_net absent, Vault vide…) est ignorée : la notification reste dans la cloche.
create or replace function public.azuu_push_dispatch()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
  v_flag text := 'azuu.push_' || replace(new.user_id::text, '-', '');
begin
  if not exists (select 1 from public.push_subscriptions s where s.user_id = new.user_id) then return null; end if;
  if current_setting(v_flag, true) = '1' then return null; end if;
  begin
    select ds.decrypted_secret into v_url from vault.decrypted_secrets ds where ds.name = 'azuu_push_url' limit 1;
    select ds.decrypted_secret into v_secret from vault.decrypted_secrets ds where ds.name = 'azuu_push_secret' limit 1;
    if v_url is null or v_secret is null or char_length(v_secret) < 32
       or v_url !~ '^https://[A-Za-z0-9.-]+/functions/v1/send-push$' then
      return null;
    end if;
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('user_id', new.user_id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
      timeout_milliseconds := 10000
    );
    perform set_config(v_flag, '1', true);
  exception when others then
    null;
  end;
  return null;
end;
$$;
drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  for each row execute function public.azuu_push_dispatch();

-- ── Droits ──
revoke all on function public.register_push_subscription(text, text, text, text, text) from public, anon;
revoke all on function public.unregister_push_subscription(text) from public, anon;
revoke all on function public.push_claim(uuid) from public, anon, authenticated;
revoke all on function public.push_done(uuid, text[], text[]) from public, anon, authenticated;
revoke all on function public.azuu_push_dispatch() from public, anon, authenticated;
grant execute on function public.register_push_subscription(text, text, text, text, text) to authenticated;
grant execute on function public.unregister_push_subscription(text) to authenticated;
grant execute on function public.push_claim(uuid) to service_role;
grant execute on function public.push_done(uuid, text[], text[]) to service_role;

-- ▼▼▼ 20261009160000_moderation.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- AzuuCine — Modération (9 octobre 2026)
--  1. Signalements (avis, profils, commentaires, listes partagées).
--  2. Tableau de modération (admin) : file des signalements regroupés par cible, actions.
--  3. Comptes suspendus : journal des suspensions + garde-fou sur la colonne « suspended ».
--  4. Blocage d'un membre : il ne peut plus te suivre ni réagir à tes avis ; ses avis
--     sont masqués côté app.
--
-- À coller dans Supabase → SQL Editor → Run. Idempotent (réexécutable sans risque).
-- Dépend de : 20261002 (profiles, follows, can_view), 20261005 (admins, is_admin,
-- suspended, admin_clear_review), 20261007 (review_reactions).
-- ════════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════ Journal de modération ═════════════════════════════
-- Qui a fait quoi (suspensions, suppressions, signalements classés). Lisible seulement
-- via les fonctions admin (aucun accès direct).
create table if not exists public.moderation_log (
  id bigint generated always as identity primary key,
  admin_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) <= 40),
  target_type text check (target_type is null or char_length(target_type) <= 20),
  target_id text check (target_id is null or char_length(target_id) <= 200),
  target_user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists moderation_log_target_idx on public.moderation_log (target_user_id, created_at desc);
alter table public.moderation_log enable row level security;
alter table public.moderation_log force row level security;
revoke all on public.moderation_log from anon, authenticated;

-- ── « suspended » : seuls un admin (ou le SQL Editor / service_role) peuvent la changer ──
-- Défense en profondeur : même si une permission de colonne venait à manquer, un membre ne
-- peut pas lever sa propre suspension en modifiant son profil.
create or replace function public.azuu_suspended_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.suspended is distinct from old.suspended
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_suspended_guard on public.profiles;
create trigger profiles_suspended_guard before update of suspended on public.profiles
  for each row execute function public.azuu_suspended_guard();

-- Chaque suspension / réactivation est journalisée (quel que soit le chemin : admin_set_suspended,
-- admin_report_action, SQL Editor…).
create or replace function public.azuu_suspended_log()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.suspended is distinct from old.suspended then
    insert into public.moderation_log (admin_id, action, target_type, target_id, target_user_id)
    values (auth.uid(), case when new.suspended then 'suspend' else 'unsuspend' end, 'profile', new.id::text, new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists profiles_suspended_log on public.profiles;
create trigger profiles_suspended_log after update of suspended on public.profiles
  for each row execute function public.azuu_suspended_log();

-- ═════════════════════════════ Signalements ═════════════════════════════
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('review', 'profile', 'comment', 'list')),
  target_id text not null check (target_id ~ '^[A-Za-z0-9_:.-]{1,200}$'),
  target_user_id uuid not null references auth.users (id) on delete cascade,  -- auteur du contenu
  reason text not null check (reason in ('spoiler', 'harassment', 'hate', 'sexual', 'spam', 'impersonation', 'other')),
  details text check (details is null or char_length(details) <= 500),
  -- Copie du contenu au moment du signalement (preuve si l'auteur le modifie ou l'efface)
  snapshot jsonb check (snapshot is null or (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 6000)),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  -- Pas deux fois la même cible par la même personne
  unique (reporter_id, target_type, target_id, target_user_id)
);
create index if not exists reports_target_idx on public.reports (target_type, target_id, target_user_id);
create index if not exists reports_status_idx on public.reports (status, created_at);
create index if not exists reports_reporter_idx on public.reports (reporter_id, created_at desc);
alter table public.reports enable row level security;
alter table public.reports force row level security;
-- Aucun accès direct : insertion via report_content(), lecture/màj via les fonctions admin.
revoke all on public.reports from anon, authenticated;

-- Signaler un contenu. Renvoie { ok: true, duplicate: bool }.
create or replace function public.report_content(
  p_type text, p_target_id text, p_target_user uuid, p_reason text, p_details text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  d text;
  snap jsonb;
  n integer;
begin
  if me is null then raise exception 'auth'; end if;
  if p_type is null or p_type not in ('review', 'profile', 'comment', 'list') then raise exception 'bad type'; end if;
  if p_reason is null or p_reason not in ('spoiler', 'harassment', 'hate', 'sexual', 'spam', 'impersonation', 'other') then
    raise exception 'bad reason';
  end if;
  if p_target_id is null or p_target_id !~ '^[A-Za-z0-9_:.-]{1,200}$' then raise exception 'bad target'; end if;
  if p_target_user is null then raise exception 'bad target'; end if;
  if p_target_user = me then raise exception 'cannot report yourself'; end if;
  -- Un compte suspendu ne signale pas
  if exists (select 1 from public.profiles p where p.id = me and p.suspended) then raise exception 'forbidden'; end if;

  -- Précision facultative : sans caractères de contrôle, 500 caractères max
  d := nullif(trim(regexp_replace(coalesce(p_details, ''), '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')), '');
  if d is not null and char_length(d) > 500 then raise exception 'details too long'; end if;

  -- La cible doit exister ET être visible de la personne qui signale
  if p_type = 'review' then
    select jsonb_build_object('title', left(i.data->>'title', 200), 'notes', left(i.data->>'notes', 3000),
                              'rating', i.data->'rating', 'externalId', left(i.data->>'externalId', 60))
      into snap
    from public.items i
    where i.user_id = p_target_user and i.id = p_target_id and not i.deleted
      and coalesce(i.data->>'notes', '') <> '';
    if snap is null or not public.can_view(p_target_user) then raise exception 'not found'; end if;
  elsif p_type = 'profile' then
    if p_target_id <> p_target_user::text then raise exception 'bad target'; end if;
    select jsonb_build_object('username', p.username, 'display_name', p.display_name, 'bio', p.bio,
                              'avatar_url', p.avatar_url, 'banner_url', p.banner_url)
      into snap
    from public.profiles p where p.id = p_target_user;
    if snap is null then raise exception 'not found'; end if;
  elsif p_type = 'comment' then
    -- Commentaire sous un avis : il doit exister et l'avis doit m'être visible
    if p_target_id !~ '^[0-9]{1,18}$' then raise exception 'bad target'; end if;
    select jsonb_build_object('body', left(c.body, 500), 'review_author', c.author_id, 'item_id', c.item_id,
                              'title', left((select i.data->>'title' from public.items i where i.user_id = c.author_id and i.id = c.item_id), 200))
      into snap
    from public.review_comments c
    where c.id = p_target_id::bigint and c.user_id = p_target_user
      and public.azuu_review_visible(c.author_id, c.item_id);
    if snap is null then raise exception 'not found'; end if;
  else
    -- Liste partagée : seuls ses membres la voient, donc seuls eux peuvent la signaler
    if p_target_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad target'; end if;
    select jsonb_build_object('name', l.name,
                              'titles', (select coalesce(jsonb_agg(left(it.title, 120) order by it.added_at desc), '[]'::jsonb)
                                         from (select title, added_at from public.shared_list_items x where x.list_id = l.id order by x.added_at desc limit 20) it))
      into snap
    from public.shared_lists l
    where l.id = p_target_id::uuid and l.owner_id = p_target_user
      and exists (select 1 from public.shared_list_members m where m.list_id = l.id and m.user_id = me and m.status = 'accepted');
    if snap is null then raise exception 'not found'; end if;
  end if;

  -- Anti-abus : 20 signalements par 24 h, 5 par minute
  select count(*) into n from public.reports r where r.reporter_id = me and r.created_at > now() - interval '1 day';
  if n >= 20 then raise exception 'rate limited'; end if;
  select count(*) into n from public.reports r where r.reporter_id = me and r.created_at > now() - interval '1 minute';
  if n >= 5 then raise exception 'rate limited'; end if;

  insert into public.reports (reporter_id, target_type, target_id, target_user_id, reason, details, snapshot)
  values (me, p_type, p_target_id, p_target_user, p_reason, d, snap)
  on conflict (reporter_id, target_type, target_id, target_user_id) do nothing;
  return jsonb_build_object('ok', true, 'duplicate', not found);
end;
$$;

-- ═════════════════════════════ Blocage ═════════════════════════════
create table if not exists public.blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked_idx on public.blocks (blocked_id);
alter table public.blocks enable row level security;
alter table public.blocks force row level security;
revoke all on public.blocks from anon, authenticated;

-- Bloquer : retire aussi les abonnements dans les deux sens.
create or replace function public.block_user(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'auth'; end if;
  if p_user is null or p_user = me then raise exception 'bad target'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user) then raise exception 'not found'; end if;
  if (select count(*) from public.blocks b where b.blocker_id = me) >= 1000 then raise exception 'too many blocks'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (me, p_user) on conflict do nothing;
  delete from public.follows f
  where (f.follower_id = me and f.following_id = p_user) or (f.follower_id = p_user and f.following_id = me);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.unblock_user(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  delete from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = p_user;
  return jsonb_build_object('ok', true);
end;
$$;

-- Mes blocages (pour masquer les contenus côté app)
create or replace function public.my_blocks()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.blocked_id, 'username', p.username, 'display_name', p.display_name,
           'avatar_url', p.avatar_url, 'created_at', b.created_at) order by b.created_at desc), '[]'::jsonb)
  from public.blocks b
  left join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid()
$$;

-- Un compte bloqué ne peut plus s'abonner (ni dans l'autre sens).
-- Nom choisi pour passer APRÈS « follows_guard » (ordre alphabétique) qui fixe follower_id.
create or replace function public.azuu_follow_block_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.blocks b
             where (b.blocker_id = new.following_id and b.blocked_id = new.follower_id)
                or (b.blocker_id = new.follower_id and b.blocked_id = new.following_id)) then
    raise exception 'blocked';
  end if;
  return new;
end;
$$;
drop trigger if exists follows_zblock_guard on public.follows;
create trigger follows_zblock_guard before insert on public.follows
  for each row execute function public.azuu_follow_block_guard();

-- … ni réagir à mes avis (pas de notification non plus, donc).
create or replace function public.azuu_reaction_block_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.blocks b where b.blocker_id = new.author_id and b.blocked_id = new.user_id) then
    raise exception 'blocked';
  end if;
  return new;
end;
$$;
do $$ begin
  if to_regclass('public.review_reactions') is not null then
    execute 'drop trigger if exists review_reactions_block_guard on public.review_reactions';
    execute 'create trigger review_reactions_block_guard before insert or update on public.review_reactions
               for each row execute function public.azuu_reaction_block_guard()';
  end if;
end $$;

-- … ni commenter mes avis.
do $$ begin
  if to_regclass('public.review_comments') is not null then
    execute 'drop trigger if exists review_comments_block_guard on public.review_comments';
    execute 'create trigger review_comments_block_guard before insert on public.review_comments
               for each row execute function public.azuu_reaction_block_guard()';
  end if;
end $$;

-- ═════════════════════════════ Administration ═════════════════════════════

-- Petite carte « compte » pour l'admin
create or replace function public.azuu_admin_card(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p.id is null then null else jsonb_build_object(
    'id', p.id, 'username', p.username, 'display_name', p.display_name,
    'avatar_url', p.avatar_url, 'suspended', p.suspended,
    'is_admin', exists (select 1 from public.admins a where a.user_id = p.id)) end
  from (select 1) x left join public.profiles p on p.id = p_user
$$;

-- File des signalements, regroupés par cible.
-- p_status = 'open'   : cibles ayant au moins un signalement ouvert (les plus signalées d'abord, puis les plus anciennes)
--          = 'closed' : cibles entièrement traitées (les plus récentes d'abord)
create or replace function public.admin_reports(p_status text default 'open', p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  res jsonb;
  open_q boolean := coalesce(p_status, 'open') = 'open';
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  with g as (
    select r.target_type, r.target_id, r.target_user_id,
           count(*)::int as total,
           (count(*) filter (where r.status = 'open'))::int as open_count,
           min(r.created_at) as first_at,
           max(r.created_at) as last_at,
           (array_agg(r.status order by r.resolved_at desc nulls last, r.created_at desc))[1] as last_status
    from public.reports r
    group by r.target_type, r.target_id, r.target_user_id
  ),
  page as (
    select g.* from g
    where (open_q and g.open_count > 0) or (not open_q and g.open_count = 0)
    order by case when open_q then g.total end desc nulls last,
             case when open_q then g.first_at end asc nulls last,
             g.last_at desc
    offset greatest(coalesce(p_offset, 0), 0) limit 30
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'target_type', pg.target_type,
    'target_id', pg.target_id,
    'target_user', public.azuu_admin_card(pg.target_user_id),
    'total', pg.total,
    'open_count', pg.open_count,
    'first_at', pg.first_at,
    'last_at', pg.last_at,
    'status', case when pg.open_count > 0 then 'open' else pg.last_status end,
    -- motif -> nombre
    'reasons', (select jsonb_object_agg(x.reason, x.c) from (
        select r.reason, count(*)::int c from public.reports r
        where r.target_type = pg.target_type and r.target_id = pg.target_id and r.target_user_id = pg.target_user_id
        group by r.reason) x),
    -- 10 derniers signalements (avec précision)
    'reports', (select coalesce(jsonb_agg(y.e order by y.created_at desc), '[]'::jsonb) from (
        select jsonb_build_object('reason', r.reason, 'details', r.details, 'created_at', r.created_at, 'status', r.status,
                                  'reporter', public.azuu_admin_card(r.reporter_id)) e, r.created_at
        from public.reports r
        where r.target_type = pg.target_type and r.target_id = pg.target_id and r.target_user_id = pg.target_user_id
        order by r.created_at desc limit 10) y),
    -- Contenu au moment du (dernier) signalement
    'snapshot', (select r.snapshot from public.reports r
        where r.target_type = pg.target_type and r.target_id = pg.target_id and r.target_user_id = pg.target_user_id
          and r.snapshot is not null order by r.created_at desc limit 1),
    -- Contenu actuel (null s'il a été effacé)
    'current', case pg.target_type
        when 'review' then (select jsonb_build_object('title', left(i.data->>'title', 200), 'notes', left(i.data->>'notes', 3000),
                                                      'rating', i.data->'rating')
                            from public.items i where i.user_id = pg.target_user_id and i.id = pg.target_id
                              and not i.deleted and coalesce(i.data->>'notes', '') <> '')
        when 'profile' then (select jsonb_build_object('username', p.username, 'display_name', p.display_name, 'bio', p.bio,
                                                       'avatar_url', p.avatar_url, 'banner_url', p.banner_url)
                             from public.profiles p where p.id = pg.target_user_id)
        when 'comment' then (select jsonb_build_object('body', left(c.body, 500))
                             from public.review_comments c
                             where pg.target_id ~ '^[0-9]{1,18}$' and c.id = pg.target_id::bigint and c.user_id = pg.target_user_id)
        when 'list' then (select jsonb_build_object('name', l.name)
                          from public.shared_lists l
                          where pg.target_id ~ '^[0-9a-f-]{36}$' and l.id = pg.target_id::uuid and l.owner_id = pg.target_user_id)
        else null end,
    -- Antécédents : nombre de contenus différents de ce compte déjà signalés
    'user_reported_targets', (select count(distinct (r.target_type, r.target_id))::int from public.reports r
        where r.target_user_id = pg.target_user_id)
  ) order by case when open_q then pg.total end desc nulls last,
             case when open_q then pg.first_at end asc nulls last,
             pg.last_at desc), '[]'::jsonb)
  into res
  from page pg;
  return res;
end;
$$;

-- Action sur une cible signalée.
-- p_action : 'delete' (efface le contenu + résout), 'suspend' (suspend l'auteur + résout),
--            'unsuspend', 'dismiss' (classe sans suite), 'resolve' (marque résolu)
create or replace function public.admin_report_action(p_type text, p_target_id text, p_target_user uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  n integer := 0;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_type is null or p_type not in ('review', 'profile', 'comment', 'list') then raise exception 'bad type'; end if;
  if p_action is null or p_action not in ('delete', 'suspend', 'unsuspend', 'dismiss', 'resolve') then raise exception 'bad action'; end if;
  if p_target_user is null then raise exception 'bad target'; end if;

  if p_action = 'delete' then
    if p_type = 'review' then
      -- Même chemin que l'onglet « Avis » (renvoyé à l'appareil du membre à la synchro)
      perform public.admin_clear_review(p_target_user, p_target_id);
    elsif p_type = 'profile' then
      if p_target_id <> p_target_user::text then raise exception 'bad target'; end if;
      -- Remet le profil à zéro : bio, photo et bannière effacées, nom affiché = pseudo
      update public.profiles p set bio = '', avatar_url = null, banner_url = null, display_name = p.username
      where p.id = p_target_user;
    elsif p_type = 'comment' then
      if p_target_id !~ '^[0-9]{1,18}$' then raise exception 'bad target'; end if;
      delete from public.review_comments c where c.id = p_target_id::bigint and c.user_id = p_target_user;
    else
      if p_target_id !~ '^[0-9a-f-]{36}$' then raise exception 'bad target'; end if;
      -- Supprime la liste (membres et titres partent en cascade)
      delete from public.shared_lists l where l.id = p_target_id::uuid and l.owner_id = p_target_user;
    end if;
  elsif p_action in ('suspend', 'unsuspend') then
    if p_target_user = me then raise exception 'cannot suspend yourself'; end if;
    if p_action = 'suspend' and exists (select 1 from public.admins a where a.user_id = p_target_user) then
      raise exception 'cannot suspend an admin';
    end if;
    update public.profiles set suspended = (p_action = 'suspend') where id = p_target_user;
  end if;

  if p_action in ('delete', 'suspend', 'resolve', 'dismiss') then
    update public.reports r
    set status = case when p_action = 'dismiss' then 'dismissed' else 'resolved' end,
        resolved_by = me, resolved_at = now()
    where r.target_type = p_type and r.target_id = p_target_id and r.target_user_id = p_target_user and r.status = 'open';
    get diagnostics n = row_count;
  end if;

  -- (suspensions déjà journalisées par le déclencheur)
  if p_action not in ('suspend', 'unsuspend') then
    insert into public.moderation_log (admin_id, action, target_type, target_id, target_user_id)
    values (me, 'report_' || p_action, p_type, p_target_id, p_target_user);
  end if;
  return jsonb_build_object('ok', true, 'reports', n);
end;
$$;

-- Comptes suspendus (les plus récemment suspendus d'abord)
create or replace function public.admin_suspended_users(p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(x.e order by x.since desc nulls last, x.username), '[]'::jsonb) into res
  from (
    select p.username,
           l.created_at as since,
           jsonb_build_object(
             'id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url,
             'suspended_at', l.created_at,
             'suspended_by', case when l.admin_id is null then null else
                               (select a.username from public.profiles a where a.id = l.admin_id) end,
             'reports', (select count(*)::int from public.reports r where r.target_user_id = p.id),
             'created_at', p.created_at) e
    from public.profiles p
    left join lateral (
      select ml.created_at, ml.admin_id from public.moderation_log ml
      where ml.target_user_id = p.id and ml.action = 'suspend'
      order by ml.created_at desc limit 1
    ) l on true
    where p.suspended
    order by l.created_at desc nulls last, p.username
    offset greatest(coalesce(p_offset, 0), 0) limit 50
  ) x;
  return res;
end;
$$;

-- ═════════════════════════════ Droits ═════════════════════════════
revoke all on function public.azuu_suspended_guard() from public, anon, authenticated;
revoke all on function public.azuu_suspended_log() from public, anon, authenticated;
revoke all on function public.azuu_follow_block_guard() from public, anon, authenticated;
revoke all on function public.azuu_reaction_block_guard() from public, anon, authenticated;
revoke all on function public.azuu_admin_card(uuid) from public, anon, authenticated;

revoke all on function public.report_content(text, text, uuid, text, text) from public, anon;
revoke all on function public.block_user(uuid) from public, anon;
revoke all on function public.unblock_user(uuid) from public, anon;
revoke all on function public.my_blocks() from public, anon;
revoke all on function public.admin_reports(text, integer) from public, anon;
revoke all on function public.admin_report_action(text, text, uuid, text) from public, anon;
revoke all on function public.admin_suspended_users(integer) from public, anon;

grant execute on function public.report_content(text, text, uuid, text, text) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.my_blocks() to authenticated;
grant execute on function public.admin_reports(text, integer) to authenticated;
grant execute on function public.admin_report_action(text, text, uuid, text) to authenticated;
grant execute on function public.admin_suspended_users(integer) to authenticated;

-- ▼▼▼ 20261009160100_bugs_errors.sql ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
-- AzuuCine — « Signaler un bug » + remontée d'erreurs (9 octobre 2026)
--  1. bug_reports   : formulaire des Réglages (comptes connectés, 5 par jour).
--  2. client_errors : erreurs JavaScript de l'app, regroupées par empreinte, sans donnée perso
--                     (équivalent Sentry minimal, sans service tiers). Écriture ouverte à anon
--                     mais bornée (taille, débit par empreinte et par heure, taille de la table).
--  3. admin_alerts  : compteurs pour le badge de l'administration.
--
-- À coller dans Supabase → SQL Editor → Run, APRÈS 20261009160000_moderation.sql.
-- Idempotent (réexécutable sans risque).
-- ════════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════ Nettoyage des textes ═════════════════════════════
-- Retire ce qui pourrait identifier quelqu'un : e-mails, jetons (JWT, clés), UUID,
-- paramètres d'URL (?…, #…), longues suites de chiffres.
create or replace function public.azuu_scrub(p text, p_max integer)
returns text language sql immutable set search_path = '' as $$
  select left(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(coalesce(p, ''), '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'),
      '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g'),
      'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]*)?', '[token]', 'g'),
      '(sb_(publishable|secret)_|sk_|pk_)[A-Za-z0-9_-]+', '[key]', 'g'),
      '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', '[id]', 'g'),
      '(https?://[^\s?#''"()]+)[?#][^\s''"()]*', '\1', 'g'),
      '[A-Za-z0-9_-]{40,}', '[token]', 'g'),
    greatest(p_max, 0))
$$;
revoke all on function public.azuu_scrub(text, integer) from public, anon, authenticated;

-- ═════════════════════════════ Signaler un bug ═════════════════════════════
create table if not exists public.bug_reports (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  description text not null check (char_length(description) between 10 and 2000),
  -- Infos techniques (version, navigateur, langue, thème, écran, page) — liste blanche de clés
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object' and octet_length(context::text) <= 2000),
  status text not null default 'new' check (status in ('new', 'in_progress', 'fixed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bug_reports_status_idx on public.bug_reports (status, created_at desc);
create index if not exists bug_reports_user_idx on public.bug_reports (user_id, created_at desc);
alter table public.bug_reports enable row level security;
alter table public.bug_reports force row level security;
revoke all on public.bug_reports from anon, authenticated;

create or replace function public.submit_bug_report(p_description text, p_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  d text;
  ctx jsonb := '{}'::jsonb;
  k text;
  new_id bigint;
begin
  if me is null then raise exception 'auth'; end if;
  d := trim(regexp_replace(coalesce(p_description, ''), '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'));
  if char_length(d) < 10 then raise exception 'too short'; end if;
  if char_length(d) > 2000 then raise exception 'too long'; end if;
  if (select count(*) from public.bug_reports b where b.user_id = me and b.created_at > now() - interval '1 day') >= 5 then
    raise exception 'rate limited';
  end if;
  -- Seules ces clés sont gardées, en texte court nettoyé
  if jsonb_typeof(p_context) = 'object' then
    foreach k in array array['version', 'browser', 'os', 'lang', 'theme', 'screen', 'viewport', 'route', 'online', 'standalone'] loop
      if p_context ? k and jsonb_typeof(p_context->k) in ('string', 'number', 'boolean') then
        ctx := ctx || jsonb_build_object(k, public.azuu_scrub(p_context->>k, 80));
      end if;
    end loop;
  end if;
  insert into public.bug_reports (user_id, description, context) values (me, d, ctx) returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;

create or replace function public.admin_bug_reports(p_status text default null, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(x.e order by x.rank, x.created_at desc), '[]'::jsonb) into res
  from (
    select b.created_at,
           case b.status when 'new' then 0 when 'in_progress' then 1 else 2 end as rank,
           jsonb_build_object('id', b.id, 'description', b.description, 'context', b.context, 'status', b.status,
                              'created_at', b.created_at, 'updated_at', b.updated_at,
                              'reporter', public.azuu_admin_card(b.user_id)) e
    from public.bug_reports b
    where p_status is null or b.status = p_status
    order by case b.status when 'new' then 0 when 'in_progress' then 1 else 2 end, b.created_at desc
    offset greatest(coalesce(p_offset, 0), 0) limit 30
  ) x;
  return res;
end;
$$;

create or replace function public.admin_set_bug_status(p_id bigint, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_status is null or p_status not in ('new', 'in_progress', 'fixed') then raise exception 'bad status'; end if;
  update public.bug_reports set status = p_status, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', found);
end;
$$;

-- ═════════════════════════════ Remontée d'erreurs ═════════════════════════════
create table if not exists public.client_errors (
  fingerprint text primary key check (fingerprint ~ '^[0-9a-f]{32}$'),
  source text not null default 'error' check (source in ('error', 'rejection', 'render')),
  message text not null check (char_length(message) between 1 and 500),
  stack text check (stack is null or char_length(stack) <= 4000),
  url text check (url is null or char_length(url) <= 300),
  app_version text check (app_version is null or char_length(app_version) <= 40),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  count integer not null default 1,
  -- Débit : nombre d'occurrences dans l'heure en cours (au-delà de 100, on ne compte plus)
  hour_start timestamptz not null default date_trunc('hour', now()),
  hour_count integer not null default 1,
  status text not null default 'new' check (status in ('new', 'seen', 'fixed')),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index if not exists client_errors_last_idx on public.client_errors (last_seen desc);
create index if not exists client_errors_first_idx on public.client_errors (first_seen desc);
alter table public.client_errors enable row level security;
alter table public.client_errors force row level security;
revoke all on public.client_errors from anon, authenticated;

-- Appelée par l'app (avec ou sans compte). Ne renvoie rien d'utile à un attaquant.
create or replace function public.log_client_error(
  p_message text, p_stack text default null, p_url text default null,
  p_version text default null, p_ua text default null, p_source text default 'error'
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  msg text;
  st text;
  u text;
  v text;
  ua text;
  src text;
  first_line text;
  fp text;
begin
  -- Corps trop gros : on ignore sans rien analyser
  if p_message is null or octet_length(p_message) > 4000 or octet_length(coalesce(p_stack, '')) > 20000
     or octet_length(coalesce(p_url, '')) > 2000 or octet_length(coalesce(p_ua, '')) > 1000 then
    return;
  end if;
  msg := nullif(trim(public.azuu_scrub(p_message, 500)), '');
  if msg is null then return; end if;
  st := nullif(trim(public.azuu_scrub(p_stack, 4000)), '');
  -- Adresse : origine + chemin seulement (ni paramètres ni ancre)
  u := nullif(left(regexp_replace(coalesce(p_url, ''), '[?#].*$', ''), 300), '');
  if u is not null and u !~ '^https?://[^\s]+$' then u := null; end if;
  if u is not null then u := public.azuu_scrub(u, 300); end if;
  v := case when coalesce(p_version, '') ~ '^[0-9A-Za-z._+-]{1,40}$' then p_version end;
  ua := nullif(public.azuu_scrub(p_ua, 300), '');
  src := case when p_source in ('error', 'rejection', 'render') then p_source else 'error' end;

  -- Empreinte calculée ici (pas par le client) : message sans nombres + 1re ligne de pile sans n° de ligne
  first_line := coalesce((regexp_match(coalesce(st, ''), '([^\n]*\S[^\n]*)'))[1], '');
  -- La 1re ligne de pile répète souvent le message (Chrome : « TypeError: … ») : on prend la 1re ligne « at … »
  first_line := coalesce((regexp_match(coalesce(st, ''), '\n\s*(at [^\n]+|[^\n]*@[^\n]+)'))[1], first_line);
  fp := md5(src || '|' || regexp_replace(lower(msg), '[0-9]+', '0', 'g') || '|'
            || regexp_replace(regexp_replace(first_line, ':[0-9]+(:[0-9]+)?', '', 'g'), '-[A-Za-z0-9_-]{8}\.js', '.js', 'g'));

  if not exists (select 1 from public.client_errors e where e.fingerprint = fp) then
    -- Nouvelles empreintes : 30 par heure maximum (inondation d'erreurs inventées)
    if (select count(*) from public.client_errors e where e.first_seen > now() - interval '1 hour') >= 30 then
      return;
    end if;
    -- Table bornée : au-delà de 2000 empreintes, on oublie les plus anciennes
    delete from public.client_errors e where e.fingerprint in (
      select e2.fingerprint from public.client_errors e2 order by e2.last_seen desc offset 1999
    );
  end if;

  insert into public.client_errors as e (fingerprint, source, message, stack, url, app_version, user_agent)
  values (fp, src, msg, st, u, v, ua)
  on conflict (fingerprint) do update set
    count = e.count + case when e.hour_start < date_trunc('hour', now()) or e.hour_count < 100 then 1 else 0 end,
    hour_count = case when e.hour_start < date_trunc('hour', now()) then 1 else least(e.hour_count + 1, 100) end,
    hour_start = date_trunc('hour', now()),
    last_seen = now(),
    url = coalesce(excluded.url, e.url),
    app_version = coalesce(excluded.app_version, e.app_version),
    user_agent = coalesce(excluded.user_agent, e.user_agent),
    -- Une erreur marquée « corrigée » qui revient redevient « nouvelle » (régression)
    status = case when e.status = 'fixed' then 'new' else e.status end;
end;
$$;

create or replace function public.admin_client_errors(p_status text default null, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) - 'hour_start' - 'hour_count' order by x.last_seen desc), '[]'::jsonb) into res
  from (
    select * from public.client_errors e
    where p_status is null or e.status = p_status
    order by e.last_seen desc
    offset greatest(coalesce(p_offset, 0), 0) limit 50
  ) x;
  return res;
end;
$$;

-- p_fingerprint null + 'seen' : tout marquer comme vu (à l'ouverture de l'onglet)
create or replace function public.admin_set_error_status(p_fingerprint text, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_status is null or p_status not in ('new', 'seen', 'fixed', 'delete') then raise exception 'bad status'; end if;
  if p_fingerprint is null then
    if p_status <> 'seen' then raise exception 'bad status'; end if;
    update public.client_errors set status = 'seen' where status = 'new';
  elsif p_status = 'delete' then
    delete from public.client_errors where fingerprint = p_fingerprint;
  else
    update public.client_errors set status = p_status where fingerprint = p_fingerprint;
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'count', n);
end;
$$;

-- Compteurs du badge « Administration »
create or replace function public.admin_alerts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'reports', (select count(*)::int from (select 1 from public.reports r where r.status = 'open'
                                           group by r.target_type, r.target_id, r.target_user_id) t),
    'bugs', (select count(*)::int from public.bug_reports b where b.status = 'new'),
    'errors', (select count(*)::int from public.client_errors e where e.status = 'new'),
    'suspended', (select count(*)::int from public.profiles p where p.suspended)
  );
end;
$$;

-- ═════════════════════════════ Droits ═════════════════════════════
revoke all on function public.submit_bug_report(text, jsonb) from public, anon;
revoke all on function public.admin_bug_reports(text, integer) from public, anon;
revoke all on function public.admin_set_bug_status(bigint, text) from public, anon;
revoke all on function public.log_client_error(text, text, text, text, text, text) from public;
revoke all on function public.admin_client_errors(text, integer) from public, anon;
revoke all on function public.admin_set_error_status(text, text) from public, anon;
revoke all on function public.admin_alerts() from public, anon;

grant execute on function public.submit_bug_report(text, jsonb) to authenticated;
grant execute on function public.admin_bug_reports(text, integer) to authenticated;
grant execute on function public.admin_set_bug_status(bigint, text) to authenticated;
-- Seule fonction ouverte aux visiteurs non connectés (l'écran de connexion peut planter aussi)
grant execute on function public.log_client_error(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.admin_client_errors(text, integer) to authenticated;
grant execute on function public.admin_set_error_status(text, text) to authenticated;
grant execute on function public.admin_alerts() to authenticated;

-- ▼▼▼ Adresse de la fonction send-push (lue par le déclencheur des notifications push) ▼▼▼
select vault.create_secret('https://qfgnxonqwldcfdjqhhjz.supabase.co/functions/v1/send-push', 'azuu_push_url')
where not exists (select 1 from vault.secrets where name = 'azuu_push_url');
