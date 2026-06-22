// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { preventFraming } from '../src/shared/page.js';

describe('preventFraming (clickjacking defense, audit-6 M4)', () => {
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
