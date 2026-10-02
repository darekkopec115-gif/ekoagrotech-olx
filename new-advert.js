const crypto = require('node:crypto');
const multer = require('multer');
const { MemoryCreationStore } = require('./creation-store');
const idPattern = /^[1-9]\d{0,19}$/;
const list = body => {
  const data = Array.isArray(body) ? body : body?.data;
  if (!Array.isArray(data)) throw new Error('Invalid OLX dictionary response');
  return data;
};
const object = body => body?.data ?? body;
function createToken(categoryId, secret, requestId = crypto.randomUUID()) {
  const data = `${requestId}.${categoryId}.${Date.now()}`;
  return `${data}.${crypto.createHmac('sha256', secret).update('create:' + data).digest('hex')}`;
}
function verifyCreateToken(token, secret) {
  if (typeof token !== 'string' || !/^[a-f0-9-]{36}\.[1-9]\d{0,19}\.\d{13}\.[a-f0-9]{64}$/.test(token)) return null;
  const [id, categoryId, timestamp, signature] = token.split('.');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) return null;
  const age = Date.now() - Number(timestamp);
  const expected = crypto.createHmac('sha256', secret).update(`create:${id}.${categoryId}.${timestamp}`).digest('hex');
  return age >= 0 && age < 2 * 60 * 60 * 1000 && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? { id, categoryId } : null;
}
function templateValues(ad = {}) {
  const result = {
    title: ad.title || '', description: ad.description || '', price: ad.price?.value ?? '',
    currency: ad.price?.currency || 'PLN', negotiable: ad.price?.negotiable ? 'on' : '',
    contact_name: ad.contact?.name || 'EkoAgroTech', contact_phone: ad.contact?.phone || '',
    city_id: ad.location?.city_id || '', district_id: ad.location?.district_id || '',
    images: (ad.images || []).map(x => x.url).join('\n'),
    before_2024: ad.product_safety_regulation?.placed_before_2024 ? 'on' : '',
    warning_and_safety: ad.product_safety_regulation?.warning_and_safety || ''
  };
  for (const party of ['manufacturer', 'contact_person']) {
    for (const key of ['name', 'country', 'address', 'email']) result[`${party}_${key}`] = ad.product_safety_regulation?.[party]?.[key] || (key === 'country' ? 'PL' : '');
  }
  for (const attr of ad.attributes || []) result[`attr_${attr.code}`] = attr.values || attr.value || '';
  return result;
}
const parameterDefinitions = definitions => definitions.filter(attr => attr.validation?.type === 'attribute');
function validatePayload(values, category, definitions, city, districts, requestId) {
  const invalid = message => { const error = new Error(message); error.status = 400; throw error; };
  const text = (key, max, required = false) => {
    const value = values[key] ?? '';
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) invalid('Uzupełnij wymagane pola i sprawdź długość wpisanych danych.');
    return value.trim();
  };
  if (!category?.is_leaf) invalid('Wybierz końcową kategorię ogłoszenia.');
  if (definitions.some(x => x.validation?.type === 'salary')) invalid('Ta kategoria dotyczy zatrudnienia. Wybierz kategorię sprzedaży maszyny lub produktu.');
  const priceText = text('price', 30, true).replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(priceText) || !Number.isFinite(Number(priceText))) invalid('Wpisz poprawną cenę, np. 1200 lub 1200,50.');
  const currency = text('currency', 3, true);
  if (!/^[A-Z]{3}$/.test(currency)) invalid('Wybierz prawidłową walutę.');
  if (!idPattern.test(String(values.city_id || '')) || String(city?.id) !== values.city_id) invalid('Wybierz miejscowość z wyników wyszukiwania.');
  const districtId = text('district_id', 20);
  if (districts.length && !districts.some(x => String(x.id) === districtId)) invalid('Wybierz dzielnicę miejscowości.');
  if (!districts.length && districtId) invalid('Wybrana miejscowość nie ma takiej dzielnicy.');
  const images = text('images', 30000).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (Number.isInteger(category.photos_limit) && images.length > category.photos_limit) invalid(`W tej kategorii OLX pozwala na ${category.photos_limit} zdjęć.`);
  for (const url of images) {
    try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) invalid('Zdjęcia muszą mieć publiczne adresy HTTP lub HTTPS.'); } catch { invalid('Każde zdjęcie musi mieć pełny adres HTTP lub HTTPS.'); }
  }
  const title = text('title', 150, true), description = text('description', 9000, true);
  if (title.length < 16) invalid('Tytuł musi mieć co najmniej 16 znaków.');
  if (description.length < 80) invalid('Opis musi mieć co najmniej 80 znaków.');
  const attributes = [];
  for (const attr of parameterDefinitions(definitions)) {
    const validation = attr.validation || {}, raw = values[`attr_${attr.code}`];
    const entries = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    if (entries.some(x => typeof x !== 'string' || x.length > 2000)) invalid(`Nieprawidłowy parametr: ${attr.label}.`);
    const selected = entries.map(x => x.trim()).filter(Boolean);
    if (validation.required && !selected.length) invalid(`Uzupełnij parametr: ${attr.label}.`);
    if (!selected.length) continue;
    if (!validation.allow_multiple_values && selected.length > 1) invalid(`Wybierz jedną wartość: ${attr.label}.`);
    if (attr.values?.length && selected.some(x => !attr.values.some(option => String(option.code) === x))) invalid(`Wybierz dostępną wartość: ${attr.label}.`);
    if (validation.numeric) {
      for (const value of selected) {
        if (!/^-?\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) || (validation.min != null && Number(value) < Number(validation.min)) || (validation.max != null && Number(value) > Number(validation.max))) invalid(`Sprawdź wartość liczbową: ${attr.label}.`);
      }
    }
    attributes.push(validation.allow_multiple_values ? { code: attr.code, values: [...new Set(selected)] } : { code: attr.code, value: selected[0] });
  }
  const payload = {
    title, description, category_id: Number(category.id),
    advertiser_type: 'business', external_id: `ekoagrotech-panel-${requestId}`,
    contact: { name: text('contact_name', 200, true), phone: text('contact_phone', 100) },
    location: { city_id: Number(city.id), ...(districtId ? { district_id: Number(districtId) } : {}) },
    price: { value: Number(priceText), currency, negotiable: values.negotiable === 'on', trade: false, budget: false },
    images: images.map(url => ({ url })), attributes, auto_extend_enabled: false
  };
  const safety = { placed_before_2024: values.before_2024 === 'on' };
  for (const party of ['manufacturer', 'contact_person']) {
    const fields = Object.fromEntries(['name', 'country', 'address', 'email'].map(key => [key, text(`${party}_${key}`, key === 'address' ? 1000 : 200)]));
    if (fields.name || fields.address || fields.email) {
      if (!fields.name || !fields.address || !/^[A-Z]{2}$/.test(fields.country) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) invalid('Uzupełnij nazwę, adres, kraj i poprawny e-mail w danych bezpieczeństwa produktu.');
      safety[party] = fields;
    }
  }
  const warning = text('warning_and_safety', 10000);
  if (warning) safety.warning_and_safety = warning;
  if (safety.placed_before_2024 || safety.manufacturer || safety.contact_person || warning) payload.product_safety_regulation = safety;
  return payload;
}

