import { mkdir, open, readFile, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

// One process owns the data file. Serialize atomic writes and keep command
// receipts so reconnecting does not award or transfer credits twice.
export class CommunityStore {
  constructor(filename) {
    this.filename = filename;
    this.queue = Promise.resolve();
    this.state = { version: 1, servers: {}, receipts: {} };
    this.closing = false;
  }
  async open() {
    await mkdir(path.dirname(this.filename), { recursive: true });
    const lock = this.filename + ".lock";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        this.lock = await open(lock, "wx", 0o600);
        await this.lock.writeFile(String(process.pid));
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const pid = Number(await readFile(lock, "utf8"));
        if (!Number.isSafeInteger(pid) || pid < 1) throw Error("The bot data lock is invalid. Check " + lock + ".");
        try { process.kill(pid, 0); }
        catch (probe) {
          if (probe.code === "ESRCH" && attempt === 0) {
            await unlink(lock).catch((e) => { if (e.code !== "ENOENT") throw e; });
            continue;
          }
        }
        throw Error("Another bot process is using this data folder. Close its console before starting again.");
      }
    }
    try {
      const state = JSON.parse(await readFile(this.filename, "utf8"));
      if (state.version !== 1 || !state.servers || !state.receipts) throw Error("Invalid bot data file. Restore its backup instead of resetting balances.");
      this.state = state;
    } catch (error) {
      if (error.code !== "ENOENT") { await this.close(); throw error; }
    }
    return this;
  }
  transact(id, operation) {
    if (this.closing) return Promise.reject(Error("The bot is stopping."));
    const work = this.queue.then(async () => {
      if (Object.hasOwn(this.state.receipts, id)) return this.state.receipts[id].reply;
      const next = structuredClone(this.state), now = Date.now();
      const reply = operation(next);
      next.receipts[id] = { reply, at: now };
      next.receipts = Object.fromEntries(Object.entries(next.receipts).filter(([, r]) => r.at > now - 86400000).slice(-10000));
      await writeFile(this.filename + ".tmp", JSON.stringify(next), { mode: 0o600 });
      await rename(this.filename + ".tmp", this.filename);
      this.state = next;
      return reply;
    });
    this.queue = work.catch(() => {});
    return work;
  }
  async read(operation) { await this.queue; return operation(this.state); }
  close() {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    return this.closePromise = (async () => {
      await this.queue;
      if (this.lock) {
        await this.lock.close();
        await unlink(this.filename + ".lock");
        this.lock = null;
      }
    })();
  }
}
