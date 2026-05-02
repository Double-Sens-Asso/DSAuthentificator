// deno-lint-ignore-file no-import-prefix
import "./_env.ts";
import { assert, assertEquals } from "jsr:@std/assert";
import { CONFIG } from "../config.ts";
import {
  deleteSession,
  getSession,
  incrementAttempt,
  type OtpSession,
  setSession,
} from "../sessions.ts";

/**
 * Le module persiste sur `<projet>/otp_sessions.json`. On ne peut pas rediriger
 * ce chemin depuis l'extérieur, donc on travaille sur le fichier réel en
 * sauvegardant son contenu avant chaque test pour le restaurer ensuite.
 */
const STORE_PATH = new URL("../otp_sessions.json", import.meta.url).pathname;

async function readMaybe(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}

async function removeMaybe(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
}

/** Exécute `fn` avec un store vide, restaure l'éventuel contenu existant après. */
async function withCleanStore<T>(fn: () => Promise<T>): Promise<T> {
  const backup = await readMaybe(STORE_PATH);
  await removeMaybe(STORE_PATH);
  try {
    return await fn();
  } finally {
    if (backup !== null) await Deno.writeTextFile(STORE_PATH, backup);
    else await removeMaybe(STORE_PATH);
  }
}

Deno.test("setSession + getSession - round-trip", async () => {
  await withCleanStore(async () => {
    await setSession("user-1", { code: "123456", email: "a@b.c", recordId: 42 });
    const s = await getSession("user-1");
    assert(s !== null);
    assertEquals(s!.code, "123456");
    assertEquals(s!.email, "a@b.c");
    assertEquals(s!.recordId, 42);
    assertEquals(s!.attempts, 0);
    assert(typeof s!.createdAt === "number" && s!.createdAt > 0);
  });
});

Deno.test("getSession - inconnu -> null", async () => {
  await withCleanStore(async () => {
    assertEquals(await getSession("inexistant"), null);
  });
});

Deno.test("deleteSession - supprime bien", async () => {
  await withCleanStore(async () => {
    await setSession("u", { code: "111111", email: "x@y.z", recordId: 1 });
    await deleteSession("u");
    assertEquals(await getSession("u"), null);
  });
});

Deno.test("incrementAttempt - incrémente et persiste", async () => {
  await withCleanStore(async () => {
    await setSession("u", { code: "111111", email: "x@y.z", recordId: 1 });
    assertEquals(await incrementAttempt("u"), 1);
    assertEquals(await incrementAttempt("u"), 2);
    assertEquals((await getSession("u"))!.attempts, 2);
  });
});

Deno.test("incrementAttempt - utilisateur inconnu -> 0", async () => {
  await withCleanStore(async () => {
    assertEquals(await incrementAttempt("ghost"), 0);
  });
});

Deno.test("getSession - purge les sessions expirées via TTL", async () => {
  await withCleanStore(async () => {
    await setSession("u", { code: "111111", email: "x@y.z", recordId: 1 });

    // On antidate `createdAt` au-delà du TTL pour simuler une expiration.
    const raw = JSON.parse(await Deno.readTextFile(STORE_PATH)) as Record<string, OtpSession>;
    raw["u"].createdAt = Date.now() - (CONFIG.OTP_TTL_SECONDS + 60) * 1000;
    await Deno.writeTextFile(STORE_PATH, JSON.stringify(raw));

    assertEquals(await getSession("u"), null);

    // L'entrée expirée doit aussi avoir été retirée du fichier.
    const after = JSON.parse(await Deno.readTextFile(STORE_PATH)) as Record<string, OtpSession>;
    assertEquals(after["u"], undefined);
  });
});

Deno.test("Sessions multiples - isolées par discordId", async () => {
  await withCleanStore(async () => {
    await setSession("a", { code: "111111", email: "a@x", recordId: 1 });
    await setSession("b", { code: "222222", email: "b@x", recordId: 2 });
    assertEquals((await getSession("a"))!.code, "111111");
    assertEquals((await getSession("b"))!.code, "222222");

    await deleteSession("a");
    assertEquals(await getSession("a"), null);
    assert((await getSession("b")) !== null);
  });
});

Deno.test("setSession - écrase la session précédente (reset des tentatives)", async () => {
  await withCleanStore(async () => {
    await setSession("u", { code: "111111", email: "x@y.z", recordId: 1 });
    await incrementAttempt("u");
    await incrementAttempt("u");
    assertEquals((await getSession("u"))!.attempts, 2);

    await setSession("u", { code: "222222", email: "x@y.z", recordId: 1 });
    const s = await getSession("u");
    assertEquals(s!.code, "222222");
    assertEquals(s!.attempts, 0);
  });
});
