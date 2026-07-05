// deno-lint-ignore-file no-import-prefix
import { CacheType, GuildMember, Interaction, MessageFlags } from "npm:discord.js@14";
import { isAdmin } from "../services/permissions.ts";
import { commandMap } from "./commands/index.ts";
import { buttonHandlers } from "./interactions/buttons.ts";
import { modalHandlers } from "./interactions/modals.ts";

/**
 * Point d'entrée unique des interactions Discord.
 * Dispatch vers la bonne commande / bouton / modal et applique le filtrage
 * admin de façon centralisée (via `SlashCommand.adminOnly`).
 */
export async function handleInteraction(interaction: Interaction<CacheType>) {
  try {
    if (interaction.isChatInputCommand()) {
      const command = commandMap.get(interaction.commandName);
      if (!command) return;

      if (command.adminOnly && !isAdmin(interaction.member as GuildMember)) {
        await interaction.reply({
          content: "⛔ Tu n'as pas la permission d'utiliser cette commande.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await command.execute(interaction);
      return;
    }

    if (interaction.isButton()) {
      const handler = buttonHandlers[interaction.customId];
      if (handler) await handler(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      const handler = modalHandlers[interaction.customId];
      if (handler) await handler(interaction);
      return;
    }
  } catch (e) {
    console.error("Global Interaction Error:", e);
  }
}
