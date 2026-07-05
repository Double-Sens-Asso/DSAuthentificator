// deno-lint-ignore-file no-import-prefix
import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  RESTPostAPIApplicationCommandsJSONBody,
} from "npm:discord.js@14";

/**
 * Contrat d'une slash-command : la définition (JSON envoyé à Discord) et son
 * exécution sont co-localisées dans un même fichier. `adminOnly` permet au
 * routeur de filtrer l'accès de façon centralisée (cf. router.ts).
 */
export interface SlashCommand {
  data: RESTPostAPIApplicationCommandsJSONBody;
  adminOnly?: boolean;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

export type ButtonHandler = (interaction: ButtonInteraction) => Promise<void>;
export type ModalHandler = (interaction: ModalSubmitInteraction) => Promise<void>;
