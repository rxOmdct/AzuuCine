-- ─────────────────────────────────────────────────────────────────────────────
-- AzuuCine — inscription par email : le pseudo est choisi dans le formulaire
--
-- L'app envoie le pseudo dans les métadonnées de l'inscription (data.username).
-- S'il est valide et libre, le profil est créé avec ; sinon (pris, réservé…), on garde
-- l'ancien fonctionnement : pseudo aléatoire, puis écran de choix à la première connexion.
-- La connexion Google ne change pas (pas de pseudo dans ses métadonnées).
--
-- Déjà appliqué sur le projet le 8 oct. 2026. Peut être relancé sans risque.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.azuu_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  u text := public.azuu_random_username();
  wanted text := lower(trim(coalesce(new.raw_user_meta_data->>'username', '')));
  n text := left(trim(regexp_replace(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), '[[:cntrl:]]', '', 'g')), 40);
begin
  if wanted ~ '^[a-z0-9_]{3,20}$' and not exists (select 1 from public.profiles where username = wanted) then
    begin
      insert into public.profiles (id, username, display_name) values (new.id, wanted, coalesce(nullif(n, ''), wanted)) on conflict (id) do nothing;
      return new;
    exception when others then
      -- Pseudo réservé ou pris entre-temps : on retombe sur le pseudo aléatoire
      null;
    end;
  end if;
  begin
    insert into public.profiles (id, username, display_name) values (new.id, u, coalesce(nullif(n, ''), u)) on conflict (id) do nothing;
  exception when others then
    insert into public.profiles (id, username, display_name) values (new.id, u, u) on conflict (id) do nothing;
  end;
  return new;
end;
$fn$;

revoke all on function public.azuu_new_user() from public, anon, authenticated;
