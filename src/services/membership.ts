// deno-lint-ignore-file no-import-prefix
import { GuildMember } from "npm:discord.js@14";
import { CONFIG } from "../config/config.ts";
import { findMemberByColumn } from "../infrastructure/nocodb/members.repo.ts";
import { clearPending } from "../infrastructure/storage/pending-removals.store.ts";
import { sendLog } from "./logger.ts";

/**
 * À l'arrivée d'un membre : si son compte Discord est déjà lié à un dossier
 * dont la cotisation est valide, on lui ré-attribue automatiquement le rôle.
 */
export async function handleMemberJoin(member: GuildMember): Promise<void> {
  try {
    const data = await findMemberByColumn(CONFIG.COL_DISCORD_ID, member.id);
    if (!data || !data.cotisationValide) return;

    const role = await member.guild.roles.fetch(CONFIG.VERIFY_ROLE_ID!);
    if (!role) return;

    if (!member.roles.cache.has(role.id)) {
      await member.roles.add(role);
      await sendLog(member.guild, member.id, data.email, "🔁 Rôle ré-attribué (retour sur le serveur)");
    }
    await clearPending(member.id);
  } catch (e) {
    console.error(`⚠️ Erreur handleMemberJoin (${member.id}):`, e);
  }
}
