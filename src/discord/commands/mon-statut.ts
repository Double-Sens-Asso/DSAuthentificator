// deno-lint-ignore-file no-import-prefix
import { MessageFlags, SlashCommandBuilder } from "npm:discord.js@14";
import { CONFIG } from "../../config/config.ts";
import { findMemberByColumn } from "../../infrastructure/nocodb/members.repo.ts";
import { getPending } from "../../infrastructure/storage/pending-removals.store.ts";
import { SlashCommand } from "../registry.ts";

export const monStatut: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("mon-statut")
    .setDescription("Voir le statut de ton adhésion (cotisation, retrait éventuel)")
    .toJSON(),

  execute: async (interaction) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const member = await findMemberByColumn(CONFIG.COL_DISCORD_ID, interaction.user.id);

    if (!member) {
      await interaction.editReply("ℹ️ Aucun dossier n'est lié à ton compte Discord. Lance `/verify` pour t'identifier.");
      return;
    }

    const lines = [
      `📧 Email lié : \`${member.email}\``,
      `💳 Cotisation : ${member.cotisationValide ? "✅ à jour" : "❌ non à jour"}`,
    ];

    const pending = await getPending(interaction.user.id);
    if (pending) {
      const removalDate = new Date(pending.firstDetectedAt + CONFIG.DELAY_INVALID_COTISATION * 1000);
      lines.push(`⏳ Retrait du rôle prévu le **${removalDate.toLocaleDateString("fr-FR")}**`);
    }

    await interaction.editReply(lines.join("\n"));
  },
};
