const search = document.querySelector('[data-search]');
const filter = document.querySelector('[data-filter]');
function filterAdverts() {
  const term = search.value.trim().toLocaleLowerCase('pl');
  let count = 0;
  document.querySelectorAll('[data-advert]').forEach(card => {
    card.hidden = !card.dataset.title.includes(term) || (filter.value && card.dataset.status !== filter.value);
    if (!card.hidden) count++;
  });
  document.querySelector('[data-count]').textContent = `Widoczne na stronie: ${count}`;
  document.querySelector('[data-empty]').hidden = count !== 0;
}
search?.addEventListener('input', filterAdverts);
filter?.addEventListener('change', filterAdverts);
const editor = document.querySelector('[data-editor]');
if (editor) {
  let dirty = false;
  let submitting = false;
  editor.addEventListener('input', () => { dirty = true; });
  window.addEventListener('beforeunload', event => {
    if (dirty && !submitting) { event.preventDefault(); event.returnValue = ''; }
  });
  editor.addEventListener('submit', event => {
    if (submitting) { event.preventDefault(); return; }
    submitting = true;
    editor.querySelector('button[type="submit"]').disabled = true;
    editor.querySelector('[data-saving]').textContent = 'Zapisywanie w OLX…';
  });
  window.addEventListener('pageshow', () => {
    submitting = false;
    editor.querySelector('button[type="submit"]').disabled = false;
    editor.querySelector('[data-saving]').textContent = '';
  });
}
