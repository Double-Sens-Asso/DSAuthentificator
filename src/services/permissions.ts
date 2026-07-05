// deno-lint-ignore-file no-import-prefix
import { GuildMember } from "npm:discord.js@14";
import { CONFIG } from "../config/config.ts";

/** Vrai si le membre possède le rôle administrateur configuré (ADMIN_ROLE_ID). */
export function isAdmin(member: GuildMember | null): boolean {
  if (!member || !CONFIG.ADMIN_ROLE_ID) return false;
  return member.roles.cache.has(CONFIG.ADMIN_ROLE_ID);
}
