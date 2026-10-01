const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.OLX_CLIENT_ID;
const CLIENT_SECRET = process.env.OLX_CLIENT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const REDIRECT_URI =
  'https://ekoagrotech-olx.onrender.com/olx/callback';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

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

      if (
        username === 'admin' &&
        ADMIN_PASSWORD &&
        password === ADMIN_PASSWORD
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
  const result = await pool.query(
    'SELECT state, created_at FROM olx_oauth_state WHERE id = 1'
  );

  if (!result.rows.length) return false;

  const saved = result.rows[0];

  if (Date.now() - Number(saved.created_at) > 10 * 60 * 1000) {
    return false;
  }

  return saved.state === state;
}

async function usunState() {
  await pool.query(
    'DELETE FROM olx_oauth_state WHERE id = 1'
  );
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

async function pobierzAccessToken() {
  const result = await pool.query(
    'SELECT * FROM olx_tokens WHERE id = 1'
  );

  if (!result.rows.length) return null;

  const token = result.rows[0];

  if (Number(token.expires_at) > Date.now() + 60000) {
    return token.access_token;
  }

  const response = await fetch(
    'https://www.olx.pl/api/open/oauth/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
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

app.get('/', requireAdmin, (req, res) => {
  res.send(`
    <h1>EkoAgroTech OLX</h1>
    <p>Panel jest zabezpieczony hasłem.</p>
    <p><a href="/olx/login">Połącz konto OLX</a></p>
    <p><a href="/olx/ogloszenia">Pokaż moje ogłoszenia OLX</a></p>
  `);
});

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
    console.error(err);
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

  if (!code || !state) {
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

    await usunState();

    const response = await fetch(
      'https://www.olx.pl/api/open/oauth/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
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
    console.error(err);
    res.status(500).send('Błąd połączenia z OLX.');
  }
});

app.get('/olx/ogloszenia', requireAdmin, async (req, res) => {
  try {
    const accessToken = await pobierzAccessToken();

    if (!accessToken) {
      return res.send(`
        <h1>Brak aktywnego połączenia z OLX</h1>
        <p><a href="/olx/login">Połącz konto OLX</a></p>
      `);
    }

    const response = await fetch(
      'https://www.olx.pl/api/partner/adverts',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: '2.0',
          Accept: 'application/json'
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Błąd pobierania ogłoszeń OLX');
      return res.status(400).send(
        'Nie udało się pobrać ogłoszeń OLX.'
      );
    }

    const adverts = data.data || [];

    const lista = adverts.map(ad => `
      <div style="
        border:1px solid #ddd;
        padding:15px;
        margin-bottom:12px;
        border-radius:8px;
      ">
        <h2>${escapeHtml(ad.title)}</h2>
        <p>Status: ${escapeHtml(ad.status)}</p>
        <a
          href="${escapeHtml(ad.url)}"
          target="_blank"
          rel="noopener noreferrer"
        >
          Otwórz ogłoszenie
        </a>
        <br><br>
<a href="/olx/edytuj/${encodeURIComponent(ad.id)}">Edytuj</a>
      </div>
    `).join('');

    res.send(`
      <!doctype html>
      <html lang="pl">
      <head>
        <meta charset="utf-8">
        <meta name="viewport"
              content="width=device-width, initial-scale=1">
        <title>EkoAgroTech OLX</title>
      </head>
      <body style="
        font-family:Arial,sans-serif;
        max-width:900px;
        margin:30px auto;
        padding:15px;
      ">
        <h1>Ogłoszenia EkoAgroTech</h1>
        <p>Znaleziono: ${adverts.length}</p>
        ${lista || '<p>Brak ogłoszeń.</p>'}
      </body>
      </html>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send(
      'Błąd podczas pobierania ogłoszeń.'
    );
  }
});

przygotujBaze()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(
        `Serwer EkoAgroTech działa na porcie ${PORT}`
      );
    });
  })
  .catch(err => {
    console.error('Błąd połączenia z bazą:', err);
    process.exit(1);
  });
