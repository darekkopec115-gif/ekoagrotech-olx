const createForm = document.querySelector('[data-create]');
if (createForm) {
  const search = createForm.querySelector('[data-city-search]');
  const searchButton = createForm.querySelector('[data-city-button]');
  const results = createForm.querySelector('[data-city-results]');
  const status = createForm.querySelector('[data-city-status]');
  const submitButton = createForm.querySelector('button[type="submit"]');
  const cityId = createForm.elements.city_id;
  const selected = createForm.querySelector('[data-city-selected]');
  const districts = createForm.querySelector('[data-district]');
  let busy = false;
  async function json(url) {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Nie udało się pobrać danych OLX. Spróbuj ponownie.');
    return body;
  }
  async function choose(city) {
    if (busy) return;
    busy = true; submitButton.disabled = true;
    cityId.value = '';
    status.textContent = 'Sprawdzanie dzielnic…';
    try {
      const body = await json(`/olx/slownik/miasta/${encodeURIComponent(city.id)}/dzielnice`);
      districts.replaceChildren(new Option(body.data.length ? 'Wybierz dzielnicę…' : 'Nie dotyczy', ''));
      body.data.forEach(district => districts.add(new Option(district.name, district.id)));
      districts.required = body.data.length > 0;
      cityId.value = city.id;
      selected.value = [city.name, city.county, city.municipality].filter(Boolean).join(' · ');
      results.replaceChildren();
      status.textContent = body.data.length ? 'Wybierz dzielnicę poniżej.' : 'Miejscowość została wybrana.';
      createForm.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (error) {
      selected.value = '';
      status.textContent = error.message;
    } finally { busy = false; submitButton.disabled = false; }
  }
  async function find() {
    if (busy) return;
    const query = search.value.trim();
    if (query.length < 3) { status.textContent = 'Wpisz co najmniej 3 znaki nazwy miejscowości.'; return; }
    busy = true; searchButton.disabled = true;
    status.textContent = 'Wyszukiwanie miejscowości w OLX… Pierwsze wyszukiwanie może potrwać dłużej.';
    results.replaceChildren();
    try {
      const body = await json(`/olx/slownik/miasta?q=${encodeURIComponent(query)}`);
      body.data.forEach(city => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'secondary';
        button.textContent = [city.name, city.county, city.municipality].filter(Boolean).join(' · ');
        button.addEventListener('click', () => choose(city));
        results.append(button);
      });
      status.textContent = body.data.length ? 'Wybierz miejscowość z wyników.' : 'Nie znaleziono miejscowości w pobranych wynikach.';
      if (!body.complete) status.textContent += ' Katalog jest jeszcze wczytywany. Kliknij „Szukaj dalej”, aby rozszerzyć wyniki.';
      if (body.more) status.textContent += ' Wyświetlono pierwsze 50 wyników — wpisz dokładniejszą nazwę.';
      searchButton.textContent = body.complete ? 'Szukaj' : 'Szukaj dalej';
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; searchButton.disabled = false; }
  }
  searchButton.addEventListener('click', find);
  search.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); find(); } });
  createForm.addEventListener('submit', event => {
    if (busy || !cityId.value) {
      event.preventDefault();
      event.stopImmediatePropagation();
      status.textContent = 'Wyszukaj i wybierz miejscowość przed publikacją.';
      search.focus();
    }
  }, true);
}
