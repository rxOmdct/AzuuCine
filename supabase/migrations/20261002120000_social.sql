-- ─────────────────────────────────────────────────────────────────────────────
-- AzuuCine — profils, abonnements et fil d'activité
--
-- À coller dans Supabase → SQL Editor → Run, APRÈS le premier fichier (…_azuucine.sql).
-- Peut être relancé sans risque.
--
-- Principes de confidentialité :
--  - Les tables de données (items, lists, settings) restent visibles uniquement par leur propriétaire.
--  - Les autres ne voient un profil QUE via les fonctions ci-dessous (get_profile, get_feed…),
--    qui vérifient l'accès (profil public, ou abonné accepté pour un compte privé) et retirent
--    les infos privées : avis écrits (sauf ceux marqués publics), listes perso.
--  - Les pseudos sont choisis par chacun ; aucun email n'est jamais exposé.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════ Profils ═════════════════════════════
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  bio text not null default '' check (char_length(bio) <= 300),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 500),
  banner_url text check (banner_url is null or char_length(banner_url) <= 500),
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_display_name_idx on public.profiles (lower(display_name));

-- Pseudo de départ aléatoire (l'email n'est jamais utilisé : il resterait visible de tous)
create or replace function public.azuu_random_username()
returns text
language plpgsql
set search_path = ''
as $$
declare
  candidate text;
begin
  loop
    candidate := 'cinephile_' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    exit when not exists (select 1 from public.profiles where username = candidate);
  end loop;
  return candidate;
end;
$$;

-- Création automatique du profil à l'inscription
create or replace function public.azuu_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  u text := public.azuu_random_username();
  -- Connexion Google : on reprend le nom du compte comme nom affiché (le pseudo reste à choisir)
  n text := left(trim(regexp_replace(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), '[[:cntrl:]]', '', 'g')), 40);
