#!/usr/bin/env node
// Génère une paire de clés VAPID (P-256) pour les notifications push, et un secret de webhook.
// À lancer UNE fois sur ton PC :  node scripts/gen-vapid.mjs
// Les valeurs affichées vont dans les secrets Supabase (jamais dans le dépôt, jamais dans .env / VITE_).
// Ne pas exécuter en CI. Voir supabase/PUSH_SETUP.md.
import { webcrypto as crypto } from 'node:crypto'

const b64url = (buf) => Buffer.from(buf).toString('base64url')

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const publicKey = b64url(await crypto.subtle.exportKey('raw', pair.publicKey))
const { d: privateKey } = await crypto.subtle.exportKey('jwk', pair.privateKey)
const webhookSecret = b64url(crypto.getRandomValues(new Uint8Array(32)))

console.log(`
=== 1) Supabase → Edge Functions → Secrets : 4 secrets (Nom = à gauche, Valeur = à droite) ===
(un secret qui existe déjà : le remplacer par cette nouvelle valeur)

  VAPID_PUBLIC_KEY      ${publicKey}
  VAPID_PRIVATE_KEY     ${privateKey}
  VAPID_SUBJECT         mailto:ton-adresse@example.com   (mets ton adresse)
  PUSH_WEBHOOK_SECRET   ${webhookSecret}

=== 2) Supabase → SQL Editor : coller CETTE ligne telle quelle, puis Run ===

do $$ begin if exists (select 1 from vault.secrets where name = 'azuu_push_secret') then perform vault.update_secret((select id from vault.secrets where name = 'azuu_push_secret'), '${webhookSecret}'); else perform vault.create_secret('${webhookSecret}', 'azuu_push_secret'); end if; end $$;

Ces valeurs sont secrètes (sauf VAPID_PUBLIC_KEY) : ne les colle nulle part ailleurs.
Chaque lancement du script crée de NOUVELLES valeurs : les étapes 1 et 2 doivent venir du même lancement.
`)
