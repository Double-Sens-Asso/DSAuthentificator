// deno-lint-ignore-file no-import-prefix

import { Client, Events, GatewayIntentBits, REST, Routes } from "npm:discord.js@14";
import { CONFIG } from "./config.ts";
import { handleMemberJoin, runDailyCheck } from "./utils.ts";
import { handleInteraction } from "./interactionHandler.ts";
import { testConnection } from "./nocodb.ts";
import { commands } from "./commands.ts";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

let stopping = false;

/**
 * Planifie `runDailyCheck` toutes les `CHECK_INTERVAL_SECONDS` secondes.
 * Utilise setTimeout récursif (et pas setInterval) pour ne pas accumuler les
 * exécutions si une passe est plus longue que l'intervalle.
 */
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

/** Arrêt propre : ferme le client Discord avant de quitter. */
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

// Filets de sécurité globaux : on ne veut pas qu'une promesse oubliée tue le bot silencieusement.
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
  } catch (_) {
    // Certaines plateformes (Windows) ne supportent pas tous les signaux ; pas critique.
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`🤖 Connecté: ${client.user?.tag}`);

  // Commandes
  const rest = new REST({ version: "10" }).setToken(CONFIG.TOKEN!);
  try {
    await rest.put(Routes.applicationGuildCommands(client.user!.id, CONFIG.GUILD_ID!), { body: commands });
    console.log("✅ Commandes chargées.");
  } catch (e) {
    console.error(e);
  }

  // DB Check
  console.log((await testConnection()) ? "✅ NocoDB OK" : "❌ NocoDB Erreur");

  // Cron
  scheduleCheck();
});

client.on(Events.InteractionCreate, (i) => handleInteraction(i));
client.on(Events.GuildMemberAdd, (member) => handleMemberJoin(member));

client.login(CONFIG.TOKEN);
