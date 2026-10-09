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

console.log(`# Clés VAPID et secret du webhook — à garder secrètes (sauf VAPID_PUBLIC_KEY)
# 1) Secrets des fonctions Supabase (Dashboard → Edge Functions → Secrets, ou en ligne de commande) :
supabase secrets set VAPID_PUBLIC_KEY=${publicKey}
supabase secrets set VAPID_PRIVATE_KEY=${privateKey}
supabase secrets set VAPID_SUBJECT=mailto:ton-adresse@example.com
supabase secrets set PUSH_WEBHOOK_SECRET=${webhookSecret}

# 2) Le même PUSH_WEBHOOK_SECRET dans Supabase Vault (SQL Editor) :
select vault.create_secret('${webhookSecret}', 'azuu_push_secret');
`)
