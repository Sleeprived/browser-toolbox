// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { initThemeToggle, preventFraming } from '../src/shared/page.js';

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.body.innerHTML = '<button class="theme-toggle" type="button" aria-pressed="false">Light</button>';
});

describe('theme toggle', () => {
  it('starts dark with aria-pressed=false', () => {
    initThemeToggle();
    const btn = document.querySelector('.theme-toggle');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.textContent).toBe('Light');
  });

  it('toggles to light with aria-pressed=true', () => {
    initThemeToggle();
    const btn = document.querySelector('.theme-toggle');
    btn.dispatchEvent(new window.Event('click'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.textContent).toBe('Dark');
  });
});

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
