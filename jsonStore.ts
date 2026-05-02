/**
 * Petit conteneur JSON sur disque avec :
 * - écriture atomique (write to *.tmp + rename) → pas de fichier corrompu en cas de kill
 * - sérialisation des opérations (toutes les transactions s'enchaînent) → pas de race condition
 *
 * Usage typique :
 *
 *     const store = new JsonStore<MyShape>("./data.json");
 *     await store.transaction(async (data, save) => {
 *       data.foo = 42;
 *       await save(data);
 *     });
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
    const tmp = `${this.path}.tmp`;
    await Deno.writeTextFile(tmp, JSON.stringify(data, null, 2));
    await Deno.rename(tmp, this.path);
  }

  /**
   * Exécute `fn` de manière sérialisée : si une autre transaction est en cours,
   * la nouvelle attend la fin de la précédente. Les erreurs ne brisent pas la chaîne.
   */
  transaction<R>(fn: (data: T, save: (d: T) => Promise<void>) => Promise<R> | R): Promise<R> {
    const next = this.chain.then(async () => {
      const data = await this._load();
      return await fn(data, (d: T) => this._save(d));
    });
    // On garde la chaîne vivante même si une transaction lève
    this.chain = next.catch(() => {});
    return next as Promise<R>;
  }

  /** Lecture seule, sans modifier le store. Toujours sérialisée. */
  read<R>(fn: (data: Readonly<T>) => Promise<R> | R): Promise<R> {
    return this.transaction((data) => fn(data));
  }
}
