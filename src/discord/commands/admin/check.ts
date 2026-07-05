// deno-lint-ignore-file no-import-prefix
import { MessageFlags, SlashCommandBuilder, SlashCommandStringOption } from "npm:discord.js@14";
import { CONFIG } from "../../../config/config.ts";
import { normalizeEmail } from "../../../shared/utils.ts";
import { findMemberByColumn } from "../../../infrastructure/nocodb/members.repo.ts";
import { SlashCommand } from "../../registry.ts";

export const adminCheck: SlashCommand = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("admin-check")
    .setDescription("👑 Admin: Vérifier le statut d'un email")
    .addStringOption((opt: SlashCommandStringOption) => opt.setName("email").setDescription("L'email à vérifier").setRequired(true))
    .toJSON(),

  execute: async (interaction) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const email = normalizeEmail(interaction.options.getString("email", true));
    const data = await findMemberByColumn(CONFIG.COL_EMAIL, email);
    await interaction.editReply(
      data
        ? `✅ Trouvé: ID ${data.recordId} | Cotis: ${data.cotisationValide} | Discord: ${data.discordId}`
        : "❌ Inconnu",
    );
  },
};
