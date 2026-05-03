// deno-lint-ignore-file no-import-prefix no-unversioned-import
import {
  ChannelType,
  Client,
  DiscordAPIError,
  EmbedBuilder,
  ForumChannel,
  Guild,
  GuildMember,
  RESTJSONErrorCodes,
  TextChannel,
} from "npm:discord.js@14";
import nodemailer from "npm:nodemailer";
import { CONFIG } from "./config.ts";
import { sleep } from "./helpers.ts";
import { findMemberByColumn, getAllLinkedUsers } from "./nocodb.ts";
import { clearPending, getPending, setPending } from "./pendingRemovals.ts";

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
        { name: "Info", value: status, inline: true },
      )
      .setColor(color)
      .setTimestamp();

    if (channel.type === ChannelType.GuildForum) {
      await (channel as ForumChannel).threads.create({
        name: `Log: ${email}`,
        message: { embeds: [embed] },
      });
    } else if (channel.isTextBased()) {
      await (channel as TextChannel).send({ embeds: [embed] });
    }
  } catch (e) {
    console.error("❌ Erreur log:", e);
  }
}

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

export async function runDailyCheck(client: Client) {
  console.log("🔄 [AUTO] Vérification des cotisations...");

  const guild = await client.guilds.fetch(CONFIG.GUILD_ID!);
  if (!guild) return;

  const role = await guild.roles.fetch(CONFIG.VERIFY_ROLE_ID!);
  if (!role) return;

  // Hydrate le cache (nécessaire pour role.members plus bas)
  await guild.members.fetch().catch((e) => {
    console.error("⚠️ guild.members.fetch a échoué :", e);
  });

  let members;
  try {
    members = await getAllLinkedUsers();
  } catch (e) {
    console.error("⚠️ Échec lecture NocoDB :", e);
    await sendLog(guild, null, "(système)", `⚠️ NocoDB inaccessible : ${e instanceof Error ? e.message : e}`, 0xFF0000);
    return;
  }

  const delayMs = CONFIG.DELAY_INVALID_COTISATION * 1000;
  const intervalMs = CONFIG.CHECK_INTERVAL_SECONDS * 1000;
  const now = Date.now();
  const linkedIds = new Set<string>();
  let removedCount = 0;
  let pendingCount = 0;
  let restoredCount = 0;

  for (const m of members) {
    if (!m.discordId) continue;
    linkedIds.add(m.discordId);

    try {
      let dUser: GuildMember;
      try {
        dUser = await guild.members.fetch(m.discordId);
      } catch (err) {
        if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMember) {
          await clearPending(m.discordId);
        } else {
          console.error(`⚠️ fetch member ${m.email} (transitoire) :`, err);
        }
        continue;
      }

      const hasRole = dUser.roles.cache.has(role.id);

      if (m.cotisationValide) {
        if (!hasRole) {
          await dUser.roles.add(role);
          await sendLog(guild, m.discordId, m.email, "✅ Cotisation à jour - Rôle ré-attribué", 0x00FF00);
          restoredCount++;
          await sleep(1000);
        }
        await clearPending(m.discordId);
        continue;
      }

      if (!hasRole) {
        await clearPending(m.discordId);
        continue;
      }

      const pending = await getPending(m.discordId);

      if (!pending) {
        await setPending(m.discordId, { firstDetectedAt: now, email: m.email, reminded: false });
        pendingCount++;
        const removalDate = new Date(now + delayMs);
        await sendLog(
          guild,
          m.discordId,
          m.email,
          `⏳ Cotisation invalide - retrait du rôle prévu le ${removalDate.toLocaleDateString("fr-FR")}`,
          0xFFA500,
        );
        continue;
      }

      const elapsed = now - pending.firstDetectedAt;
      const remaining = delayMs - elapsed;

      if (elapsed >= delayMs) {
        await dUser.roles.remove(role);
        await sendLog(guild, m.discordId, m.email, "❌ Cotisation expirée - Rôle retiré", 0xFF0000);
        await clearPending(m.discordId);
        removedCount++;
        await sleep(1000);
        continue;
      }

      // Rappel DM "juste avant" le retrait : dans la dernière fenêtre cron avant l'échéance.
      if (CONFIG.RAPPEL_DESACTIVATION && !pending.reminded && remaining <= intervalMs * 1.5) {
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
          console.error(`⚠️ DM impossible (${m.email}) :`, e);
          await sendLog(guild, m.discordId, m.email, "⚠️ Rappel DM impossible (DMs fermés)", 0xFFA500);
        }
        if (dmOk) await setPending(m.discordId, { ...pending, reminded: true });
      }
    } catch (e) {
      console.error(`⚠️ Erreur check (${m.email}) :`, e);
    }
  }

  // Retrait des rôles "orphelins" : membres ayant le rôle mais sans liaison NocoDB
  // (typiquement après /admin-unlink, ou un rôle attribué manuellement à un non-adhérent).
  let orphanCount = 0;
  for (const [, member] of role.members) {
    if (linkedIds.has(member.id)) continue;
    try {
      await member.roles.remove(role);
      await sendLog(guild, member.id, "(non lié)", "❌ Rôle retiré (aucune liaison en base)", 0xFF0000);
      orphanCount++;
      await sleep(1000);
    } catch (e) {
      console.error(`⚠️ Retrait orphelin ${member.id} :`, e);
    }
  }

  console.log(
    `✅ [AUTO] Terminé. ${restoredCount} ré-attribué(s), ${pendingCount} en attente, ${removedCount} retiré(s), ${orphanCount} orphelin(s).`,
  );
}

const transporter = nodemailer.createTransport({
  host: CONFIG.SMTP_HOST,
  port: CONFIG.SMTP_PORT,
  secure: false,
  auth: {
    user: CONFIG.SMTP_USER,
    pass: CONFIG.SMTP_PASS,
  },
});

const EMAIL_TEMPLATE_PATH = new URL("./assets/verification-email.html", import.meta.url).pathname;
const EMAIL_TEMPLATE = await Deno.readTextFile(EMAIL_TEMPLATE_PATH).catch((e) => {
  console.error(`⚠️ Impossible de charger ${EMAIL_TEMPLATE_PATH} :`, e);
  return "Code: {{code}} (valable {{ttl_minutes}} min)";
});

function renderEmail(code: string, ttlMinutes: number): string {
  return EMAIL_TEMPLATE.replaceAll("{{code}}", code).replaceAll("{{ttl_minutes}}", String(ttlMinutes));
}

export async function sendVerificationCode(email: string, code: string): Promise<boolean> {
  const ttlMinutes = Math.round(CONFIG.OTP_TTL_SECONDS / 60);
  try {
    await transporter.sendMail({
      from: `"Bot Adhésion" <${CONFIG.SMTP_FROM}>`,
      to: email,
      subject: "🔐 Ton code de vérification Discord",
      text: `Voici ton code : ${code}. Valable ${ttlMinutes} minutes.`,
      html: renderEmail(code, ttlMinutes),
    });
    console.log(`📧 Email envoyé à ${email}`);
    return true;
  } catch (e) {
    console.error("❌ Erreur envoi email :", e);
    return false;
  }
}
