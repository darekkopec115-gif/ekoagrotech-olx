const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');
const path = require('node:path');
const { installPanel } = require('./panel');

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.OLX_CLIENT_ID;
const CLIENT_SECRET = process.env.OLX_CLIENT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const REDIRECT_URI = process.env.OLX_REDIRECT_URI ||
  'https://ekoagrotech-olx.onrender.com/olx/callback';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ...(process.env.PGSSLMODE === 'disable' ? { ssl: false } : { ssl: { rejectUnauthorized: false } })
});

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;

  if (auth && auth.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(
        auth.slice(6),
        'base64'
      ).toString('utf8');

      const separator = decoded.indexOf(':');
      const username = decoded.slice(0, separator);
      const password = decoded.slice(separator + 1);

      const validPassword = ADMIN_PASSWORD && password.length <= 1024 && crypto.timingSafeEqual(
        crypto.createHash('sha256').update(password).digest(),
        crypto.createHash('sha256').update(ADMIN_PASSWORD).digest()
      );

      if (
        separator > 0 && username === 'admin' &&
        validPassword
      ) {
        return next();
      }
    } catch (err) {
      console.error('Błąd logowania administratora');
    }
  }

  res.set(
    'WWW-Authenticate',
    'Basic realm="EkoAgroTech OLX"'
  );

  return res.status(401).send(
    '<h1>Panel EkoAgroTech</h1><p>Wymagane logowanie.</p>'
  );
}

async function przygotujBaze() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS olx_tokens (
      id INTEGER PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS olx_oauth_state (
      id INTEGER PRIMARY KEY,
      state TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `);
}

async function zapiszState(state) {
  await pool.query(`
    INSERT INTO olx_oauth_state (id, state, created_at)
    VALUES (1, $1, $2)
    ON CONFLICT (id)
    DO UPDATE SET
      state = EXCLUDED.state,
      created_at = EXCLUDED.created_at
  `, [state, Date.now()]);
}

async function sprawdzState(state) {
  if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state)) return false;
  const result = await pool.query(
    'DELETE FROM olx_oauth_state WHERE id = 1 AND state = $1 AND created_at > $2 RETURNING id',
    [state, Date.now() - 10 * 60 * 1000]
  );
  return result.rows.length === 1;
}

async function zapiszTokeny(data, poprzedniRefreshToken = null) {
  const refresh =
    data.refresh_token || poprzedniRefreshToken;

  if (!data.access_token || !refresh) {
    throw new Error('Brak tokenu OLX');
  }

  const expiresAt =
    Date.now() + Number(data.expires_in || 86400) * 1000;

  await pool.query(`
    INSERT INTO olx_tokens
      (id, access_token, refresh_token, expires_at)
    VALUES (1, $1, $2, $3)
    ON CONFLICT (id)
    DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      expires_at = EXCLUDED.expires_at
  `, [
    data.access_token,
    refresh,
    expiresAt
  ]);
}

async function odczytajAccessToken(forceRefresh = false) {
  const result = await pool.query(
    'SELECT * FROM olx_tokens WHERE id = 1'
  );

  if (!result.rows.length) return null;

  const token = result.rows[0];

  if (!forceRefresh && Number(token.expires_at) > Date.now() + 60000) {
    return token.access_token;
  }

  const response = await fetch(
    'https://www.olx.pl/api/open/oauth/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: token.refresh_token
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error('Nie udało się odświeżyć tokenu OLX');
    return null;
  }

  await zapiszTokeny(data, token.refresh_token);

  return data.access_token;
}

let refreshInFlight;
async function pobierzAccessToken(forceRefresh = false) {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = odczytajAccessToken(forceRefresh);
  try { return await refreshInFlight; } finally { refreshInFlight = null; }
}

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https: http:; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  });
  next();
});
app.use(express.urlencoded({ extended: false, limit: '128kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.json({ status: 'ok' }));
installPanel(app, { requireAdmin, getToken: pobierzAccessToken, secret: ADMIN_PASSWORD || crypto.randomBytes(32).toString('hex') });

app.get('/olx/login', requireAdmin, async (req, res) => {
  try {
    const state = crypto.randomBytes(32).toString('hex');

    await zapiszState(state);

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      state,
      scope: 'read write v2',
      redirect_uri: REDIRECT_URI
    });

    res.redirect(
      'https://www.olx.pl/oauth/authorize?' +
      params.toString()
    );
  } catch (err) {
    console.error('Operacja OLX nie powiodła się.');
    res.status(500).send('Błąd rozpoczęcia połączenia z OLX.');
  }
});

app.get('/olx/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send(
      'OLX zwrócił błąd autoryzacji.'
    );
  }

  if (typeof code !== 'string' || typeof state !== 'string' || !code || !state) {
    return res.status(400).send(
      'Brak wymaganych danych z OLX.'
    );
  }

  try {
    const stateOK = await sprawdzState(state);

    if (!stateOK) {
      return res.status(400).send(
        'Nieprawidłowy lub wygasły kod bezpieczeństwa.'
      );
    }

    const response = await fetch(
      'https://www.olx.pl/api/open/oauth/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
          scope: 'v2 read write',
          redirect_uri: REDIRECT_URI
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Błąd pobierania tokenu OLX');
      return res.status(400).send(
        'Nie udało się połączyć konta OLX.'
      );
    }

    await zapiszTokeny(data);

    res.send(`
      <h1>Gotowe!</h1>
      <p>Konto OLX zostało połączone.</p>
      <p><a href="/">Przejdź do panelu</a></p>
    `);
  } catch (err) {
    console.error('Operacja OLX nie powiodła się.');
    res.status(500).send('Błąd połączenia z OLX.');
  }
});

app.use((err, req, res, next) => {
  res.status(err.type === 'entity.too.large' ? 413 : 500).send('Nie udało się obsłużyć żądania. Sprawdź rozmiar formularza i spróbuj ponownie.');
});

if (require.main === module) {
  if (!CLIENT_ID || !CLIENT_SECRET || !DATABASE_URL || !ADMIN_PASSWORD) {
    console.error('Wymagane zmienne: OLX_CLIENT_ID, OLX_CLIENT_SECRET, DATABASE_URL, ADMIN_PASSWORD.');
    process.exit(1);
  }
  przygotujBaze()
    .then(() => {
      const server = app.listen(PORT, '0.0.0.0', () => console.log(`Serwer EkoAgroTech działa na porcie ${PORT}`));
      process.on('SIGTERM', () => server.close(() => pool.end().finally(() => process.exit(0))));
    })
    .catch(() => { console.error('Błąd połączenia z bazą danych.'); process.exit(1); });
}

module.exports = { app, requireAdmin, pool };
