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
