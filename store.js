import { DatabaseSync } from 'node:sqlite';

export let store;

export function openStore(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS objects (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS objects_updated ON objects(updated);
    DELETE FROM objects WHERE key GLOB 'locks/*';
  `);
  const read = db.prepare('SELECT data FROM objects WHERE key = ?');
  const insert = db.prepare('INSERT INTO objects VALUES (?, ?, ?)');
  const upsert = db.prepare(`
    INSERT INTO objects VALUES (?, ?, ?) ON CONFLICT(key)
    DO UPDATE SET data = excluded.data, updated = excluded.updated
  `);
  const remove = db.prepare('DELETE FROM objects WHERE key = ?');
  const list = db.prepare('SELECT key, key AS etag FROM objects WHERE key GLOB ? ORDER BY key');
  const expire = db.prepare('DELETE FROM objects WHERE updated < ?');
  let tail = Promise.resolve();

  store = {
    async get(key, { type } = {}) {
      const value = read.get(key)?.data;
      return value === undefined ? null : type === 'json' ? JSON.parse(value) : value;
    },
    async setJSON(key, value, { onlyIfNew = false } = {}) {
      (onlyIfNew ? insert : upsert).run(key, JSON.stringify(value), Date.now());
    },
    async delete(key) { remove.run(key); },
    async list({ prefix = '' } = {}) { return { blobs: list.all(prefix + '*') }; },
  };

  function transaction(run) {
    const result = tail.then(async () => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const response = await run();
        db.exec('COMMIT');
        return response;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    });
    tail = result.catch(() => {});
    return result;
  }

  const cleanup = () => transaction(() => expire.run(Date.now() - 7 * 86_400_000));
  const maintain = () => cleanup().catch(error => console.error('Room cleanup:', error));
  void maintain();
  setInterval(maintain, 60 * 60_000).unref();
  return transaction;
}
