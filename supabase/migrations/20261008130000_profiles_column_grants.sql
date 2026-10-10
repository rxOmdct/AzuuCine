-- ─────────────────────────────────────────────────────────────────────────────
-- AzuuCine — profils : seules les colonnes éditables sont modifiables
--
-- La policy « own profile update » laissait chacun modifier TOUTES les colonnes de son
-- profil, y compris `suspended` : un compte suspendu par l'admin pouvait se réactiver
-- lui-même (PATCH /rest/v1/profiles). On limite l'UPDATE aux 6 colonnes que l'app modifie ;
-- `admin_set_suspended` (security definer) continue de fonctionner.
--
-- + nettoyage : droits des fonctions de trigger de notification, fonctions de test oubliées.
-- Déjà appliqué sur le projet le 8 oct. 2026. Peut être relancé sans risque.
-- ─────────────────────────────────────────────────────────────────────────────

revoke update, delete on public.profiles from authenticated;
grant update (username, display_name, bio, avatar_url, banner_url, is_private) on public.profiles to authenticated;

-- Fonctions de trigger : jamais appelables depuis l'API
do $$
begin
  if to_regprocedure('public.azuu_follow_notify()') is not null then
    revoke all on function public.azuu_follow_notify() from public, anon, authenticated;
  end if;
  if to_regprocedure('public.azuu_reaction_notify()') is not null then
    revoke all on function public.azuu_reaction_notify() from public, anon, authenticated;
  end if;
end;
$$;

-- Fonctions de test laissées par erreur
drop function if exists public._tmp_ping2();
drop function if exists public._tmp_sd2();
