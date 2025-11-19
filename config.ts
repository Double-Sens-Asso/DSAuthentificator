import "jsr:@std/dotenv/load";

export const CONFIG = {
  // Discord
  TOKEN:          Deno.env.get("DISCORD_TOKEN"),
  GUILD_ID:       Deno.env.get("GUILD_ID"),
  VERIFY_ROLE_ID: Deno.env.get("VERIFY_ROLE_ID"),
  ADMIN_ROLE_ID:  Deno.env.get("ADMIN_ROLE_ID"),
  LOG_CHANNEL_ID: Deno.env.get("LOG_CHANNEL_ID"),
  
  // NocoDB
  NOCODB_BASE_URL:   Deno.env.get("NOCODB_BASE_URL")?.replace(/\/+$/, "") ?? "",
  NOCODB_TOKEN:      Deno.env.get("NOCODB_TOKEN") ?? "",
  NOCODB_PROJECT_ID: Deno.env.get("NOCODB_PROJECT_ID") ?? "",
  NOCODB_TABLE_ID:   Deno.env.get("NOCODB_TABLE_ID") ?? "",
  
  // Mapping Colonnes
  COL_EMAIL:      Deno.env.get("COL_EMAIL") ?? "mail",
  COL_DISCORD_ID: Deno.env.get("COL_DISCORD_ID") ?? "IdDiscord",
  COL_COTISATION: Deno.env.get("COL_COTISATION") ?? "cotisationValide",

  // SMTP (Configuration Brevo)
  SMTP_HOST: Deno.env.get("SMTP_HOST"),
  SMTP_PORT: Number(Deno.env.get("SMTP_PORT")),
  SMTP_USER: Deno.env.get("SMTP_USER"), // Ton identifiant (94e79c...)
  SMTP_PASS: Deno.env.get("SMTP_PASS"), // Ton mot de passe
  SMTP_FROM: Deno.env.get("SMTP_FROM") ?? "noreply@asso-doublesens.fr", // L'adresse affichée aux gens
};

// Vérification critique au démarrage
const requiredKeys = ["TOKEN", "GUILD_ID", "VERIFY_ROLE_ID", "NOCODB_TOKEN", "SMTP_HOST", "SMTP_USER", "SMTP_PASS"];
for (const key of requiredKeys) {
  // @ts-ignore : Accès dynamique aux clés
  if (!CONFIG[key]) {
    console.error(`❌ Configuration manquante : ${key} est requis dans le .env`);
    Deno.exit(1);
  }
}

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;