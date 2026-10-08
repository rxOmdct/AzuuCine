# Skills de sécurité (tiers)

Sélection de 16 skills défensifs / de test tirés de
[mukul975/anthropic-cybersecurity-skills](https://github.com/mukul975/anthropic-cybersecurity-skills)
(commit `54a7988`, licence Apache-2.0 — fichier `LICENSE` dans chaque dossier).
Projet communautaire, non affilié à Anthropic.

Retenus pour AzuuCine : contrôle d'accès / IDOR (≈ RLS Supabase), en-têtes et CSP, CORS,
OAuth/PKCE, JWT, XSS, Edge Functions (serverless), limitation de débit, dépendances npm,
secrets (gitleaks), RGPD, OWASP API Top 10.

Les scripts `scripts/*.py` envoient des requêtes de test : ne les lancer que contre
AzuuCine (ou une copie locale), jamais contre un site tiers.