begin
  begin
    insert into public.profiles (id, username, display_name) values (new.id, u, coalesce(nullif(n, ''), u)) on conflict (id) do nothing;
  exception when others then
    -- Nom refusé : on garde le pseudo (l'inscription ne doit jamais échouer pour ça)
    insert into public.profiles (id, username, display_name) values (new.id, u, u) on conflict (id) do nothing;
  end;
  return new;
end;
$$;

drop trigger if exists azuu_on_auth_user_created on auth.users;
create trigger azuu_on_auth_user_created after insert on auth.users
  for each row execute function public.azuu_new_user();

-- Profils des comptes déjà existants
insert into public.profiles (id, username, display_name)
select u.id, x.name, x.name
from auth.users u
cross join lateral (select public.azuu_random_username() as name) x
where not exists (select 1 from public.profiles p where p.id = u.id);

-- Contrôles à chaque modification de profil
create or replace function public.azuu_profile_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  media text := '^https?://[^/?#]+/storage/v1/object/public/profile-media/' || new.id::text || '/[A-Za-z0-9_.-]{1,80}$';
begin
  if tg_op = 'UPDATE' and new.id <> old.id then
    raise exception 'id is immutable';
  end if;
  new.username := lower(trim(new.username));
  new.display_name := trim(regexp_replace(new.display_name, '[[:cntrl:]]', '', 'g'));
  new.bio := trim(regexp_replace(new.bio, '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'));
  if new.username in ('admin', 'administrator', 'azuucine', 'support', 'moderator', 'root', 'system', 'null', 'undefined', 'me', 'settings') then
    raise exception 'username reserved';
  end if;
  -- Les images ne peuvent venir que du dossier de l'utilisateur dans le stockage de l'app
  if new.avatar_url is not null and new.avatar_url !~ media then
    raise exception 'invalid avatar url';
  end if;
  if new.banner_url is not null and new.banner_url !~ media then
    raise exception 'invalid banner url';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before insert or update on public.profiles
  for each row execute function public.azuu_profile_guard();

-- ═════════════════════════════ Abonnements ═════════════════════════════
create table if not exists public.follows (
  follower_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  following_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create index if not exists follows_following_idx on public.follows (following_id, status);

create or replace function public.azuu_follow_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_private boolean;
begin
  if tg_op = 'INSERT' then
    -- On ne peut s'abonner qu'en son propre nom ; l'acceptation dépend du compte suivi
    new.follower_id := auth.uid();
    select is_private into target_private from public.profiles where id = new.following_id;
    if not found then
      raise exception 'profile not found';
    end if;
    new.status := case when target_private then 'pending' else 'accepted' end;
    new.created_at := now();
    if (select count(*) from public.follows where follower_id = new.follower_id) >= 2000 then
      raise exception 'too many follows';
    end if;
    return new;
  end if;
  -- UPDATE : seul le compte suivi peut accepter une demande, et rien d'autre ne peut changer
  if new.follower_id <> old.follower_id or new.following_id <> old.following_id then
    raise exception 'immutable';
  end if;
  if auth.uid() is distinct from old.following_id then
    raise exception 'only the followed account can accept';
  end if;
  new.status := 'accepted';
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists follows_guard on public.follows;
create trigger follows_guard before insert or update on public.follows
  for each row execute function public.azuu_follow_guard();

-- Passer son compte en public accepte les demandes en attente
create or replace function public.azuu_profile_public()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_private and not new.is_private then
    update public.follows set status = 'accepted' where following_id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_public on public.profiles;
create trigger profiles_public after update of is_private on public.profiles
  for each row execute function public.azuu_profile_public();

-- ═════════════════════════════ Activité ═════════════════════════════
-- Seulement « qui a fait quoi et quand » : le contenu (titre, affiche, note) est relu sur la fiche
-- au moment de l'affichage, donc une fiche supprimée disparaît aussi du fil.
create table if not exists public.activity (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id text not null,
  kind text not null check (kind in ('finished', 'started', 'rewatched', 'added')),
  created_at timestamptz not null default now()
);

create index if not exists activity_user_idx on public.activity (user_id, created_at desc);

create or replace function public.azuu_day(v text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if v ~ '^\d{4}-\d{2}-\d{2}$' then
    return v::date;
  end if;
  return null;
exception when others then
  return null;
end;
$$;

create or replace function public.azuu_log(p_user uuid, p_item text, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Pas de doublon pour la même fiche dans la journée
  delete from public.activity
  where user_id = p_user and item_id = p_item and kind = p_kind and created_at > now() - interval '1 day';
  insert into public.activity (user_id, item_id, kind) values (p_user, p_item, p_kind);
  -- On garde les 500 dernières activités par compte
  delete from public.activity
  where user_id = p_user and id in (
    select id from public.activity where user_id = p_user order by created_at desc offset 500
  );
end;
$$;

-- Déduit l'activité des modifications de fiches (les vieux titres importés ne remplissent pas le fil)
create or replace function public.azuu_item_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  st text;
  old_st text;
  recent date := current_date - 7;
  rw_new int := 0;
  rw_old int := 0;
begin
  if new.deleted or new.data is null then
    return new;
  end if;
  st := new.data->>'status';
  if jsonb_typeof(new.data->'rewatchDates') = 'array' then
    rw_new := jsonb_array_length(new.data->'rewatchDates');
  end if;
  if tg_op = 'UPDATE' then
    if not old.deleted and old.data is not null then
      old_st := old.data->>'status';
      if jsonb_typeof(old.data->'rewatchDates') = 'array' then
        rw_old := jsonb_array_length(old.data->'rewatchDates');
      end if;
    end if;
  end if;

  if st = 'termine' and old_st is distinct from 'termine'
     and coalesce(public.azuu_day(new.data->>'endDate'), current_date) >= recent then
    perform public.azuu_log(new.user_id, new.id, 'finished');
  elsif st = 'en_cours' and old_st is distinct from 'en_cours'
     and coalesce(public.azuu_day(new.data->>'startDate'), current_date) >= recent then
    perform public.azuu_log(new.user_id, new.id, 'started');
  elsif st = 'a_voir' and tg_op = 'INSERT' and new.updated_at > now() - interval '2 days' then
    perform public.azuu_log(new.user_id, new.id, 'added');
  end if;
  if tg_op = 'UPDATE' and rw_new > rw_old then
    perform public.azuu_log(new.user_id, new.id, 'rewatched');
  end if;
  return new;
end;
$$;

drop trigger if exists items_activity on public.items;
create trigger items_activity after insert or update on public.items
  for each row execute function public.azuu_item_activity();

-- ═════════════════════════════ Accès (RLS) ═════════════════════════════
alter table public.profiles enable row level security;
alter table public.follows enable row level security;
alter table public.activity enable row level security;
alter table public.profiles force row level security;
alter table public.follows force row level security;
alter table public.activity force row level security;

revoke all on public.profiles, public.follows, public.activity from anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.follows to authenticated;
grant select on public.activity to authenticated;

-- Pseudo, nom, photo, bannière et bio sont visibles des comptes connectés (comme sur Letterboxd,
-- même pour un compte privé) ; seul le propriétaire peut modifier son profil.
drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select to authenticated using (true);
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Abonnements : chacun voit ceux qui le concernent ; les listes publiques passent par les fonctions
drop policy if exists "own follows read" on public.follows;
create policy "own follows read" on public.follows for select to authenticated
  using ((select auth.uid()) in (follower_id, following_id));
drop policy if exists "follow someone" on public.follows;
create policy "follow someone" on public.follows for insert to authenticated
  with check ((select auth.uid()) = follower_id);
drop policy if exists "accept request" on public.follows;
create policy "accept request" on public.follows for update to authenticated
  using ((select auth.uid()) = following_id) with check ((select auth.uid()) = following_id);
drop policy if exists "unfollow or remove follower" on public.follows;
create policy "unfollow or remove follower" on public.follows for delete to authenticated
  using ((select auth.uid()) in (follower_id, following_id));

drop policy if exists "own activity read" on public.activity;
create policy "own activity read" on public.activity for select to authenticated
  using ((select auth.uid()) = user_id);

-- ═════════════════════════════ Fonctions de lecture ═════════════════════════════

-- Ai-je le droit de voir le contenu de ce profil ?
create or replace function public.can_view(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    owner = auth.uid()
    or exists (select 1 from public.profiles p where p.id = owner and not p.is_private)
    or exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.following_id = owner and f.status = 'accepted')
  )
$$;

-- Version publique d'une fiche : sans avis privé, sans listes perso, sans affiche trop lourde
create or replace function public.public_item(d jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when length(coalesce(x->>'poster', '')) > 150000 then x - 'poster' else x end
  -- Les avis sont publics (comme sur Letterboxd) ; les listes perso restent privées
  from (select d - 'listIds' - 'notesPublic' as x) s
$$;

create or replace function public.profile_card(p public.profiles)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'username', p.username, 'display_name', p.display_name,
    'avatar_url', p.avatar_url, 'is_private', p.is_private,
    'relation', coalesce((select f.status from public.follows f where f.follower_id = auth.uid() and f.following_id = p.id), 'none')
  )
$$;

-- Profil complet par pseudo
create or replace function public.get_profile(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.profiles;
  me uuid := auth.uid();
  res jsonb;
begin
  if me is null then
    return null;
  end if;
  select * into p from public.profiles where username = lower(trim(p_username));
  if not found then
    return null;
  end if;
  res := public.profile_card(p) || jsonb_build_object(
    'bio', p.bio,
    'banner_url', p.banner_url,
    'is_me', p.id = me,
    'follows_me', exists (select 1 from public.follows where follower_id = p.id and following_id = me and status = 'accepted'),
    'followers', (select count(*) from public.follows where following_id = p.id and status = 'accepted'),
    'following', (select count(*) from public.follows where follower_id = p.id and status = 'accepted'),
    'visible', public.can_view(p.id)
  );
  if public.can_view(p.id) then
    res := res || jsonb_build_object(
      'stats', (
        select jsonb_build_object(
          'total', count(*),
          'finished', count(*) filter (where data->>'status' = 'termine'),
          'finished_year', count(*) filter (where data->>'status' = 'termine' and left(data->>'endDate', 4) = to_char(now(), 'YYYY')),
          'films', count(*) filter (where data->>'status' = 'termine' and data->>'type' = 'film'),
          'series', count(*) filter (where data->>'status' = 'termine' and data->>'type' <> 'film'),
          'episodes', coalesce(sum(case when data->>'episodesWatched' ~ '^\d{1,6}$' then (data->>'episodesWatched')::int else 0 end), 0),
          'rated', count(*) filter (where data ? 'rating')
        )
        from public.items where user_id = p.id and not deleted
      ),
      'top', (
        select coalesce(jsonb_agg(public.public_item(data) order by data->'top'->>'category', (data->'top'->>'rank')), '[]'::jsonb)
        from public.items where user_id = p.id and not deleted and jsonb_typeof(data->'top') = 'object'
      ),
      'recent', (
        select coalesce(jsonb_agg(public.public_item(s.data) order by s.k desc nulls last), '[]'::jsonb)
        from (
          -- Date de visionnage (pas la date de modification : un import ou une synchro ne doit pas tout faire remonter)
          select data, coalesce(data->>'endDate', data->>'startDate') as k
          from public.items
          where user_id = p.id and not deleted and data->>'status' = 'termine'
          order by k desc nulls last
          limit 12
        ) s
      ),
      -- En cours et « à voir » : ce qu'on voit aussi dans le fil des abonnements
      'watching', (
        select coalesce(jsonb_agg(public.public_item(s.data) order by s.k desc nulls last), '[]'::jsonb)
        from (
          select data, coalesce(data->>'startDate', left(data->>'updatedAt', 10)) as k
          from public.items
          where user_id = p.id and not deleted and data->>'status' = 'en_cours'
          order by k desc nulls last
          limit 8
        ) s
      ),
      'watchlist', (
        select coalesce(jsonb_agg(public.public_item(s.data) order by s.k desc nulls last), '[]'::jsonb)
        from (
          select data, data->>'createdAt' as k
          from public.items
          where user_id = p.id and not deleted and data->>'status' = 'a_voir'
          order by k desc nulls last
          limit 8
        ) s
      )
    );
  end if;
  return res;
end;
$$;

-- Bibliothèque d'un profil (par pages)
create or replace function public.get_profile_items(p_user uuid, p_status text default null, p_offset int default 0, p_limit int default 48)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_view(p_user) then
    return '[]'::jsonb;
  end if;
  return (
    select coalesce(jsonb_agg(public.public_item(s.data) order by s.k desc nulls last, s.id), '[]'::jsonb)
    from (
      select id, data, coalesce(data->>'endDate', data->>'startDate', left(data->>'updatedAt', 10)) as k
      from public.items
      where user_id = p_user and not deleted
        and (p_status is null or data->>'status' = p_status)
      order by k desc nulls last, id
      offset greatest(p_offset, 0)
      limit least(greatest(p_limit, 1), 60)
    ) s
  );
end;
$$;

-- Fil d'activité de mes abonnements
create or replace function public.get_feed(p_before timestamptz default null, p_limit int default 30)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(entry order by created_at desc), '[]'::jsonb)
  from (
    select a.created_at,
      jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'created_at', a.created_at,
        'user', jsonb_build_object('username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url),
        'item', public.public_item(i.data)
      ) as entry
    from public.activity a
    join public.follows f on f.following_id = a.user_id and f.follower_id = auth.uid() and f.status = 'accepted'
    join public.profiles p on p.id = a.user_id
    join public.items i on i.user_id = a.user_id and i.id = a.item_id and not i.deleted
    where p_before is null or a.created_at < p_before
    order by a.created_at desc
    limit least(greatest(p_limit, 1), 50)
  ) s
$$;

-- Recherche de profils (pseudo ou nom)
create or replace function public.search_profiles(q text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  term text := lower(trim(coalesce(q, '')));
  pattern text;
begin
  if auth.uid() is null or char_length(term) < 2 or char_length(term) > 40 then
    return '[]'::jsonb;
  end if;
  pattern := replace(replace(replace(ltrim(term, '@'), '\', '\\'), '%', '\%'), '_', '\_');
  return (
    select coalesce(jsonb_agg(public.profile_card(p) order by (p.username = ltrim(term, '@')) desc, p.username), '[]'::jsonb)
    from (
      select * from public.profiles
      where id <> auth.uid() and (username like pattern || '%' or lower(display_name) like '%' || pattern || '%')
      order by username
      limit 20
    ) p
  );
end;
$$;

-- Abonnés / abonnements d'un profil
create or replace function public.get_follow_list(p_user uuid, p_kind text, p_offset int default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_view(p_user) or p_kind not in ('followers', 'following') then
    return '[]'::jsonb;
  end if;
  return (
    select coalesce(jsonb_agg(public.profile_card(p) order by s.created_at desc), '[]'::jsonb)
    from (
      select case when p_kind = 'followers' then f.follower_id else f.following_id end as uid, f.created_at
      from public.follows f
      where f.status = 'accepted' and (case when p_kind = 'followers' then f.following_id else f.follower_id end) = p_user
      order by f.created_at desc
      offset greatest(p_offset, 0)
      limit 50
    ) s
    join public.profiles p on p.id = s.uid
  );
end;
$$;

-- Demandes d'abonnement reçues (compte privé)
create or replace function public.get_follow_requests()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.profile_card(p) order by f.created_at desc), '[]'::jsonb)
  from public.follows f
  join public.profiles p on p.id = f.follower_id
  where f.following_id = auth.uid() and f.status = 'pending'
$$;

-- Les fonctions de lecture ne sont utilisables que par les comptes connectés
revoke all on function public.can_view(uuid), public.public_item(jsonb), public.profile_card(public.profiles),
  public.get_profile(text), public.get_profile_items(uuid, text, int, int), public.get_feed(timestamptz, int),
  public.search_profiles(text), public.get_follow_list(uuid, text, int), public.get_follow_requests()
  from public, anon;
grant execute on function public.get_profile(text), public.get_profile_items(uuid, text, int, int), public.get_feed(timestamptz, int),
  public.search_profiles(text), public.get_follow_list(uuid, text, int), public.get_follow_requests()
  to authenticated;

-- Outils internes des fonctions ci-dessus : jamais appelables directement depuis l'API
revoke all on function public.can_view(uuid), public.public_item(jsonb), public.profile_card(public.profiles)
  from public, anon, authenticated;

-- Fonctions internes : jamais appelables depuis l'API
revoke all on function public.azuu_random_username(), public.azuu_new_user(), public.azuu_profile_guard(),
  public.azuu_follow_guard(), public.azuu_profile_public(), public.azuu_day(text), public.azuu_log(uuid, text, text),
  public.azuu_item_activity()
  from public, anon, authenticated;

-- ═════════════════════════════ Photos de profil et bannières ═════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-media', 'profile-media', true, 2097152, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Chacun ne peut écrire que dans son propre dossier « <id>/… » ; la lecture passe par l'adresse publique
drop policy if exists "profile media read own" on storage.objects;
create policy "profile media read own" on storage.objects for select to authenticated
  using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "profile media upload own" on storage.objects;
create policy "profile media upload own" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/(avatar|banner)-[0-9]{1,15}\.(jpg|webp|png)$'
  );
drop policy if exists "profile media delete own" on storage.objects;
create policy "profile media delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
