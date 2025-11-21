// deno-lint-ignore-file no-import-prefix
import { 
  Interaction, CacheType, MessageFlags, EmbedBuilder, 
  ActionRowBuilder, ButtonBuilder, ButtonStyle, TextInputBuilder, 
  TextInputStyle, ModalBuilder, GuildMember, AttachmentBuilder 
} from "npm:discord.js@14";

import { CONFIG, EMAIL_REGEX } from "./config.ts";
import { sendLog, sendVerificationCode } from "./utils.ts";
import { checkUserStatus, linkDiscordUser, unlinkUserByEmail, findMemberByColumn } from "./nocodb.ts";

/**
 * Stockage temporaire des sessions de vérification en mémoire.
 * Clé : ID Discord de l'utilisateur
 * Valeur : Code généré, Email saisi, ID de l'enregistrement dans la BDD
 * * Note : En production à grande échelle, préférer une solution persistante comme Redis.
 */
const pendingVerifications = new Map<string, { code: string; email: string; recordId: number }>();

/**
 * Point d'entrée principal pour gérer toutes les interactions Discord
 * (Slash Commands, Boutons, Modals).
 * * @param interaction L'objet d'interaction reçu de l'API Discord
 */
export async function handleInteraction(interaction: Interaction<CacheType>) {
  try {
    
    // -------------------------------------------------------------------------
    // 1. GESTION DES COMMANDES SLASH (/verify, /admin-...)
    // -------------------------------------------------------------------------
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      // Commande publique : Lancer la procédure de vérification
      if (commandName === "verify") {
        const logo = new AttachmentBuilder("assets/logo.png");
        
        // Création de l'embed d'accueil
        const embed = new EmbedBuilder()
          .setTitle("✨ Bienvenue ! Finalisons ton inscription")
          .setDescription("Nous allons vérifier ton adhésion.\nClique ci-dessous pour démarrer.")
          .setColor(0x5865F2)
          .setThumbnail("attachment://logo.png")
          .setFooter({ text: "Sécurisé par SMTP" });

        // Bouton pour déclencher la modale
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("btn_verify_start")
            .setLabel("Lier mon compte")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("📧")
        );

        await interaction.reply({ embeds: [embed], components: [row], files: [logo], flags: MessageFlags.Ephemeral });
      }

      // --- Commandes Administrateur ---
      
      // Admin : Forcer la déliaison d'un email
      if (commandName === "admin-unlink") {
        // Vérification des permissions (Rôle Admin requis)
        if (!(interaction.member as GuildMember).roles.cache.has(CONFIG.ADMIN_ROLE_ID!)) return;
        
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const res = await unlinkUserByEmail(interaction.options.getString("email", true));
        await interaction.editReply(res.message);
      }
      
      // Admin : Vérifier le statut d'un email dans la BDD
      if (commandName === "admin-check") {
        if (!(interaction.member as GuildMember).roles.cache.has(CONFIG.ADMIN_ROLE_ID!)) return;
        
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const data = await findMemberByColumn(CONFIG.COL_EMAIL, interaction.options.getString("email", true));
        
        // Affichage compact des infos de débogage
        await interaction.editReply(data 
          ? `✅ Trouvé: ID ${data.recordId} | Cotis: ${data.cotisationValide} | Discord: ${data.discordId}` 
          : "❌ Inconnu"
        );
      }
    }

    // -------------------------------------------------------------------------
    // 2. INTERACTION : DÉMARRAGE DE LA VÉRIFICATION (Bouton)
    // -------------------------------------------------------------------------
    if (interaction.isButton() && interaction.customId === "btn_verify_start") {
      // Affichage de la modale pour saisir l'email
      const modal = new ModalBuilder().setCustomId("modal_email").setTitle("Identification");
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("input_email")
          .setLabel("Ton Email Adhérent")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ));

      await interaction.showModal(modal);
    }

    // -------------------------------------------------------------------------
    // 3. INTERACTION : SOUMISSION DE L'EMAIL (Modal 1)
    // -------------------------------------------------------------------------
    if (interaction.isModalSubmit() && interaction.customId === "modal_email") {
      // On diffère la réponse car l'appel BDD + SMTP peut prendre > 3 secondes
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      
      // Récupération et nettoyage de l'email
      const email = interaction.fields.getTextInputValue("input_email").trim();

      // Validation syntaxique basique (Regex)
      if (!EMAIL_REGEX.test(email)) {
        await interaction.editReply("❌ Format d'email invalide.");
        return;
      }

      // A. Vérification métier : L'utilisateur existe-t-il ? A-t-il payé ? Est-il déjà lié ?
      const status = await checkUserStatus(email, interaction.user.id);
      
      // Si le statut est invalide (non trouvé, cotisation impayée, déjà lié...), on arrête.
      if (!status.valid || !status.member) {
        await interaction.editReply(status.message);
        return;
      }

      // B. Génération du code OTP (One Time Password)
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      
      // C. Envoi de l'email via SMTP
      const sent = await sendVerificationCode(email, code);
      
      if (!sent) {
        await interaction.editReply("❌ Erreur technique lors de l'envoi de l'email. Contacte un admin.");
        return;
      }

      // D. Stockage en mémoire de la session de vérification
      // On map l'ID Discord -> { Code attendu, Email, ID BDD }
      pendingVerifications.set(interaction.user.id, { code, email, recordId: status.member.recordId });

      // E. Invite utilisateur à saisir le code
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("btn_enter_code")
          .setLabel("J'ai reçu mon code")
          .setStyle(ButtonStyle.Success)
          .setEmoji("🔓")
      );
      
      await interaction.editReply({ 
        content: `✅ **Vérification initiale réussie !**\nUn code de sécurité vient d'être envoyé à \`${email}\`.\nRegarde tes spams, puis clique ci-dessous.`, 
        components: [row] 
      });
    }

    // -------------------------------------------------------------------------
    // 4. INTERACTION : SAISIE DU CODE (Bouton)
    // -------------------------------------------------------------------------
    if (interaction.isButton() && interaction.customId === "btn_enter_code") {
      // Sécurité : Vérifier si une session est en cours pour cet utilisateur
      if (!pendingVerifications.has(interaction.user.id)) {
        await interaction.reply({ content: "⏳ Session expirée. Recommence depuis le début.", flags: MessageFlags.Ephemeral });
        return;
      }

      // Affichage de la modale pour le code
      const modal = new ModalBuilder().setCustomId("modal_code").setTitle("Code de Sécurité");
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("input_code")
          .setLabel("Code à 6 chiffres")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(6)
      ));

      await interaction.showModal(modal);
    }

    // -------------------------------------------------------------------------
    // 5. INTERACTION : VALIDATION FINALE (Modal 2)
    // -------------------------------------------------------------------------
    if (interaction.isModalSubmit() && interaction.customId === "modal_code") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      
      const codeInput = interaction.fields.getTextInputValue("input_code").trim();
      const session = pendingVerifications.get(interaction.user.id);

      // Vérification de la validité du code OTP
      if (!session || session.code !== codeInput) {
        await interaction.editReply("❌ Code incorrect ou session expirée. Recommence.");
        return;
      }

      // --- SUCCÈS ---
      
      // 1. Écriture définitive en base de données (Liaison ID Discord <-> Enregistrement)
      const success = await linkDiscordUser(session.recordId, interaction.user.id);
      
      if (success) {
        // 2. Attribution du rôle Discord "Vérifié"
        const role = interaction.guild?.roles.cache.get(CONFIG.VERIFY_ROLE_ID!);
        if (role) await (interaction.member as GuildMember).roles.add(role);
        
        // 3. Logging dans le channel admin
        await sendLog(interaction.guild!, interaction.user.id, session.email, "✅ Succès (Vérifié par Code)");
        
        // 4. Feedback utilisateur
        await interaction.editReply(`🎉 **Félicitations !** Ton compte est maintenant lié à \`${session.email}\`.`);
        
        // 5. Nettoyage de la mémoire (suppression de la session)
        pendingVerifications.delete(interaction.user.id);
      } else {
        await interaction.editReply("❌ Erreur critique lors de l'enregistrement dans la base de données.");
      }
    }

  } catch (e) {
    console.error("Global Interaction Error:", e);
  }
}