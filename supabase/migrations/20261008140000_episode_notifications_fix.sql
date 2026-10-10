-- ─────────────────────────────────────────────────────────────────────────────
-- AzuuCine — notifications « nouvel épisode » : seulement les VRAIS nouveaux épisodes
--
-- Avant : l'app envoyait « épisodes sortis − épisodes vus », donc Friends (5/228 vus)
-- donnait « 223 nouveaux épisodes », et des séries terminées (Naruto) recevaient
-- une « nouvelle saison » à cause d'une numérotation différente TMDB / AniList.
--
-- Maintenant le serveur retient le dernier épisode connu de chaque série (episode_seen) :
--  - premier passage : on mémorise, aucune notification (le passé n'est pas « nouveau ») ;
--  - ensuite : notification seulement si un épisode plus récent est sorti ;
--  - jamais pour une série abandonnée (une série que j'ai terminée peut avoir une nouvelle saison) ;
--  - l'app n'envoie plus les séries dont la diffusion est finie (ex. Friends) ;
--  - un saut de plus de 30 épisodes est ignoré (décalage de numérotation entre bases).
-- Fonctionne quelle que soit la version de l'app (le calcul côté client n'est plus cru).
--
-- À coller dans Supabase → SQL Editor → Run. Peut être relancé sans risque.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.episode_seen (
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id text not null,
  last_episode integer not null check (last_episode between 0 and 1000000),
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
alter table public.episode_seen enable row level security;
alter table public.episode_seen force row level security;
-- Accessible uniquement via add_episode_notifications (security definer)
revoke all on public.episode_seen from public, anon, authenticated;

create or replace function public.add_episode_notifications(p_list jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  me uuid := auth.uid();
  e jsonb;
  k text;
  st text;
  ep integer;
  prev integer;
  n integer := 0;
begin
  if me is null or jsonb_typeof(p_list) is distinct from 'array' then return 0; end if;
  if not public.azuu_wants(me, 'new_episode') then return 0; end if;
  for e in select value from jsonb_array_elements(p_list) limit 50 loop
    k := e->>'kind';
    if k is null or k not in ('new_episode', 'new_season') then continue; end if;
    if coalesce(e->>'episode', '') !~ '^[0-9]{1,6}$' or coalesce(e->>'count', '1') !~ '^[0-9]{1,4}$' then continue; end if;
    select i.data->>'status' into st from public.items i where i.user_id = me and i.id = e->>'item_id' and not i.deleted;
    if not found then continue; end if;
    ep := (e->>'episode')::int;
    select s.last_episode into prev from public.episode_seen s where s.user_id = me and s.item_id = e->>'item_id';
    insert into public.episode_seen (user_id, item_id, last_episode) values (me, e->>'item_id', ep)
      on conflict (user_id, item_id) do update
      set last_episode = greatest(public.episode_seen.last_episode, excluded.last_episode), updated_at = now();
    if prev is null or ep <= prev or ep - prev > 30 or st = 'abandonne' then continue; end if;
    insert into public.notifications (user_id, kind, actor_id, item_id, episode, ep_count, dedup)
      values (me, k, null, e->>'item_id', ep, ep - prev, 'ep:' || (e->>'item_id') || ':' || ep)
      on conflict (user_id, dedup) where dedup is not null do nothing;
    if found then n := n + 1; end if;
  end loop;
  delete from public.notifications
  where user_id = me and id not in (
    select id from public.notifications where user_id = me order by created_at desc limit 300
  );
  return n;
end;
$fn$;

revoke all on function public.add_episode_notifications(jsonb) from public, anon;
grant execute on function public.add_episode_notifications(jsonb) to authenticated;

-- Les fausses notifications déjà créées par l'ancien calcul
delete from public.notifications n
where n.kind in ('new_episode', 'new_season')
  and not exists (select 1 from public.episode_seen s where s.user_id = n.user_id and s.item_id = n.item_id);
