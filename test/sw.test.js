// Service worker stale-while-revalidate: when the cached copy is served,
// nothing awaits the background refresh — it must be handed to event.waitUntil
// or the browser may stop the idle worker before the fetch/cache.put complete
// and the documented self-heal silently never happens.
import { describe, it, expect, vi } from 'vitest';

const tick = () => new Promise((r) => setTimeout(r, 0));

// Loads sw.js under mocked SW globals. cache.put stays pending until the test
// releases it, so a test can observe whether the waitUntil promise covers it.
async function loadSw() {
  const handlers = {};
  const puts = [];
  let finishPut = null;
  const cache = {
    add: async () => {},
    match: async () => undefined,
    put: (key) =>
      new Promise((resolve) => {
        finishPut = () => { puts.push(String(key)); resolve(); };
      }),
  };
  globalThis.self = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    registration: { scope: 'https://toolbox.test/' },
    location: new URL('https://toolbox.test/sw.js'),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  globalThis.caches = {
    open: async () => cache,
    match: async () => undefined,
    keys: async () => [],
    delete: async () => true,
  };
  globalThis.fetch = async () => ({ ok: true, type: 'basic', clone: () => ({}) });
  vi.resetModules();
  await import('../sw.js');
  return {
    handlers,
    puts,
    putPending: () => finishPut !== null,
    releasePut: () => { if (finishPut) finishPut(); },
  };
}

function fetchEvent(url, mode) {
  const ev = {
    request: { method: 'GET', url, mode },
    waits: [],
    response: null,
  };
  ev.respondWith = (p) => { ev.response = Promise.resolve(p); };
  ev.waitUntil = (p) => { ev.waits.push(Promise.resolve(p)); };
  return ev;
}

describe('sw.js stale-while-revalidate worker lifetime', () => {
  it('serves the cached asset and keeps the event alive until the refresh is written', async () => {
    const sw = await loadSw();
    const cachedResp = { fromCache: true };
    globalThis.caches.match = async () => cachedResp;

    const ev = fetchEvent('https://toolbox.test/src/morse/keyer.js', 'no-cors');
    sw.handlers.fetch(ev);
    for (let i = 0; i < 10 && !ev.waits.length; i++) await tick();

    expect(await ev.response).toBe(cachedResp); // stale copy served immediately
    expect(ev.waits.length).toBe(1);            // revalidation handed to waitUntil

    let settled = false;
    ev.waits[0].then(() => { settled = true; });
    for (let i = 0; i < 10 && !sw.putPending(); i++) await tick();
    expect(sw.putPending()).toBe(true);
    await tick();
    expect(settled).toBe(false); // the waitUntil promise covers the pending put
    sw.releasePut();
    await tick();
    expect(settled).toBe(true);
    expect(sw.puts.length).toBe(1);
  });

  it('navigations: the refresh lands under the search-stripped URL, inside waitUntil', async () => {
    const sw = await loadSw();
    globalThis.caches.match = async () => ({ shell: true });

    const ev = fetchEvent('https://toolbox.test/morse.html?share=1', 'navigate');
    sw.handlers.fetch(ev);
    for (let i = 0; i < 10 && !sw.putPending(); i++) await tick();

    expect(ev.waits.length).toBe(1);
    sw.releasePut();
    await tick();
    expect(sw.puts).toEqual(['https://toolbox.test/morse.html']);
  });
});
