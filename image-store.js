const crypto = require('node:crypto');

class PostgresImageStore {
  constructor(pool) { this.pool = pool; }
  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS olx_uploaded_images (
        id TEXT PRIMARY KEY,
        mime_type TEXT NOT NULL,
        data BYTEA NOT NULL,
        created_at BIGINT NOT NULL
      )
    `);
    await this.pool.query('DELETE FROM olx_uploaded_images WHERE created_at < $1', [Date.now() - 14 * 24 * 60 * 60 * 1000]);
  }
  async save(file) {
    const id = crypto.randomBytes(24).toString('hex');
    await this.pool.query(
      'INSERT INTO olx_uploaded_images (id, mime_type, data, created_at) VALUES ($1, $2, $3, $4)',
      [id, file.mimetype, file.buffer, Date.now()]
    );
    return id;
  }
  async get(id) {
    if (!/^[a-f0-9]{48}$/.test(id)) return null;
    const result = await this.pool.query('SELECT mime_type, data FROM olx_uploaded_images WHERE id = $1', [id]);
    return result.rows[0] || null;
  }
}
module.exports = { PostgresImageStore };
