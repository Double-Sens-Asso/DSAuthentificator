import { CONFIG } from "../../config/config.ts";
import { debug } from "../../shared/utils.ts";

/**
 * Wrapper générique pour fetch vers l'API NocoDB.
 * Gère l'authentification via token et la robustesse des erreurs (HTML vs JSON).
 */
export async function nocoFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${CONFIG.NOCODB_BASE_URL}${path}`;
  debug(`NocoDB ${options.method ?? "GET"} ${url}`);

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
    console.error(`📄 Réponse serveur : ${text.slice(0, 300)}...`);
    throw new Error(`Erreur NocoDB [${res.status}]`);
  }

  try {
    return JSON.parse(text) as T;
  } catch (_e) {
    console.error("❌ Erreur JSON. Le serveur a renvoyé du HTML ou du texte brut :");
    console.error(text.slice(0, 500));
    throw new Error("Réponse invalide (Pas de JSON)");
  }
}
