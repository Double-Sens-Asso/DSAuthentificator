// deno-lint-ignore-file no-import-prefix
import { MessageFlags, SlashCommandBuilder, SlashCommandStringOption } from "npm:discord.js@14";
import { Colors } from "../../../config/constants.ts";
import { normalizeEmail } from "../../../shared/utils.ts";
import { clearPending, findPendingByEmail } from "../../../infrastructure/storage/pending-removals.store.ts";
import { sendLog } from "../../../services/logger.ts";
import { SlashCommand } from "../../registry.ts";

export const adminCancelRemoval: SlashCommand = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("admin-cancel-removal")
    .setDescription("👑 Admin: Annuler un retrait de rôle programmé")
    .addStringOption((opt: SlashCommandStringOption) => opt.setName("email").setDescription("L'email concerné").setRequired(true))
    .toJSON(),

  execute: async (interaction) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const email = normalizeEmail(interaction.options.getString("email", true));
    const found = await findPendingByEmail(email);
    if (!found) {
      await interaction.editReply(`ℹ️ Aucun retrait en attente pour \`${email}\`.`);
      return;
    }

    await clearPending(found.discordId);
    await interaction.editReply(`✅ Retrait annulé pour \`${email}\` (<@${found.discordId}>).`);
    await sendLog(
      interaction.guild!,
      found.discordId,
      email,
      `🛠️ admin-cancel-removal par <@${interaction.user.id}>`,
      Colors.BRAND,
    );
  },
};
