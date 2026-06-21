// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { initThemeToggle } from '../src/shared/page.js';

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
