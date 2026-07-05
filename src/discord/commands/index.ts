import { SlashCommand } from "../registry.ts";
import { ping } from "./ping.ts";
import { verify } from "./verify.ts";
import { monStatut } from "./mon-statut.ts";
import { donnerAvis } from "./donner-avis.ts";
import { adminUnlink } from "./admin/unlink.ts";
import { adminCheck } from "./admin/check.ts";
import { adminPending } from "./admin/pending.ts";
import { adminCancelRemoval } from "./admin/cancel-removal.ts";

/** Toutes les slash-commands du bot. */
export const slashCommands: SlashCommand[] = [
  // Public
  ping,
  verify,
  monStatut,
  donnerAvis,
  // Admin (filtrées par ADMIN_ROLE_ID via le routeur)
  adminUnlink,
  adminCheck,
  adminPending,
  adminCancelRemoval,
];

/** Corps JSON à envoyer à l'API Discord lors de l'enregistrement. */
export const commandsJson = slashCommands.map((c) => c.data);

/** Index nom -> commande, pour le dispatch des interactions. */
export const commandMap = new Map<string, SlashCommand>(
  slashCommands.map((c) => [c.data.name, c]),
);
