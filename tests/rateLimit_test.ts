// deno-lint-ignore-file no-import-prefix
import "./_env.ts";
import { assert, assertEquals } from "jsr:@std/assert";
import { checkRateLimit } from "../src/services/rate-limit.ts";

// Chaque test utilise une clé unique pour ne pas polluer le bucket des autres.
const k = (suffix: string) => `test-${suffix}-${crypto.randomUUID()}`;

Deno.test("checkRateLimit - autorise jusqu'à `max` appels", () => {
  const key = k("basic");
  for (let i = 0; i < 3; i++) {
    const r = checkRateLimit(key, 3, 60);
    assertEquals(r.allowed, true);
    assertEquals(r.remaining, 3 - i - 1);
  }
});

Deno.test("checkRateLimit - bloque le (max+1)e appel", () => {
  const key = k("block");
  for (let i = 0; i < 5; i++) checkRateLimit(key, 5, 60);

  const blocked = checkRateLimit(key, 5, 60);
  assertEquals(blocked.allowed, false);
  assertEquals(blocked.remaining, 0);
  assert(blocked.retryAfter > 0 && blocked.retryAfter <= 60);
});

Deno.test("checkRateLimit - clés indépendantes", () => {
  const a = k("iso-a");
  const b = k("iso-b");

  for (let i = 0; i < 5; i++) checkRateLimit(a, 5, 60);
  assertEquals(checkRateLimit(a, 5, 60).allowed, false);
  assertEquals(checkRateLimit(b, 5, 60).allowed, true);
});

Deno.test("checkRateLimit - libère la fenêtre après expiration", async () => {
  const key = k("expire");
  // Fenêtre de 1 seconde
  checkRateLimit(key, 1, 1);
  assertEquals(checkRateLimit(key, 1, 1).allowed, false);

  await new Promise((r) => setTimeout(r, 1100));
  assertEquals(checkRateLimit(key, 1, 1).allowed, true);
});
