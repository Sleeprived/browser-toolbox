// Shared page bootstrap: clickjacking defense and service worker registration.

// Clickjacking defense (audit-6 M4). The CSP is delivered via a <meta> tag,
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

export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const base = new URL('.', document.baseURI);
  const swUrl = new URL('sw.js', base).href;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(swUrl).catch(() => {});
  });
}

// Auto-run in the browser; tests import the functions directly.
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  preventFraming();
  registerServiceWorker();
}
