# Notifications push (Web Push) — mise en service

Les notifications de la cloche (nouveaux abonnés, demandes acceptées, réactions, nouveaux épisodes…)
peuvent aussi arriver **sur le téléphone / l'ordinateur, même app fermée**.

```
nouvelle ligne dans public.notifications
  └─ déclencheur notifications_push (SQL) ── pg_net ──► fonction « send-push » (en-tête x-push-secret)
                                                          ├─ push_claim() : notifications non envoyées + appareils
                                                          ├─ préférences (notifPrefs) appliquées, textes traduits, regroupés
                                                          ├─ chiffrement aes128gcm + jeton VAPID ──► FCM / Mozilla / Apple / Windows
                                                          └─ push_done() : appareils expirés (404/410) supprimés
```

Rien ne casse tant que ce n'est pas configuré : sans secrets ni Vault, le déclencheur ne fait rien,
la cloche fonctionne comme avant et l'interrupteur des Réglages affiche « pas encore disponible ».

---

## 1. Base de données (SQL Editor)

Prérequis déjà appliqués : `20261007120000_social_notifications.sql` et `20261008140000_episode_notifications_fix.sql`.

1. Supabase → **SQL Editor** → coller `supabase/migrations/20261009150000_web_push.sql` → **Run**.
   - Elle active l'extension **pg_net** (`create extension if not exists pg_net`). Si l'éditeur refuse,
     l'activer à la main : **Database → Extensions → pg_net → Enable**, puis relancer le fichier.
   - Le fichier est idempotent : on peut le relancer sans risque.

## 2. Clés VAPID et secret partagé (sur ton PC)

```bash
node scripts/gen-vapid.mjs
```

Le script affiche les commandes à copier. **Ne jamais committer ces valeurs** (ni dans `.env`, ni en `VITE_…`).
La clé publique n'est pas secrète (l'app la lit via la fonction), la clé privée et le secret du webhook le sont.

## 3. Secrets des fonctions

Supabase → **Edge Functions → Secrets** (ou `supabase secrets set …`) :

| Nom | Valeur |
| --- | --- |
| `VAPID_PUBLIC_KEY` | clé publique affichée par le script (87 caractères, commence par `B`) |
| `VAPID_PRIVATE_KEY` | clé privée affichée par le script (43 caractères) |
| `VAPID_SUBJECT` | `mailto:ton-adresse@…` (contact pour les services push) |
| `PUSH_WEBHOOK_SECRET` | secret aléatoire affiché par le script (≥ 32 caractères) |

`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont fournis automatiquement. `ALLOWED_ORIGINS`
(déjà en place pour `tmdb`) sert aussi ici pour la lecture de la clé publique depuis le site.

## 4. Déployer la fonction

```bash
supabase functions deploy send-push --project-ref qfgnxonqwldcfdjqhhjz
```

`supabase/config.toml` contient `verify_jwt = false` pour `send-push` : la base l'appelle sans jeton
utilisateur, l'accès est protégé par l'en-tête `x-push-secret` (comparé en temps constant).
Vérification : ouvrir `https://qfgnxonqwldcfdjqhhjz.supabase.co/functions/v1/send-push` → `{"publicKey":"B…"}`.

## 5. Adresse et secret dans Supabase Vault (SQL Editor)

Le déclencheur lit ces deux valeurs dans Vault (elles ne sont jamais écrites dans une migration) :

```sql
select vault.create_secret('https://qfgnxonqwldcfdjqhhjz.supabase.co/functions/v1/send-push', 'azuu_push_url');
select vault.create_secret('<la même valeur que PUSH_WEBHOOK_SECRET>', 'azuu_push_secret');
```

Pour changer une valeur plus tard :

```sql
select vault.update_secret((select id from vault.secrets where name = 'azuu_push_secret'), '<nouvelle valeur>');
```

(et mettre la même dans le secret `PUSH_WEBHOOK_SECRET` de la fonction).

## 6. Publier l'app

`git push` (Gitea Actions construit et publie). Le service worker se met à jour tout seul ;
il charge `push-sw.js` (servi en `Cache-Control: no-cache`, en-tête généré depuis `vite.config.ts`).

## 7. Tester

1. Sur l'app : **Réglages → Notifications → Notifications sur cet appareil** (la permission n'est demandée qu'à ce moment-là).
   - iPhone / iPad : uniquement depuis l'app **installée sur l'écran d'accueil**, iOS 16.4 ou plus récent.
2. Depuis un autre compte, s'abonner à ce compte → une notification doit arriver (même app fermée).
3. En cas de souci :
   ```sql
   select count(*) from public.push_subscriptions;                                  -- l'appareil est-il inscrit ?
   select id, status_code, content, created from net._http_response order by created desc limit 10;  -- appels de la base
   ```
   et **Edge Functions → send-push → Logs**. Un `401` = `PUSH_WEBHOOK_SECRET` et `azuu_push_secret` différents ;
   un `503 not-configured` = secrets VAPID manquants ou mal copiés.

## Sécurité (résumé)

- `push_subscriptions` : RLS activé et forcé ; chacun ne voit / supprime que ses appareils ; ajout uniquement via
  `register_push_subscription` (security definer) qui n'accepte que des adresses **https** vers les services push
  connus (`fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.push.apple.com`, `web.push.apple.com`,
  `*.notify.windows.com`) : pas de SSRF possible. La fonction d'envoi revérifie la liste.
- 10 appareils max par compte (les plus anciens sont retirés), 10 nouvelles inscriptions max par 10 minutes.
- Un abonnement déjà lié à un autre compte n'est repris que si l'on fournit les mêmes clés (même navigateur).
- À la déconnexion, l'appareil est désinscrit ; à la suppression du compte, tout part en cascade.
- `push_claim` / `push_done` : réservées au rôle `service_role`. Les préférences `notifPrefs` sont appliquées
  à la création **et** à l'envoi.
- Changer les clés VAPID invalide les abonnements existants : après une rotation, vider la table
  (`delete from public.push_subscriptions;`) ; chacun réactive l'interrupteur.
