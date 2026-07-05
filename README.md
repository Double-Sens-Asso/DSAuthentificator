# DSAuthentificator

Bot Discord d'authentification des adhérents de **DoubleSens**.

Il vérifie l'adhésion via un code envoyé par e-mail (OTP), lie le compte Discord
au dossier NocoDB, attribue un rôle « vérifié », et entretient ce rôle dans le
temps en fonction de la validité de la cotisation.

## Fonctionnalités

- **`/verify`** : saisie de l'email → OTP par SMTP → saisie du code → liaison du
  compte Discord + attribution du rôle.
- **`/mon-statut`** : affiche l'état de l'adhésion et l'éventuel retrait programmé.
- **`/ping`**, **`/donner-avis`** (placeholder).
- **Commandes admin** (`/admin-unlink`, `/admin-check`, `/admin-pending`,
  `/admin-cancel-removal`), filtrées par `ADMIN_ROLE_ID`.
- **Cron** : ré-attribution / retrait différé du rôle selon la cotisation,
  rappel DM avant retrait, nettoyage des rôles orphelins.

## Démarrage

```bash
cp env.example .env   # renseigner les variables
deno task dev         # développement (watch)
deno task start       # production
deno task check       # type-check
deno task test        # tests
```

## Architecture

Le code est organisé en couches sous [`src/`](src/), des dépendances externes
vers la présentation Discord :

```
src/
├── main.ts                 # Composition root : assemble tout, démarre le bot
├── config/                 # Configuration & constantes (aucune logique)
│   ├── config.ts           #   chargement + validation des variables d'env
│   ├── constants.ts        #   regex email, couleurs d'embed, customId
│   └── paths.ts            #   chemins data/ et assets/ (résolus via cwd)
├── core/                   # Domaine pur (types, aucun I/O)
│   └── types.ts
├── infrastructure/         # Accès au monde extérieur
│   ├── nocodb/             #   client HTTP + repository adhérents
│   ├── email/              #   transport SMTP + template
│   └── storage/            #   persistance JSON atomique (sessions, retraits)
├── services/               # Logique applicative transverse
│   ├── verification.ts     #   règles de vérification d'adhésion
│   ├── membership.ts       #   gestion des rôles à l'arrivée d'un membre
│   ├── logger.ts           #   logs d'audit Discord
│   ├── rate-limit.ts       #   anti-spam /verify
│   └── permissions.ts      #   contrôle du rôle admin
├── jobs/                   # Tâches planifiées
│   └── cotisation-check.ts #   passage périodique du cron
├── discord/                # Couche présentation Discord
│   ├── client.ts           #   création du client + intents
│   ├── router.ts           #   dispatch des interactions + filtre admin
│   ├── registry.ts         #   contrats (SlashCommand, handlers)
│   ├── commands/           #   une commande = un fichier
│   └── interactions/       #   handlers de boutons & modals
└── shared/                 # Petits utilitaires purs (sleep, OTP, email…)

assets/                     # logo + template e-mail
data/                       # fichiers JSON runtime (gitignored)
tests/                      # tests unitaires Deno
```

### Principes

- **Sens des dépendances** : `discord/` → `services/` / `jobs/` →
  `infrastructure/` → `config/` + `core/`. Le domaine ne dépend de personne.
- **Chaque commande dans son fichier**, exposant sa définition et son
  exécution ; le routeur applique le filtrage admin de façon centralisée.
- **Persistance isolée** derrière `JsonStore` (écriture atomique, sérialisée).
- **Configuration validée au démarrage** (échec rapide si une variable
  critique manque).
