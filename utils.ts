import { EmbedBuilder, ChannelType, ForumChannel, TextChannel, Guild, Client } from "npm:discord.js@14";
import nodemailer from "npm:nodemailer";
import { CONFIG } from "./config.ts";
import { getAllLinkedUsers } from "./nocodb.ts";

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

/* --- CRON JOB (VERIFICATION AUTO) --- */
export async function runDailyCheck(client: Client) {
  console.log("🔄 [AUTO] Vérification des cotisations...");
  
  const guild = await client.guilds.fetch(CONFIG.GUILD_ID!);
  if (!guild) return;

  const role = await guild.roles.fetch(CONFIG.VERIFY_ROLE_ID!);
  if (!role) return;

  const members = await getAllLinkedUsers();
  let removedCount = 0;

  for (const m of members) {
    try {
      if (!m.discordId) continue;
      
      const dUser = await guild.members.fetch(m.discordId).catch(() => null);
      if (!dUser) continue;

      if (!m.cotisationValide && dUser.roles.cache.has(role.id)) {
        console.log(`📉 [AUTO] Retrait rôle pour ${m.email}`);
        await dUser.roles.remove(role);
        await sendLog(guild, m.discordId, m.email, "❌ Cotisation expirée - Rôle retiré", 0xFF0000);
        removedCount++;
        await new Promise(r => setTimeout(r, 1000)); // Pause anti-spam
      }
    } catch (e) { 
      console.error(`⚠️ Erreur check (${m.email}):`, e); 
    }
  }
  console.log(`✅ [AUTO] Terminé. ${removedCount} rôle(s) retiré(s).`);
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
      from: `"Bot Adhésion" <${CONFIG.SMTP_FROM}>`, // Adresse d'affichage (noreply@...)
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