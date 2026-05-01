/**
 * Sessions OTP en cours de vérification.
 * - Persistées sur disque pour survivre à un redémarrage du bot.
 * - Expirent après CONFIG.OTP_TTL_SECONDS.
 * - Limitées à CONFIG.OTP_MAX_ATTEMPTS tentatives de code.
 */

import { CONFIG } from "./config.ts";

const FILE_PATH = new URL("./otp_sessions.json", import.meta.url).pathname;

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

async function load(): Promise<Store> {
  try {
    const text = await Deno.readTextFile(FILE_PATH);
    return JSON.parse(text) as Store;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return {};
    console.error("⚠️ Lecture otp_sessions.json échouée :", e);
    return {};
  }
}

async function save(store: Store): Promise<void> {
  await Deno.writeTextFile(FILE_PATH, JSON.stringify(store, null, 2));
}

/** Supprime les sessions expirées et renvoie le store nettoyé. */
async function loadAndPurge(): Promise<Store> {
  const store = await load();
  const ttl = CONFIG.OTP_TTL_SECONDS * 1000;
  const now = Date.now();
  let mutated = false;
  for (const [id, s] of Object.entries(store)) {
    if (now - s.createdAt > ttl) {
      delete store[id];
      mutated = true;
    }
  }
  if (mutated) await save(store);
  return store;
}

export async function setSession(discordId: string, data: Omit<OtpSession, "createdAt" | "attempts">): Promise<void> {
  const store = await loadAndPurge();
  store[discordId] = { ...data, createdAt: Date.now(), attempts: 0 };
  await save(store);
}

export async function getSession(discordId: string): Promise<OtpSession | null> {
  const store = await loadAndPurge();
  return store[discordId] ?? null;
}

export async function deleteSession(discordId: string): Promise<void> {
  const store = await load();
  if (discordId in store) {
    delete store[discordId];
    await save(store);
  }
}

/** Incrémente le compteur de tentatives ; renvoie le compteur post-incrément. */
export async function incrementAttempt(discordId: string): Promise<number> {
  const store = await load();
  const s = store[discordId];
  if (!s) return 0;
  s.attempts += 1;
  await save(store);
  return s.attempts;
}
