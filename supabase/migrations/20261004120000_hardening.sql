-- Durcissement (audit du 4 octobre 2026)

create or replace function public.azuu_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
  max_rows integer := case tg_table_name when 'items' then 20000 else 300 end;
  already boolean;
begin
  -- Un « upsert » d'une ligne qui existe déjà n'en ajoute pas : jamais bloqué (sinon plus aucune modification possible)
  execute format('select exists (select 1 from public.%I where user_id = $1 and id = $2)', tg_table_name) into already using new.user_id, new.id;
  if already then
    return new;
  end if;
  -- Les fiches supprimées (gardées pour la synchro) ne comptent pas
  execute format('select count(*) from public.%I where user_id = $1 and not deleted', tg_table_name) into n using new.user_id;
  if n >= max_rows then
    raise exception 'quota exceeded for %', tg_table_name;
  end if;
  return new;
end;
$$;

revoke all on public.items, public.lists, public.settings from anon, authenticated;
grant select, insert, update, delete on public.items, public.lists, public.settings to authenticated;

create or replace function public.azuu_profile_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  media text := '^https://[a-z0-9-]{1,63}\.supabase\.(co|in)/storage/v1/object/public/profile-media/' || new.id::text || '/[A-Za-z0-9_.-]{1,80}$';
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
     -- Fiche importée sans date : pas d'activité ; changement de statut fait maintenant : aujourd'hui
     and coalesce(public.azuu_day(new.data->>'endDate'), case when tg_op = 'UPDATE' then current_date end) >= recent then
    perform public.azuu_log(new.user_id, new.id, 'finished');
  elsif st = 'en_cours' and old_st is distinct from 'en_cours'
     and coalesce(public.azuu_day(new.data->>'startDate'), case when tg_op = 'UPDATE' then current_date end) >= recent then
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
        from public.items i
        where i.user_id = p.id and not i.deleted and jsonb_typeof(i.data->'top') = 'object'
          -- Seulement les catégories de Top 5 que la personne a choisi d'afficher (toutes si rien n'est réglé)
          and coalesce(
            (select s.data->'topCategories' ? (i.data->'top'->>'category')
             from public.settings s where s.user_id = p.id and jsonb_typeof(s.data->'topCategories') = 'array'),
            true)
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

revoke all on function public.get_profile(text) from public, anon;
grant execute on function public.get_profile(text) to authenticated;

revoke all on public.profiles, public.follows, public.activity from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.follows to authenticated;
grant select on public.activity to authenticated;

create or replace function public.azuu_media_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from storage.objects
  where bucket_id = 'profile-media' and (storage.foldername(name))[1] = (select auth.uid())::text
$$;
revoke all on function public.azuu_media_count() from public, anon;
grant execute on function public.azuu_media_count() to authenticated;

drop policy if exists "profile media upload own" on storage.objects;
create policy "profile media upload own" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/(avatar|banner)-[0-9]{1,15}\.(jpg|webp|png)$'
    -- Pas plus de 6 images par compte (l'app supprime les anciennes à chaque changement)
    and public.azuu_media_count() < 6
  );


drop index if exists public.profiles_display_name_idx;
