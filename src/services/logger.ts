// deno-lint-ignore-file no-import-prefix
import { ChannelType, EmbedBuilder, ForumChannel, Guild, TextChannel } from "npm:discord.js@14";
import { CONFIG } from "../config/config.ts";
import { Colors } from "../config/constants.ts";

/**
 * Publie un embed de log dans le canal d'audit configuré (LOG_CHANNEL_ID).
 * Supporte les canaux texte classiques et les forums (crée un thread par log).
 */
export async function sendLog(
  guild: Guild,
  discordId: string | null,
  email: string,
  status: string,
  color: number = Colors.SUCCESS,
) {
  if (!CONFIG.LOG_CHANNEL_ID) return;

  try {
    const channel = await guild.channels.fetch(CONFIG.LOG_CHANNEL_ID);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle("📋 Log Bot Adhésion")
      .setDescription(discordId ? `Concerne : <@${discordId}>` : `Concerne : ${email}`)
      .addFields(
        { name: "Email", value: email, inline: true },
        { name: "Info", value: status, inline: true },
      )
      .setColor(color)
      .setTimestamp();

    if (channel.type === ChannelType.GuildForum) {
      await (channel as ForumChannel).threads.create({
        name: `Log: ${email}`,
        message: { embeds: [embed] },
      });
    } else if (channel.isTextBased()) {
      await (channel as TextChannel).send({ embeds: [embed] });
    }
  } catch (e) {
    console.error("❌ Erreur log:", e);
  }
}
