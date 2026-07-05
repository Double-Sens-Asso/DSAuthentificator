// deno-lint-ignore-file no-import-prefix
import { MessageFlags, SlashCommandBuilder } from "npm:discord.js@14";
import { SlashCommand } from "../registry.ts";

export const ping: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Vérifier si le bot répond")
    .toJSON(),

  execute: async (interaction) => {
    const latency = Date.now() - interaction.createdTimestamp;
    await interaction.reply({ content: `🏓 Pong ! (${latency}ms)`, flags: MessageFlags.Ephemeral });
  },
};
