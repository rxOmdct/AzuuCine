-- Défis de visionnage (idempotent)
--
-- 1) Les défis vivent dans les réglages synchronisés (public.settings.data → "challenges", 15 max).
--    La limite de 4 000 octets du JSON des réglages devient 16 000 octets.
-- 2) Les fiches gagnent un journal privé des épisodes cochés par jour ("episodeLog") :
--    il est retiré des fiches montrées aux autres (profil public, fil d'amis), comme les listes perso.

-- ─── 1. Taille des réglages ───
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.settings'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%octet_length%'
  loop
    execute format('alter table public.settings drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table public.settings
  add constraint settings_data_check
  check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 16000);

-- ─── 2. Fiche publique : sans le journal des épisodes ───
create or replace function public.public_item(d jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when length(coalesce(x->>'poster', '')) > 150000 then x - 'poster' else x end
  -- Les avis sont publics (comme sur Letterboxd) ; les listes perso et le journal des épisodes restent privés
  from (select d - 'listIds' - 'notesPublic' - 'tags' - 'episodeLog' as x) s
$$;
