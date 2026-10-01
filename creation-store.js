// Persist submission outcomes so a restart or repeated POST cannot create another ad.
class PostgresCreationStore {
  constructor(pool) { this.pool = pool; }
  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS olx_create_requests (
      id UUID PRIMARY KEY, advert_id BIGINT, created_at BIGINT NOT NULL
    )`);
  }
  async get(id) {
    const result = await this.pool.query('SELECT advert_id FROM olx_create_requests WHERE id = $1', [id]);
    return result.rows[0] || null;
  }
  async claim(id) {
    const result = await this.pool.query('INSERT INTO olx_create_requests (id, created_at) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id', [id, Date.now()]);
    return result.rows.length === 1;
  }
  async complete(id, advertId) {
    await this.pool.query('UPDATE olx_create_requests SET advert_id = $2 WHERE id = $1', [id, advertId]);
  }
  async release(id) {
    await this.pool.query('DELETE FROM olx_create_requests WHERE id = $1 AND advert_id IS NULL', [id]);
  }
}

// Used only by route tests and isolated previews; production always supplies PostgreSQL.
class MemoryCreationStore {
  constructor() { this.rows = new Map(); }
  async get(id) { return this.rows.get(id) || null; }
  async claim(id) { if (this.rows.has(id)) return false; this.rows.set(id, { advert_id: null }); return true; }
  async complete(id, advertId) { this.rows.set(id, { advert_id: String(advertId) }); }
  async release(id) { if (!this.rows.get(id)?.advert_id) this.rows.delete(id); }
}
module.exports = { PostgresCreationStore, MemoryCreationStore };
