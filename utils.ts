// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { ChannelType, Client, EmbedBuilder, ForumChannel, Guild, GuildMember, TextChannel } from "npm:discord.js@14";
import nodemailer from "npm:nodemailer";
import { CONFIG } from "./config.ts";
import { sleep } from "./helpers.ts";
import { findMemberByColumn, getAllLinkedUsers } from "./nocodb.ts";
import { clearPending, getPending, setPending } from "./pendingRemovals.ts";

/* --- LOGS DISCORD --- */
export async function sendLog(guild: Guild, discordId: string | null, email: string, status: string, color: number = 0x00FF00) {
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
    console.error("❌ Erreur log:", e); 
  }
}

/* --- RE-ATTRIBUTION AUTO À L'ARRIVÉE D'UN MEMBRE --- */
/**
 * Si l'utilisateur a déjà un dossier valide en base, on lui rend le rôle
 * directement (et on annule un éventuel retrait en attente).
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

/* --- CRON JOB (VERIFICATION AUTO) --- */
export async function runDailyCheck(client: Client) {
  console.log("🔄 [AUTO] Vérification des cotisations...");

  const guild = await client.guilds.fetch(CONFIG.GUILD_ID!);
  if (!guild) return;

  const role = await guild.roles.fetch(CONFIG.VERIFY_ROLE_ID!);
  if (!role) return;

  const members = await getAllLinkedUsers();
  const delayMs = CONFIG.DELAY_INVALID_COTISATION * 1000;
  const now = Date.now();
  let removedCount = 0;
  let pendingCount = 0;

  for (const m of members) {
    try {
      if (!m.discordId) continue;

      const dUser = await guild.members.fetch(m.discordId).catch(() => null);
      if (!dUser) {
        await clearPending(m.discordId);
        continue;
      }

      const hasRole = dUser.roles.cache.has(role.id);

      if (m.cotisationValide || !hasRole) {
        // Cotisation à jour (ou rôle déjà absent) -> on annule tout retrait en attente
        await clearPending(m.discordId);
        continue;
      }

      // Cotisation invalide ET le membre a encore le rôle
      const pending = await getPending(m.discordId);

      if (!pending) {
        // Première détection : on enregistre l'horodatage et on attend
        await setPending(m.discordId, { firstDetectedAt: now, email: m.email, reminded: false });
        pendingCount++;
        const removalDate = new Date(now + delayMs);
        console.log(`⏳ [AUTO] Cotisation invalide détectée pour ${m.email} - retrait prévu le ${removalDate.toISOString()}`);
        await sendLog(
          guild,
          m.discordId,
          m.email,
          `⏳ Cotisation invalide - retrait du rôle prévu le ${removalDate.toLocaleDateString("fr-FR")}`,
          0xFFA500
        );
        continue;
      }

      const elapsed = now - pending.firstDetectedAt;

      if (elapsed >= delayMs) {
        console.log(`📉 [AUTO] Retrait rôle pour ${m.email} (délai écoulé)`);
        await dUser.roles.remove(role);
        await sendLog(guild, m.discordId, m.email, "❌ Cotisation expirée - Rôle retiré", 0xFF0000);
        await clearPending(m.discordId);
        removedCount++;
        await sleep(1000); // Anti-spam API Discord
      } else if (CONFIG.RAPPEL_DESACTIVATION && !pending.reminded) {
        const removalDate = new Date(pending.firstDetectedAt + delayMs);
        let dmOk = false;
        try {
          await dUser.send(
            `👋 Bonjour, ta cotisation à l'association n'apparaît pas comme à jour.\n` +
            `Sans régularisation, ton rôle sera retiré le **${removalDate.toLocaleDateString("fr-FR")}**.\n` +
            `Si c'est une erreur, contacte un administrateur.`,
          );
          dmOk = true;
          await sendLog(guild, m.discordId, m.email, "📨 Rappel DM envoyé (cotisation invalide)", 0xFFFF00);
        } catch (e) {
          console.error(`⚠️ Impossible d'envoyer le DM à ${m.email}:`, e);
          await sendLog(guild, m.discordId, m.email, "⚠️ Rappel DM impossible (DMs fermés)", 0xFFA500);
        }
        // On ne marque "reminded" que si le DM a réussi, pour autoriser un nouvel essai au prochain cycle
        if (dmOk) await setPending(m.discordId, { ...pending, reminded: true });
      }
    } catch (e) {
      console.error(`⚠️ Erreur check (${m.email}):`, e);
    }
  }
  console.log(`✅ [AUTO] Terminé. ${removedCount} rôle(s) retiré(s), ${pendingCount} en attente.`);
}

/* --- SMTP (EMAILS) --- */
const transporter = nodemailer.createTransport({
  host: CONFIG.SMTP_HOST,
  port: CONFIG.SMTP_PORT,
  secure: false, // false pour le port 587
  auth: { 
    user: CONFIG.SMTP_USER, // Identifiant technique Brevo
    pass: CONFIG.SMTP_PASS  // Mot de passe Brevo
  },
});

export async function sendVerificationCode(email: string, code: string): Promise<boolean> {
  try {
    await transporter.sendMail({
      from: `"Bot Adhésion" <${CONFIG.SMTP_FROM}>`, 
      to: email,
      subject: "🔐 Ton code de vérification Discord",
      text: `Voici ton code : ${code}. Valable 10 minutes.`,
      html: `<div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
               <h2>Vérification Adhésion</h2>
               <p>Voici ton code de sécurité pour lier ton compte Discord :</p>
               <h1 style="color: #5865F2; letter-spacing: 5px;">${code}</h1>
               <p>Ce code expire dans 10 minutes.</p>
               <p style="font-size: 12px; color: #888;">Si tu n'as pas demandé ce code, ignore cet email.</p>
             </div>`,
    });
    console.log(`📧 Email envoyé à ${email} via ${CONFIG.SMTP_HOST}`);
    return true;
  } catch (e) {
    console.error("❌ Erreur envoi email:", e);
    return false;
  }
}