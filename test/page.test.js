// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { preventFraming, showUpdateToast, watchForWaitingWorker } from '../src/shared/page.js';

describe('preventFraming (clickjacking defense)', () => {
  it('does nothing when the page is not framed (self === top)', () => {
    let blanked = false;
    const win = { location: { href: 'https://x/vault.html' }, document: { documentElement: { replaceChildren: () => { blanked = true; } } } };
    win.self = win; win.top = win;
    preventFraming(win);
    expect(blanked).toBe(false);
  });

  it('breaks out of a same-origin frame by pointing the top window at self', () => {
    const top = { location: { href: 'about:blank' } };
    const win = { top, location: { href: 'https://x/vault.html' }, document: { documentElement: { replaceChildren: () => {} } } };
    win.self = win;
    preventFraming(win);
    expect(top.location).toBe('https://x/vault.html');
  });

  it('blanks the page when a cross-origin parent blocks the breakout', () => {
    let blanked = false;
    const top = {};
    Object.defineProperty(top, 'location', { get() { throw new Error('cross-origin'); } });
    const win = { top, location: { href: 'https://x/vault.html' }, document: { documentElement: { replaceChildren: () => { blanked = true; } } } };
    win.self = win;
    preventFraming(win);
    expect(blanked).toBe(true);
  });
});

describe('service worker "update ready" toast', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('renders once, and Refresh posts SKIP_WAITING to the waiting worker', () => {
    const posted = [];
    const worker = { postMessage: (m) => posted.push(m) };
    showUpdateToast(worker);
    showUpdateToast(worker); // second call must not stack a duplicate toast
    const toasts = document.querySelectorAll('#sw-update-toast');
    expect(toasts.length).toBe(1);
    expect(toasts[0].textContent).toMatch(/Update ready/);
    const refresh = [...toasts[0].querySelectorAll('button')].find((b) => b.textContent === 'Refresh');
    refresh.dispatchEvent(new window.Event('click'));
    expect(posted).toEqual([{ type: 'SKIP_WAITING' }]);
    expect(refresh.disabled).toBe(true); // no double-send while activating
  });

  it('Later dismisses the toast without touching the worker', () => {
    const posted = [];
    showUpdateToast({ postMessage: (m) => posted.push(m) });
    const later = [...document.querySelectorAll('#sw-update-toast button')].find((b) => b.textContent === 'Later');
    later.dispatchEvent(new window.Event('click'));
    expect(document.getElementById('sw-update-toast')).toBeNull();
    expect(posted).toEqual([]);
  });

  it('watchForWaitingWorker stays silent on the very first install (no controller)', () => {
    let called = 0;
    watchForWaitingWorker(
      { waiting: {}, addEventListener() {} },
      { controller: null },
      () => called++,
    );
    expect(called).toBe(0);
  });

  it('fires for an already-waiting worker AND for a new worker reaching installed', () => {
    const seen = [];
    const regListeners = {};
    const reg = {
      waiting: 'already-waiting',
      installing: null,
      addEventListener: (ev, fn) => { regListeners[ev] = fn; },
    };
    watchForWaitingWorker(reg, { controller: {} }, (w) => seen.push(w));
    expect(seen).toEqual(['already-waiting']);

    const workerListeners = {};
    reg.installing = { state: 'installing', addEventListener: (ev, fn) => { workerListeners[ev] = fn; } };
    regListeners.updatefound();
    reg.installing.state = 'installed';
    workerListeners.statechange();
    expect(seen).toEqual(['already-waiting', reg.installing]);
  });
});
