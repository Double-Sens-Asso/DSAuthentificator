// deno-lint-ignore-file no-import-prefix no-unversioned-import
/**
 * Sessions OTP en cours de vérification.
 * - Persistées sur disque pour survivre à un redémarrage du bot.
 * - Expirent après CONFIG.OTP_TTL_SECONDS.
 * - Limitées à CONFIG.OTP_MAX_ATTEMPTS tentatives de code.
 *
 * Toutes les opérations passent par JsonStore -> écriture atomique
 * et sérialisée (pas de race conditions).
 */

import { join } from "jsr:@std/path";
import { CONFIG } from "../../config/config.ts";
import { DATA_DIR } from "../../config/paths.ts";
import { JsonStore } from "./json-store.ts";

export const SESSIONS_FILE = join(DATA_DIR, "otp_sessions.json");

export interface OtpSession {
  code: string;
  email: string;
  recordId: number;
  /** Timestamp (ms) de création */
  createdAt: number;
  /** Nombre de tentatives de code déjà effectuées */
  attempts: number;
}

type Store = Record<string, OtpSession>; // clé = discordId

const store = new JsonStore<Store>(SESSIONS_FILE, () => ({}));

/** Supprime les entrées expirées du store (mute en place). */
function purgeExpired(s: Store): void {
  const ttl = CONFIG.OTP_TTL_SECONDS * 1000;
  const now = Date.now();
  for (const [id, session] of Object.entries(s)) {
    if (now - session.createdAt > ttl) delete s[id];
  }
}

export function setSession(
  discordId: string,
  data: Omit<OtpSession, "createdAt" | "attempts">,
): Promise<void> {
  return store.transaction(async (s, save) => {
    purgeExpired(s);
    s[discordId] = { ...data, createdAt: Date.now(), attempts: 0 };
    await save(s);
  });
}

export function getSession(discordId: string): Promise<OtpSession | null> {
  return store.transaction(async (s, save) => {
    const before = Object.keys(s).length;
    purgeExpired(s);
    if (Object.keys(s).length !== before) await save(s);
    return s[discordId] ?? null;
  });
}

export function deleteSession(discordId: string): Promise<void> {
  return store.transaction(async (s, save) => {
    if (discordId in s) {
      delete s[discordId];
      await save(s);
    }
  });
}

/** Incrémente le compteur de tentatives ; renvoie le compteur post-incrément. */
export function incrementAttempt(discordId: string): Promise<number> {
  return store.transaction(async (s, save) => {
    purgeExpired(s);
    const session = s[discordId];
    if (!session) return 0;
    session.attempts += 1;
    await save(s);
    return session.attempts;
  });
}
