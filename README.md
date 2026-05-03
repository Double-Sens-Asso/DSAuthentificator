# DSAuthentificator

Bot Discord de vérification d'adhésion : un membre tape `/verify`, saisit son email
adhérent, reçoit un code OTP par mail, et obtient automatiquement le rôle "Vérifié"
si sa cotisation est à jour dans la base NocoDB. Une vérification quotidienne retire
le rôle aux adhérents dont la cotisation n'est plus à jour, après un délai de grâce
configurable et un éventuel rappel par DM.

---

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Architecture](#architecture)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [Commandes Discord](#commandes-discord)
- [Schéma NocoDB](#schéma-nocodb)
- [Lancement](#lancement)
- [Docker](#docker)
- [Tests](#tests)
- [Données runtime](#données-runtime)
- [Sécurité](#sécurité)
- [Licence](#licence)

---

## Fonctionnalités

- **Vérification par email** : code OTP à 6 chiffres généré avec `crypto.getRandomValues`, expirant après 10 min, max 5 tentatives.
- **Anti-abus** : rate-limit configurable par utilisateur sur `/verify` (5 envois/h par défaut).
- **Cron quotidien** : retire le rôle aux cotisations expirées, avec délai de grâce (7 jours par défaut) et rappel DM optionnel.
- **Annulation automatique** : si la cotisation redevient valide ou que le rôle est retiré manuellement, le retrait programmé est annulé.
- **Re-attribution automatique** : si un membre vérifié quitte puis revient sur le serveur, son rôle lui est rendu sans qu'il ait à refaire `/verify`.
- **Logs Discord** : chaque action (succès, retrait, intervention admin) est loggée dans un canal dédié.
- **Persistance** : sessions OTP et retraits en attente survivent au redémarrage (JSON sur disque, écriture atomique).

---

## Architecture

```
.
├── main.ts                  Point d'entrée : client Discord, scheduler, handlers signaux
├── config.ts                Chargement & validation des variables d'environnement
├── commands.ts              Définition des slash commands enregistrées auprès de Discord
├── interactionHandler.ts    Dispatch des slash/buttons/modals -> handlers par customId
├── nocodb.ts                Wrapper REST NocoDB + logique `checkUserStatus`
├── utils.ts                 Cron `runDailyCheck`, logs, SMTP, re-attribution rôle
├── sessions.ts              Sessions OTP (persistées via JsonStore)
├── pendingRemovals.ts       Retraits de rôle en attente (persistés via JsonStore)
├── jsonStore.ts             Petit conteneur JSON : écriture atomique + transactions sérialisées
├── rateLimit.ts             Rate-limit en mémoire à fenêtre glissante
├── helpers.ts               sleep, debug log, generateOtp (cryptographique)
├── types.ts                 Interfaces partagées (NocoMember, VerificationResult)
├── assets/                  Logo + template email HTML
└── tests/                   Tests unitaires Deno (46 tests)
```

---

## Prérequis

- [Deno](https://deno.land/) ≥ 1.40 (Deno 2.x recommandé)
- Un bot Discord (token + ID d'application via [Discord Developer Portal](https://discord.com/developers/applications))
- Une instance [NocoDB](https://nocodb.com) accessible (Docker ou Cloud)
- Un service SMTP (Brevo, Gmail, Mailgun, ...)

---

## Installation

```bash
git clone <url-du-repo>
cd DSAuthentificator
cp env.example .env
# Editer .env avec vos valeurs
```

---

## Configuration

Toutes les variables sont dans `.env`. Référence complète : [env.example](env.example).

### Indispensables

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Token du bot Discord |
| `GUILD_ID` | ID du serveur où le bot est installé |
| `VERIFY_ROLE_ID` | ID du rôle à attribuer aux adhérents vérifiés |
| `ADMIN_ROLE_ID` | ID du rôle ayant accès aux commandes `/admin-*` |
| `LOG_CHANNEL_ID` | Canal Discord recevant les logs (peut être un forum) |
| `NOCODB_BASE_URL`, `NOCODB_TOKEN` | Connexion NocoDB |
| `NOCODB_PROJECT_ID`, `NOCODB_TABLE_ID` | Identifiants table cible |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Envoi des codes OTP |

### Optionnelles (avec valeurs par défaut)

| Variable | Défaut | Description |
|---|---|---|
| `DISCORD_DELAY_INVALID_COTISATION_DURATION` | `604800` (7j) | Délai en secondes avant retrait du rôle |
| `rappel_bot_desactivation` | `false` | Envoie un DM de rappel avant le retrait |
| `CHECK_INTERVAL_SECONDS` | `86400` (24h) | Période du cron de vérification |
| `OTP_TTL_SECONDS` | `600` (10 min) | Durée de validité d'un code OTP |
| `OTP_MAX_ATTEMPTS` | `5` | Tentatives de code avant invalidation de session |
| `VERIFY_RATE_LIMIT_MAX` | `5` | Envois `/verify` autorisés par fenêtre |
| `VERIFY_RATE_LIMIT_WINDOW_SECONDS` | `3600` | Fenêtre du rate-limit (en secondes) |
| `NOCODB_PAGE_SIZE` | `200` | Taille des pages lors de la pagination NocoDB |
| `COL_EMAIL`, `COL_DISCORD_ID`, `COL_COTISATION` | `mail`, `IdDiscord`, `cotisationValide` | Mapping des colonnes NocoDB |
| `DEBUG` | `false` | Logs verbeux (appels NocoDB, etc.) |

---

## Commandes Discord

### Publiques

- **`/verify`** — Démarre la procédure de vérification (modal email → OTP → modal code).
- **`/mon-statut`** — Affiche le statut de cotisation de l'utilisateur et l'éventuelle date de retrait.
- **`/ping`** — Vérifie que le bot répond et donne sa latence.

### Administrateur (filtrées par `ADMIN_ROLE_ID`)

- **`/admin-check <email>`** — Affiche les infos brutes d'un adhérent (cotisation, ID Discord lié).
- **`/admin-unlink <email>`** — Casse la liaison Discord ↔ email côté NocoDB.
- **`/admin-pending`** — Liste les retraits de rôle en attente.
- **`/admin-cancel-removal <email>`** — Annule un retrait programmé.

---

## Schéma NocoDB

Le bot attend une table contenant au minimum trois colonnes (renommables via `COL_*`) :

| Colonne (par défaut) | Type | Rôle |
|---|---|---|
| `mail` | Email | Email de l'adhérent (clé fonctionnelle) |
| `IdDiscord` | Texte | ID Discord (snowflake) — vide tant que l'adhérent n'a pas lié son compte |
| `cotisationValide` | Booléen / Lookup | `true` si la cotisation est à jour. Accepte aussi `1`, `"true"`, `[1]`, `[true]` |

---

## Lancement

```bash
# Développement (watch mode)
deno task dev

# Production
deno task start

# Vérification de types
deno task check

# Tests
deno task test
```

---

## Docker

Un `Dockerfile` est fourni :

```bash
docker build -t dsauth .
docker run -d \
  --name dsauth \
  --env-file .env \
  -v dsauth-data:/app \
  dsauth
```

Le volume préserve `pending_removals.json` et `otp_sessions.json` entre redémarrages.

---

## Tests

46 tests unitaires couvrent la logique pure et les modules à persistance :

```bash
deno task test
```

Les tests qui touchent au disque utilisent un pattern de **backup/restore** : le fichier
JSON existant (s'il y en a) est sauvegardé avant le test et restauré après, sans risque
de perte des données runtime.

| Module | Tests |
|---|---|
| `helpers` | `generateOtp` (format, plage, variabilité), `sleep` |
| `rateLimit` | Limite, blocage, isolation, expiration de fenêtre |
| `nocodb.cleanRecord` | Variantes d'id, `fields` wrapper, toutes les représentations bool/lookup, normalisation email |
| `nocodb.checkUserStatus` | 5 branches métier (stub `globalThis.fetch`) |
| `sessions` | Round-trip, delete, attempts, purge TTL, isolation |
| `pendingRemovals` | Round-trip, clear, getAll trié, recherche par email |

---

## Données runtime

Deux fichiers JSON sont créés automatiquement à la racine du projet (gitignorés) :

- `otp_sessions.json` — sessions de vérification OTP en cours
- `pending_removals.json` — adhérents dont le rôle sera retiré à terme

Les écritures sont **atomiques** (write-to-tmp + rename) et **sérialisées** (transactions
chaînées) — pas de risque de corruption en cas de SIGTERM.

---

## Sécurité

- **OTP** générés avec `crypto.getRandomValues` (pas `Math.random`).
- **TTL** strict côté serveur sur les sessions OTP (`OTP_TTL_SECONDS`).
- **Anti brute-force** : `OTP_MAX_ATTEMPTS` invalide la session, `VERIFY_RATE_LIMIT_MAX` limite les envois d'emails.
- **Permissions admin** : source unique de vérité — uniquement `ADMIN_ROLE_ID` (pas de double check Discord/code).
- **Validation email** : regex + limite RFC 5321 (254 caractères).
- **Logs traçables** : les actions admin (`admin-unlink`, `admin-cancel-removal`) sont loggées avec mention de l'admin auteur.
- **Arrêt propre** : `SIGTERM`/`SIGINT` ferment le client Discord avant de quitter, évitant tout fichier corrompu.

---

## Licence

[GPL-3.0](LICENSE)
