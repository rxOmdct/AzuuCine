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
