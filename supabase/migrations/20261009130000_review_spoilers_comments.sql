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
