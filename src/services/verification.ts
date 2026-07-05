/**
 * Logique métier de vérification d'adhésion.
 * Orchestre les lectures NocoDB pour décider si un couple (email, compte Discord)
 * peut poursuivre la procédure de liaison.
 */
import { CONFIG } from "../config/config.ts";
import { VerificationResult } from "../core/types.ts";
import { findMemberByColumn } from "../infrastructure/nocodb/members.repo.ts";

export async function checkUserStatus(emailInput: string, discordIdInput: string): Promise<VerificationResult> {
  const email = emailInput.trim().toLowerCase();

  // 1. Check : Ce compte Discord est-il déjà utilisé ?
  const existingDiscord = await findMemberByColumn(CONFIG.COL_DISCORD_ID, discordIdInput);
  if (existingDiscord && existingDiscord.email !== email) {
    return { valid: false, message: "⛔ Ce compte Discord est déjà lié à un autre dossier." };
  }

  // 2. Check : L'email existe-t-il ?
  const member = await findMemberByColumn(CONFIG.COL_EMAIL, email);
  if (!member) {
    return { valid: false, message: `❌ Email \`${email}\` introuvable.` };
  }

  // 3. Check : Cotisation à jour ?
  if (!member.cotisationValide) {
    return { valid: false, message: "⚠️ Ton dossier existe, mais ta cotisation n'est pas à jour." };
  }

  // 4. Check : Email déjà pris par un autre Discord ?
  if (member.discordId && member.discordId !== discordIdInput) {
    return { valid: false, message: "⛔ Cet email est déjà lié à un autre compte Discord." };
  }

  // 5. Check : Déjà fait ?
  if (member.discordId === discordIdInput) {
    return { valid: false, message: "✅ Ton compte est déjà correctement lié." };
  }

  return { valid: true, message: "OK", member };
}
