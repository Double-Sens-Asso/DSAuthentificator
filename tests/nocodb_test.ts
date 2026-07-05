// deno-lint-ignore-file no-import-prefix
import "./_env.ts";
import { assertEquals } from "jsr:@std/assert";
import { cleanRecord } from "../src/infrastructure/nocodb/members.repo.ts";

Deno.test("cleanRecord - record basique avec id et booléen true", () => {
  const r = cleanRecord({ id: 1, mail: "Foo@Example.COM", IdDiscord: "123", cotisationValide: true });
  assertEquals(r, { recordId: 1, email: "foo@example.com", discordId: "123", cotisationValide: true });
});

Deno.test("cleanRecord - accepte les variantes d'id (Id, _id)", () => {
  assertEquals(cleanRecord({ Id: 7, mail: "a@b.c" })?.recordId, 7);
  assertEquals(cleanRecord({ _id: 9, mail: "a@b.c" })?.recordId, 9);
});

Deno.test("cleanRecord - retourne null si pas d'id", () => {
  assertEquals(cleanRecord({ mail: "a@b.c", cotisationValide: true }), null);
});

Deno.test("cleanRecord - cotisation invalide par défaut", () => {
  const r = cleanRecord({ id: 1, mail: "a@b.c" });
  assertEquals(r?.cotisationValide, false);
});

Deno.test("cleanRecord - reconnaît plusieurs représentations de 'true'", () => {
  for (const truthy of [true, "true", 1, "1"]) {
    const r = cleanRecord({ id: 1, mail: "a@b.c", cotisationValide: truthy });
    assertEquals(r?.cotisationValide, true, `Echoue pour ${JSON.stringify(truthy)}`);
  }
});

Deno.test("cleanRecord - rejette les valeurs falsy", () => {
  for (const falsy of [false, "false", 0, "0", null, undefined, ""]) {
    const r = cleanRecord({ id: 1, mail: "a@b.c", cotisationValide: falsy });
    assertEquals(r?.cotisationValide, false, `Echoue pour ${JSON.stringify(falsy)}`);
  }
});

Deno.test("cleanRecord - gère les colonnes lookup (tableau)", () => {
  assertEquals(cleanRecord({ id: 1, mail: "a@b.c", cotisationValide: [1] })?.cotisationValide, true);
  assertEquals(cleanRecord({ id: 1, mail: "a@b.c", cotisationValide: [true] })?.cotisationValide, true);
  assertEquals(cleanRecord({ id: 1, mail: "a@b.c", cotisationValide: [0] })?.cotisationValide, false);
  assertEquals(cleanRecord({ id: 1, mail: "a@b.c", cotisationValide: [] })?.cotisationValide, false);
});

Deno.test("cleanRecord - déballe le wrapper 'fields' de NocoDB", () => {
  const r = cleanRecord({ id: 1, fields: { mail: "X@Y.Z", IdDiscord: "42", cotisationValide: true } });
  assertEquals(r, { recordId: 1, email: "x@y.z", discordId: "42", cotisationValide: true });
});

Deno.test("cleanRecord - normalise email (trim + lowercase)", () => {
  const r = cleanRecord({ id: 1, mail: "  HELLO@WORLD.fr  " });
  assertEquals(r?.email, "hello@world.fr");
});

Deno.test("cleanRecord - email manquant -> chaîne vide", () => {
  const r = cleanRecord({ id: 1 });
  assertEquals(r?.email, "");
});

Deno.test("cleanRecord - discordId null si absent ou vide", () => {
  assertEquals(cleanRecord({ id: 1, mail: "a@b.c" })?.discordId, null);
  assertEquals(cleanRecord({ id: 1, mail: "a@b.c", IdDiscord: "" })?.discordId, null);
});

Deno.test("cleanRecord - convertit discordId numérique en string", () => {
  const r = cleanRecord({ id: 1, mail: "a@b.c", IdDiscord: 1234567890 });
  assertEquals(r?.discordId, "1234567890");
});
