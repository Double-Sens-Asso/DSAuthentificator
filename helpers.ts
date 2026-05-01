import { CONFIG } from "./config.ts";

/** Pause asynchrone (anti-spam API). */
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Log conditionnel (activé via DEBUG=true dans le .env). */
export function debug(...args: unknown[]) {
  if (CONFIG.DEBUG) console.log("🔍 [DEBUG]", ...args);
}

/**
 * Génère un code OTP à 6 chiffres avec une source d'aléa cryptographique.
 * Évite la prédictibilité de Math.random().
 */
export function generateOtp(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const n = 100000 + (buf[0] % 900000);
  return n.toString();
}
