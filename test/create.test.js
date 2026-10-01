const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installPanel } = require('../panel');
const { createToken, verifyCreateToken } = require('../new-advert');
const { MemoryCreationStore } = require('../creation-store');

const secret = 'test-creation-secret';
const category = { id: 757, name: 'Maszyny rolnicze', is_leaf: true, photos_limit: 3 };
const definitions = [
  { code: 'price', label: 'Cena', validation: { type: 'price', required: true } },
  { code: 'condition', label: 'Stan', validation: { type: 'attribute', required: true }, values: [{ code: 'new', label: 'Nowe' }, { code: 'used', label: 'Używane' }] },
  { code: 'width', label: 'Szerokość', unit: 'cm', validation: { type: 'attribute', numeric: true, min: 1, max: 500 } },
  { code: 'options', label: 'Opcje', validation: { type: 'attribute', allow_multiple_values: true }, values: [{ code: 'hydraulic', label: 'Hydraulika' }, { code: 'manual', label: 'Ręczne' }] },
  { code: 'delivery', label: 'Dostawa', validation: { type: 'package' } }
];
const city = { id: 42, name: 'Pacanów', county: 'buski', municipality: 'Pacanów' };
const original = { id: 123, category_id: 757, status: 'active', advertiser_type: 'business', title: 'Pług śnieżny EkoAgroTech 150 cm', description: 'Solidny pług śnieżny do quada EkoAgroTech. System bezlinkowy na klik. Szerokość robocza 150 cm.', price: { value: 1200, currency: 'PLN', negotiable: true }, contact: { name: 'EkoAgroTech', phone: '123456789' }, location: { city_id: 42 }, images: [{ url: 'https://example.com/photo.jpg' }], attributes: [{ code: 'condition', value: 'new' }, { code: 'width', value: '150' }, { code: 'options', values: ['hydraulic'] }], external_id: 'old-external-id', auto_extend_enabled: true, product_safety_regulation: { manufacturer: { name: 'EkoAgroTech', country: 'PL', address: 'Adres producenta', email: 'firma@example.com' }, warning_and_safety: 'Przeczytaj instrukcję.' } };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
function values(token = createToken('757', secret)) {
  return { _token: token, title: original.title, description: original.description, price: '1200,50', currency: 'PLN', negotiable: 'on', contact_name: 'EkoAgroTech', contact_phone: '123456789', city_id: '42', district_id: '', images: 'https://example.com/photo.jpg', attr_condition: 'new', attr_width: '150', attr_options: ['hydraulic', 'manual'], manufacturer_name: 'EkoAgroTech', manufacturer_country: 'PL', manufacturer_address: 'Adres producenta', manufacturer_email: 'firma@example.com', warning_and_safety: 'Przeczytaj instrukcję.' };
}
function post(data) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) for (const item of Array.isArray(value) ? value : [value]) body.append(key, item);
  return { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body };
}
async function setup(t, options = {}) {
  const store = options.store || new MemoryCreationStore();
  const calls = [], created = [];
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  installPanel(app, {
    requireAdmin: (req, res, next) => req.headers.authorization === 'Basic test' ? next() : res.sendStatus(401),
    getToken: async () => 'access-token', secret, creationStore: store,
    fetchImpl: async (url, request) => {
      const parsed = new URL(url), path = parsed.pathname.replace('/api/partner', '');
      calls.push({ path, url, ...request });
      if (options.handler) { const handled = await options.handler(path, parsed, request, created); if (handled) return handled; }
      if (path === '/categories') return json({ data: [{ id: 1, parent_id: null, name: 'Rolnictwo', is_leaf: false }, { ...category, parent_id: 1 }].filter(x => !parsed.searchParams.has('parent_id') || String(x.parent_id) === parsed.searchParams.get('parent_id')) });
      if (path === '/categories/757') return json({ data: category });
      if (path === '/categories/757/attributes') return json({ data: definitions });
      if (path === '/cities/42') return json({ data: city });
      if (path === '/cities/42/districts') return json({ data: options.districts || [] });
      if (path === '/cities') return json({ data: parsed.searchParams.get('offset') === '0' ? [city, { id: 43, name: 'Łódź', county: 'Łódź' }] : [] });
      if (path === '/adverts/123') return json({ data: original });
      if (path === '/adverts/999') return json({ data: { ...original, id: 999, status: options.status || 'new' } });
      if (path === '/adverts' && request.method === 'GET') return json({ data: parsed.searchParams.has('external_id') ? created.filter(x => x.external_id === parsed.searchParams.get('external_id')) : [original] });
      if (path === '/adverts' && request.method === 'POST') {
        assert.equal(request.headers.Version, '2.0');
        assert.equal(request.headers.Authorization, 'Bearer access-token');
        const ad = { ...JSON.parse(request.body), id: 999, status: 'new' }; created.push(ad); return json({ data: ad });
      }
      throw new Error(`Unexpected OLX request: ${request.method} ${path}`);
    }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { request: (path, options = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { redirect: 'manual', ...options, headers: { Authorization: 'Basic test', ...options.headers } }), created, calls, store };
}

test('new routes require admin; listing keeps editing and adds creation links', async t => {
  const { request, calls } = await setup(t);
  for (const path of ['/olx/nowe', '/olx/slownik/miasta?q=Pacanów', '/olx/slownik/miasta/42/dzielnice']) assert.equal((await request(path, { headers: { Authorization: '' } })).status, 401);
  assert.equal((await request('/olx/nowe', { ...post(values()), headers: { Authorization: '', 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 401);
  assert.equal(calls.length, 0);
  const html = await (await request('/olx/ogloszenia')).text();
  assert.match(html, /href="\/olx\/nowe"/); assert.match(html, /template=123/); assert.match(html, /\/olx\/edytuj\/123/);
});
test('category wizard traverses tree and renders live required parameters', async t => {
  const { request } = await setup(t);
  const root = await (await request('/olx/nowe')).text(); assert.match(root, /parent=1/);
  const child = await (await request('/olx/nowe?parent=1')).text(); assert.match(child, /category=757/);
  const html = await (await request('/olx/nowe?category=757')).text();
  assert.match(html, /name="attr_condition" required/); assert.match(html, /name="attr_options"[^>]*multiple/);
  assert.match(html, /name="city_id"/); assert.match(html, /data-create/); assert.match(html, /src="\/create.js"/);
  assert.ok(!html.includes('name="attr_price"')); assert.ok(!html.includes('name="attr_delivery"'));
});
test('similar advert prefills template without changing the original or reusing its external ID', async t => {
  const { request, created, calls } = await setup(t);
  const html = await (await request('/olx/nowe?template=123')).text();
  assert.match(html, /value="Pług śnieżny EkoAgroTech 150 cm"/); assert.match(html, /Pacanów/); assert.match(html, /https:\/\/example.com\/photo.jpg/); assert.match(html, /name="manufacturer_name" value="EkoAgroTech"/);
  assert.match(html, /value="new" selected/); assert.match(html, /value="hydraulic" selected/);
  assert.equal(created.length, 0); assert.ok(calls.every(x => x.method === 'GET'));
});
test('creation sends a complete POST and redirects to existing editor with success notice', async t => {
  const { request, created } = await setup(t);
  const response = await request('/olx/nowe', post(values()));
  assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/olx/edytuj/999?created=1');
  const ad = created[0];
  assert.equal(ad.category_id, 757); assert.equal(ad.advertiser_type, 'business'); assert.equal(ad.price.value, 1200.5); assert.equal(ad.price.negotiable, true); assert.equal(ad.auto_extend_enabled, false);
  assert.deepEqual(ad.location, { city_id: 42 }); assert.deepEqual(ad.images, [{ url: 'https://example.com/photo.jpg' }]);
  assert.deepEqual(ad.attributes, [{ code: 'condition', value: 'new' }, { code: 'width', value: '150' }, { code: 'options', values: ['hydraulic', 'manual'] }]);
  assert.deepEqual(ad.product_safety_regulation.manufacturer, original.product_safety_regulation.manufacturer);
  assert.match(ad.external_id, /^ekoagrotech-panel-[a-f0-9-]{36}$/); assert.notEqual(ad.external_id, original.external_id); assert.equal(ad.created_at, undefined);
  const html = await (await request(response.headers.get('location'))).text(); assert.match(html, /Nowe ogłoszenie zostało utworzone w OLX/); assert.match(html, /Zapisz zmiany w OLX/);
});
test('invalid title, price, image limit, URL, parameters, and safety fields never POST', async t => {
  const { request, created } = await setup(t);
  const invalid = [{ title: 'Krótki' }, { description: 'Za krótki' }, { price: '-1' }, { price: '1e6' }, { currency: 'pln' }, { attr_condition: '' }, { attr_condition: 'invented' }, { attr_width: '700' }, { images: 'javascript:alert(1)' }, { images: Array(4).fill('https://example.com/1.jpg').join('\n') }, { manufacturer_email: 'not-an-email' }, { city_id: '' }];
  for (const changes of invalid) {
    const response = await request('/olx/nowe', post({ ...values(), ...changes }));
    assert.equal(response.status, 400, JSON.stringify(changes));
  }
  assert.equal(created.length, 0);
});
test('district must belong to selected city and is included in created ad', async t => {
  const { request, created } = await setup(t, { districts: [{ id: 81, city_id: 42, name: 'Centrum' }] });
  assert.equal((await request('/olx/nowe', post(values()))).status, 400);
  assert.equal((await request('/olx/nowe', post({ ...values(), district_id: '82' }))).status, 400);
  assert.equal((await request('/olx/nowe', post({ ...values(), district_id: '81' }))).status, 303);
  assert.deepEqual(created[0].location, { city_id: 42, district_id: 81 });
});
test('forged token prevents every API request and create token cannot be reused for editing', async t => {
  const { request, calls } = await setup(t);
  const forged = createToken('757', 'wrong-secret');
  assert.equal((await request('/olx/nowe', post(values(forged)))).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await request('/olx/edytuj/123', post({ _token: createToken('757', secret) }))).status, 403);
  assert.equal(verifyCreateToken('123.0.hash.sig', secret), null);
});
test('repeated submission and service restart return the same ad without another POST', async t => {
  const store = new MemoryCreationStore();
  const first = await setup(t, { store }), data = values();
  assert.equal((await first.request('/olx/nowe', post(data))).status, 303);
  assert.equal((await first.request('/olx/nowe', post(data))).headers.get('location'), '/olx/edytuj/999?created=1');
  assert.equal(first.created.length, 1);
  const restarted = await setup(t, { store });
  assert.equal((await restarted.request('/olx/nowe', post(data))).headers.get('location'), '/olx/edytuj/999?created=1');
  assert.equal(restarted.calls.length, 0); assert.equal(restarted.created.length, 0);
});
test('validation errors keep the form and allow a corrected retry with the same token', async t => {
  let reject = true;
  const { request, created } = await setup(t, { handler: (path, parsed, options) => {
    if (path === '/adverts' && options.method === 'POST' && reject) { reject = false; return json({ error: { validation: [{ field: 'title', title: 'Zmień tytuł <script>bad</script>' }] } }, 422); }
  } });
  const data = values(), response = await request('/olx/nowe', post(data));
  assert.equal(response.status, 422); const html = await response.text(); assert.match(html, /value="1200,50"/); assert.ok(!html.includes('<script>bad</script>')); assert.match(html, /attr_condition/);
  assert.equal((await request('/olx/nowe', post({ ...data, title: 'Poprawiony pług EkoAgroTech 150 cm' }))).status, 303); assert.equal(created.length, 1);
});
test('lost POST response reconciles external_id, including after process restart', async t => {
  const store = new MemoryCreationStore(); let posted;
  const first = await setup(t, { store, handler: (path, parsed, options) => {
    if (path === '/adverts' && options.method === 'POST') { posted = { ...JSON.parse(options.body), id: 777, status: 'new' }; throw new Error('connection lost after acceptance'); }
  } });
  const data = values();
  const failed = await first.request('/olx/nowe', post(data)); assert.equal(failed.status, 502); assert.match(await failed.text(), /Sprawdź wynik poprzedniej publikacji/);
  const second = await setup(t, { store, handler: (path, parsed, options) => path === '/adverts' && options.method === 'GET' ? json({ data: [posted] }) : null });
  const response = await second.request('/olx/nowe', post(data)); assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/olx/edytuj/777?created=1'); assert.equal(second.created.length, 0);
});
test('unknown publication outcome never resends POST even if OLX lookup is empty', async t => {
  let posts = 0;
  const { request } = await setup(t, { handler: (path, parsed, options) => {
    if (path === '/adverts' && options.method === 'POST') { posts++; return json({}, 503); }
  } });
  const data = values(); assert.equal((await request('/olx/nowe', post(data))).status, 502);
  assert.equal((await request('/olx/nowe', post(data))).status, 409); assert.equal(posts, 1);
});
test('simultaneous publish clicks cause at most one POST', async t => {
  let release, started, posts = 0;
  const wait = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { started = resolve; });
  const { request } = await setup(t, { handler: async (path, parsed, options) => {
    if (path === '/adverts' && options.method === 'POST') { posts++; started(); await wait; }
  } });
  const data = values(), first = request('/olx/nowe', post(data)); await entered;
  try { assert.equal((await request('/olx/nowe', post(data))).status, 409); assert.equal(posts, 1); }
  finally { release(); }
  assert.equal((await first).status, 303);
});
test('city search uses documented pagination, caches catalogue, and safely handles names', async t => {
  const { request, calls } = await setup(t);
  assert.equal((await request('/olx/slownik/miasta?q=ab')).status, 400);
  const first = await request('/olx/slownik/miasta?q=Pacanów'); assert.equal(first.status, 200); assert.equal((await first.json()).data[0].id, 42);
  const count = calls.length;
  const second = await request('/olx/slownik/miasta?q=lodz'); assert.equal((await second.json()).data[0].name, 'Łódź'); assert.equal(calls.length, count);
  assert.ok(calls.every(x => !new URL(x.url).searchParams.has('name')));
});
test('limited offers show package requirement without buying or activating anything', async t => {
  const { request, calls } = await setup(t, { status: 'limited' });
  const html = await (await request('/olx/edytuj/999?created=1')).text();
  assert.match(html, /OLX wymaga pakietu/); assert.ok(calls.every(x => x.method === 'GET'));
});
