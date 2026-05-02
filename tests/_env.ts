/**
 * Pré-remplit les variables d'environnement requises par config.ts
 * AVANT le chargement des modules testés (sinon config.ts fait Deno.exit(1)).
 *
 * À importer en tout premier dans chaque fichier de test :
 *
 *     import "./_env.ts";
 *     import { ... } from "../monModule.ts";
 */

const REQUIRED: Record<string, string> = {
  DISCORD_TOKEN: "test-token",
  GUILD_ID: "111111111111111111",
  VERIFY_ROLE_ID: "222222222222222222",
  NOCODB_TOKEN: "test-noco",
  SMTP_HOST: "localhost",
  SMTP_USER: "test@example.com",
  SMTP_PASS: "test-pass",
};

for (const [k, v] of Object.entries(REQUIRED)) {
  if (!Deno.env.get(k)) Deno.env.set(k, v);
}
