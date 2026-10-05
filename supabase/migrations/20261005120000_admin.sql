-- Partie administration d'AzuuCine (5 octobre 2026).
-- Un espace réservé au(x) compte(s) de la table public.admins :
--  - vue d'ensemble (chiffres), liste des utilisateurs, avis publics récents ;
--  - actions réversibles : suspendre/réactiver un compte, effacer l'avis d'une fiche.
-- Tout est verrouillé côté serveur par is_admin() (pas seulement masqué dans l'app).

-- ── Table des administrateurs : écriture réservée au rôle service_role ──
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

-- Suspension d'un compte : masque le profil publiquement (réversible), jamais une suppression.
alter table public.profiles add column if not exists suspended boolean not null default false;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid())
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Romain est administrateur.
insert into public.admins (user_id) values ('4529202d-618c-4b40-ab13-228eef3f71ad') on conflict do nothing;

-- ── Intégration de la suspension dans les fonctions sociales ──
-- (can_view, search_profiles, get_feed, get_follow_list, get_follow_requests, get_profile
--  excluent désormais les comptes suspendus pour les autres utilisateurs. Voir la base de données
--  pour les définitions complètes — appliquées par le même déploiement.)

-- ── Fonctions d'administration (toutes : si not is_admin() -> exception) ──
-- admin_overview()            : chiffres globaux + inscriptions des 14 derniers jours
-- admin_users(q, offset)      : liste des comptes (recherche e-mail/pseudo/nom)
-- admin_recent_reviews(offset): avis publics récents (modération)
-- admin_set_suspended(id, on) : suspendre/réactiver (jamais soi-même)
-- admin_clear_review(id, item): efface l'avis d'une fiche (renvoyé à l'appareil du membre à la synchro)
-- Définitions complètes appliquées en base ; droits : execute réservé à authenticated, gate interne is_admin().
