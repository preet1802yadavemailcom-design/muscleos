/**
 * Theme management: dark mode + custom primary color.
 *
 * The app uses shadcn-style HSL CSS variables (--primary, --ring, etc.)
 * defined in styles/globals.css. This module reads/writes a persisted theme
 * ({ dark: boolean, primary: hex string }) and applies it by:
 *   - toggling the `.dark` class on <html>
 *   - setting inline HSL variables on the <html> element (inline styles win
 *     over both the `:root` and `.dark` blocks in the stylesheet)
 */

export interface ThemeSettings {
  dark: boolean;
  /** Primary color as a hex string, e.g. '#2563eb'. */
  primary: string;
}

const STORAGE_KEY = 'muscleos-theme';

/** Defaults match the design tokens in globals.css (slate-based). */
export const DEFAULT_THEME: ThemeSettings = {
  dark: false,
  primary: '#0f172a',
};

/** Hex (#rrggbb or #rgb) → { h, s, l } in [0..360] / [0..100] / [0..100]. */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  let value = hex.replace('#', '').trim();
  if (value.length === 3) {
    value = value
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const num = parseInt(value, 16);
  if (Number.isNaN(num) || value.length !== 6) {
    return { h: 222, s: 47, l: 11 };
  }
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;

  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  return {
    h,
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/** Pick a readable foreground color (white or near-black) for a given background. */
export function contrastText(hex: string): string {
  let value = hex.replace('#', '').trim();
  if (value.length === 3) {
    value = value
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const num = parseInt(value, 16);
  if (Number.isNaN(num) || value.length !== 6) return '210 40% 98%';
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  // Perceived luminance (WCAG relative luminance approximation).
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '222.2 47.4% 11.2%' : '210 40% 98%';
}

export function loadTheme(): ThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw) as Partial<ThemeSettings>;
    return {
      dark: typeof parsed.dark === 'boolean' ? parsed.dark : DEFAULT_THEME.dark,
      primary:
        typeof parsed.primary === 'string' && /^#[0-9a-fA-F]{6}$/.test(parsed.primary)
          ? parsed.primary
          : DEFAULT_THEME.primary,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(theme: ThemeSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // Storage unavailable (private mode, etc.) — theme still applies for this session.
  }
}

/** Applies the theme to the document: .dark class + inline HSL variables. */
export function applyTheme(theme: ThemeSettings): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme.dark);

  const { h, s, l } = hexToHsl(theme.primary);
  const primary = `${h} ${s}% ${l}%`;
  const ring = `${h} ${Math.min(s, 70)}% ${Math.min(l + 20, 90)}%`;

  // Inline styles override both :root and .dark blocks, so the brand color
  // applies consistently in light and dark mode.
  root.style.setProperty('--primary', primary);
  root.style.setProperty('--ring', ring);
  root.style.setProperty('--primary-foreground', contrastText(theme.primary));
}
