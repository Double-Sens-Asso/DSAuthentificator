import "jsr:@std/dotenv/load";

export const CONFIG = {
  TOKEN:          Deno.env.get("DISCORD_TOKEN"),
  GUILD_ID:       Deno.env.get("GUILD_ID"),
  VERIFY_ROLE_ID: Deno.env.get("VERIFY_ROLE_ID"),
  ADMIN_ROLE_ID:  Deno.env.get("ADMIN_ROLE_ID"),
  LOG_CHANNEL_ID: Deno.env.get("LOG_CHANNEL_ID"),
  COL_EMAIL:      Deno.env.get("COL_EMAIL") ?? "mail"
};

// Vérification de sécurité immédiate
if (!CONFIG.TOKEN || !CONFIG.GUILD_ID || !CONFIG.VERIFY_ROLE_ID || !CONFIG.ADMIN_ROLE_ID) {
  console.error("❌ Configuration incomplète. Vérifie le fichier .env (ADMIN_ROLE_ID est requis).");
  Deno.exit(1);
}

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;