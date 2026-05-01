/**
 * Persistance des retraits de rôle en attente.
 * Quand une cotisation est détectée invalide, on n'enlève pas le rôle tout de suite :
 * on enregistre la date de première détection et on attend le délai configuré.
 */

const FILE_PATH = new URL("./pending_removals.json", import.meta.url).pathname;

export interface PendingEntry {
  /** Timestamp (ms) de la première détection de cotisation invalide */
  firstDetectedAt: number;
  /** Email associé (utile pour les logs si l'utilisateur quitte le serveur) */
  email: string;
  /** Indique si le rappel DM a déjà été envoyé */
  reminded: boolean;
}

type Store = Record<string, PendingEntry>; // clé = discordId

async function load(): Promise<Store> {
  try {
    const text = await Deno.readTextFile(FILE_PATH);
    return JSON.parse(text) as Store;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return {};
    console.error("⚠️ Lecture pending_removals.json échouée :", e);
    return {};
  }
}

async function save(store: Store): Promise<void> {
  await Deno.writeTextFile(FILE_PATH, JSON.stringify(store, null, 2));
}

export async function getPending(discordId: string): Promise<PendingEntry | null> {
  const store = await load();
  return store[discordId] ?? null;
}

export async function setPending(discordId: string, entry: PendingEntry): Promise<void> {
  const store = await load();
  store[discordId] = entry;
  await save(store);
}

export async function clearPending(discordId: string): Promise<void> {
  const store = await load();
  if (discordId in store) {
    delete store[discordId];
    await save(store);
  }
}
