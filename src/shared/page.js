// Shared page bootstrap: clickjacking defense and service worker registration.

// Clickjacking defense. The CSP is delivered via a <meta> tag,
// which cannot carry frame-ancestors, and GitHub Pages cannot send X-Frame-Options,
// so bust frames in JS: if framed, try to break out; if a cross-origin parent
// blocks that, blank the page so it cannot be overlaid for UI-redress.
export function preventFraming(win = (typeof window !== 'undefined' ? window : undefined)) {
  if (!win) return;
  try {
    if (win.self !== win.top) {
      try { win.top.location = win.self.location.href; }
      catch { win.document.documentElement.replaceChildren(); }
    }
  } catch {
    try { win.document.documentElement.replaceChildren(); } catch { /* nothing else to do */ }
  }
}

// "Update ready" toast. Exported for tests: builds the toast and wires its
// Refresh button to tell the given waiting worker to take over.
export function showUpdateToast(waitingWorker, doc = document) {
  if (doc.getElementById('sw-update-toast')) return; // already showing
  const toast = doc.createElement('div');
  toast.id = 'sw-update-toast';
  toast.className = 'update-toast';
  toast.setAttribute('role', 'status');
  const msg = doc.createElement('span');
  msg.textContent = 'Update ready — refresh to get the newest version.';
  const refresh = doc.createElement('button');
  refresh.type = 'button';
  refresh.className = 'btn';
  refresh.textContent = 'Refresh';
  refresh.addEventListener('click', () => {
    refresh.disabled = true;
    // The worker's activation fires controllerchange, which reloads the page.
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  });
  const later = doc.createElement('button');
  later.type = 'button';
  later.className = 'btn secondary';
  later.textContent = 'Later';
  later.addEventListener('click', () => toast.remove());
  toast.append(msg, refresh, later);
  doc.body.appendChild(toast);
}

// Exported for tests: show the toast for an already-waiting worker, and watch
// a registration for a new worker reaching the installed (= waiting) state.
export function watchForWaitingWorker(reg, container, onWaiting) {
  // Only offer an update when a controller exists — on the very first install
  // there is nothing to update. Checked per event rather than once up front,
  // so a first-visit tab still gets the toast for a deploy during its session.
  const offer = (worker) => { if (container.controller) onWaiting(worker); };
  if (reg.waiting) offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const incoming = reg.installing;
    if (!incoming) return;
    incoming.addEventListener('statechange', () => {
      if (incoming.state === 'installed') offer(incoming);
    });
  });
}

export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const base = new URL('.', document.baseURI);
  const swUrl = new URL('sw.js', base).href;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(swUrl)
      .then((reg) => watchForWaitingWorker(reg, navigator.serviceWorker, showUpdateToast))
      .catch(() => {});
  });
  // Reload once when the accepted update takes control. Guards: `reloaded`
  // (re-entry flag — can never reload-loop) and `hadController` (the FIRST
  // install claiming the page must not trigger a reload).
  let reloaded = false;
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}

// Auto-run in the browser; tests import the functions directly.
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  preventFraming();
  registerServiceWorker();
}