function installNewAdvert(app, { api, requireAdmin, secret, page, escape, notice, fail, creationStore = new MemoryCreationStore(), imageStore }) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 15, fileSize: 12 * 1024 * 1024, fieldSize: 100000 },
    fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
  });
  function attributesHtml(definitions, values) {
    return parameterDefinitions(definitions).map(attr => {
      const validation = attr.validation || {}, name = `attr_${attr.code}`, required = validation.required ? 'required' : '';
      const selected = Array.isArray(values[name]) ? values[name] : [values[name]];
      let field;
      if (attr.values?.length) field = `<select name="${escape(name)}" ${required} ${validation.allow_multiple_values ? 'multiple size="5"' : ''}>${validation.allow_multiple_values ? '' : '<option value="">Wybierz…</option>'}${attr.values.map(x => `<option value="${escape(x.code)}" ${selected.includes(String(x.code)) ? 'selected' : ''}>${escape(x.label)}</option>`).join('')}</select>`;
      else field = `<input name="${escape(name)}" value="${escape(selected[0] || '')}" maxlength="2000" ${required} ${validation.numeric ? `type="number" step="any" ${validation.min != null ? `min="${escape(validation.min)}"` : ''} ${validation.max != null ? `max="${escape(validation.max)}"` : ''}` : ''}>`;
      return `<label>${escape(attr.label)}${attr.unit ? ` (${escape(attr.unit)})` : ''}${validation.required ? ' *' : ''}${field}${validation.allow_multiple_values ? '<span class="hint">Możesz wybrać więcej niż jedną wartość.</span>' : ''}</label>`;
    }).join('') || '<p class="hint">Ta kategoria nie wymaga dodatkowych parametrów.</p>';
  }
  function form(context, values, token, error = '', uncertain = false) {
    const { category, definitions, city, districts = [] } = context;
    const input = (name, label, options = '') => `<label>${label}<input name="${name}" value="${escape(values[name] ?? '')}" ${options}></label>`;
    const party = (prefix, heading) => `<details ${values[`${prefix}_name`] ? 'open' : ''}><summary>${heading}</summary><div class="columns">${input(`${prefix}_name`, 'Nazwa', 'maxlength="200"')}${input(`${prefix}_country`, 'Kraj (np. PL)', 'maxlength="2"')}${input(`${prefix}_email`, 'E-mail', 'type="email" maxlength="200"')}</div>${input(`${prefix}_address`, 'Pełny adres', 'maxlength="1000"')}</details>`;
    return page('Nowe ogłoszenie', `<a class="back" href="/olx/ogloszenia">← Lista ogłoszeń</a><div class="heading"><div><p class="eyebrow">NOWA OFERTA</p><h1>Utwórz ogłoszenie OLX</h1><p>Kategoria: <strong>${escape(category.name)}</strong></p></div><a class="button secondary" href="/olx/nowe?choose=1">Wybierz inną kategorię</a></div>${error ? notice(error) : ''}<form method="post" action="/olx/nowe" enctype="multipart/form-data" data-editor data-create><input type="hidden" name="_token" value="${escape(token)}"><section class="card"><h2>Treść ogłoszenia</h2>${input('title', 'Tytuł *', 'required minlength="16" maxlength="150"')}<label>Opis *<textarea name="description" rows="10" required minlength="80" maxlength="9000">${escape(values.description)}</textarea></label><p class="hint">Tytuł: 16–150 znaków. Opis: 80–9000 znaków. Telefon wpisz w polu kontaktu. Nie umieszczaj telefonu ani e-maila w treści; OLX sprawdza też treść ogłoszenia.</p></section><section class="card"><h2>Cena i parametry</h2><div class="columns">${input('price', 'Cena *', 'required inputmode="decimal"')}<label>Waluta<input name="currency" value="${escape(values.currency || 'PLN')}" required pattern="[A-Z]{3}" maxlength="3"></label></div><label class="check"><input type="checkbox" name="negotiable" ${values.negotiable === 'on' ? 'checked' : ''}> Cena do negocjacji</label><div class="columns">${attributesHtml(definitions, values)}</div></section><section class="card"><h2>Kontakt i lokalizacja</h2><div class="columns">${input('contact_name', 'Nazwa kontaktu *', 'required maxlength="200"')}${input('contact_phone', 'Telefon', 'maxlength="100"')}</div><input type="hidden" name="city_id" value="${escape(values.city_id)}"><label>Wybrana miejscowość *<input data-city-selected value="${escape(city ? [city.name, city.county, city.municipality].filter(Boolean).join(' · ') : '')}" readonly placeholder="Wyszukaj i wybierz poniżej"></label><div class="city-search"><label>Szukaj miejscowości<input data-city-search type="search" placeholder="Np. Pacanów" minlength="3"></label><button type="button" class="secondary" data-city-button>Szukaj</button></div><p class="hint" data-city-status role="status"></p><div data-city-results class="city-results"></div><label>Dzielnica<select name="district_id" data-district ${districts.length ? 'required' : ''}><option value="">${districts.length ? 'Wybierz dzielnicę…' : 'Nie dotyczy'}</option>${districts.map(x => `<option value="${escape(x.id)}" ${String(x.id) === String(values.district_id) ? 'selected' : ''}>${escape(x.name)}</option>`).join('')}</select></label><noscript>Do wyszukania nowej miejscowości potrzebna jest obsługa JavaScript.</noscript></section><section class="card"><h2>Zdjęcia</h2><p class="hint">Wybierz zdjęcia bezpośrednio z komputera lub telefonu. JPG, PNG lub WEBP, maks. 12 MB na zdjęcie.${Number.isInteger(category.photos_limit) ? ` Limit kategorii: ${category.photos_limit}.` : ''}</p><label>Dodaj zdjęcia<input type="file" name="photo_files" accept="image/jpeg,image/png,image/webp" multiple></label><input type="hidden" name="images" value="${escape(values.images || '')}">${values.images ? '<p class="hint">Zdjęcia skopiowane z istniejącego ogłoszenia również zostaną zachowane. Nowo wybrane zdjęcia zostaną dodane po nich.</p>' : ''}</section><section class="card"><h2>Bezpieczeństwo produktu</h2><p class="hint">Jeżeli OLX wymaga tych danych w wybranej kategorii, wpisz rzeczywiste dane producenta i informacje z instrukcji maszyny.</p>${party('manufacturer', 'Producent')}${party('contact_person', 'Osoba odpowiedzialna za produkt')}<label>Ostrzeżenia i informacje bezpieczeństwa<textarea name="warning_and_safety" rows="3" maxlength="10000">${escape(values.warning_and_safety)}</textarea></label><label class="check"><input type="checkbox" name="before_2024" ${values.before_2024 === 'on' ? 'checked' : ''}> Produkt został wprowadzony na rynek przed 2024 rokiem</label></section><section class="card"><h2>Publikacja</h2><p>Przycisk poniżej tworzy nowe ogłoszenie na połączonym koncie OLX. OLX może skierować ofertę do moderacji lub wymagać dostępnego pakietu ogłoszeń.</p><p class="hint">Publikujesz jako firma. Automatyczne przedłużanie jest wyłączone.</p><div class="actions"><button type="submit">${uncertain ? 'Sprawdź wynik poprzedniej publikacji' : 'Utwórz ogłoszenie w OLX'}</button><a href="/olx/ogloszenia">Wróć do listy</a><span role="status" data-saving></span></div></section></form><script src="/create.js" defer></script>`);
  }
  async function categoryContext(categoryId) {
    const [categoryBody, definitionsBody] = await Promise.all([api(`/categories/${categoryId}`), api(`/categories/${categoryId}/attributes`)]);
    const category = object(categoryBody), definitions = list(definitionsBody);
    if (String(category?.id) !== String(categoryId) || !category.is_leaf) { const error = new Error('Wybierz końcową kategorię ogłoszenia.'); error.status = 400; throw error; }
    return { category, definitions };
  }
  async function locationContext(values) {
    if (!idPattern.test(String(values.city_id || ''))) return { city: null, districts: [] };
    const [city, districts] = await Promise.all([api(`/cities/${values.city_id}`).then(object), api(`/cities/${values.city_id}/districts`).then(list)]);
    return { city, districts };
  }
  app.get('/olx/nowe', requireAdmin, async (req, res) => {
    try {
      if (req.query.template || req.query.category) {
        let ad = {};
        if (req.query.template) {
          if (typeof req.query.template !== 'string' || !idPattern.test(req.query.template)) return res.sendStatus(400);
          ad = object(await api(`/adverts/${req.query.template}`));
          if (String(ad?.id) !== req.query.template) throw new Error('Invalid template');
        }
        const categoryId = req.query.category || String(ad.category_id || '');
        if (typeof categoryId !== 'string' || !idPattern.test(categoryId)) return res.sendStatus(400);
        const context = await categoryContext(categoryId);
        const values = templateValues(ad);
        if (String(ad.category_id) !== categoryId) for (const key of Object.keys(values)) if (key.startsWith('attr_')) delete values[key];
        Object.assign(context, await locationContext(values));
        return res.send(form(context, values, createToken(categoryId, secret)));
      }
      if (!req.query.choose && !req.query.parent) return res.redirect(302, '/olx/nowe?category=1265');
      const parent = req.query.parent;
      if (parent !== undefined && (typeof parent !== 'string' || !idPattern.test(parent))) return res.sendStatus(400);
      const categories = list(await api(`/categories${parent ? `?parent_id=${parent}` : ''}`));
      const ids = new Set(categories.map(x => String(x.id)));
      const roots = parent ? categories.filter(x => String(x.parent_id) === parent) : categories.filter(x => !x.parent_id || !ids.has(String(x.parent_id)));
      const shown = roots.length ? roots : categories;
      res.send(page('Nowe ogłoszenie', `<a href="/olx/ogloszenia">← Lista ogłoszeń</a><h1>Nowe ogłoszenie</h1><section class="card"><h2>Wybierz kategorię</h2><p>Przejdź do kategorii, która najlepiej opisuje sprzedawaną maszynę.</p>${parent ? '<p><a href="/olx/nowe?choose=1">Wszystkie kategorie</a></p>' : ''}<div class="category-grid">${shown.map(x => `<a class="button secondary" href="/olx/nowe?${x.is_leaf ? 'category' : 'parent'}=${encodeURIComponent(x.id)}">${escape(x.name)}${x.is_leaf ? '' : ' →'}</a>`).join('')}</div></section><section class="card"><h2>Szybciej z istniejącej oferty</h2><p>Na liście ogłoszeń wybierz „Utwórz podobne”, aby przenieść kategorię, parametry, treść, cenę, kontakt, lokalizację i zdjęcia do nowego formularza.</p><a class="button" href="/olx/ogloszenia">Wybierz istniejącą ofertę</a></section>`));
    } catch (error) {
      if (error.status === 400) res.status(400).send(page('Błąd', notice(error.message)));
      else fail(res, error);
    }
  });

  // OLX documents pagination rather than a city-name filter. Index its city catalogue
  // incrementally, cache it for six hours, and resume a partial scan on the next search.
  let cities = [], cityOffset = 0, cityComplete = false, cityScan, cityExpiry = 0;
  async function scanCities() {
    if (cityScan) return cityScan;
    if (Date.now() > cityExpiry) { cities = []; cityOffset = 0; cityComplete = false; cityExpiry = Date.now() + 6 * 60 * 60 * 1000; }
    cityScan = (async () => {
      const started = Date.now();
      for (let batch = 0; !cityComplete && batch < 4 && Date.now() - started < 20000; batch++) {
        const offsets = Array.from({ length: 4 }, (_, i) => cityOffset + i * 1000);
        const pages = await Promise.all(offsets.map(offset => api(`/cities?offset=${offset}&limit=1000`).then(list)));
        for (const result of pages) {
          cities.push(...result); cityOffset += 1000;
          if (result.length < 1000) { cityComplete = true; break; }
        }
        if (cityOffset >= 200000) throw new Error('City catalogue limit exceeded');
      }
    })();
    try { await cityScan; } finally { cityScan = null; }
  }
  app.get('/olx/slownik/miasta', requireAdmin, async (req, res) => {
    const query = req.query.q;
    if (typeof query !== 'string' || query.trim().length < 3 || query.length > 100) return res.status(400).json({ error: 'Wpisz co najmniej 3 znaki nazwy miejscowości.' });
    try {
      await scanCities();
      const normalized = value => String(value || '').toLocaleLowerCase('pl').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replaceAll('ł', 'l');
      const term = normalized(query.trim());
      const found = cities.filter(x => normalized(x.name).includes(term)).sort((a, b) => Number(normalized(b.name) === term) - Number(normalized(a.name) === term));
      res.json({ data: found.slice(0, 50), complete: cityComplete, more: found.length > 50 });
    } catch (error) { res.status(502).json({ error: 'Nie udało się pobrać miejscowości z OLX. Spróbuj ponownie.' }); }
  });
  app.get('/olx/slownik/miasta/:id/dzielnice', requireAdmin, async (req, res) => {
    if (!idPattern.test(req.params.id)) return res.sendStatus(400);
    try { res.json({ data: list(await api(`/cities/${req.params.id}/districts`)) }); }
    catch { res.status(502).json({ error: 'Nie udało się pobrać dzielnic. Spróbuj ponownie.' }); }
  });

  const redirect = (res, advertId) => res.redirect(303, `/olx/edytuj/${advertId}?created=1`);
  async function reconcile(id) {
    const found = list(await api(`/adverts?external_id=${encodeURIComponent(`ekoagrotech-panel-${id}`)}&limit=100`));
    const match = found.find(ad => ad.external_id === `ekoagrotech-panel-${id}` && idPattern.test(String(ad.id)));
    if (match) { await creationStore.complete(id, match.id); return match.id; }
    return null;
  }
  app.post('/olx/nowe', requireAdmin, upload.array('photo_files', 15), async (req, res) => {
    const token = verifyCreateToken(req.body?._token, secret);
    if (!token) return res.status(403).send(page('Formularz wygasł', notice('Formularz jest nieprawidłowy lub wygasł. Otwórz nowy formularz ogłoszenia.') + '<a href="/olx/nowe">Nowe ogłoszenie</a>'));
    let context, claimed = false, attempted = false;
    try {
      if (req.files?.length) {
        if (!imageStore) { const error = new Error('Magazyn zdjęć jest niedostępny.'); error.status = 502; throw error; }
        const base = `${req.protocol}://${req.get('host')}`;
        const uploaded = [];
        for (const file of req.files) uploaded.push(`${base}/olx-zdjecia/${await imageStore.save(file)}`);
        req.body.images = [req.body.images || '', ...uploaded].filter(Boolean).join('\n');
      }
      const existing = await creationStore.get(token.id);
      if (existing?.advert_id) return redirect(res, existing.advert_id);
      context = await categoryContext(token.categoryId);
      Object.assign(context, await locationContext(req.body));
      if (existing) {
        const advertId = await reconcile(token.id);
        if (advertId) return redirect(res, advertId);
        return res.status(409).send(form(context, req.body, req.body._token, 'Wynik wcześniejszej publikacji nie jest jeszcze potwierdzony. Sprawdź listę ogłoszeń lub sprawdź wynik ponownie za chwilę. Panel nie wysyła drugiej publikacji, aby uniknąć duplikatu.', true));
      }
      const payload = validatePayload(req.body, context.category, context.definitions, context.city, context.districts, token.id);
      claimed = await creationStore.claim(token.id);
      if (!claimed) return res.status(409).send(form(context, req.body, req.body._token, 'Trwa już publikacja z tego formularza. Sprawdź wynik za chwilę.', true));
      attempted = true;
      const ad = object(await api('/adverts', 'POST', payload));
      if (!idPattern.test(String(ad?.id))) throw new Error('Missing created advert ID');
      await creationStore.complete(token.id, ad.id);
      return redirect(res, ad.id);
    } catch (error) {
      // A received validation/auth/rate-limit response is a definite rejection.
      // Network errors, timeouts, unexpected replies and 5xx may hide a success.
      const rejected = [400, 401, 403, 404, 422, 429].includes(error.status);
      if (claimed && (!attempted || rejected)) await creationStore.release(token.id);
      const uncertain = claimed && attempted && !rejected;
      const message = uncertain ? 'Nie udało się potwierdzić publikacji. Treść formularza została zachowana. Sprawdź wynik ponownie lub sprawdź listę ogłoszeń przed tworzeniem kolejnej oferty.' : (error.status && error.message) || 'Nie udało się pobrać danych OLX. Treść formularza została zachowana. Spróbuj ponownie.';
      if (context) return res.status(uncertain ? 502 : error.status && error.status < 500 ? error.status : 502).send(form(context, req.body, req.body._token, message, uncertain));
      fail(res, error);
    }
  });
}
module.exports = { installNewAdvert, createToken, verifyCreateToken, validatePayload, templateValues };
