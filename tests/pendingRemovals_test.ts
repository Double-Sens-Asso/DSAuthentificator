// deno-lint-ignore-file no-import-prefix
import "./_env.ts";
import { assert, assertEquals } from "jsr:@std/assert";
import {
  clearPending,
  findPendingByEmail,
  getAllPending,
  getPending,
  setPending,
} from "../pendingRemovals.ts";

const STORE_PATH = new URL("../pending_removals.json", import.meta.url).pathname;

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

Deno.test("setPending + getPending - round-trip", async () => {
  await withCleanStore(async () => {
    await setPending("u1", { firstDetectedAt: 100, email: "a@b.c", reminded: false });
    const p = await getPending("u1");
    assertEquals(p, { firstDetectedAt: 100, email: "a@b.c", reminded: false });
  });
});

Deno.test("getPending - inconnu -> null", async () => {
  await withCleanStore(async () => {
    assertEquals(await getPending("ghost"), null);
  });
});

Deno.test("clearPending - supprime l'entrée", async () => {
  await withCleanStore(async () => {
    await setPending("u1", { firstDetectedAt: 100, email: "a@b.c", reminded: false });
    await clearPending("u1");
    assertEquals(await getPending("u1"), null);
  });
});

Deno.test("clearPending - inexistant : ne lève pas", async () => {
  await withCleanStore(async () => {
    await clearPending("ghost");
    assertEquals(await getPending("ghost"), null);
  });
});

Deno.test("setPending - écrase l'entrée existante", async () => {
  await withCleanStore(async () => {
    await setPending("u1", { firstDetectedAt: 100, email: "a@b.c", reminded: false });
    await setPending("u1", { firstDetectedAt: 100, email: "a@b.c", reminded: true });
    assertEquals((await getPending("u1"))!.reminded, true);
  });
});

Deno.test("getAllPending - trie par firstDetectedAt croissant", async () => {
  await withCleanStore(async () => {
    await setPending("c", { firstDetectedAt: 300, email: "c@x", reminded: false });
    await setPending("a", { firstDetectedAt: 100, email: "a@x", reminded: false });
    await setPending("b", { firstDetectedAt: 200, email: "b@x", reminded: false });

    const all = await getAllPending();
    assertEquals(all.map((p) => p.discordId), ["a", "b", "c"]);
    assertEquals(all.map((p) => p.firstDetectedAt), [100, 200, 300]);
  });
});

Deno.test("getAllPending - vide -> tableau vide", async () => {
  await withCleanStore(async () => {
    assertEquals(await getAllPending(), []);
  });
});

Deno.test("findPendingByEmail - trouve insensible à la casse", async () => {
  await withCleanStore(async () => {
    await setPending("u1", { firstDetectedAt: 100, email: "Foo@Bar.Com", reminded: false });

    const found = await findPendingByEmail("foo@bar.com");
    assert(found !== null);
    assertEquals(found!.discordId, "u1");

    const upper = await findPendingByEmail("FOO@BAR.COM");
    assertEquals(upper?.discordId, "u1");
  });
});

Deno.test("findPendingByEmail - trim", async () => {
  await withCleanStore(async () => {
    await setPending("u1", { firstDetectedAt: 100, email: "a@b.c", reminded: false });
    const found = await findPendingByEmail("  a@b.c  ");
    assertEquals(found?.discordId, "u1");
  });
});

Deno.test("findPendingByEmail - introuvable -> null", async () => {
  await withCleanStore(async () => {
    await setPending("u1", { firstDetectedAt: 100, email: "a@b.c", reminded: false });
    assertEquals(await findPendingByEmail("z@z.z"), null);
  });
});

Deno.test("Persistance - les entrées survivent à un re-load", async () => {
  await withCleanStore(async () => {
    await setPending("u1", { firstDetectedAt: 100, email: "a@b.c", reminded: false });
    // Chaque appel relit le fichier (chaque getPending refait un load) -> simule un redémarrage.
    assertEquals((await getPending("u1"))?.email, "a@b.c");
  });
});
