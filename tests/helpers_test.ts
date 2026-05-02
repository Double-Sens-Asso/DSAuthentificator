// deno-lint-ignore-file no-import-prefix
import "./_env.ts";
import { assert, assertEquals, assertMatch } from "jsr:@std/assert";
import { generateOtp, sleep } from "../helpers.ts";

Deno.test("generateOtp - retourne 6 chiffres en string", () => {
  for (let i = 0; i < 100; i++) {
    const otp = generateOtp();
    assertEquals(typeof otp, "string");
    assertEquals(otp.length, 6);
    assertMatch(otp, /^\d{6}$/);
  }
});

Deno.test("generateOtp - reste dans la plage [100000, 999999]", () => {
  for (let i = 0; i < 1000; i++) {
    const n = Number(generateOtp());
    assert(n >= 100000 && n <= 999999, `Hors borne : ${n}`);
  }
});

Deno.test("generateOtp - produit des valeurs variées", () => {
  const set = new Set<string>();
  for (let i = 0; i < 50; i++) set.add(generateOtp());
  // Probabilité d'avoir < 30 valeurs distinctes sur 50 tirages dans 900k : négligeable
  assert(set.size > 30, `Trop peu de valeurs distinctes : ${set.size}`);
});

Deno.test("sleep - attend approximativement la durée demandée", async () => {
  const start = Date.now();
  await sleep(50);
  const elapsed = Date.now() - start;
  assert(elapsed >= 45, `Trop court : ${elapsed}ms`);
  assert(elapsed < 500, `Trop long : ${elapsed}ms`);
});
