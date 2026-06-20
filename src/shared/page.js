// Shared page bootstrap: wires the theme toggle and registers the service worker.
// Theme defaults to dark on every load and the toggle does NOT persist (stateless
// by design — see spec Decisions Locked).

function initThemeToggle() {
  const btn = document.querySelector('.theme-toggle');
  if (!btn) return;
  const apply = (light) => {
    if (light) document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    btn.textContent = light ? 'Dark' : 'Light';
    btn.setAttribute('aria-pressed', String(light));
  };
  apply(false);
  btn.addEventListener('click', () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    apply(!isLight);
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Resolve sw.js relative to the site root (works under a project subpath on Pages).
  const base = new URL('.', document.baseURI);
  const swUrl = new URL('sw.js', base).href;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(swUrl).catch(() => {
      /* offline support is best-effort; ignore registration errors */
    });
  });
}

initThemeToggle();
registerServiceWorker();
