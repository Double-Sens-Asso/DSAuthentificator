// deno-lint-ignore-file no-import-prefix
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  CacheType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  Interaction,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "npm:discord.js@14";

import { CONFIG, EMAIL_MAX_LENGTH, EMAIL_REGEX } from "./config.ts";
import { generateOtp } from "./helpers.ts";
import { sendLog, sendVerificationCode } from "./utils.ts";
import { checkUserStatus, findMemberByColumn, linkDiscordUser, unlinkUserByEmail } from "./nocodb.ts";
import { deleteSession, getSession, incrementAttempt, setSession } from "./sessions.ts";
import { checkRateLimit } from "./rateLimit.ts";
import { clearPending, findPendingByEmail, getAllPending, getPending } from "./pendingRemovals.ts";

const ephemeral = MessageFlags.Ephemeral;
const normalizeEmail = (e: string) => e.trim().toLowerCase();

function isAdmin(member: GuildMember | null): boolean {
  if (!member || !CONFIG.ADMIN_ROLE_ID) return false;
  return member.roles.cache.has(CONFIG.ADMIN_ROLE_ID);
}

async function denyIfNotAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (isAdmin(interaction.member as GuildMember)) return false;
  await interaction.reply({ content: "⛔ Tu n'as pas la permission d'utiliser cette commande.", flags: ephemeral });
  return true;
}

const slashHandlers: Record<string, (i: ChatInputCommandInteraction) => Promise<void>> = {
  ping: async (interaction) => {
    const latency = Date.now() - interaction.createdTimestamp;
    await interaction.reply({ content: `🏓 Pong ! (${latency}ms)`, flags: ephemeral });
  },

  verify: async (interaction) => {
    const logo = new AttachmentBuilder("assets/logo.png");

    const embed = new EmbedBuilder()
      .setTitle("✨ Bienvenue ! Finalisons ton inscription")
      .setDescription("Nous allons vérifier ton adhésion.\nClique ci-dessous pour démarrer.")
      .setColor(0x5865F2)
      .setThumbnail("attachment://logo.png")
      .setFooter({ text: "Sécurisé par SMTP" });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("btn_verify_start")
        .setLabel("Lier mon compte")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("📧"),
    );

    await interaction.reply({ embeds: [embed], components: [row], files: [logo], flags: ephemeral });
  },

  "mon-statut": async (interaction) => {
    await interaction.deferReply({ flags: ephemeral });
    const member = await findMemberByColumn(CONFIG.COL_DISCORD_ID, interaction.user.id);

    if (!member) {
      await interaction.editReply("ℹ️ Aucun dossier n'est lié à ton compte Discord. Lance `/verify` pour t'identifier.");
      return;
    }

    const lines = [
      `📧 Email lié : \`${member.email}\``,
      `💳 Cotisation : ${member.cotisationValide ? "✅ à jour" : "❌ non à jour"}`,
    ];

    const pending = await getPending(interaction.user.id);
    if (pending) {
      const removalDate = new Date(pending.firstDetectedAt + CONFIG.DELAY_INVALID_COTISATION * 1000);
      lines.push(`⏳ Retrait du rôle prévu le **${removalDate.toLocaleDateString("fr-FR")}**`);
    }

    await interaction.editReply(lines.join("\n"));
  },

  "admin-unlink": async (interaction) => {
    if (await denyIfNotAdmin(interaction)) return;
    await interaction.deferReply({ flags: ephemeral });
    const email = normalizeEmail(interaction.options.getString("email", true));
    const res = await unlinkUserByEmail(email);
    await interaction.editReply(res.message);
    await sendLog(
      interaction.guild!,
      null,
      email,
      `🛠️ admin-unlink par <@${interaction.user.id}> — ${res.success ? "OK" : "ÉCHEC"}`,
      res.success ? 0x5865F2 : 0xFFA500,
    );
  },

  "admin-check": async (interaction) => {
    if (await denyIfNotAdmin(interaction)) return;
    await interaction.deferReply({ flags: ephemeral });
    const email = normalizeEmail(interaction.options.getString("email", true));
    const data = await findMemberByColumn(CONFIG.COL_EMAIL, email);
    await interaction.editReply(
      data
        ? `✅ Trouvé: ID ${data.recordId} | Cotis: ${data.cotisationValide} | Discord: ${data.discordId}`
        : "❌ Inconnu",
    );
  },

  "admin-pending": async (interaction) => {
    if (await denyIfNotAdmin(interaction)) return;
    await interaction.deferReply({ flags: ephemeral });

    const pending = await getAllPending();
    if (pending.length === 0) {
      await interaction.editReply("✅ Aucun retrait de rôle en attente.");
      return;
    }

    const delayMs = CONFIG.DELAY_INVALID_COTISATION * 1000;
    const lines = pending.slice(0, 25).map((p) => {
      const removal = new Date(p.firstDetectedAt + delayMs).toLocaleDateString("fr-FR");
      const motif = p.reminded ? "Cotisation invalide (rappel envoyé)" : "Cotisation invalide";
      return `<@${p.discordId}> — \`${p.email}\` — retrait le ${removal} — ${motif}`;
    });

    const overflow = pending.length > 25 ? `\n_(+${pending.length - 25} autres)_` : "";
    await interaction.editReply(`**${pending.length} retrait(s) en attente :**\n${lines.join("\n")}${overflow}`);
  },

  "admin-cancel-removal": async (interaction) => {
    if (await denyIfNotAdmin(interaction)) return;
    await interaction.deferReply({ flags: ephemeral });

    const email = normalizeEmail(interaction.options.getString("email", true));
    const found = await findPendingByEmail(email);
    if (!found) {
      await interaction.editReply(`ℹ️ Aucun retrait en attente pour \`${email}\`.`);
      return;
    }

    await clearPending(found.discordId);
    await interaction.editReply(`✅ Retrait annulé pour \`${email}\` (<@${found.discordId}>).`);
    await sendLog(
      interaction.guild!,
      found.discordId,
      email,
      `🛠️ admin-cancel-removal par <@${interaction.user.id}>`,
      0x5865F2,
    );
  },
};

