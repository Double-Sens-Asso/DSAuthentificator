// deno-lint-ignore-file no-import-prefix
import { MessageFlags, SlashCommandBuilder } from "npm:discord.js@14";
import { CONFIG } from "../../../config/config.ts";
import { getAllPending } from "../../../infrastructure/storage/pending-removals.store.ts";
import { SlashCommand } from "../../registry.ts";

export const adminPending: SlashCommand = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("admin-pending")
    .setDescription("👑 Admin: Lister les retraits de rôle en attente")
    .toJSON(),

  execute: async (interaction) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const pending = await getAllPending();
    if (pending.length === 0) {
      await interaction.editReply("✅ Aucun retrait de rôle en attente.");
      return;
    }

    const delayMs = CONFIG.DELAY_INVALID_COTISATION * 1000;
    const lines = pending.slice(0, 25).map((p) => {
      const removal = new Date(p.firstDetectedAt + delayMs).toLocaleDateString("fr-FR");
      const motif = p.reminded ? "Cotisation invalide (rappel envoyé)" : "Cotisation invalide";
      return `<@${p.discordId}> — \`${p.email}\` — retrait le ${removal} — ${motif}`;
    });

    const overflow = pending.length > 25 ? `\n_(+${pending.length - 25} autres)_` : "";
    await interaction.editReply(`**${pending.length} retrait(s) en attente :**\n${lines.join("\n")}${overflow}`);
  },
};
