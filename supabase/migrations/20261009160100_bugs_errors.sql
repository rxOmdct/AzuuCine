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
