const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installPanel, signedToken, verifyToken, writable, revision } = require('../panel');

const secret = 'test-admin-password';
const fixture = () => ({ id: 123, status: 'active', url: 'https://www.olx.pl/test', title: 'Pług EkoAgroTech', description: 'Opis maszyny', category_id: 757, advertiser_type: 'business', contact: { name: 'EkoAgroTech', phone: '123456789' }, location: { city_id: 42, district_id: null, latitude: 50.4, longitude: 21.0 }, price: { value: 1200, currency: 'PLN', negotiable: false, trade: false, budget: false }, images: [{ url: 'https://example.com/photo.jpg', id: 'read-only-image-id' }], attributes: [{ code: 'condition', value: 'new', values: null }], ad_delivery: { delivery_package_ids: ['1'], delivery_change_allowed: false }, auto_extend_enabled: true, product_safety_regulation: { placed_before_2024: false, warning_and_safety: 'Instrukcja w zestawie' }, created_at: 'read-only' });
async function setup(t, handler, getToken = async () => 'access-token') {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  installPanel(app, { requireAdmin: (req, res, next) => req.headers.authorization === 'Basic test' ? next() : res.sendStatus(401), getToken, secret, fetchImpl: handler });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  return (path, options = {}) => fetch(url + path, { redirect: 'manual', ...options, headers: { Authorization: 'Basic test', ...options.headers } });
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const submitted = ad => ({ _token: signedToken(ad, secret), title: 'Nowy pług', description: 'Nowy opis maszyny', price: '1450,50', negotiable: 'on', contact_name: 'EkoAgroTech', contact_phone: '987654321', images: 'https://example.com/new.jpg' });
const post = values => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values) });

