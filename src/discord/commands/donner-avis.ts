// deno-lint-ignore-file no-import-prefix
import { MessageFlags, SlashCommandBuilder } from "npm:discord.js@14";
import { SlashCommand } from "../registry.ts";

/**
 * NOTE : dans l'ancienne architecture, cette commande était déclarée mais sans
 * handler — Discord affichait alors "L'application n'a pas répondu". On fournit
 * ici un retour minimal en attendant l'implémentation complète du recueil d'avis.
 */
export const donnerAvis: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("donner-avis")
    .setDescription("Donner un avis sur l'association (non anonyme)")
    .toJSON(),

  execute: async (interaction) => {
    await interaction.reply({
      content: "🚧 Cette fonctionnalité arrive bientôt. Merci de ta patience !",
      flags: MessageFlags.Ephemeral,
    });
  },
};
