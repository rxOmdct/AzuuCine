-- ─────────────────────────────────────────────────────────────────────────────
-- Tags personnels (« comfort », « à revoir avec Léa »…) : PRIVÉS.
--
-- Les tags vivent dans la fiche (colonne JSON `items.data`, champ `tags`) et suivent donc
-- la synchronisation existante sans nouvelle colonne. Ils ne doivent jamais apparaître
-- chez les autres : la fonction qui prépare une fiche pour un profil / le fil d'abonnements
-- les retire, comme les listes perso.
--
-- Idempotent : peut être relancé sans risque (create or replace + revoke).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.public_item(d jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when length(coalesce(x->>'poster', '')) > 150000 then x - 'poster' else x end
  -- Les avis sont publics (comme sur Letterboxd) ; les listes perso et les tags perso restent privés
  from (select d - 'listIds' - 'notesPublic' - 'tags' as x) s
$$;

-- Outil interne des fonctions de profil : jamais appelable directement depuis l'API
revoke all on function public.public_item(jsonb) from public, anon, authenticated;
