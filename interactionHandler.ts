import { 
  Interaction, CacheType, MessageFlags, EmbedBuilder, 
  ActionRowBuilder, ButtonBuilder, ButtonStyle, TextInputBuilder, 
  TextInputStyle, ModalBuilder, GuildMember, AttachmentBuilder, Client 
} from "npm:discord.js@14";

import { CONFIG, EMAIL_REGEX } from "./config.ts";
import { sendLog, sendVerificationCode } from "./utils.ts";
import { checkUserStatus, linkDiscordUser, unlinkUserByEmail, findMemberByColumn } from "./nocodb.ts";

// Stockage temporaire : Map<DiscordID, {code, email, recordId}>
const pendingVerifications = new Map<string, { code: string; email: string; recordId: number }>();

export async function handleInteraction(interaction: Interaction<CacheType>, client: Client) {
  try {
    /* --- COMMANDES SLASH --- */
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === "verify") {
        const logo = new AttachmentBuilder("assets/logo.png");
        const embed = new EmbedBuilder()
          .setTitle("✨ Bienvenue ! Finalisons ton inscription")
          .setDescription("Nous allons vérifier ton adhésion.\nClique ci-dessous pour démarrer.")
          .setColor(0x5865F2)
          .setThumbnail("attachment://logo.png")
          .setFooter({ text: "Sécurisé par SMTP" });

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("btn_verify_start").setLabel("Lier mon compte").setStyle(ButtonStyle.Primary).setEmoji("📧")
        );

        await interaction.reply({ embeds: [embed], components: [row], files: [logo], flags: MessageFlags.Ephemeral });
      }

      // Commandes Admin
      if (commandName === "admin-unlink") {
        if (!(interaction.member as GuildMember).roles.cache.has(CONFIG.ADMIN_ROLE_ID!)) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const res = await unlinkUserByEmail(interaction.options.getString("email", true));
        await interaction.editReply(res.message);
      }
      
      if (commandName === "admin-check") {
        if (!(interaction.member as GuildMember).roles.cache.has(CONFIG.ADMIN_ROLE_ID!)) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const data = await findMemberByColumn(CONFIG.COL_EMAIL, interaction.options.getString("email", true));
        await interaction.editReply(data ? `✅ Trouvé: ID ${data.recordId} | Cotis: ${data.cotisationValide} | Discord: ${data.discordId}` : "❌ Inconnu");
      }
    }

    /* --- BOUTON 1 : OUVRIR LE FORMULAIRE EMAIL --- */
    if (interaction.isButton() && interaction.customId === "btn_verify_start") {
      const modal = new ModalBuilder().setCustomId("modal_email").setTitle("Identification");
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("input_email").setLabel("Ton Email Adhérent").setStyle(TextInputStyle.Short).setRequired(true)
      ));

      await interaction.showModal(modal);
    }

    /* --- MODAL 1 RECU : VÉRIF STRICTE -> ENVOI MAIL --- */
    if (interaction.isModalSubmit() && interaction.customId === "modal_email") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      
      // On nettoie l'entrée utilisateur
      const email = interaction.fields.getTextInputValue("input_email").trim();

      if (!EMAIL_REGEX.test(email)) {
        await interaction.editReply("❌ Format d'email invalide.");
        return;
      }

      // 1. VÉRIFICATIONS STRICTES (Comme avant)
      const status = await checkUserStatus(email, interaction.user.id);
      
      // Si une erreur ou si déjà lié -> On arrête et on affiche le message
      if (!status.valid || !status.member) {
        await interaction.editReply(status.message);
        return;
      }

      // 2. TOUT EST BON -> GÉNÉRATION DU CODE
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      
      // 3. ENVOI SMTP
      const sent = await sendVerificationCode(email, code);
      
      if (!sent) {
        await interaction.editReply("❌ Erreur technique lors de l'envoi de l'email. Contacte un admin.");
        return;
      }

      // 4. STOCKAGE TEMPORAIRE
      pendingVerifications.set(interaction.user.id, { code, email, recordId: status.member.recordId });

      // 5. INVITE A ENTRER LE CODE
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("btn_enter_code").setLabel("J'ai reçu mon code").setStyle(ButtonStyle.Success).setEmoji("🔓")
      );
      
      await interaction.editReply({ 
        content: `✅ **Vérification initiale réussie !**\nUn code de sécurité vient d'être envoyé à \`${email}\`.\nRegarde tes spams, puis clique ci-dessous.`, 
        components: [row] 
      });
    }

    /* --- BOUTON 2 : OUVRIR LE FORMULAIRE CODE --- */
    if (interaction.isButton() && interaction.customId === "btn_enter_code") {
      if (!pendingVerifications.has(interaction.user.id)) {
        await interaction.reply({ content: "⏳ Session expirée. Recommence depuis le début.", flags: MessageFlags.Ephemeral });
        return;
      }
      const modal = new ModalBuilder().setCustomId("modal_code").setTitle("Code de Sécurité");
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("input_code").setLabel("Code à 6 chiffres").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6)
      ));

      await interaction.showModal(modal);
    }

    /* --- MODAL 2 RECU : VÉRIF CODE -> LIAISON FINALE --- */
    if (interaction.isModalSubmit() && interaction.customId === "modal_code") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      
      const codeInput = interaction.fields.getTextInputValue("input_code").trim();
      const session = pendingVerifications.get(interaction.user.id);

      // Vérif Code
      if (!session || session.code !== codeInput) {
        await interaction.editReply("❌ Code incorrect ou session expirée. Recommence.");
        return;
      }

      // ECRITURE EN BASE (Seulement maintenant)
      const success = await linkDiscordUser(session.recordId, interaction.user.id);
      
      if (success) {
        // Ajout du Rôle
        const role = interaction.guild?.roles.cache.get(CONFIG.VERIFY_ROLE_ID!);
        if (role) await (interaction.member as GuildMember).roles.add(role);
        
        // Log et Réponse
        await sendLog(interaction.guild!, interaction.user.id, session.email, "✅ Succès (Vérifié par Code)");
        await interaction.editReply(`🎉 **Félicitations !** Ton compte est maintenant lié à \`${session.email}\`.`);
        
        // Nettoyage
        pendingVerifications.delete(interaction.user.id);
      } else {
        await interaction.editReply("❌ Erreur critique lors de l'enregistrement dans la base de données.");
      }
    }

  } catch (e) {
    console.error("Global Interaction Error:", e);
  }
}