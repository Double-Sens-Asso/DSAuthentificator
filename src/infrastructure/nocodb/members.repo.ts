// deno-lint-ignore-file no-explicit-any
/**
 * Repository NocoDB : accès (lecture / écriture) aux dossiers adhérents.
 * Traduit les enregistrements bruts NocoDB en `NocoMember` typés et isole
 * le reste de l'application des détails de l'API v3.
 */
import { CONFIG } from "../../config/config.ts";
import { NocoMember } from "../../core/types.ts";
import { nocoFetch } from "./client.ts";

/** Normalise les données brutes de NocoDB en un objet typé propre. */
export function cleanRecord(raw: any): NocoMember | null {
  // Gestion des variations d'ID (id, Id, _id)
  const id = raw.id ?? raw.Id ?? raw._id;
  if (!id) return null;

  // NocoDB encapsule parfois les données dans "fields"
  const data = raw.fields ? raw.fields : raw;

  // Récupération sécurisée des valeurs
  const rawEmail = data[CONFIG.COL_EMAIL];
  const rawDiscordId = data[CONFIG.COL_DISCORD_ID];
  const rawCotis = data[CONFIG.COL_COTISATION];

  // Logique pour la cotisation (gère booléens, strings "true", nombres 1, ou tableaux lookup)
  let isValid = false;
  if (rawCotis === true || rawCotis === "true" || rawCotis === 1 || rawCotis === "1") isValid = true;
  if (Array.isArray(rawCotis) && rawCotis.length > 0 && (rawCotis[0] === 1 || rawCotis[0] === true)) isValid = true;

  return {
    recordId: Number(id),
    email: String(rawEmail ?? "").trim().toLowerCase(),
    discordId: rawDiscordId ? String(rawDiscordId) : null,
    cotisationValide: isValid,
  };
}

// -------------------------------------------------------------------------
// LECTURE (READ)
// -------------------------------------------------------------------------

/** Teste la connectivité en demandant 1 ligne. */
export async function testConnection(): Promise<boolean> {
  try {
    await nocoFetch(`/api/v3/data/${CONFIG.NOCODB_PROJECT_ID}/${CONFIG.NOCODB_TABLE_ID}/records?limit=1`);
    return true;
  } catch (e) {
    console.error("⚠️ Échec test connexion NocoDB:", e);
    return false;
  }
}

/** Cherche un adhérent selon une colonne spécifique (ex: Email ou DiscordID). */
export async function findMemberByColumn(colName: string, value: string): Promise<NocoMember | null> {
  // Filtre NocoDB : where=(Colonne,eq,Valeur)
  const where = `where=(${encodeURIComponent(colName)},eq,${encodeURIComponent(value)})`;

  const json = await nocoFetch<{ list?: any[]; records?: any[] }>(
    `/api/v3/data/${CONFIG.NOCODB_PROJECT_ID}/${CONFIG.NOCODB_TABLE_ID}/records?${where}&limit=1`,
  );

  // Compatibilité v3/v4 (certaines versions renvoient 'list', d'autres 'records')
  const list = json.list ?? json.records ?? [];

  return list.length > 0 ? cleanRecord(list[0]) : null;
}

/**
 * Récupère tous les utilisateurs ayant déjà lié leur compte Discord.
 * Pagine automatiquement pour ne pas être bloqué par la limite NocoDB.
 */
export async function getAllLinkedUsers(): Promise<NocoMember[]> {
  const pageSize = CONFIG.NOCODB_PAGE_SIZE;
  const all: NocoMember[] = [];
  let offset = 0;

  // Garde-fou : on s'arrête quand on récupère moins que la pageSize ou après 50 pages.
  for (let page = 0; page < 50; page++) {
    const json = await nocoFetch<{ list?: any[]; records?: any[]; pageInfo?: { isLastPage?: boolean } }>(
      `/api/v3/data/${CONFIG.NOCODB_PROJECT_ID}/${CONFIG.NOCODB_TABLE_ID}/records?limit=${pageSize}&offset=${offset}`,
    );

    const rawList = json.list ?? json.records ?? [];
    if (rawList.length === 0) break;

    for (const r of rawList) {
      const m = cleanRecord(r);
      if (m && m.discordId) all.push(m);
    }

    if (rawList.length < pageSize || json.pageInfo?.isLastPage) break;
    offset += pageSize;
  }

  return all;
}

// -------------------------------------------------------------------------
// ÉCRITURE (WRITE)
// -------------------------------------------------------------------------

/** Lie l'ID Discord dans la base (PATCH). */
export async function linkDiscordUser(recordId: number, discordId: string): Promise<boolean> {
  try {
    const payload = [{ id: recordId, fields: { [CONFIG.COL_DISCORD_ID]: discordId } }];

    await nocoFetch(`/api/v3/data/${CONFIG.NOCODB_PROJECT_ID}/${CONFIG.NOCODB_TABLE_ID}/records`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    return true;
  } catch (e) {
    console.error("Erreur linkDiscordUser:", e);
    return false;
  }
}

/** Admin : Supprime la liaison Discord d'un dossier. */
export async function unlinkUserByEmail(email: string): Promise<{ success: boolean; message: string }> {
  const member = await findMemberByColumn(CONFIG.COL_EMAIL, email.toLowerCase());

  if (!member || !member.discordId) {
    return { success: false, message: "Dossier introuvable ou non lié." };
  }

  // On écrase l'ID avec une chaîne vide
  const success = await linkDiscordUser(member.recordId, "");

  return success
    ? { success: true, message: `✅ Liaison supprimée pour ${email}` }
    : { success: false, message: "Erreur technique lors de la déliaison." };
}
