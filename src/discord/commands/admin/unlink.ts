// deno-lint-ignore-file no-import-prefix
import { MessageFlags, SlashCommandBuilder, SlashCommandStringOption } from "npm:discord.js@14";
import { Colors } from "../../../config/constants.ts";
import { normalizeEmail } from "../../../shared/utils.ts";
import { unlinkUserByEmail } from "../../../infrastructure/nocodb/members.repo.ts";
import { sendLog } from "../../../services/logger.ts";
import { SlashCommand } from "../../registry.ts";

export const adminUnlink: SlashCommand = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("admin-unlink")
    .setDescription("👑 Admin: Délier un email d'un compte Discord")
    .addStringOption((opt: SlashCommandStringOption) => opt.setName("email").setDescription("L'email à libérer").setRequired(true))
    .toJSON(),

  execute: async (interaction) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const email = normalizeEmail(interaction.options.getString("email", true));
    const res = await unlinkUserByEmail(email);
    await interaction.editReply(res.message);
    await sendLog(
      interaction.guild!,
      null,
      email,
      `🛠️ admin-unlink par <@${interaction.user.id}> — ${res.success ? "OK" : "ÉCHEC"}`,
      res.success ? Colors.BRAND : Colors.WARNING,
    );
  },
};
