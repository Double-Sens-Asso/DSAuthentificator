// deno-lint-ignore-file no-import-prefix
import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "npm:discord.js@14";
import { CustomId } from "../../config/constants.ts";
import { getSession } from "../../infrastructure/storage/sessions.store.ts";
import { ButtonHandler } from "../registry.ts";

/** Handlers de boutons, indexés par customId. */
export const buttonHandlers: Record<string, ButtonHandler> = {
  [CustomId.BTN_VERIFY_START]: async (interaction) => {
    const modal = new ModalBuilder().setCustomId(CustomId.MODAL_EMAIL).setTitle("Identification");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(CustomId.INPUT_EMAIL)
          .setLabel("Ton Email Adhérent")
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );
    await interaction.showModal(modal);
  },

  [CustomId.BTN_ENTER_CODE]: async (interaction) => {
    const session = await getSession(interaction.user.id);
    if (!session) {
      await interaction.reply({ content: "⏳ Session expirée. Recommence depuis le début.", flags: MessageFlags.Ephemeral });
      return;
    }

    const modal = new ModalBuilder().setCustomId(CustomId.MODAL_CODE).setTitle("Code de Sécurité");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(CustomId.INPUT_CODE)
          .setLabel(`Code envoyé à ${session.email}`.slice(0, 45))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(6),
      ),
    );
    await interaction.showModal(modal);
  },
};
