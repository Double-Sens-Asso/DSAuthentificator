// deno-lint-ignore-file no-import-prefix
import "./_env.ts";
import { assert, assertEquals } from "jsr:@std/assert";
import { checkUserStatus } from "../src/services/verification.ts";

interface RawRecord {
  id: number;
  mail: string;
  IdDiscord?: string | null;
  cotisationValide?: boolean | string | number | unknown[];
}

/**
 * Stubbe `globalThis.fetch` pour répondre selon la colonne interrogée par NocoDB :
 * - URL contenant "IdDiscord" -> renvoie `byDiscord`
 * - URL contenant "mail"      -> renvoie `byEmail`
 *
 * Renvoie une fonction de restauration à appeler dans `finally`.
 */
function stubFetch(byDiscord: RawRecord | null, byEmail: RawRecord | null): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    let record: RawRecord | null = null;
    if (url.includes("IdDiscord")) record = byDiscord;
    else if (url.includes("mail")) record = byEmail;

    const body = record ? { list: [record] } : { list: [] };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return () => {
    globalThis.fetch = original;
  };
}

async function withStub(
  byDiscord: RawRecord | null,
  byEmail: RawRecord | null,
  fn: () => Promise<void>,
): Promise<void> {
  const restore = stubFetch(byDiscord, byEmail);
  try {
    await fn();
  } finally {
    restore();
  }
}

Deno.test("checkUserStatus - Discord déjà lié à un autre dossier", async () => {
  await withStub(
    { id: 1, mail: "other@x.com", IdDiscord: "user-1", cotisationValide: true },
    null,
    async () => {
      const r = await checkUserStatus("foo@bar.com", "user-1");
      assertEquals(r.valid, false);
      assert(r.message.toLowerCase().includes("déjà lié"));
    },
  );
});

Deno.test("checkUserStatus - email introuvable", async () => {
  await withStub(null, null, async () => {
    const r = await checkUserStatus("ghost@nope.com", "user-1");
    assertEquals(r.valid, false);
    assert(r.message.toLowerCase().includes("introuvable"));
  });
});

Deno.test("checkUserStatus - cotisation invalide", async () => {
  await withStub(
    null,
    { id: 1, mail: "foo@bar.com", IdDiscord: null, cotisationValide: false },
    async () => {
      const r = await checkUserStatus("foo@bar.com", "user-1");
      assertEquals(r.valid, false);
      assert(r.message.toLowerCase().includes("cotisation"));
    },
  );
});

Deno.test("checkUserStatus - email déjà lié à un autre Discord", async () => {
  await withStub(
    null,
    { id: 1, mail: "foo@bar.com", IdDiscord: "autre-user", cotisationValide: true },
    async () => {
      const r = await checkUserStatus("foo@bar.com", "user-1");
      assertEquals(r.valid, false);
      assert(r.message.toLowerCase().includes("déjà lié"));
    },
  );
});

Deno.test("checkUserStatus - déjà lié au même utilisateur (idempotent)", async () => {
  // Même record renvoyé pour les deux requêtes (Discord et email correspondent au même dossier)
  const record: RawRecord = { id: 1, mail: "foo@bar.com", IdDiscord: "user-1", cotisationValide: true };
  await withStub(record, record, async () => {
    const r = await checkUserStatus("foo@bar.com", "user-1");
    assertEquals(r.valid, false);
    assert(r.message.toLowerCase().includes("déjà"));
  });
});

Deno.test("checkUserStatus - cas valide -> renvoie le member", async () => {
  await withStub(
    null,
    { id: 42, mail: "foo@bar.com", IdDiscord: null, cotisationValide: true },
    async () => {
      const r = await checkUserStatus("foo@bar.com", "user-1");
      assertEquals(r.valid, true);
      assert(r.member !== undefined);
      assertEquals(r.member!.recordId, 42);
      assertEquals(r.member!.email, "foo@bar.com");
      assertEquals(r.member!.cotisationValide, true);
    },
  );
});

Deno.test("checkUserStatus - normalise l'email (trim + lower)", async () => {
  await withStub(
    null,
    { id: 7, mail: "foo@bar.com", IdDiscord: null, cotisationValide: true },
    async () => {
      const r = await checkUserStatus("  FOO@Bar.COM  ", "user-1");
      assertEquals(r.valid, true);
      assertEquals(r.member!.email, "foo@bar.com");
    },
  );
});
