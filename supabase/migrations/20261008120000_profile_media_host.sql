-- ─────────────────────────────────────────────────────────────────────────────
-- AzuuCine — photos de profil et bannières : uniquement depuis le stockage du projet
--
-- `azuu_profile_guard` vérifie déjà le chemin (« …/profile-media/<id>/… ») mais accepte
-- n'importe quel serveur devant. Un compte pouvait donc pointer sa photo vers son propre
-- serveur et y relever l'adresse IP des visiteurs (l'app le bloque déjà via la CSP et
-- `safeMediaUrl`, mais la base doit le refuser elle-même).
--
-- Ajoute un contrôle séparé (l'ancien garde-fou n'est pas touché).
-- À coller dans Supabase → SQL Editor → Run, APRÈS …_social.sql. Peut être relancé sans risque.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.azuu_profile_media_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- Le projet Supabase, ou la pile locale (`supabase start`) pour le développement
  origin text := '^(https://qfgnxonqwldcfdjqhhjz\.supabase\.co|http://(localhost|127\.0\.0\.1):[0-9]{1,5})/storage/v1/object/public/profile-media/';
begin
  if new.avatar_url is not null and new.avatar_url !~ origin then
    raise exception 'invalid avatar url';
  end if;
  if new.banner_url is not null and new.banner_url !~ origin then
    raise exception 'invalid banner url';
  end if;
  return new;
end;
$$;

-- Images déjà enregistrées ailleurs : retirées (sinon le profil ne pourrait plus être modifié)
update public.profiles set avatar_url = null
where avatar_url is not null
  and avatar_url !~ '^(https://qfgnxonqwldcfdjqhhjz\.supabase\.co|http://(localhost|127\.0\.0\.1):[0-9]{1,5})/storage/v1/object/public/profile-media/';
update public.profiles set banner_url = null
where banner_url is not null
  and banner_url !~ '^(https://qfgnxonqwldcfdjqhhjz\.supabase\.co|http://(localhost|127\.0\.0\.1):[0-9]{1,5})/storage/v1/object/public/profile-media/';

drop trigger if exists profiles_media_guard on public.profiles;
create trigger profiles_media_guard before insert or update on public.profiles
  for each row execute function public.azuu_profile_media_guard();

-- Fonction interne : jamais appelable depuis l'API
revoke all on function public.azuu_profile_media_guard() from public, anon, authenticated;
