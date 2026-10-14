import { useSyncExternalStore } from 'react';

// Appearance preference, saved per browser. 'sistema' follows the device's
// light/dark setting; 'claro' and 'escuro' force one of them.
const STORAGE_KEY = 'tema';
const listeners = new Set();
const darkQuery = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

export const THEME_OPTIONS = [
  { value: 'claro', label: 'Claro', icon: '☀️', hint: 'Fundo claro, sempre.' },
  { value: 'escuro', label: 'Escuro', icon: '🌙', hint: 'Fundo escuro, sempre.' },
  { value: 'sistema', label: 'Automático', icon: '🖥️', hint: 'Segue o modo do celular ou computador.' },
];

export function getThemePreference() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return THEME_OPTIONS.some((o) => o.value === saved) ? saved : 'sistema';
  } catch {
    return 'sistema';
  }
}

function isDark(pref) {
  return pref === 'escuro' || (pref === 'sistema' && Boolean(darkQuery?.matches));
}

export function applyTheme(pref = getThemePreference()) {
  const dark = isDark(pref);
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1120' : '#1d4ed8');
}

export function setThemePreference(pref) {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Storage blocked: the choice still applies until the page reloads.
  }
  applyTheme(pref);
  listeners.forEach((fn) => fn());
}

export function initTheme() {
  applyTheme();
  darkQuery?.addEventListener('change', () => {
    if (getThemePreference() === 'sistema') applyTheme('sistema');
  });
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useThemePreference() {
  return useSyncExternalStore(subscribe, getThemePreference);
}
