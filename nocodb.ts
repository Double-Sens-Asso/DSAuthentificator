// deno-lint-ignore-file no-explicit-any
import { CONFIG as C } from "./config.ts";
import { NocoMember, VerificationResult } from "./types.ts";

// Export de la config pour permettre le mocking dans les tests unitaires si besoin
export const CONFIG = C;

// -------------------------------------------------------------------------
// 1. FONCTIONS UTILITAIRES INTERNES (HELPERS)
// -------------------------------------------------------------------------

/**
 * Wrapper générique pour fetch vers l'API NocoDB.
 * Gère l'authentification via token et la gestion des erreurs (HTML vs JSON).
 */
async function nocoFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  // [DEBUG] On affiche l'URL pour t'aider à trouver l'erreur de connexion
  const url = `${CONFIG.NOCODB_BASE_URL}${path}`;
  console.log(`🔍 [DEBUG] Appel NocoDB : ${url}`);

  const res = await fetch(url, {
    ...options,
    headers: {
      "xc-token": CONFIG.NOCODB_TOKEN,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  // On récupère le texte brut d'abord pour éviter le crash "Unexpected token <"
  const text = await res.text();

  if (!res.ok) {
    console.error(`❌ Erreur HTTP ${res.status}`);
    console.error(`📄 Réponse serveur : ${text.slice(0, 300)}...`); // Affiche le début de l'erreur
    throw new Error(`Erreur NocoDB [${res.status}]`);
  }

  try {
    return JSON.parse(text) as T;
  } catch (e) {
    console.error("❌ Erreur JSON. Le serveur a renvoyé du HTML ou du texte brut :");
    console.error(text.slice(0, 500));
    throw new Error("Réponse invalide (Pas de JSON)");
  }
}

/**
 * Normalise les données brutes de NocoDB en un objet typé propre.
 */
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
// 2. FONCTIONS PUBLIQUES : LECTURE (READ)
// -------------------------------------------------------------------------

/**
 * Teste la connectivité en demandant 1 ligne.
 */
export async function testConnection(): Promise<boolean> {
  try {
    await nocoFetch(`/api/v3/data/${CONFIG.NOCODB_PROJECT_ID}/${CONFIG.NOCODB_TABLE_ID}/records?limit=1`);
    return true;
  } catch (e) {
    console.error("⚠️ Échec test connexion NocoDB:", e);
    return false;
  }
}

/**
 * Cherche un adhérent selon une colonne spécifique (ex: Email ou DiscordID).
 */
export async function findMemberByColumn(colName: string, value: string): Promise<NocoMember | null> {
  // Filtre NocoDB : where=(Colonne,eq,Valeur)
  const where = `where=(${encodeURIComponent(colName)},eq,${encodeURIComponent(value)})`;
  
  const json = await nocoFetch<{ list?: any[], records?: any[] }>(
    `/api/v3/data/${CONFIG.NOCODB_PROJECT_ID}/${CONFIG.NOCODB_TABLE_ID}/records?${where}&limit=1`
  );

  // Compatibilité v3/v4 (certaines versions renvoient 'list', d'autres 'records')
  const list = json.list ?? json.records ?? [];
  
  return list.length > 0 ? cleanRecord(list[0]) : null;
}

/**
 * Récupère tous les utilisateurs ayant déjà lié leur compte Discord.
 */
export async function getAllLinkedUsers(): Promise<NocoMember[]> {
  const json = await nocoFetch<{ list?: any[], records?: any[] }>(
    `/api/v3/data/${CONFIG.NOCODB_PROJECT_ID}/${CONFIG.NOCODB_TABLE_ID}/records?limit=1000`
  );
  
  const rawList = json.list ?? json.records ?? [];
  
  // On nettoie et on garde uniquement ceux qui ont un discordId valide
  return rawList
    .map(cleanRecord)
    .filter((m): m is NocoMember => m !== null && !!m.discordId);
}

// -------------------------------------------------------------------------
// 3. LOGIQUE MÉTIER : VÉRIFICATION
// -------------------------------------------------------------------------

export async function checkUserStatus(emailInput: string, discordIdInput: string): Promise<VerificationResult> {
  const email = emailInput.trim().toLowerCase();
  
  // 1. Check : Ce compte Discord est-il déjà utilisé ?
  const existingDiscord = await findMemberByColumn(CONFIG.COL_DISCORD_ID, discordIdInput);
  if (existingDiscord && existingDiscord.email !== email) {
    return { valid: false, message: "⛔ Ce compte Discord est déjà lié à un autre dossier." };
  }

  // 2. Check : L'email existe-t-il ?
  const member = await findMemberByColumn(CONFIG.COL_EMAIL, email);
  if (!member) {
    return { valid: false, message: `❌ Email \`${email}\` introuvable.` };
  }

  // 3. Check : Cotisation à jour ?
  if (!member.cotisationValide) {
    return { valid: false, message: "⚠️ Ton dossier existe, mais ta cotisation n'est pas à jour." };
  }

  // 4. Check : Email déjà pris par un autre Discord ?
  if (member.discordId && member.discordId !== discordIdInput) {
    return { valid: false, message: "⛔ Cet email est déjà lié à un autre compte Discord." };
  }

  // 5. Check : Déjà fait ?
  if (member.discordId === discordIdInput) {
    return { valid: false, message: "✅ Ton compte est déjà correctement lié." };
  }

  return { valid: true, message: "OK", member };
}

// -------------------------------------------------------------------------
// 4. FONCTIONS PUBLIQUES : ÉCRITURE (WRITE)
// -------------------------------------------------------------------------

/**
 * Lie l'ID Discord dans la base (PATCH).
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
    console.error("Erreur linkDiscordUser:", e);
    return false;
  }
}

/**
 * Admin : Supprime la liaison.
 */
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