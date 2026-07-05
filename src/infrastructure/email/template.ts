// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { join } from "jsr:@std/path";
import { ASSETS_DIR } from "../../config/paths.ts";

const TEMPLATE_PATH = join(ASSETS_DIR, "verification-email.html");

const TEMPLATE = await Deno.readTextFile(TEMPLATE_PATH).catch((e) => {
  console.error(`⚠️ Impossible de charger ${TEMPLATE_PATH} :`, e);
  return "Code: {{code}} (valable {{ttl_minutes}} min)";
});

/** Injecte le code OTP et la durée de validité dans le template HTML. */
export function renderEmail(code: string, ttlMinutes: number): string {
  return TEMPLATE.replaceAll("{{code}}", code).replaceAll("{{ttl_minutes}}", String(ttlMinutes));
}
