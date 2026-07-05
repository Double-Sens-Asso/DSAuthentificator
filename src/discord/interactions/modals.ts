// deno-lint-ignore-file no-import-prefix
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildMember,
  MessageFlags,
} from "npm:discord.js@14";
import { CONFIG } from "../../config/config.ts";
import { Colors, CustomId, EMAIL_MAX_LENGTH, EMAIL_REGEX } from "../../config/constants.ts";
import { generateOtp, normalizeEmail } from "../../shared/utils.ts";
import { checkUserStatus } from "../../services/verification.ts";
import { linkDiscordUser } from "../../infrastructure/nocodb/members.repo.ts";
import { checkRateLimit } from "../../services/rate-limit.ts";
import { sendVerificationCode } from "../../infrastructure/email/mailer.ts";
import { sendLog } from "../../services/logger.ts";
import {
  deleteSession,
  getSession,
  incrementAttempt,
  setSession,
} from "../../infrastructure/storage/sessions.store.ts";
import { clearPending } from "../../infrastructure/storage/pending-removals.store.ts";
import { ModalHandler } from "../registry.ts";

/** Handlers de modals, indexés par customId. */
export const modalHandlers: Record<string, ModalHandler> = {
  [CustomId.MODAL_EMAIL]: async (interaction) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const email = normalizeEmail(interaction.fields.getTextInputValue(CustomId.INPUT_EMAIL));

    if (email.length > EMAIL_MAX_LENGTH || !EMAIL_REGEX.test(email)) {
      await interaction.editReply("❌ Format d'email invalide.");
      return;
    }

    const rl = checkRateLimit(
      `verify:${interaction.user.id}`,
      CONFIG.VERIFY_RATE_LIMIT_MAX,
      CONFIG.VERIFY_RATE_LIMIT_WINDOW_SECONDS,
    );
    if (!rl.allowed) {
      const minutes = Math.ceil(rl.retryAfter / 60);
      await interaction.editReply(`⏱️ Trop de tentatives. Réessaie dans ~${minutes} min.`);
      await sendLog(interaction.guild!, interaction.user.id, email, "⏱️ Vérification refusée (rate-limit)", Colors.WARNING);
      return;
    }

    const status = await checkUserStatus(email, interaction.user.id);
    if (!status.valid || !status.member) {
      await interaction.editReply(status.message);
      await sendLog(interaction.guild!, interaction.user.id, email, `❌ Échec /verify : ${status.message}`, Colors.WARNING);
      return;
    }

    const code = generateOtp();
    const result = await sendVerificationCode(email, code);
    if (!result.ok) {
      await interaction.editReply("❌ Erreur technique lors de l'envoi de l'email. Contacte un admin.");
      const detail = result.error ? ` : ${result.error.slice(0, 200)}` : "";
      await sendLog(interaction.guild!, interaction.user.id, email, `⚠️ Échec d'envoi SMTP${detail}`, Colors.ERROR);
      return;
    }

    await setSession(interaction.user.id, { code, email, recordId: status.member.recordId });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(CustomId.BTN_ENTER_CODE)
        .setLabel("J'ai reçu mon code")
        .setStyle(ButtonStyle.Success)
        .setEmoji("🔓"),
    );

    const ttlMin = Math.round(CONFIG.OTP_TTL_SECONDS / 60);
    await interaction.editReply({
      content: `✅ **Vérification initiale réussie !**\nUn code de sécurité vient d'être envoyé à \`${email}\`.\n` +
        `Regarde tes spams, puis clique ci-dessous (valable ${ttlMin} min).`,
      components: [row],
    });
  },

  [CustomId.MODAL_CODE]: async (interaction) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const codeInput = interaction.fields.getTextInputValue(CustomId.INPUT_CODE).trim();
    const session = await getSession(interaction.user.id);

    if (!session) {
      await interaction.editReply("⏳ Session expirée. Recommence depuis le début.");
      return;
    }

    if (session.code !== codeInput) {
      const attempts = await incrementAttempt(interaction.user.id);
      const remaining = CONFIG.OTP_MAX_ATTEMPTS - attempts;
      if (remaining <= 0) {
        await deleteSession(interaction.user.id);
        await interaction.editReply("❌ Trop de tentatives. Recommence depuis le début avec `/verify`.");
        await sendLog(interaction.guild!, interaction.user.id, session.email, "❌ Session invalidée (trop de tentatives)", Colors.ERROR);
        return;
      }
      await interaction.editReply(`❌ Code incorrect. ${remaining} tentative(s) restante(s).`);
      return;
    }

    const success = await linkDiscordUser(session.recordId, interaction.user.id);
    if (!success) {
      await interaction.editReply("❌ Erreur critique lors de l'enregistrement dans la base de données.");
      await sendLog(interaction.guild!, interaction.user.id, session.email, "⚠️ Échec écriture NocoDB", Colors.ERROR);
      return;
    }

    const role = await interaction.guild?.roles.fetch(CONFIG.VERIFY_ROLE_ID!).catch(() => null);
    if (role) {
      await (interaction.member as GuildMember).roles.add(role);
    } else {
      console.error(`❌ VERIFY_ROLE_ID introuvable côté Discord pour ${session.email}`);
    }
    await clearPending(interaction.user.id);

    await sendLog(interaction.guild!, interaction.user.id, session.email, "✅ Succès (Vérifié par Code)");
    await interaction.editReply(`🎉 **Félicitations !** Ton compte est maintenant lié à \`${session.email}\`.`);
    await deleteSession(interaction.user.id);
  },
};
