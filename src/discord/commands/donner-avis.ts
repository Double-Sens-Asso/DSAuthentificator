// deno-lint-ignore-file no-import-prefix
import {
  LabelBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "npm:discord.js@14";
import { CustomId } from "../../config/constants.ts";
import { SlashCommand } from "../registry.ts";

/**
 * Ouvre un modal de recueil d'avis (non anonyme). La soumission est traitée
 * par le handler `MODAL_AVIS` (cf. interactions/modals.ts).
 */
export const donnerAvis: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("donner-avis")
    .setDescription("Donner un avis sur l'association (non anonyme)")
    .toJSON(),

  execute: async (interaction) => {
    const modal = new ModalBuilder()
      .setCustomId(CustomId.MODAL_AVIS)
      .setTitle("Donner un avis")
      .setLabelComponents(
        new LabelBuilder()
          .setLabel("Note (0 à 5)")
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId(CustomId.INPUT_AVIS_NOTE)
              .setPlaceholder("Exemple : 4")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(1),
          ),
        new LabelBuilder()
          .setLabel("Commentaire (obligatoire)")
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId(CustomId.INPUT_AVIS_COMMENT)
              .setPlaceholder("Exemple : L'entraide dans l'association est top !")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true),
          ),
      );

    await interaction.showModal(modal);
  },
};
