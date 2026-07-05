// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { ensureDir } from "jsr:@std/fs";
import { dirname } from "jsr:@std/path";

/**
 * Conteneur JSON sur disque, écriture atomique (tmp+rename) et opérations sérialisées.
 */
export class JsonStore<T extends object> {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string, private readonly empty: () => T) {}

  private async _load(): Promise<T> {
    try {
      const text = await Deno.readTextFile(this.path);
      return JSON.parse(text) as T;
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return this.empty();
      console.error(`⚠️ Lecture ${this.path} échouée :`, e);
      return this.empty();
    }
  }

  private async _save(data: T): Promise<void> {
    await ensureDir(dirname(this.path));
    const tmp = `${this.path}.tmp`;
    await Deno.writeTextFile(tmp, JSON.stringify(data, null, 2));
    await Deno.rename(tmp, this.path);
  }

  transaction<R>(fn: (data: T, save: (d: T) => Promise<void>) => Promise<R> | R): Promise<R> {
    const next = this.chain.then(async () => {
      const data = await this._load();
      return await fn(data, (d: T) => this._save(d));
    });
    this.chain = next.catch(() => {});
    return next as Promise<R>;
  }

  read<R>(fn: (data: Readonly<T>) => Promise<R> | R): Promise<R> {
    return this.transaction((data) => fn(data));
  }
}
