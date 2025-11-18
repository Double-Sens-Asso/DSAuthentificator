import "jsr:@std/dotenv/load";
import { NocoMember, VerificationResult } from "./types.ts";


const CONFIG = {
  baseUrl:   Deno.env.get("NOCODB_BASE_URL")?.replace(/\/+$/, "") ?? "",
  token:     Deno.env.get("NOCODB_TOKEN") ?? "",
  projectId: Deno.env.get("NOCODB_PROJECT_ID") ?? "",
  tableId:   Deno.env.get("NOCODB_TABLE_ID") ?? "",
  columns: {
    email:   Deno.env.get("COL_EMAIL") ?? "mail",
    discord: Deno.env.get("COL_DISCORD_ID") ?? "IdDiscord",
    cotis:   Deno.env.get("COL_COTISATION") ?? "cotisationValide",
  }
};


/**
 * Fonction pour faire des requêtes à NocoDB.
 */
async function nocoFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${CONFIG.baseUrl}${path}`;
  
  const headers = {
    "xc-token": CONFIG.token,
    "Content-Type": "application/json",
    "Accept": "application/json",
    ...options.headers,
  };

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "Pas de détails");
    throw new Error(`Erreur NocoDB [${res.status}]: ${errorText}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Nettoie les données brutes de NocoDB pour en faire un objet "Membre" propre.
 */
// deno-lint-ignore no-explicit-any
function cleanRecord(raw: any): NocoMember | null {
  // 1. Trouver l'ID (peut être 'id', 'Id' ou '_id')
  const id = raw.id ?? raw.Id ?? raw._id;
  if (!id) return null;

  // 2. Trouver les données (parfois dans 'fields', parfois à la racine)
  const data = raw.fields ? raw.fields : raw;

  // 3. Vérifier la cotisation (Gère: 1, "1", true, [1])
  const rawCotis = data[CONFIG.columns.cotis];
  let isValid = false;
  if (rawCotis === true || rawCotis === "true" || rawCotis === 1 || rawCotis === "1") isValid = true;
  if (Array.isArray(rawCotis) && rawCotis.length > 0 && (rawCotis[0] === 1 || rawCotis[0] === true)) isValid = true;

  return {
    recordId: Number(id),
    email: String(data[CONFIG.columns.email] ?? "").trim().toLowerCase(),
    discordId: data[CONFIG.columns.discord] ? String(data[CONFIG.columns.discord]) : null,
    cotisationValide: isValid,
  };
}

/* =========================================
   3. ACTIONS DE BASE DE DONNÉES
   Lecture, Recherche, Modification.
   ========================================= */

/**
 * Teste juste si la connexion fonctionne.
 */
export async function testConnection(): Promise<boolean> {
  try {
    await nocoFetch(`/api/v3/data/${CONFIG.projectId}/${CONFIG.tableId}/records?limit=1`);
    return true;
  } catch (e) {
    console.error("❌ Échec connexion NocoDB:", e);
    return false;
  }
}

/**
 * Trouve un membre en cherchant dans une colonne spécifique (Email ou ID Discord).
 */
export async function findMemberByColumn(colName: string, value: string): Promise<NocoMember | null> {
  // Formule de recherche NocoDB : (Colonne,eq,Valeur)
  const where = `where=(${encodeURIComponent(colName)},eq,${encodeURIComponent(value)})`;
  
  const json = await nocoFetch<{ list?: any[], records?: any[] }>(
    `/api/v3/data/${CONFIG.projectId}/${CONFIG.tableId}/records?${where}&limit=1`
  );

  const list = json.list ?? json.records ?? [];
  return list.length > 0 ? cleanRecord(list[0]) : null;
}

/**
 * Récupère TOUS les membres ayant un Discord lié (pour la vérif auto).
 */
