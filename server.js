const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.OLX_CLIENT_ID;
const CLIENT_SECRET = process.env.OLX_CLIENT_SECRET;

const REDIRECT_URI =
  'https://ekoagrotech-olx.onrender.com/olx/callback';

let oauthState = null;

app.get('/', (req, res) => {
  res.send(`
    <h1>EkoAgroTech OLX API działa!</h1>
    <p><a href="/olx/login">Połącz konto OLX</a></p>
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
    'https://www.olx.pl/oauth/authorize/?' + params.toString()
  );
});

app.get('/olx/callback', async (req, res) => {

  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send('OLX zwrócił błąd autoryzacji.');
  }

  if (!code) {
    return res.status(400).send('Brak kodu autoryzacyjnego OLX.');
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
      return res.status(400).send(
        'Nie udało się pobrać tokenu OLX.'
      );
    }

    console.log('Konto OLX zostało połączone.');

    res.send(`
      <h1>Gotowe!</h1>
      <p>Konto OLX zostało połączone z EkoAgroTech.</p>
      <p>Możesz zamknąć tę stronę.</p>
    `);

  } catch (err) {

    console.error(err);

    res.status(500).send(
      'Wystąpił błąd podczas łączenia z OLX.'
    );
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Serwer EkoAgroTech działa na porcie ${PORT}`);
});
