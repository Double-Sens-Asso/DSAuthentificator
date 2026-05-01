// deno-lint-ignore-file no-import-prefix no-unversioned-import
import "jsr:@std/dotenv/load";

const bool = (v: string | undefined, def = false) =>
  v === undefined ? def : v.toLowerCase() === "true";

const num = (v: string | undefined, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
};

export const CONFIG = {
  // Discord
  TOKEN:          Deno.env.get("DISCORD_TOKEN"),
  GUILD_ID:       Deno.env.get("GUILD_ID"),
  VERIFY_ROLE_ID: Deno.env.get("VERIFY_ROLE_ID"),
  ADMIN_ROLE_ID:  Deno.env.get("ADMIN_ROLE_ID"),
  LOG_CHANNEL_ID: Deno.env.get("LOG_CHANNEL_ID"),

  // Délai (en secondes) entre la détection d'une cotisation invalide et le retrait du rôle
  DELAY_INVALID_COTISATION: num(Deno.env.get("DISCORD_DELAY_INVALID_COTISATION_DURATION"), 604800),
  // Envoi d'un rappel DM avant le retrait effectif du rôle
  RAPPEL_DESACTIVATION: bool(Deno.env.get("rappel_bot_desactivation")),
  // Intervalle (en secondes) entre deux passages du cron de vérification
  CHECK_INTERVAL_SECONDS: num(Deno.env.get("CHECK_INTERVAL_SECONDS"), 24 * 3600),

  // OTP
  OTP_TTL_SECONDS: num(Deno.env.get("OTP_TTL_SECONDS"), 600),         // 10 min
  OTP_MAX_ATTEMPTS: num(Deno.env.get("OTP_MAX_ATTEMPTS"), 5),
  // Rate-limit /verify : nb max d'envois d'email par utilisateur sur la fenêtre
  VERIFY_RATE_LIMIT_MAX: num(Deno.env.get("VERIFY_RATE_LIMIT_MAX"), 5),
  VERIFY_RATE_LIMIT_WINDOW_SECONDS: num(Deno.env.get("VERIFY_RATE_LIMIT_WINDOW_SECONDS"), 3600),

  // NocoDB
  NOCODB_BASE_URL:   Deno.env.get("NOCODB_BASE_URL")?.replace(/\/+$/, "") ?? "",
  NOCODB_TOKEN:      Deno.env.get("NOCODB_TOKEN") ?? "",
  NOCODB_PROJECT_ID: Deno.env.get("NOCODB_PROJECT_ID") ?? "",
  NOCODB_TABLE_ID:   Deno.env.get("NOCODB_TABLE_ID") ?? "",
  NOCODB_PAGE_SIZE:  num(Deno.env.get("NOCODB_PAGE_SIZE"), 200),

  // Mapping Colonnes
  COL_EMAIL:      Deno.env.get("COL_EMAIL") ?? "mail",
  COL_DISCORD_ID: Deno.env.get("COL_DISCORD_ID") ?? "IdDiscord",
  COL_COTISATION: Deno.env.get("COL_COTISATION") ?? "cotisationValide",

  // SMTP (Configuration Brevo)
  SMTP_HOST: Deno.env.get("SMTP_HOST"),
  SMTP_PORT: Number(Deno.env.get("SMTP_PORT")),
  SMTP_USER: Deno.env.get("SMTP_USER"),
  SMTP_PASS: Deno.env.get("SMTP_PASS"),
  SMTP_FROM: Deno.env.get("SMTP_FROM"),

  // Logs
  DEBUG: bool(Deno.env.get("DEBUG")),
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
