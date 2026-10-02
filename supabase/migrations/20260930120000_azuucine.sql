-- ─────────────────────────────────────────────────────────────────────────────
-- AzuuCine — base de données (Supabase / Postgres)
--
-- Chaque utilisateur ne voit et ne modifie QUE ses propres lignes :
-- c'est garanti par la base elle-même (Row Level Security), pas par l'app.
-- Même avec la clé publique de l'app, personne ne peut lire les données d'un autre compte.
--
-- À coller une fois dans Supabase → SQL Editor → Run (ou `supabase db push`).
-- ─────────────────────────────────────────────────────────────────────────────

-- Fiches (films, séries, animes…) : le contenu est stocké tel quel (JSON), l'app le valide à la lecture.
create table if not exists public.items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  data jsonb check (data is null or (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 400000)),
  deleted boolean not null default false,
  updated_at timestamptz not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id),
  check (deleted or data is not null)
);

-- Listes perso
create table if not exists public.lists (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  data jsonb check (data is null or (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 4000)),
  deleted boolean not null default false,
  updated_at timestamptz not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id),
  check (deleted or data is not null)
);

-- Réglages (note sur 5 ou 10, thème, Top 5…) — une ligne par compte
create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 4000),
  updated_at timestamptz not null,
  server_updated_at timestamptz not null default clock_timestamp()
);

create index if not exists items_sync_idx on public.items (user_id, server_updated_at);
create index if not exists lists_sync_idx on public.lists (user_id, server_updated_at);

-- ─── Écritures : « la modification la plus récente gagne » + horodatage serveur ───
create or replace function public.azuu_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Un appareil resté hors-ligne ne peut pas écraser une version plus récente
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  -- Personne ne peut déplacer une ligne vers un autre compte
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise exception 'user_id is immutable';
  end if;
  -- Date venant du client bornée (pas de date dans le futur lointain qui bloquerait les mises à jour)
  if new.updated_at > now() + interval '1 day' then
    new.updated_at := now();
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists items_before_write on public.items;
create trigger items_before_write before insert or update on public.items
  for each row execute function public.azuu_before_write();
drop trigger if exists lists_before_write on public.lists;
create trigger lists_before_write before insert or update on public.lists
  for each row execute function public.azuu_before_write();
drop trigger if exists settings_before_write on public.settings;
create trigger settings_before_write before insert or update on public.settings
  for each row execute function public.azuu_before_write();

-- ─── Quotas par compte (évite qu'un compte remplisse la base) ───
create or replace function public.azuu_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
  max_rows integer := case tg_table_name when 'items' then 20000 else 300 end;
begin
  execute format('select count(*) from public.%I where user_id = $1', tg_table_name) into n using new.user_id;
  if n >= max_rows then
    raise exception 'quota exceeded for %', tg_table_name;
  end if;
  return new;
end;
$$;

drop trigger if exists items_quota on public.items;
create trigger items_quota before insert on public.items for each row execute function public.azuu_quota();
drop trigger if exists lists_quota on public.lists;
create trigger lists_quota before insert on public.lists for each row execute function public.azuu_quota();

-- ─── Sécurité au niveau des lignes (RLS) ───
alter table public.items enable row level security;
alter table public.lists enable row level security;
alter table public.settings enable row level security;
alter table public.items force row level security;
alter table public.lists force row level security;
alter table public.settings force row level security;

-- Les visiteurs non connectés n'ont accès à rien
revoke all on public.items, public.lists, public.settings from anon;
grant select, insert, update, delete on public.items, public.lists, public.settings to authenticated;

drop policy if exists "own items" on public.items;
create policy "own items" on public.items for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own lists" on public.lists;
create policy "own lists" on public.lists for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Les fonctions internes ne sont pas appelables depuis l'API
revoke all on function public.azuu_before_write() from public, anon, authenticated;
revoke all on function public.azuu_quota() from public, anon, authenticated;
