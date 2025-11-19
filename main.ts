import { Client, GatewayIntentBits, REST, Routes, Events } from "npm:discord.js@14";

// Import des modules locaux
import { CONFIG } from "./config.ts";
import { commands } from "./commands.ts";
import { runDailyCheck } from "./utils.ts";
import { handleInteraction } from "./interactionHandler.ts";
import { testConnection } from "./nocodb.ts";

// Initialisation du Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// Événement : Prêt
client.once(Events.ClientReady, async () => {
  console.log(`✅ Connecté en tant que : ${client.user?.tag}`);
  
  // 1. Enregistrement des commandes Slash
  const rest = new REST({ version: "10" }).setToken(CONFIG.TOKEN!);
  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user!.id, CONFIG.GUILD_ID!), 
      { body: commands }
    );
    console.log("✅ Commandes Slash enregistrées.");
  } catch (e) {
    console.error("❌ Erreur enregistrement commandes:", e);
  }

  // 2. Test DB
  const dbStatus = await testConnection();
  console.log(dbStatus ? "✅ Connexion NocoDB OK" : "❌ Échec connexion NocoDB");
  
  // 3. Lancement Cron Job (Immédiat + Intervalle 24h)
  runDailyCheck(client);
  setInterval(() => runDailyCheck(client), 1000 * 60 * 60 * 24);
});

// Événement : Interactions (Commandes, Boutons, Modals)
client.on(Events.InteractionCreate, async (interaction) => {
  await handleInteraction(interaction, client);
});

// Connexion
client.login(CONFIG.TOKEN);