const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.OLX_CLIENT_ID;
const CLIENT_SECRET = process.env.OLX_CLIENT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

const REDIRECT_URI =
  'https://ekoagrotech-olx.onrender.com/olx/callback';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let oauthState = null;

async function przygotujBaze() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS olx_tokens (
      id INTEGER PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    )
  `);
}

async function zapiszTokeny(data) {
  const expiresAt =
    Date.now() + (Number(data.expires_in || 86400) * 1000);

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
    data.refresh_token,
    expiresAt
  ]);
}

async function pobierzToken() {
  const result = await pool.query(
    'SELECT * FROM olx_tokens WHERE id = 1'
  );

  if (!result.rows.length) return null;

  let token = result.rows[0];

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
    console.error('Błąd odświeżania tokenu OLX');
    return null;
  }

  await zapiszTokeny(data);
  return data.access_token;
}

app.get('/', (req, res) => {
  res.send(`
    <h1>EkoAgroTech OLX</h1>
    <p><a href="/olx/login">Połącz konto OLX</a></p>
    <p><a href="/olx/ogloszenia">Pokaż moje ogłoszenia OLX</a></p>
  `);
});

app.get('/olx/login', (req, res) => {
  oauthState = crypto.randomBytes(24).toString('hex');

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    state: oauthState,
    scope: 'read write v2',
    redirect_uri: REDIRECT_URI
  });

  res.redirect(
    'https://www.olx.pl/oauth/authorize?' + params.toString()
  );
});

app.get('/olx/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send('OLX zwrócił błąd autoryzacji.');
  }

  if (!code) {
    return res.status(400).send('Brak kodu OLX.');
  }

  if (!state || state !== oauthState) {
    return res.status(400).send(
      'Nieprawidłowy kod bezpieczeństwa state. Wróć na stronę główną i kliknij ponownie Połącz konto OLX.'
    );
  }

  try {
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
      console.error('Błąd autoryzacji OLX');
      return res.status(400).send(
        'Nie udało się pobrać tokenu OLX.'
      );
    }

    await zapiszTokeny(data);

    res.send(`
      <h1>Gotowe!</h1>
      <p>Konto OLX zostało połączone.</p>
      <p>Token został zapisany w bazie danych.</p>
      <p><a href="/olx/ogloszenia">Pokaż moje ogłoszenia</a></p>
    `);

  } catch (err) {
    console.error(err);
    res.status(500).send('Błąd połączenia z OLX.');
  }
});

app.get('/olx/ogloszenia', async (req, res) => {
  try {
    const accessToken = await pobierzToken();

    if (!accessToken) {
      return res.send(`
        <h1>Brak połączenia z OLX</h1>
        <a href="/olx/login">Połącz konto OLX</a>
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
        'Nie udało się pobrać ogłoszeń.'
      );
    }

    const adverts = data.data || [];

    const lista = adverts.map(ad => `
      <div style="margin-bottom:20px">
        <h2>${ad.title}</h2>
        <p>Status: ${ad.status}</p>
        <a href="${ad.url}" target="_blank">
          Otwórz ogłoszenie
        </a>
      </div>
    `).join('');

    res.send(`
      <h1>Ogłoszenia EkoAgroTech</h1>
      <p>Znaleziono: ${adverts.length}</p>
      ${lista || '<p>Brak ogłoszeń.</p>'}
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

👉 Tylko wklej kod. Na razie
