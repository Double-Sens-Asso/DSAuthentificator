import { 
  Interaction, CacheType, MessageFlags, EmbedBuilder, 
  ActionRowBuilder, ButtonBuilder, ButtonStyle, TextInputBuilder, 
  TextInputStyle, ModalBuilder, GuildMember, AttachmentBuilder, Client 
} from "npm:discord.js@14";

import { CONFIG, EMAIL_REGEX } from "./config.ts";
import { sendLog } from "./utils.ts";
import { checkAndLinkUser, unlinkUserByEmail, findMemberByColumn } from "./nocodb.ts";

export async function handleInteraction(interaction: Interaction<CacheType>, client: Client) {
  try {
    /* --- GESTION DES COMMANDES SLASH (/...) --- */
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      // > /ping
      if (commandName === "ping") {
        await interaction.reply({ content: "🏓 Pong!", flags: MessageFlags.Ephemeral });
      }

      // > /verify
      if (commandName === "verify") {
        const logoFile = new AttachmentBuilder("assets/logo.png");
        
        const embed = new EmbedBuilder()
          .setTitle("✨ Bienvenue ! Finalisons ton inscription")
          .setDescription(
            "Tu es à une étape de rejoindre la communauté !\n" +
            "Pour accéder aux **salons privés** et profiter de tes avantages, nous devons simplement lier ton compte Discord à ton dossier adhérent."
          )
          .setColor(0x5865F2)
          .setThumbnail("attachment://logo.png")
          .addFields(
            { 
              name: "🚀 Comment faire ?", 
              value: "Clique sur le bouton **« Lier mon compte »** ci-dessous et entre l'adresse email que tu as utilisée lors de ton adhésion.",
              inline: false 
            },
            { 
              name: "🔒 Données & Confidentialité (RGPD)", 
              value: "Rassure-toi : ton email est **sécurisé**. Il sert uniquement à interroger notre base pour valider ta cotisation.",
              inline: false 
            }
          )
          .setFooter({ text: "Système sécurisé par DSAuthentificator", iconURL: client.user?.displayAvatarURL() });

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("btn_verify_start")
            .setLabel("Lier mon compte maintenant")
            .setEmoji("🔗")
            .setStyle(ButtonStyle.Primary)
        );

        await interaction.reply({ 
          embeds: [embed], 
          components: [row], 
          files: [logoFile], 
          flags: MessageFlags.Ephemeral 
        });
      }

      // > /admin-unlink
      if (commandName === "admin-unlink") {
        const member = interaction.member as GuildMember;
        if (!member.roles.cache.has(CONFIG.ADMIN_ROLE_ID!)) {
          await interaction.reply({ content: "⛔ Permission refusée.", flags: MessageFlags.Ephemeral });
          return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const email = interaction.options.getString("email", true).trim();
        const result = await unlinkUserByEmail(email);
        
        if (result.success) {
          await interaction.editReply(`✅ **Succès :** ${result.message}`);
          if (interaction.guild) await sendLog(interaction.guild, null, email, "🔧 ADMIN : Liaison supprimée", 0xFFA500);
        } else {
          await interaction.editReply(`❌ **Erreur :** ${result.message}`);
        }
      }

      // > /admin-check
      if (commandName === "admin-check") {
        const member = interaction.member as GuildMember;
        if (!member.roles.cache.has(CONFIG.ADMIN_ROLE_ID!)) {
          await interaction.reply({ content: "⛔ Permission refusée.", flags: MessageFlags.Ephemeral });
          return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const email = interaction.options.getString("email", true).trim();
        const data = await findMemberByColumn(CONFIG.COL_EMAIL, email);

        if (!data) {
          await interaction.editReply(`❌ Aucun dossier trouvé pour \`${email}\``);
        } else {
          const embed = new EmbedBuilder()
            .setTitle(`🔍 Info Adhérent`)
            .setColor(data.cotisationValide ? 0x00FF00 : 0xFF0000)
            .addFields(
              { name: "Email", value: data.email, inline: true },
              { name: "Cotisation", value: data.cotisationValide ? "✅ Valide" : "❌ Expirée", inline: true },
              { name: "ID NocoDB", value: String(data.recordId), inline: true },
              { name: "Compte Discord", value: data.discordId ? `<@${data.discordId}>` : "Non lié", inline: false },
            );
          await interaction.editReply({ embeds: [embed] });
        }
      }
    }

    /* --- GESTION DU BOUTON "Lier mon compte" --- */
    if (interaction.isButton() && interaction.customId === "btn_verify_start") {
      const emailInput = new TextInputBuilder()
        .setCustomId("input_email")
        .setLabel("Ton adresse email")
        .setPlaceholder("ex: jean.dupont@mail.com")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const row = new ActionRowBuilder<TextInputBuilder>().addComponents(emailInput);

      const modal = new ModalBuilder()
        .setCustomId("modal_verify_submit")
        .setTitle("Liaison Compte")
        .addComponents(row);

      await interaction.showModal(modal);
    }
    
    /* --- GESTION DE LA SOUMISSION DU MODAL --- */
    if (interaction.isModalSubmit() && interaction.customId === "modal_verify_submit") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      
      const email = interaction.fields.getTextInputValue("input_email");
      
      if (!EMAIL_REGEX.test(email)) { 
        await interaction.editReply("❌ Le format de l'email est invalide."); 
        return; 
      }

      const result = await checkAndLinkUser(email, interaction.user.id);
      
      if (!result.success) { 
        await interaction.editReply(`😕 ${result.message}`); 
        return; 
      }

      const guild = interaction.guild;
      if (guild) {
        const role = guild.roles.cache.get(CONFIG.VERIFY_ROLE_ID!);
        const member = await guild.members.fetch(interaction.user.id);
        
        if (role) {
          if (!member.roles.cache.has(role.id)) {
            await member.roles.add(role);
            await interaction.editReply(`🎉 Compte lié à \`${email}\` ! Le rôle **${role.name}** t'a été ajouté.`);
          } else {
            await interaction.editReply(`✅ Compte lié à \`${email}\` (Tu possédais déjà le rôle).`);
          }
          await sendLog(guild, interaction.user.id, email, "✅ Succès (Utilisateur vérifié)");
        } else {
          await interaction.editReply("✅ Liaison réussie, mais **rôle introuvable** sur le serveur.");
        }
      }
    }
  } catch (e) { 
    console.error("❌ Erreur Interaction:", e);
    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply({ content: "Une erreur interne est survenue.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}