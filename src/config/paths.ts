// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { join } from "jsr:@std/path";

/**
 * Chemins résolus depuis le répertoire de travail (racine du projet).
 *
 * Le bot est toujours lancé depuis la racine (voir `deno task start` et le
 * `WORKDIR /app` du Dockerfile). On s'appuie donc sur `Deno.cwd()` plutôt que
 * sur `import.meta.url`, dont le `.pathname` produit des chemins invalides sous
 * Windows (ex. `/C:/Users/...`).
 */
export const ROOT_DIR = Deno.cwd();

/** Fichiers de données runtime (sessions OTP, retraits en attente). */
export const DATA_DIR = join(ROOT_DIR, "data");

/** Ressources statiques (logo, template e-mail). */
export const ASSETS_DIR = join(ROOT_DIR, "assets");