const buttonHandlers: Record<string, (i: ButtonInteraction) => Promise<void>> = {
  btn_verify_start: async (interaction) => {
    const modal = new ModalBuilder().setCustomId("modal_email").setTitle("Identification");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("input_email")
          .setLabel("Ton Email Adhérent")
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );
    await interaction.showModal(modal);
  },

  btn_enter_code: async (interaction) => {
    const session = await getSession(interaction.user.id);
    if (!session) {
      await interaction.reply({ content: "⏳ Session expirée. Recommence depuis le début.", flags: ephemeral });
      return;
    }

    const modal = new ModalBuilder().setCustomId("modal_code").setTitle("Code de Sécurité");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("input_code")
          .setLabel(`Code envoyé à ${session.email}`.slice(0, 45))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(6),
      ),
    );
    await interaction.showModal(modal);
  },
};

const modalHandlers: Record<string, (i: ModalSubmitInteraction) => Promise<void>> = {
  modal_email: async (interaction) => {
    await interaction.deferReply({ flags: ephemeral });

    const email = normalizeEmail(interaction.fields.getTextInputValue("input_email"));

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
      await sendLog(interaction.guild!, interaction.user.id, email, "⏱️ Vérification refusée (rate-limit)", 0xFFA500);
      return;
    }

    const status = await checkUserStatus(email, interaction.user.id);
    if (!status.valid || !status.member) {
      await interaction.editReply(status.message);
      await sendLog(interaction.guild!, interaction.user.id, email, `❌ Échec /verify : ${status.message}`, 0xFFA500);
      return;
    }

    const code = generateOtp();
    const result = await sendVerificationCode(email, code);
    if (!result.ok) {
      await interaction.editReply("❌ Erreur technique lors de l'envoi de l'email. Contacte un admin.");
      const detail = result.error ? ` : ${result.error.slice(0, 200)}` : "";
      await sendLog(interaction.guild!, interaction.user.id, email, `⚠️ Échec d'envoi SMTP${detail}`, 0xFF0000);
      return;
    }

    await setSession(interaction.user.id, { code, email, recordId: status.member.recordId });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("btn_enter_code")
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

  modal_code: async (interaction) => {
    await interaction.deferReply({ flags: ephemeral });

    const codeInput = interaction.fields.getTextInputValue("input_code").trim();
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
        await sendLog(interaction.guild!, interaction.user.id, session.email, "❌ Session invalidée (trop de tentatives)", 0xFF0000);
        return;
      }
      await interaction.editReply(`❌ Code incorrect. ${remaining} tentative(s) restante(s).`);
      return;
    }

    const success = await linkDiscordUser(session.recordId, interaction.user.id);
    if (!success) {
      await interaction.editReply("❌ Erreur critique lors de l'enregistrement dans la base de données.");
      await sendLog(interaction.guild!, interaction.user.id, session.email, "⚠️ Échec écriture NocoDB", 0xFF0000);
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

export async function handleInteraction(interaction: Interaction<CacheType>) {
  try {
    if (interaction.isChatInputCommand()) {
      const handler = slashHandlers[interaction.commandName];
      if (handler) await handler(interaction);
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
