// Index page tool filter: instant, case-insensitive match against each tile's
// name + description. Clearing the box restores every tile; no matches shows a
// plain empty-state line. Pure DOM filtering — nothing is stored or sent.

const input = document.getElementById('tool-search');
const cards = [...document.querySelectorAll('.tool-card')];
const empty = document.getElementById('no-tools');

function applyFilter() {
  const q = input.value.trim().toLowerCase();
  let shown = 0;
  for (const card of cards) {
    const show = !q || card.textContent.toLowerCase().includes(q);
    card.classList.toggle('hidden', !show);
    if (show) shown++;
  }
  empty.classList.toggle('hidden', shown > 0);
}

input.addEventListener('input', applyFilter);
// type="search" gives a native clear control; Escape also empties the box.
input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && input.value) {
    input.value = '';
    applyFilter();
  }
});
