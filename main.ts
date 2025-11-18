import "jsr:@std/dotenv/load";
import {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
  TextInputBuilder, TextInputStyle, EmbedBuilder, Interaction,
  CacheType, Events, MessageFlags, ChannelType, ForumChannel, TextChannel,
  Guild, PermissionFlagsBits, GuildMember
} from "npm:discord.js@14";

import { 
  checkAndLinkUser, testConnection, getAllLinkedUsers, 
  unlinkUserByEmail, findMemberByColumn 
} from "./nocodb.ts";

/* =========================================
   1. CONFIGURATION & ENVIRONNEMENT
   ========================================= */
const CONFIG = {
  TOKEN:          Deno.env.get("DISCORD_TOKEN"),
  GUILD_ID:       Deno.env.get("GUILD_ID"),
  VERIFY_ROLE_ID: Deno.env.get("VERIFY_ROLE_ID"),
  ADMIN_ROLE_ID:  Deno.env.get("ADMIN_ROLE_ID"),
  LOG_CHANNEL_ID: Deno.env.get("LOG_CHANNEL_ID"),
  COL_EMAIL:      Deno.env.get("COL_EMAIL") ?? "mail"
};

// Vérification de sécurité au démarrage
if (!CONFIG.TOKEN || !CONFIG.GUILD_ID || !CONFIG.VERIFY_ROLE_ID || !CONFIG.ADMIN_ROLE_ID) {
  console.error("❌ Configuration incomplète. Vérifie le fichier .env (ADMIN_ROLE_ID est requis).");
  Deno.exit(1);
}

// Regex pour valider l'email
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* =========================================
   2. INITIALISATION DU CLIENT
   ========================================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // Requis pour gérer les rôles
  ],
});

/* =========================================
   3. FONCTIONS UTILITAIRES (LOGS & CRON)
   ========================================= */

/**
 * Envoie un log dans le salon configuré (Compatible Texte & Forum)
 */
async function sendLog(guild: Guild, discordId: string | null, email: string, status: string, color: number = 0x00FF00) {
  if (!CONFIG.LOG_CHANNEL_ID) return;

  try {
    const channel = await guild.channels.fetch(CONFIG.LOG_CHANNEL_ID);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle("📋 Log Bot Adhésion")
      .setDescription(discordId ? `Concerne : <@${discordId}>` : `Concerne : ${email}`)
      .addFields(
        { name: "Email", value: email, inline: true },
        { name: "Info", value: status, inline: true }
      )
      .setColor(color)
      .setTimestamp();

    if (channel.type === ChannelType.GuildForum) {
      await (channel as ForumChannel).threads.create({ 
        name: `Log: ${email}`, 
        message: { embeds: [embed] } 
      });
    } else if (channel.isTextBased()) {
      await (channel as TextChannel).send({ embeds: [embed] });
    }
  } catch (e) { 
    console.error("❌ Erreur lors de l'envoi du log:", e); 
  }
}

/**
 * Tâche planifiée : Vérifie tous les jours si les cotisations sont toujours valides
 */
