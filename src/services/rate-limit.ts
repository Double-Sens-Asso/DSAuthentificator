/**
 * Rate-limit en mémoire à fenêtre glissante.
 * Suffisant pour un bot mono-process. Ne survit pas au redémarrage,
 * ce qui est acceptable (au pire, on offre une fenêtre supplémentaire à un attaquant).
 */

interface Bucket {
  hits: number[]; // timestamps (ms)
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  /** Secondes avant la prochaine tentative autorisée (si bloqué). */
  retryAfter: number;
  /** Nombre d'appels restants dans la fenêtre courante. */
  remaining: number;
}

export function checkRateLimit(key: string, max: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const bucket = buckets.get(key) ?? { hits: [] };

  // Purge des hits hors fenêtre
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= max) {
    const oldest = bucket.hits[0];
    const retryAfter = Math.ceil((windowMs - (now - oldest)) / 1000);
    buckets.set(key, bucket);
    return { allowed: false, retryAfter, remaining: 0 };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { allowed: true, retryAfter: 0, remaining: max - bucket.hits.length };
}