test('edycja jest zabezpieczona i wyświetla istniejącą treść bez wykonywania HTML', async t => {
  const ad = fixture(); ad.description = '</textarea><script>alert(1)</script>';
  const request = await setup(t, async () => json({ data: ad }));
  assert.equal((await request('/olx/edytuj/123', { headers: { Authorization: '' } })).status, 401);
  const result = await request('/olx/edytuj/123');
  const html = await result.text();
  assert.equal(result.status, 200);
  assert.ok(html.includes('&lt;/textarea&gt;&lt;script&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /name="_token"/);
});
test('zapis wysyła PUT z pełnymi wymaganymi polami i zachowuje parametry', async t => {
  const ad = fixture(); let sent;
  const request = await setup(t, async (url, options) => {
    assert.ok(url.endsWith('/adverts/123'));
    assert.equal(options.headers.Version, '2.0');
    if (options.method === 'PUT') { sent = JSON.parse(options.body); return json({ data: { ...ad, ...sent } }); }
    return json({ data: ad });
  });
  const result = await request('/olx/edytuj/123', post(submitted(ad)));
  assert.equal(result.status, 303);
  assert.equal(result.headers.get('location'), '/olx/edytuj/123?saved=1');
  assert.equal(sent.title, 'Nowy pług');
  assert.equal(sent.price.value, 1450.5);
  assert.equal(sent.price.negotiable, true);
  assert.equal(sent.contact.phone, '987654321');
  assert.equal(sent.category_id, 757);
  assert.deepEqual(sent.location, { city_id: 42, latitude: 50.4, longitude: 21.0 });
  assert.deepEqual(sent.attributes, [{ code: 'condition', value: 'new' }]);
  assert.deepEqual(sent.ad_delivery, { delivery_package_ids: ['1'] });
  assert.deepEqual(sent.product_safety_regulation, ad.product_safety_regulation);
  assert.equal(sent.auto_extend_enabled, true);
  assert.equal(sent.id, undefined); assert.equal(sent.status, undefined); assert.equal(sent.created_at, undefined);
  assert.deepEqual(sent.images, [{ url: 'https://example.com/new.jpg' }]);
});
test('brak lub fałszywy token formularza blokuje zapis przed zapytaniem do OLX', async t => {
  let calls = 0;
  const request = await setup(t, async () => { calls++; return json({}); });
  for (const token of ['', 'forged', signedToken(fixture(), 'wrong-secret')]) {
    const result = await request('/olx/edytuj/123', post({ ...submitted(fixture()), _token: token }));
    assert.equal(result.status, 403);
  }
  assert.equal(calls, 0);
});
test('zmiany z drugiej karty powodują konflikt i nie są nadpisywane', async t => {
  const original = fixture(), changed = { ...original, title: 'Zmieniono w OLX' }; let put = false;
  const request = await setup(t, async (url, options) => { if (options.method === 'PUT') put = true; return json({ data: changed }); });
  const result = await request('/olx/edytuj/123', post(submitted(original)));
  assert.equal(result.status, 409); assert.equal(put, false);
  assert.match(await result.text(), /Nowy opis maszyny/);
});
test('niepoprawna cena i niebezpieczne URL nie docierają do zapisu OLX', async t => {
  const ad = fixture(); let put = false;
  const request = await setup(t, async (url, options) => { if (options.method === 'PUT') put = true; return json({ data: ad }); });
  for (const values of [{ price: '-1' }, { price: 'abc' }, { images: 'javascript:alert(1)' }, { title: '' }]) {
    const result = await request('/olx/edytuj/123', post({ ...submitted(ad), ...values }));
    assert.equal(result.status, 400);
  }
  assert.equal(put, false);
});
test('OLX validation errors retain entered text and escape error HTML', async t => {
  const ad = fixture();
  const request = await setup(t, async (url, options) => options.method === 'PUT' ? json({ error: { validation: [{ field: 'title', title: '<script>bad</script>', detail: 'Za krótki tytuł' }] } }, 422) : json({ data: ad }));
  const result = await request('/olx/edytuj/123', post(submitted(ad)));
  assert.equal(result.status, 422);
  const html = await result.text();
  assert.match(html, /Za krótki tytuł/); assert.match(html, /Nowy opis maszyny/); assert.ok(!html.includes('<script>bad</script>'));
});
test('paginacja zapewnia dostęp do kolejnych 100 ogłoszeń', async t => {
  let endpoint;
  const request = await setup(t, async url => { endpoint = url; return json({ data: Array.from({ length: 100 }, (_, i) => ({ ...fixture(), id: i + 101 })) }); });
  const html = await (await request('/olx/ogloszenia?offset=100')).text();
  assert.match(endpoint, /offset=100&limit=100/); assert.match(html, /offset=200/); assert.match(html, /offset=0/); assert.match(html, /101–200/);
  assert.equal((await request('/olx/ogloszenia?offset=-1')).status, 400);
});
test('401 ponawia odczyt po odświeżeniu tokenu, a 429 daje czytelny błąd', async t => {
  const forces = []; let calls = 0;
  const request = await setup(t, async () => ++calls === 1 ? json({}, 401) : json({ data: fixture() }), async force => { forces.push(Boolean(force)); return force ? 'fresh' : 'expired'; });
  assert.equal((await request('/olx/edytuj/123')).status, 200);
  assert.deepEqual(forces, [false, true]);
  const limited = await setup(t, async () => json({}, 429));
  const result = await limited('/olx/edytuj/123'); assert.equal(result.status, 429); assert.match(await result.text(), /ograniczył liczbę zapytań/);
});
test('brak połączenia i uszkodzona odpowiedź OLX mają kontrolowane komunikaty', async t => {
  const missing = await setup(t, async () => { throw new Error('should not fetch'); }, async () => null);
  assert.equal((await missing('/olx/ogloszenia')).status, 401);
  const broken = await setup(t, async () => new Response('<html>Gateway error</html>', { status: 502 }));
  const response = await broken('/olx/ogloszenia'); assert.equal(response.status, 502); assert.match(await response.text(), /nieprawidłową odpowiedź/);
});
test('token jest związany z numerem ogłoszenia, datą i wersją danych', () => {
  const ad = fixture(), token = signedToken(ad, secret);
  assert.equal(verifyToken(token, '123', secret), revision(ad));
  assert.equal(verifyToken(token, '124', secret), null);
  assert.equal(verifyToken(token.replace(/\.\d+\./, '.1.'), '123', secret), null);
  const reordered = Object.fromEntries(Object.entries(ad).reverse());
  assert.equal(revision(reordered), revision(ad));
  assert.equal(writable(ad).images[0].id, undefined);
});
test('równoczesny drugi zapis tego samego ogłoszenia jest blokowany', async t => {
  const ad = fixture(); let release, started;
  const writing = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  let writes = 0;
  const request = await setup(t, async (url, options) => {
    if (options.method === 'PUT') { writes++; started(); await blocked; }
    return json({ data: ad });
  });
  const first = request('/olx/edytuj/123', post(submitted(ad)));
  await writing;
  try {
    assert.equal((await request('/olx/edytuj/123', post(submitted(ad)))).status, 409);
    assert.equal(writes, 1);
  } finally { release(); }
  assert.equal((await first).status, 303);
});