export async function getAllLinkedUsers(): Promise<NocoMember[]> {
  // On récupère beaucoup de lignes
  const json = await nocoFetch<{ list?: any[], records?: any[] }>(
    `/api/v3/data/${CONFIG.projectId}/${CONFIG.tableId}/records?limit=100000`
  );
  
  const list = json.list ?? json.records ?? [];
  const results: NocoMember[] = [];

  for (const item of list) {
    const member = cleanRecord(item);
    // On ne garde que ceux qui ont un ID Discord valide
    if (member && member.discordId && member.discordId.length > 5) {
      results.push(member);
    }
  }
  return results;
}

/**
 * Met à jour l'ID Discord d'un membre.
 * Utilise le format spécifique requis par NocoDB v3 (Array + Nested Fields).
 */
async function saveDiscordIdToDb(recordId: number, discordId: string): Promise<void> {
  const path = `/api/v3/data/${CONFIG.projectId}/${CONFIG.tableId}/records`;
  
  const payload = [{
    id: recordId,
    fields: {
      [CONFIG.columns.discord]: discordId
    }
  }];

  await nocoFetch(path, { method: "PATCH", body: JSON.stringify(payload) });
}

/* =========================================
   4. LOGIQUE MÉTIER (VÉRIFICATION)
   ========================================= */

/**
 * Commande Admin : Supprime le lien Discord pour un email donné.
 */
export async function unlinkUserByEmail(email: string): Promise<{ success: boolean; message: string }> {
  const member = await findMemberByColumn(CONFIG.columns.email, email.toLowerCase());
  
  if (!member) return { success: false, message: "Aucun dossier trouvé avec cet email." };
  if (!member.discordId) return { success: false, message: "Cet email n'est pas lié à un compte Discord." };

  try {
    // On envoie une chaîne vide "" pour effacer l'ID
    await saveDiscordIdToDb(member.recordId, "");
    return { success: true, message: `✅ Liaison supprimée pour l'email : ${email}` };
  } catch (e) {
    console.error(e);
    return { success: false, message: "❌ Erreur technique lors de la suppression." };
  }
}

/**
 * Vérifie tout et lie le compte si c'est bon.
 */
export async function checkAndLinkUser(emailInput: string, discordIdInput: string): Promise<VerificationResult> {
  const email = emailInput.trim().toLowerCase();
  
  // ÉTAPE 1 : Vérifier si ce compte Discord est déjà utilisé par quelqu'un d'autre
  const existingDiscord = await findMemberByColumn(CONFIG.columns.discord, discordIdInput);
  if (existingDiscord && existingDiscord.email !== email) {
    return { success: false, message: "⛔ Ce compte Discord est déjà lié à une autre personne." };
  }

  // ÉTAPE 2 : Trouver le membre par son email
  const member = await findMemberByColumn(CONFIG.columns.email, email);
  
  if (!member) {
    return { success: false, message: "❌ Email introuvable dans la base adhérents." };
  }

  // ÉTAPE 3 : Vérifier si la cotisation est à jour
  if (!member.cotisationValide) {
    return { success: false, message: "⚠️ Ton dossier existe, mais ta cotisation n'est pas valide." };
  }

  // ÉTAPE 4 : Vérifier si cet email est déjà pris par un AUTRE compte Discord
  if (member.discordId && member.discordId !== discordIdInput) {
    return { success: false, message: "⛔ Cet email est déjà lié à un autre compte Discord." };
  }

  // ÉTAPE 5 : Vérifier si c'est déjà fait (Cas "Je clique deux fois")
  if (member.discordId === discordIdInput) {
    return { success: true, message: "✅ Ton compte est déjà correctement lié.", member };
  }

  // ÉTAPE 6 : Tout est bon, on enregistre !
  try {
    await saveDiscordIdToDb(member.recordId, discordIdInput);
    member.discordId = discordIdInput; // Mise à jour locale pour le retour
    return { success: true, message: "✅ Succès ! Ton compte a été lié.", member };
  } catch (e) {
    console.error(e);
    return { success: false, message: "❌ Erreur technique lors de l'enregistrement en base." };
  }
}