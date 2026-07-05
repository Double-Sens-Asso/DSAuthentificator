// deno-lint-ignore-file no-import-prefix no-unversioned-import
/**
 * Persistance des retraits de rôle en attente.
 * Quand une cotisation est détectée invalide, on n'enlève pas le rôle tout de suite :
 * on enregistre la date de première détection et on attend le délai configuré.
 *
 * Toutes les opérations passent par JsonStore -> écriture atomique
 * et sérialisée (pas de race conditions).
 */

import { join } from "jsr:@std/path";
import { DATA_DIR } from "../../config/paths.ts";
import { JsonStore } from "./json-store.ts";

export const PENDING_FILE = join(DATA_DIR, "pending_removals.json");

export interface PendingEntry {
  /** Timestamp (ms) de la première détection de cotisation invalide */
  firstDetectedAt: number;
  /** Email associé (utile pour les logs si l'utilisateur quitte le serveur).
   *  Toujours stocké en lower-case pour permettre des comparaisons strictes. */
  email: string;
  /** Indique si le rappel DM a déjà été envoyé */
  reminded: boolean;
}

type Store = Record<string, PendingEntry>; // clé = discordId

const store = new JsonStore<Store>(PENDING_FILE, () => ({}));

export function getPending(discordId: string): Promise<PendingEntry | null> {
  return store.read((s) => s[discordId] ?? null);
}

export function setPending(discordId: string, entry: PendingEntry): Promise<void> {
  return store.transaction(async (s, save) => {
    // On normalise l'email à l'écriture pour permettre des comparaisons strictes plus tard.
    s[discordId] = { ...entry, email: entry.email.trim().toLowerCase() };
    await save(s);
  });
}

export function clearPending(discordId: string): Promise<void> {
  return store.transaction(async (s, save) => {
    if (discordId in s) {
      delete s[discordId];
      await save(s);
    }
  });
}

/** Renvoie tous les retraits en attente, triés par date de détection croissante. */
export function getAllPending(): Promise<Array<PendingEntry & { discordId: string }>> {
  return store.read((s) =>
    Object.entries(s)
      .map(([discordId, entry]) => ({ discordId, ...entry }))
      .sort((a, b) => a.firstDetectedAt - b.firstDetectedAt)
  );
}

/** Cherche un pending par email (insensible à la casse / espaces). */
export function findPendingByEmail(email: string): Promise<{ discordId: string; entry: PendingEntry } | null> {
  const target = email.trim().toLowerCase();
  return store.read((s) => {
    for (const [discordId, entry] of Object.entries(s)) {
      // Les emails en store sont déjà normalisés -> comparaison stricte.
      if (entry.email === target) return { discordId, entry };
    }
    return null;
  });
}
