// deno-lint-ignore-file no-import-prefix
/**
 * Point d'entrée (composition root) : instancie le client, branche les
 * écouteurs d'événements, enregistre les commandes et démarre le cron.
 * Toute la logique vit dans les modules de `src/` ; ce fichier ne fait que
 * les assembler.
 */
import { Events, REST, Routes } from "npm:discord.js@14";
import { CONFIG } from "./config/config.ts";
import { createClient } from "./discord/client.ts";
import { handleInteraction } from "./discord/router.ts";
import { commandsJson } from "./discord/commands/index.ts";
import { handleMemberJoin } from "./services/membership.ts";
import { runDailyCheck } from "./jobs/cotisation-check.ts";
import { testConnection } from "./infrastructure/nocodb/members.repo.ts";

const client = createClient();

let stopping = false;

// Cron : setTimeout récursif pour ne pas accumuler les exécutions si une passe dépasse l'intervalle.
function scheduleCheck() {
  const intervalMs = CONFIG.CHECK_INTERVAL_SECONDS * 1000;
  const tick = async () => {
    if (stopping) return;
    try {
      await runDailyCheck(client);
    } catch (e) {
      console.error("⚠️ runDailyCheck a échoué :", e);
    } finally {
      if (!stopping) setTimeout(tick, intervalMs);
    }
  };
  tick();
}

async function shutdown(reason: string) {
  if (stopping) return;
  stopping = true;
  console.log(`🛑 Arrêt en cours (${reason})...`);
  try {
    await client.destroy();
  } catch (e) {
    console.error("⚠️ Erreur pendant client.destroy :", e);
  }
  Deno.exit(0);
}

globalThis.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  console.error("⚠️ Promesse rejetée non catchée :", event.reason);
});

globalThis.addEventListener("error", (event) => {
  console.error("⚠️ Erreur non catchée :", event.error ?? event.message);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  try {
    Deno.addSignalListener(sig, () => shutdown(sig));
  } catch (_) { /* signal non supporté sur la plateforme courante */ }
}

client.once(Events.ClientReady, async () => {
  console.log(`🤖 Connecté: ${client.user?.tag}`);

  // Enregistrement des commandes (scope guilde)
  const rest = new REST({ version: "10" }).setToken(CONFIG.TOKEN!);
  try {
    await rest.put(Routes.applicationGuildCommands(client.user!.id, CONFIG.GUILD_ID!), { body: commandsJson });
    console.log("✅ Commandes chargées.");
  } catch (e) {
    console.error(e);
  }

  // Test de connexion à la base
  console.log((await testConnection()) ? "✅ NocoDB OK" : "❌ NocoDB Erreur");

  // Démarrage du cron
  scheduleCheck();
});

client.on(Events.InteractionCreate, (i) => handleInteraction(i));
client.on(Events.GuildMemberAdd, (member) => handleMemberJoin(member));

client.login(CONFIG.TOKEN);
