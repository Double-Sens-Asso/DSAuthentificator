// deno-lint-ignore-file no-import-prefix
import { Client, DiscordAPIError, GuildMember, RESTJSONErrorCodes } from "npm:discord.js@14";
import { CONFIG } from "../config/config.ts";
import { Colors } from "../config/constants.ts";
import { sleep } from "../shared/utils.ts";
import { getAllLinkedUsers } from "../infrastructure/nocodb/members.repo.ts";
import { clearPending, getPending, setPending } from "../infrastructure/storage/pending-removals.store.ts";
import { sendLog } from "../services/logger.ts";

/**
 * Passage périodique de vérification des cotisations :
 *  - ré-attribue le rôle aux adhérents redevenus à jour ;
 *  - programme puis applique le retrait différé pour les cotisations invalides ;
 *  - envoie un rappel DM avant retrait (si activé) ;
 *  - retire les rôles "orphelins" portés sans liaison en base.
 */
export async function runDailyCheck(client: Client) {
  console.log("🔄 [AUTO] Vérification des cotisations...");

  const guild = await client.guilds.fetch(CONFIG.GUILD_ID!);
  if (!guild) return;

  const role = await guild.roles.fetch(CONFIG.VERIFY_ROLE_ID!);
  if (!role) return;

  await guild.members.fetch().catch((e) => console.error("⚠️ guild.members.fetch :", e));

  let members;
  try {
    members = await getAllLinkedUsers();
  } catch (e) {
    console.error("⚠️ Échec lecture NocoDB :", e);
    await sendLog(guild, null, "(système)", `⚠️ NocoDB inaccessible : ${e instanceof Error ? e.message : e}`, Colors.ERROR);
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
          await sendLog(guild, m.discordId, m.email, "✅ Cotisation à jour - Rôle ré-attribué", Colors.SUCCESS);
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
          Colors.WARNING,
        );
        continue;
      }

      const elapsed = now - pending.firstDetectedAt;
      const remaining = delayMs - elapsed;

      if (elapsed >= delayMs) {
        await dUser.roles.remove(role);
        await sendLog(guild, m.discordId, m.email, "❌ Cotisation expirée - Rôle retiré", Colors.ERROR);
        await clearPending(m.discordId);
        removedCount++;
        await sleep(1000);
        continue;
      }

      // Rappel DM dans la dernière fenêtre cron avant retrait
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
          await sendLog(guild, m.discordId, m.email, "📨 Rappel DM envoyé (cotisation invalide)", Colors.REMINDER);
        } catch (e) {
          console.error(`⚠️ DM impossible (${m.email}) :`, e);
          await sendLog(guild, m.discordId, m.email, "⚠️ Rappel DM impossible (DMs fermés)", Colors.WARNING);
        }
        if (dmOk) await setPending(m.discordId, { ...pending, reminded: true });
      }
    } catch (e) {
      console.error(`⚠️ Erreur check (${m.email}) :`, e);
    }
  }

  // Retrait des rôles orphelins (porteurs du rôle sans liaison en base)
  let orphanCount = 0;
  for (const [, member] of role.members) {
    if (linkedIds.has(member.id)) continue;
    try {
      await member.roles.remove(role);
      await sendLog(guild, member.id, "(non lié)", "❌ Rôle retiré (aucune liaison en base)", Colors.ERROR);
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
