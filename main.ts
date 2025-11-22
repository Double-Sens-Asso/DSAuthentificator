// deno-lint-ignore-file no-import-prefix

import { Client, GatewayIntentBits, REST, Routes, Events } from "npm:discord.js@14";
import { CONFIG } from "./config.ts";
import { runDailyCheck } from "./utils.ts";
import { handleInteraction } from "./interactionHandler.ts";
import { testConnection } from "./nocodb.ts";
import { commands } from "./commands.ts"; // <--- LIGNE À AJOUTER

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once(Events.ClientReady, async () => {
  console.log(`🤖 Connecté: ${client.user?.tag}`);
  
  // Commandes
  const rest = new REST({ version: "10" }).setToken(CONFIG.TOKEN!);
  try {
    await rest.put(Routes.applicationGuildCommands(client.user!.id, CONFIG.GUILD_ID!), { body: commands });
    console.log("✅ Commandes chargées.");
  } catch (e) { console.error(e); }

  // DB Check
  console.log((await testConnection()) ? "✅ NocoDB OK" : "❌ NocoDB Erreur");
  
  // Cron
  runDailyCheck(client);
  setInterval(() => runDailyCheck(client), 24 * 3600 * 1000);
});

client.on(Events.InteractionCreate, (i) => handleInteraction(i));

client.login(CONFIG.TOKEN);