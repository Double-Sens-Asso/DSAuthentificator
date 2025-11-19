import { EmbedBuilder, ChannelType, ForumChannel, TextChannel, Guild, Client } from "npm:discord.js@14";
import { CONFIG } from "./config.ts";
import { getAllLinkedUsers } from "./nocodb.ts";

/**
 * Envoie un log dans le salon configuré
 */
export async function sendLog(guild: Guild, discordId: string | null, email: string, status: string, color: number = 0x00FF00) {
  if (!CONFIG.LOG_CHANNEL_ID) return;

  try {
    const channel = await guild.channels.fetch(CONFIG.LOG_CHANNEL_ID);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle("📋 Log Bot Adhésion")
      .setDescription(discordId ? `Concerne : <@${discordId}>` : `Concerne : ${email}`)
      .addFields(
        { name: "Email", value: email, inline: true },
        { name: "Info", value: status, inline: true }
      )
      .setColor(color)
      .setTimestamp();

    if (channel.type === ChannelType.GuildForum) {
      await (channel as ForumChannel).threads.create({ 
        name: `Log: ${email}`, 
        message: { embeds: [embed] } 
      });
    } else if (channel.isTextBased()) {
      await (channel as TextChannel).send({ embeds: [embed] });
    }
  } catch (e) { 
    console.error("❌ Erreur lors de l'envoi du log:", e); 
  }
}

/**
 * Tâche planifiée : Vérifie les cotisations
 */
export async function runDailyCheck(client: Client) {
  console.log("🔄 [AUTO] Lancement de la vérification des cotisations...");
  
  const guild = await client.guilds.fetch(CONFIG.GUILD_ID!);
  if (!guild) return;

  const role = await guild.roles.fetch(CONFIG.VERIFY_ROLE_ID!);
  if (!role) return;

  const members = await getAllLinkedUsers();
  let removedCount = 0;

  for (const m of members) {
    try {
      if (!m.discordId) continue;
      
      const dUser = await guild.members.fetch(m.discordId).catch(() => null);
      if (!dUser) continue;

      if (!m.cotisationValide && dUser.roles.cache.has(role.id)) {
        console.log(`📉 [AUTO] Retrait du rôle pour ${m.email}`);
        await dUser.roles.remove(role);
        await sendLog(guild, m.discordId, m.email, "❌ Cotisation expirée - Rôle retiré", 0xFF0000);
        removedCount++;
        await new Promise(r => setTimeout(r, 1000)); // Pause anti-spam
      }
    } catch (e) { 
      console.error(`⚠️ Erreur check auto (${m.email}):`, e); 
    }
  }
  console.log(`✅ [AUTO] Terminé. ${removedCount} rôle(s) retiré(s).`);
}