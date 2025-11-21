// deno-lint-ignore-file no-explicit-any
import { CONFIG as C } from "./config.ts";
import { NocoMember, VerificationResult } from "./types.ts";

// Export de la config pour permettre le mocking dans les tests unitaires
export const CONFIG = C;

// -------------------------------------------------------------------------
// 1. FONCTIONS UTILITAIRES INTERNES (HELPERS)
// -------------------------------------------------------------------------

/**
 * Wrapper générique pour fetch vers l'API NocoDB.
 * Gère l'authentification via token et la gestion centralisée des erreurs HTTP.
 */
async function nocoFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${CONFIG.NOCODB_BASE_URL}${path}`, {
    ...options,
    headers: {
      "xc-token": CONFIG.NOCODB_TOKEN,
      "Content-Type": "application/json",
      ...options.headers, // Permet de surcharger si besoin
    },
  });

  if (!res.ok) throw new Error(`Erreur NocoDB [${res.status}]: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/**
 * Normalise les données brutes (RAW) renvoyées par NocoDB en un objet typé propre.
 * Utile car la structure API NocoDB peut varier (fields, id vs Id, booléens vs int).
 * * @param raw L'objet JSON brut retourné par l'API
 */
export function cleanRecord(raw: any): NocoMember | null {
  // Gestion des variations de casse sur l'ID selon les versions de NocoDB
  const id = raw.id ?? raw.Id ?? raw._id;
  if (!id) return null;

  // NocoDB encapsule parfois les données dans une propriété "fields"
  const data = raw.fields ? raw.fields : raw;
  const rawCotis = data[CONFIG.COL_COTISATION];
  
  // Logique robuste pour déterminer si la cotisation est valide
  // (Gère : true, "true", 1, "1", ou tableau [1] typique des Lookups/Rollups)
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

// -------------------------------------------------------------------------
// 2. FONCTIONS PUBLIQUES : LECTURE (READ)
// -------------------------------------------------------------------------

/**
 * Teste la connectivité avec la base de données en demandant 1 ligne.
 */
export async function testConnection(): Promise<boolean> {
  try {
    await nocoFetch(`/api/v3/data/${CONFIG.NOCODB_PROJECT_ID}/${CONFIG.NOCODB_TABLE_ID}/records?limit=1`);
    return true;
  } catch (e) { console.error(e); return false; }
}

/**
 * Cherche un adhérent selon une colonne spécifique (ex: Email ou DiscordID).
 * Utilise l'API de filtre NocoDB.
 */
export async function findMemberByColumn(colName: string, value: string): Promise<NocoMember | null> {
  // Syntax where=(Colonne,eq,Valeur)
  const where = `where=(${encodeURIComponent(colName)},eq,${encodeURIComponent(value)})`;
  
  const json = await nocoFetch<{ list?: any[], records?: any[] }>(
    `/api/v3/data/${CONFIG.NOCODB_PROJECT_ID}/${CONFIG.NOCODB_TABLE_ID}/records?${where}&limit=1`
  );
  
  // Gestion compatibilité v3/v4 (list vs records)
  const list = json.list ?? json.records ?? [];
  return list.length > 0 ? cleanRecord(list[0]) : null;
}

/**
 * Récupère tous les utilisateurs ayant déjà lié leur compte Discord.
 * * Note : Limité à 1000 records (pagination à implémenter si l'asso grandit).
 */
export async function getAllLinkedUsers(): Promise<NocoMember[]> {
  const json = await nocoFetch<{ list?: any[], records?: any[] }>(
    `/api/v3/data/${CONFIG.NOCODB_PROJECT_ID}/${CONFIG.NOCODB_TABLE_ID}/records?limit=1000`
  );
  // On nettoie et on ne garde que ceux qui ont un discordId non null
  return (json.list ?? json.records ?? []).map(cleanRecord).filter((m): m is NocoMember => m !== null && !!m.discordId);
}

// -------------------------------------------------------------------------
// 3. LOGIQUE MÉTIER : VÉRIFICATION (VALIDATION)
// -------------------------------------------------------------------------

/**
 * Cœur de la validation : Vérifie si un utilisateur a le droit de se lier.
 * Applique toutes les règles de gestion (paiement, unicité, etc.).
 * * @returns VerificationResult : Contient le statut et le message d'erreur ou le membre trouvé.
 */
export async function checkUserStatus(emailInput: string, discordIdInput: string): Promise<VerificationResult> {
  const email = emailInput.trim().toLowerCase(); // Normalisation
  
  // 1. Check INTÉGRITÉ : Ce compte Discord est-il déjà pris par quelqu'un d'autre ?
  // Empêche qu'un utilisateur lie son compte Discord à plusieurs emails différents.
  const existingDiscord = await findMemberByColumn(CONFIG.COL_DISCORD_ID, discordIdInput);
  if (existingDiscord && existingDiscord.email !== email) {
    return { valid: false, message: "⛔ Ce compte Discord est déjà lié à un autre dossier adhérent." };
  }

  // 2. Check EXISTENCE : L'email existe-t-il dans la base ?
  const member = await findMemberByColumn(CONFIG.COL_EMAIL, email);
  if (!member) {
    return { valid: false, message: `❌ Email \`${email}\` introuvable dans la base adhérents.` };
  }

  // 3. Check MÉTIER : La cotisation est-elle à jour ?
  if (!member.cotisationValide) {
    return { valid: false, message: "⚠️ Ton dossier existe, mais ta cotisation n'est pas à jour." };
  }

  // 4. Check DISPONIBILITÉ : Cet email est-il déjà lié à un AUTRE compte Discord ?
  // Empêche le vol de compte adhérent par un autre compte Discord.
  if (member.discordId && member.discordId !== discordIdInput) {
    return { valid: false, message: "⛔ Cet email est déjà lié à un autre compte Discord." };
  }

  // 5. Check IDEMPOTENCE : C'est déjà fait !
  if (member.discordId === discordIdInput) {
    return { valid: false, message: "✅ Ton compte est déjà correctement lié (Inutile de refaire la procédure)." };
  }

  // Si on arrive ici, tous les feux sont verts pour l'envoi du code SMTP.
  return { valid: true, message: "OK", member };
}

// -------------------------------------------------------------------------
// 4. FONCTIONS PUBLIQUES : ÉCRITURE (WRITE)
// -------------------------------------------------------------------------

/**
 * Finalise l'inscription en écrivant l'ID Discord dans la base NocoDB.
 * Utilisé uniquement après validation du code OTP.
 */
export async function linkDiscordUser(recordId: number, discordId: string): Promise<boolean> {
  try {
    // PATCH pour ne mettre à jour que le champ Discord ID
    const payload = [{ id: recordId, fields: { [CONFIG.COL_DISCORD_ID]: discordId } }];
    
    await nocoFetch(`/api/v3/data/${CONFIG.NOCODB_PROJECT_ID}/${CONFIG.NOCODB_TABLE_ID}/records`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    return true;
  } catch (e) {
    console.error("Erreur linkDiscordUser:", e);
    return false;
  }
}

/**
 * Fonction Admin : Supprime la liaison Discord pour un email donné.
 * Utile en cas de changement de compte Discord ou d'erreur.
 */
export async function unlinkUserByEmail(email: string): Promise<{ success: boolean; message: string }> {
  const member = await findMemberByColumn(CONFIG.COL_EMAIL, email.toLowerCase());
  
  if (!member || !member.discordId) {
    return { success: false, message: "Dossier introuvable ou non lié." };
  }
  
  // On écrase l'ID Discord avec une chaîne vide
  const success = await linkDiscordUser(member.recordId, "");
  
  return success 
    ? { success: true, message: `✅ Liaison supprimée pour ${email}` }
    : { success: false, message: "Erreur technique lors de la déliaison." };
}