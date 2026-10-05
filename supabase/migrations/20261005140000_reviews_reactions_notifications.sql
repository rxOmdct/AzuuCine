-- ════════════════════════════════════════════════════════════════════════════
-- AzuuCine — Avis par titre, réactions et notifications (5 octobre 2026)
--  1. Voir tous les avis sur un titre (amis / autres).
--  2. Réagir aux avis (emoji).
--  3. Notifications (cloche) : abonnements, demandes acceptées, réactions reçues.
--
-- À coller dans Supabase → SQL Editor → Run. Idempotent (réexécutable sans risque).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Tables ──
create table if not exists public.review_reactions (
  author_id uuid not null references auth.users(id) on delete cascade,  -- auteur de l'avis
  item_id text not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,  -- qui réagit
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (author_id, item_id, user_id)
);
create index if not exists review_reactions_target_idx on public.review_reactions (author_id, item_id);
alter table public.review_reactions enable row level security;
alter table public.review_reactions force row level security;
revoke all on public.review_reactions from anon, authenticated;

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,  -- destinataire
  kind text not null check (kind in ('follow_request','follow_accepted','new_follower','reaction')),
  actor_id uuid references auth.users(id) on delete cascade,
  item_id text,
  emoji text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
alter table public.notifications force row level security;
revoke all on public.notifications from anon, authenticated;

-- ── Création de notifications + bornage de l'historique ──
create or replace function public.azuu_notify(p_user uuid, p_kind text, p_actor uuid, p_item text default null, p_emoji text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null or p_actor is null or p_user = p_actor then return; end if;
  insert into public.notifications (user_id, kind, actor_id, item_id, emoji)
  values (p_user, p_kind, p_actor, p_item, p_emoji);
  delete from public.notifications
  where user_id = p_user and id not in (
    select id from public.notifications where user_id = p_user order by created_at desc limit 300
  );
end;
$$;

-- Abonnement / demande -> notifie le compte suivi ; demande acceptée -> notifie le demandeur
create or replace function public.azuu_follow_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.azuu_notify(new.following_id,
      case when new.status = 'pending' then 'follow_request' else 'new_follower' end, new.follower_id);
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    perform public.azuu_notify(new.follower_id, 'follow_accepted', new.following_id);
  end if;
  return null;
end;
$$;
drop trigger if exists follows_notify on public.follows;
create trigger follows_notify after insert or update on public.follows
  for each row execute function public.azuu_follow_notify();

-- Réaction reçue -> notifie l'auteur de l'avis
create or replace function public.azuu_reaction_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.azuu_notify(new.author_id, 'reaction', new.user_id, new.item_id, new.emoji);
  return null;
end;
$$;
drop trigger if exists reactions_notify on public.review_reactions;
create trigger reactions_notify after insert on public.review_reactions
  for each row execute function public.azuu_reaction_notify();

-- ── Réagir à un avis ──
create or replace function public.react_to_review(p_author uuid, p_item text, p_emoji text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  if p_author = auth.uid() then raise exception 'cannot react to your own review'; end if;
  if p_emoji is null or p_emoji <> all (array['👍','❤️','🔥','😂','😮','😢']) then raise exception 'bad emoji'; end if;
  if not public.can_view(p_author) or not exists (
    select 1 from public.items i join public.profiles pr on pr.id = i.user_id
    where i.user_id = p_author and i.id = p_item and not i.deleted
      and coalesce(i.data->>'notes','') <> '' and not pr.suspended
  ) then
    raise exception 'review not found';
  end if;
  insert into public.review_reactions (author_id, item_id, user_id, emoji)
  values (p_author, p_item, auth.uid(), p_emoji)
  on conflict (author_id, item_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.unreact_review(p_author uuid, p_item text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  delete from public.review_reactions where author_id = p_author and item_id = p_item and user_id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

-- ── Tous les avis sur un titre (amis / autres) ──
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
           i.data->>'notes' as notes, pr,
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
      (select emoji from public.review_reactions rr where rr.author_id = r.user_id and rr.item_id = r.item_id and rr.user_id = me) as mine
    from revs r
  )
  select jsonb_build_object(
    'friends', coalesce((select jsonb_agg(entry order by total desc, updated_at desc) from (
        select jsonb_build_object('user', public.profile_card(pr), 'user_id', user_id, 'item_id', item_id,
               'updated_at', updated_at, 'rating', rating, 'notes', notes,
               'reactions', reactions, 'total', total, 'mine', mine) entry, total, updated_at
        from enriched where friend offset greatest(p_offset, 0) limit 40) f), '[]'::jsonb),
    'others', coalesce((select jsonb_agg(entry order by total desc, updated_at desc) from (
        select jsonb_build_object('user', public.profile_card(pr), 'user_id', user_id, 'item_id', item_id,
               'updated_at', updated_at, 'rating', rating, 'notes', notes,
               'reactions', reactions, 'total', total, 'mine', mine) entry, total, updated_at
        from enriched where not friend offset greatest(p_offset, 0) limit 40) o), '[]'::jsonb)
  ) into res;
  return res;
end;
$$;

-- ── Notifications ──
create or replace function public.get_notifications(p_offset integer default 0)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by created_at desc), '[]'::jsonb)
  from (
    select n.id, n.kind, n.created_at, n.read_at, n.emoji, n.item_id,
      case when p.id is null then null else
        jsonb_build_object('username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url) end as actor,
      case when n.kind = 'reaction'
        then (select it.data->>'title' from public.items it where it.user_id = n.user_id and it.id = n.item_id) end as title
    from public.notifications n
    left join public.profiles p on p.id = n.actor_id
    where n.user_id = auth.uid()
    order by n.created_at desc
    offset greatest(p_offset, 0) limit 30
  ) x
$$;

create or replace function public.notifications_unread()
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.notifications where user_id = auth.uid() and read_at is null
$$;

create or replace function public.mark_notifications_read()
returns void language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null
$$;

-- ── Droits (gate interne : auth.uid() / can_view) ──
revoke all on function public.react_to_review(uuid, text, text) from public, anon;
revoke all on function public.unreact_review(uuid, text) from public, anon;
revoke all on function public.title_reviews(text, integer) from public, anon;
revoke all on function public.get_notifications(integer) from public, anon;
revoke all on function public.notifications_unread() from public, anon;
revoke all on function public.mark_notifications_read() from public, anon;
grant execute on function public.react_to_review(uuid, text, text) to authenticated;
grant execute on function public.unreact_review(uuid, text) to authenticated;
grant execute on function public.title_reviews(text, integer) to authenticated;
grant execute on function public.get_notifications(integer) to authenticated;
grant execute on function public.notifications_unread() to authenticated;
grant execute on function public.mark_notifications_read() to authenticated;
