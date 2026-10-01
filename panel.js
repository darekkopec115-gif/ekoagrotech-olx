const crypto = require('node:crypto');

const statuses = { active: 'Aktywne', new: 'W moderacji', limited: 'Wymaga pakietu', outdated: 'Wygasłe', unconfirmed: 'Do potwierdzenia', unpaid: 'Nieopłacone', moderated: 'Odrzucone', blocked: 'Zablokowane', disabled: 'Wyłączone', removed_by_user: 'Usunięte', removed_by_moderator: 'Usunięte przez moderatora' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function webUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
function page(title, body) {
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} — EkoAgroTech OLX</title><link rel="stylesheet" href="/panel.css"><script src="/panel.js" defer></script></head><body><header><a class="brand" href="/olx/ogloszenia">EkoAgroTech <span>OLX</span></a><a href="/olx/login">Połącz konto OLX</a></header><main>${body}</main><footer>Panel zarządzania ogłoszeniami EkoAgroTech</footer></body></html>`;
}
function notice(message, type = 'error') { return `<div class="notice ${type}" role="${type === 'error' ? 'alert' : 'status'}">${escape(message)}</div>`; }
function selectFields(value, keys) {
  return Object.fromEntries(keys.filter(key => value?.[key] !== undefined && value[key] !== null).map(key => [key, value[key]]));
}
// Only fields accepted by OLX's Update advert schema; never send id/status/dates.
function writable(ad) {
  const result = selectFields(ad, ['title', 'description', 'category_id', 'advertiser_type', 'external_url', 'external_id', 'courier', 'auto_extend_enabled', 'product_safety_regulation']);
  for (const [key, fields] of Object.entries({ contact: ['name', 'phone'], location: ['city_id', 'district_id', 'latitude', 'longitude'], price: ['value', 'currency', 'negotiable', 'trade', 'budget'], salary: ['value_from', 'value_to', 'currency', 'negotiable', 'type'], ad_delivery: ['delivery_package_ids'] })) {
    if (ad[key] != null) result[key] = selectFields(ad[key], fields);
  }
  result.images = (ad.images || []).map(image => ({ url: image.url }));
  result.attributes = (ad.attributes || []).map(attribute => selectFields(attribute, ['code', 'value', 'values']));
  return result;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function revision(ad) { return crypto.createHash('sha256').update(JSON.stringify(canonical(writable(ad)))).digest('hex'); }
function signedToken(ad, secret) {
  const data = `${ad.id}.${Date.now()}.${revision(ad)}`;
  return `${data}.${crypto.createHmac('sha256', secret).update(data).digest('hex')}`;
}
function verifyToken(token, id, secret) {
  if (typeof token !== 'string' || !/^\d+\.\d+\.[a-f0-9]{64}\.[a-f0-9]{64}$/.test(token)) return null;
  const [savedId, timestamp, hash, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(`${savedId}.${timestamp}.${hash}`).digest('hex');
  const age = Date.now() - Number(timestamp);
  return savedId === id && age >= 0 && age < 2 * 60 * 60 * 1000 && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? hash : null;
}
function formValues(ad) {
  return { title: ad.title, description: ad.description, price: ad.price?.value ?? '', negotiable: ad.price?.negotiable ? 'on' : '', contact_name: ad.contact?.name || '', contact_phone: ad.contact?.phone || '', images: (ad.images || []).map(x => x.url).join('\n') };
}
function editPage(ad, values, token, error = '', saved = false) {
  const input = (name, label, options = '') => `<label>${label}<input name="${name}" value="${escape(values[name])}" ${options}></label>`;
  return page('Edycja ogłoszenia', `<a class="back" href="/olx/ogloszenia">← Lista ogłoszeń</a><div class="heading"><div><p class="eyebrow">OGŁOSZENIE #${escape(ad.id)}</p><h1>Edytuj ogłoszenie</h1><p>${escape(statuses[ad.status] || ad.status)}</p></div>${webUrl(ad.url) ? `<a class="button secondary" href="${escape(webUrl(ad.url))}" target="_blank" rel="noopener noreferrer">Otwórz w OLX ↗</a>` : ''}</div>${saved ? notice('Zmiany zostały zapisane w OLX. Ogłoszenie może wymagać ponownej moderacji.', 'success') : ''}${error ? notice(error) : ''}<form method="post" action="/olx/edytuj/${escape(ad.id)}" data-editor><input type="hidden" name="_token" value="${escape(token)}"><section class="card"><h2>Treść ogłoszenia</h2>${input('title', 'Tytuł', 'required maxlength="200"')}<label>Opis<textarea name="description" rows="13" required maxlength="65000">${escape(values.description)}</textarea></label><p class="hint">Ostateczne wymagania dotyczące długości i treści sprawdza OLX.</p></section><section class="card"><h2>Cena i kontakt</h2><div class="columns">${ad.price ? input('price', `Cena (${escape(ad.price.currency || 'PLN')})`, 'required inputmode="decimal"') : '<p>To ogłoszenie nie ma pola ceny.</p>'}${input('contact_name', 'Nazwa kontaktu', 'required maxlength="200"')}${input('contact_phone', 'Telefon', 'maxlength="100"')}</div>${ad.price ? `<label class="check"><input type="checkbox" name="negotiable" ${values.negotiable === 'on' ? 'checked' : ''}> Cena do negocjacji</label>` : ''}</section><section class="card"><h2>Zdjęcia</h2><p class="hint">Adresy istniejących lub nowych zdjęć — jeden pełny adres HTTP/HTTPS w wierszu. Kolejność wierszy określa kolejność zdjęć. Usunięcie adresu usuwa zdjęcie z ogłoszenia. Nowe adresy muszą być publicznie dostępne dla OLX.</p><div class="photos">${(ad.images || []).map(x => webUrl(x.url) ? `<img src="${escape(webUrl(x.url))}" alt="Zdjęcie ogłoszenia" loading="lazy" referrerpolicy="no-referrer">` : '').join('')}</div><label>Adresy zdjęć<textarea name="images" rows="5" maxlength="30000">${escape(values.images)}</textarea></label></section><p class="hint">Kategoria, lokalizacja, parametry maszyny i ustawienia dostawy zostaną zachowane. Zapis aktualizuje to ogłoszenie w OLX.</p><div class="actions"><button type="submit">Zapisz zmiany w OLX</button><a class="button secondary" href="/olx/ogloszenia">Anuluj</a><span role="status" data-saving></span></div></form>`);
}
class OlxError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function apiError(status, body) {
  if (status === 401) return 'Połączenie z OLX wygasło. Połącz konto OLX ponownie.';
  if (status === 403) return 'OLX odmówił dostępu. Sprawdź, czy aplikacja ma uprawnienia read i write oraz czy ogłoszenie należy do połączonego konta.';
  if (status === 404) return 'Nie znaleziono ogłoszenia na połączonym koncie OLX.';
  if (status === 429) return 'OLX ograniczył liczbę zapytań. Spróbuj ponownie za chwilę.';
  if (status >= 500) return 'OLX jest chwilowo niedostępny. Spróbuj ponownie później.';
  const details = body?.error?.validation || body?.validation || [];
  return `OLX nie przyjął zmian (HTTP ${status}). ${Array.isArray(details) ? details.map(x => [x.field, x.title, x.detail].filter(Boolean).join(': ')).join('; ').slice(0, 1800) : 'Sprawdź wpisane dane.'}`;
}
function installPanel(app, { requireAdmin, getToken, secret, fetchImpl = fetch }) {
  const saving = new Set();
  async function api(path, method = 'GET', payload) {
    let token = await getToken();
    if (!token) throw new OlxError(401, 'Brak aktywnego połączenia z OLX. Użyj przycisku „Połącz konto OLX”.');
    const request = token => fetchImpl(`https://www.olx.pl/api/partner${path}`, { method, headers: { Authorization: `Bearer ${token}`, Version: '2.0', Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(25000) });
    let response = await request(token);
    if (response.status === 401) {
      token = await getToken(true);
      if (token) response = await request(token);
    }
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : {}; } catch { throw new OlxError(502, 'OLX zwrócił nieprawidłową odpowiedź. Spróbuj ponownie później.'); }
    if (!response.ok) throw new OlxError(response.status, apiError(response.status, body));
    return body;
  }
  function fail(res, error) {
    const known = error instanceof OlxError;
    res.status(known && error.status < 500 ? error.status : 502).send(page('Błąd', notice(known ? error.message : 'Nie udało się połączyć z OLX. Spróbuj ponownie za chwilę.') + '<a class="button" href="/olx/ogloszenia">Wróć do ogłoszeń</a>'));
  }
  app.get('/', requireAdmin, (req, res) => res.redirect('/olx/ogloszenia'));
  app.get('/olx/ogloszenia', requireAdmin, async (req, res) => {
    const raw = req.query.offset ?? '0';
    if (typeof raw !== 'string' || !/^\d{1,8}$/.test(raw)) return res.status(400).send(page('Błąd', notice('Nieprawidłowy numer strony.')));
    const offset = Number(raw), limit = 100;
    try {
      const data = await api(`/adverts?offset=${offset}&limit=${limit}`);
      if (!Array.isArray(data.data)) throw new Error('Invalid adverts response');
      const adverts = data.data;
      const cards = adverts.map(ad => `<article class="advert card" data-advert data-title="${escape(ad.title?.toLocaleLowerCase('pl'))}" data-status="${escape(ad.status)}">${webUrl(ad.images?.[0]?.url) ? `<img class="thumbnail" src="${escape(webUrl(ad.images[0].url))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="placeholder">OLX</div>'}<div class="advert-content"><span class="badge">${escape(statuses[ad.status] || ad.status)}</span><h2>${escape(ad.title)}</h2><p>${ad.price ? `${escape(ad.price.value)} ${escape(ad.price.currency)}` : 'Brak ceny'} · #${escape(ad.id)}</p><div class="actions"><a class="button" href="/olx/edytuj/${encodeURIComponent(ad.id)}">Edytuj ogłoszenie</a>${webUrl(ad.url) ? `<a href="${escape(webUrl(ad.url))}" target="_blank" rel="noopener noreferrer">Zobacz w OLX ↗</a>` : ''}</div></div></article>`).join('');
      res.send(page('Ogłoszenia', `<div class="heading"><div><p class="eyebrow">PANEL FIRMY</p><h1>Twoje ogłoszenia OLX</h1><p>Edytuj treść, cenę, kontakt i zdjęcia.</p></div><a class="button secondary" href="/olx/ogloszenia?offset=${offset}">Odśwież listę</a></div><section class="filters card"><label>Szukaj na tej stronie<input type="search" placeholder="Np. pług, ładowacz…" data-search></label><label>Status<select data-filter><option value="">Wszystkie</option value="active">Aktywne</option>${Object.entries(statuses).filter(([key]) => key !== 'active').map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label></section><p data-count>Na stronie: ${adverts.length}${adverts.length ? ` · pozycje ${offset + 1}–${offset + adverts.length}` : ''}</p>${cards || '<section class="card"><h2>Brak ogłoszeń na tej stronie</h2><p>Sprawdź poprzednią stronę lub połącz właściwe konto OLX.</p></section>'}<p data-empty hidden>Brak wyników dla wybranych filtrów.</p><nav class="actions" aria-label="Strony ogłoszeń">${offset > 0 ? `<a class="button secondary" href="?offset=${Math.max(0, offset - limit)}">← Poprzednia strona</a>` : ''}${adverts.length === limit ? `<a class="button" href="?offset=${offset + limit}">Następna strona →</a>` : ''}</nav><p class="hint">Lista pobiera po 100 ogłoszeń. Wyszukiwanie i filtr statusu dotyczą bieżącej strony.</p>`));
    } catch (error) { fail(res, error); }
  });
  const validId = (req, res, next) => /^\d{1,20}$/.test(req.params.id) ? next() : res.status(400).send(page('Błąd', notice('Nieprawidłowy numer ogłoszenia.')));
  app.get('/olx/edytuj/:id', requireAdmin, validId, async (req, res) => {
    try {
      const { data: ad } = await api(`/adverts/${req.params.id}`);
      if (!ad || String(ad.id) !== req.params.id) throw new Error('Invalid advert response');
      res.send(editPage(ad, formValues(ad), signedToken(ad, secret), '', req.query.saved === '1'));
    } catch (error) { fail(res, error); }
  });
  app.post('/olx/edytuj/:id', requireAdmin, validId, async (req, res) => {
    const hash = verifyToken(req.body?._token, req.params.id, secret);
    if (!hash) return res.status(403).send(page('Formularz wygasł', notice('Formularz jest nieprawidłowy lub wygasł. Otwórz edycję ponownie.') + `<a href="/olx/edytuj/${req.params.id}">Otwórz edycję</a>`));
    if (saving.has(req.params.id)) return res.status(409).send(page('Zapis trwa', notice('Trwa już zapis tego ogłoszenia. Poczekaj i otwórz edycję ponownie.') + `<a href="/olx/edytuj/${req.params.id}">Otwórz edycję</a>`));
    saving.add(req.params.id);
    let ad;
    try {
      ({ data: ad } = await api(`/adverts/${req.params.id}`));
      if (!ad || String(ad.id) !== req.params.id) throw new Error('Invalid advert response');
      if (revision(ad) !== hash) return res.status(409).send(editPage(ad, req.body, req.body._token, 'Ogłoszenie zmieniło się od otwarcia formularza. Skopiuj swoją treść i otwórz edycję ponownie, aby nie nadpisać nowszych zmian.').replace('</main>', `<p><a href="/olx/edytuj/${req.params.id}">Otwórz aktualną wersję ogłoszenia</a></p></main>`));
      const fields = ['title', 'description', 'contact_name', 'contact_phone', 'images', ...(ad.price ? ['price'] : [])];
      if (fields.some(key => typeof req.body[key] !== 'string')) throw new OlxError(400, 'Nieprawidłowe dane formularza.');
      const values = Object.fromEntries(fields.map(key => [key, req.body[key].trim()]));
      if (!values.title || values.title.length > 200 || !values.description || values.description.length > 65000 || !values.contact_name || values.contact_name.length > 200 || values.contact_phone.length > 100) throw new OlxError(400, 'Uzupełnij tytuł, opis i nazwę kontaktu. Sprawdź długość wpisanych danych.');
      const payload = writable(ad);
      payload.title = values.title; payload.description = values.description;
      payload.contact = { ...payload.contact, name: values.contact_name, phone: values.contact_phone };
      if (ad.price) {
        const price = values.price.replace(',', '.');
        if (!/^\d+(\.\d{1,2})?$/.test(price) || !Number.isFinite(Number(price))) throw new OlxError(400, 'Wpisz poprawną cenę, np. 1200 lub 1200,50.');
        payload.price = { ...payload.price, value: Number(price), negotiable: req.body.negotiable === 'on' };
      }
      const images = values.images.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      if (images.some(url => !webUrl(url))) throw new OlxError(400, 'Każde zdjęcie musi mieć pełny adres HTTP lub HTTPS.');
      payload.images = images.map(url => ({ url }));
      await api(`/adverts/${req.params.id}`, 'PUT', payload);
      res.redirect(303, `/olx/edytuj/${req.params.id}?saved=1`);
    } catch (error) {
      if (ad) res.status(error instanceof OlxError && error.status < 500 ? error.status : 502).send(editPage(ad, req.body, req.body._token, error instanceof OlxError ? error.message : 'Nie udało się potwierdzić zapisu. Twoja treść jest w formularzu. Sprawdź ogłoszenie w OLX przed ponowieniem zapisu.'));
      else fail(res, error);
    } finally { saving.delete(req.params.id); }
  });
}

module.exports = { installPanel, writable, revision, signedToken, verifyToken, escape, webUrl };
