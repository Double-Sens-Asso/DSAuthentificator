// deno-lint-ignore-file no-import-prefix no-unversioned-import
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "npm:discord.js@14";
import { join } from "jsr:@std/path";
import { ASSETS_DIR } from "../../config/paths.ts";
import { Colors, CustomId } from "../../config/constants.ts";
import { SlashCommand } from "../registry.ts";

export const verify: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Lancer la procédure de vérification d'adhésion")
    .toJSON(),

  execute: async (interaction) => {
    const logo = new AttachmentBuilder(join(ASSETS_DIR, "logo.png"));

    const embed = new EmbedBuilder()
      .setTitle("✨ Bienvenue ! Finalisons ton inscription")
      .setDescription("Nous allons vérifier ton adhésion.\nClique ci-dessous pour démarrer.")
      .setColor(Colors.BRAND)
      .setThumbnail("attachment://logo.png")
      .setFooter({ text: "Sécurisé par SMTP" });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(CustomId.BTN_VERIFY_START)
        .setLabel("Lier mon compte")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("📧"),
    );

    await interaction.reply({ embeds: [embed], components: [row], files: [logo], flags: MessageFlags.Ephemeral });
  },
};