async function runDailyCheck() {
  console.log("🔄 [AUTO] Lancement de la vérification des cotisations...");
  
  const guild = await client.guilds.fetch(CONFIG.GUILD_ID!);
  if (!guild) return;

  const role = await guild.roles.fetch(CONFIG.VERIFY_ROLE_ID!);
  if (!role) return;

  const members = await getAllLinkedUsers();
  let removedCount = 0;

  for (const m of members) {
    try {
      if (!m.discordId) continue;
      
      // On essaie de trouver le membre (catch s'il a quitté le serveur)
      const dUser = await guild.members.fetch(m.discordId).catch(() => null);
      if (!dUser) continue;

      // Si Cotisation Invalide (0) ET il possède le rôle -> On retire
      if (!m.cotisationValide && dUser.roles.cache.has(role.id)) {
        console.log(`📉 [AUTO] Retrait du rôle pour ${m.email}`);
        await dUser.roles.remove(role);
        await sendLog(guild, m.discordId, m.email, "❌ Cotisation expirée - Rôle retiré", 0xFF0000);
        removedCount++;
        
        // Petite pause pour éviter de spammer l'API Discord
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (e) { 
      console.error(`⚠️ Erreur check auto (${m.email}):`, e); 
    }
  }
  console.log(`✅ [AUTO] Terminé. ${removedCount} rôle(s) retiré(s).`);
}

/* =========================================
   4. DÉFINITION DES COMMANDES SLASH
   ========================================= */
const commands = [
  // Commandes Publiques
  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Lancer la procédure de vérification d'adhésion"),
  
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Vérifier si le bot répond"),
  
  // Commandes Admins
  new SlashCommandBuilder()
    .setName("admin-unlink")
    .setDescription("👑 Admin: Délier un email d'un compte Discord")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt => 
      opt.setName("email").setDescription("L'email à libérer").setRequired(true)
    ),
    
  new SlashCommandBuilder()
    .setName("admin-check")
    .setDescription("👑 Admin: Vérifier le statut d'un email")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt => 
      opt.setName("email").setDescription("L'email à vérifier").setRequired(true)
    )
].map(c => c.toJSON());

/* =========================================
   5. ÉVÉNEMENTS DU CLIENT
   ========================================= */

client.once(Events.ClientReady, async () => {
  console.log(`✅ Connecté en tant que : ${client.user?.tag}`);
  
  // Enregistrement des commandes
  const rest = new REST({ version: "10" }).setToken(CONFIG.TOKEN!);
  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user!.id, CONFIG.GUILD_ID!), 
      { body: commands }
    );
    console.log("✅ Commandes Slash enregistrées.");
  } catch (e) {
    console.error("❌ Erreur enregistrement commandes:", e);
  }

  // Test de la DB
  const dbStatus = await testConnection();
  console.log(dbStatus ? "✅ Connexion NocoDB OK" : "❌ Échec connexion NocoDB");
  
  // Lancement Cron Job (Immédiat + Intervalle 24h)
  runDailyCheck();
  setInterval(runDailyCheck, 1000 * 60 * 60 * 24);
});

client.on(Events.InteractionCreate, async (interaction: Interaction<CacheType>) => {
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
        const embed = new EmbedBuilder()
          .setTitle("🔐 Vérification d'adhésion")
          .setDescription("Accède aux salons privés en liant ton adhésion !")
          .setColor(0x5865F2)
          .addFields({ name: "RGPD", value: "Ton email sert uniquement à la vérification NocoDB et ne sera pas partagé." })
          .setFooter({ text: "Automatisé par DSAuthentificator" });

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("btn_verify_start")
            .setLabel("Lier mon compte 🚀")
            .setStyle(ButtonStyle.Primary)
        );
        await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
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

      // 1. Création de l'input (méthode moderne via constructeur)
      const emailInput = new TextInputBuilder({
        customId: "input_email",
        label: "Ton adresse email",
        placeholder: "ex: jean.dupont@mail.com",
        style: TextInputStyle.Short,
        required: true,
      });

      // 2. Création de la ligne (Row)
      const row = new ActionRowBuilder<TextInputBuilder>({
        components: [emailInput]
      });

      // 3. Création du Modal
      const modal = new ModalBuilder({
        customId: "modal_verify_submit",
        title: "Liaison Compte",
        components: [row]
      });

      // 4. Affichage
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

      // Appel logique NocoDB
      const result = await checkAndLinkUser(email, interaction.user.id);
      
      if (!result.success) { 
        await interaction.editReply(`😕 ${result.message}`); 
        return; 
      }

      // Gestion du rôle
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
          // Log Succès
          await sendLog(guild, interaction.user.id, email, "✅ Succès (Utilisateur vérifié)");
        } else {
          await interaction.editReply("✅ Liaison réussie en base, mais **rôle introuvable** sur le serveur Discord.");
        }
      }
    }
  } catch (e) { 
    console.error("❌ Erreur Interaction:", e);
    // Tentative de réponse d'erreur générique si possible
    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply({ content: "Une erreur interne est survenue.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

// Lancement final
client.login(CONFIG.TOKEN);