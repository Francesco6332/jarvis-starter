import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class JsonStore<T> {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private file: string, private initial: () => T) {}
  async read(): Promise<T> {
    await this.queue;
    return this.load();
  }
  private async load(): Promise<T> {
    try { return JSON.parse(await fs.readFile(this.file, 'utf8')) as T; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.initial(); throw error; }
  }
  update(change: (value: T) => T | Promise<T>): Promise<T> {
    const operation = this.queue.then(async () => {
      const next = await change(await this.load());
      await fs.mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
        await fs.rename(temp, this.file);
      } finally { await fs.rm(temp, { force: true }); }
      return next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
