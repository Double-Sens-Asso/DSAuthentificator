import { CONFIG as C } from "./config.ts";
import { NocoMember, VerificationResult } from "./types.ts";

// Allow mocking for tests
export let CONFIG = C;

/** Helpers API */
async function nocoFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${CONFIG.NOCODB_BASE_URL}${path}`, {
    ...options,
    headers: {
      "xc-token": CONFIG.NOCODB_TOKEN,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) throw new Error(`Erreur NocoDB [${res.status}]: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export function cleanRecord(raw: any): NocoMember | null {
  const id = raw.id ?? raw.Id ?? raw._id;
  if (!id) return null;

  const data = raw.fields ? raw.fields : raw;
  const rawCotis = data[CONFIG.COL_COTISATION];
  
  let isValid = false;
  if (rawCotis === true || rawCotis === "true" || rawCotis === 1 || rawCotis === "1") isValid = true;
  if (Array.isArray(rawCotis) && rawCotis.length > 0 && (rawCotis[0] === 1 || rawCotis[0] === true)) isValid = true;

  return {
    recordId: Number(id),
    email: String(data[CONFIG.COL_EMAIL] ?? "").trim().toLowerCase(),
    discordId: data[CONFIG.COL_DISCORD_ID] ? String(data[CONFIG.COL_DISCORD_ID]) : null,
    cotisationValide: isValid,
  };
}

/* --- FONCTIONS PUBLIQUES --- */

export async function testConnection(): Promise<boolean> {
  try {
    await nocoFetch(`/api/v3/data/${CONFIG.NOCODB_PROJECT_ID}/${CONFIG.NOCODB_TABLE_ID}/records?limit=1`);
    return true;
  } catch (e) { console.error(e); return false; }
}

export async function findMemberByColumn(colName: string, value: string): Promise<NocoMember | null> {
  // Recherche stricte
  const where = `where=(${encodeURIComponent(colName)},eq,${encodeURIComponent(value)})`;
  const json = await nocoFetch<{ list?: any[], records?: any[] }>(
    `/api/v3/data/${CONFIG.NOCODB_PROJECT_ID}/${CONFIG.NOCODB_TABLE_ID}/records?${where}&limit=1`
  );
  const list = json.list ?? json.records ?? [];
  return list.length > 0 ? cleanRecord(list[0]) : null;
}

export async function getAllLinkedUsers(): Promise<NocoMember[]> {
  const json = await nocoFetch<{ list?: any[], records?: any[] }>(
    `/api/v3/data/${CONFIG.NOCODB_PROJECT_ID}/${CONFIG.NOCODB_TABLE_ID}/records?limit=1000`
  );
  return (json.list ?? json.records ?? []).map(cleanRecord).filter((m): m is NocoMember => m !== null && !!m.discordId);
}

/**
 * ÉTAPE A : Vérification STRICTE (Idem ancien script)
 * Ne renvoie valid=true que si on peut procéder à l'envoi du code.
 */
export async function checkUserStatus(emailInput: string, discordIdInput: string): Promise<VerificationResult> {
  const email = emailInput.trim().toLowerCase(); // Nettoyage agressif
  
  // 1. Ce compte Discord est-il déjà pris par quelqu'un d'autre ?
  const existingDiscord = await findMemberByColumn(CONFIG.COL_DISCORD_ID, discordIdInput);
  if (existingDiscord && existingDiscord.email !== email) {
    return { valid: false, message: "⛔ Ce compte Discord est déjà lié à un autre dossier adhérent." };
  }

  // 2. L'email existe-t-il ?
  const member = await findMemberByColumn(CONFIG.COL_EMAIL, email);
  if (!member) {
    return { valid: false, message: `❌ Email \`${email}\` introuvable dans la base adhérents.` };
  }

  // 3. Cotisation à jour ?
  if (!member.cotisationValide) {
    return { valid: false, message: "⚠️ Ton dossier existe, mais ta cotisation n'est pas à jour." };
  }

  // 4. Email déjà pris par un autre compte Discord ?
  if (member.discordId && member.discordId !== discordIdInput) {
    return { valid: false, message: "⛔ Cet email est déjà lié à un autre compte Discord." };
  }

  // 5. Cas spécial : C'est déjà fait !
  if (member.discordId === discordIdInput) {
    return { valid: false, message: "✅ Ton compte est déjà correctement lié (Inutile de refaire la procédure)." };
  }

  // Si on arrive ici, c'est que tout est parfait pour envoyer le code
  return { valid: true, message: "OK", member };
}

/**
 * ÉTAPE B : Enregistrement (Une fois le code validé)
 */
export async function linkDiscordUser(recordId: number, discordId: string): Promise<boolean> {
  try {
    const payload = [{ id: recordId, fields: { [CONFIG.COL_DISCORD_ID]: discordId } }];
    await nocoFetch(`/api/v3/data/${CONFIG.NOCODB_PROJECT_ID}/${CONFIG.NOCODB_TABLE_ID}/records`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

export async function unlinkUserByEmail(email: string): Promise<{ success: boolean; message: string }> {
  const member = await findMemberByColumn(CONFIG.COL_EMAIL, email.toLowerCase());
  if (!member || !member.discordId) return { success: false, message: "Dossier introuvable ou non lié." };
  
  const success = await linkDiscordUser(member.recordId, "");
  return success 
    ? { success: true, message: `✅ Liaison supprimée pour ${email}` }
    : { success: false, message: "Erreur technique." };
}