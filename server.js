const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.OLX_CLIENT_ID;
const CLIENT_SECRET = process.env.OLX_CLIENT_SECRET;

const REDIRECT_URI =
  'https://ekoagrotech-olx.onrender.com/olx/callback';

let oauthState = null;
let accessToken = null;
let refreshToken = null;

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
    return res.status(400).send('Nieprawidłowy kod bezpieczeństwa state.');
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
          code: code,
          scope: 'v2 read write',
          redirect_uri: REDIRECT_URI
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Błąd OLX:', data);
      return res.status(400).send('Nie udało się pobrać tokenu OLX.');
    }

    accessToken = data.access_token;
    refreshToken = data.refresh_token;

    res.send(`
      <h1>Gotowe!</h1>
      <p>Konto OLX zostało połączone.</p>
      <p><a href="/olx/ogloszenia">Pokaż moje ogłoszenia</a></p>
    `);

  } catch (err) {
    console.error(err);
    res.status(500).send('Błąd połączenia z OLX.');
  }
});

app.get('/olx/ogloszenia', async (req, res) => {

  if (!accessToken) {
    return res.send(`
      <h1>Brak połączenia z OLX</h1>
      <a href="/olx/login">Połącz konto OLX</a>
    `);
  }

  try {

    const response = await fetch(
      'https://www.olx.pl/api/partner/adverts',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Version': '2.0',
          'Accept': 'application/json'
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Błąd ogłoszeń:', data);
      return res.status(400).send('Nie udało się pobrać ogłoszeń.');
    }

    const adverts = data.data || [];

    const lista = adverts.map(ad => `
      <div style="margin-bottom:20px">
        <h2>${ad.title}</h2>
        <p>Status: ${ad.status}</p>
        <a href="${ad.url}" target="_blank">Otwórz ogłoszenie</a>
      </div>
    `).join('');

    res.send(`
      <h1>Ogłoszenia EkoAgroTech</h1>
      <p>Znaleziono: ${adverts.length}</p>
      ${lista || '<p>Brak ogłoszeń.</p>'}
    `);

  } catch (err) {
    console.error(err);
    res.status(500).send('Błąd podczas pobierania ogłoszeń.');
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Serwer EkoAgroTech działa na porcie ${PORT}`);
});
