import { t } from '../i18n'
/**
 * Thèmes de couleur : à partir d'une seule couleur, on calcule
 *  - accent      : version lisible sur fond noir (texte, icônes, filets)
 *  - accentFill  : la couleur choisie, pour les boutons pleins
 *  - onAccent    : texte blanc ou noir sur ces boutons, selon ce qui se lit le mieux
 */

export const DEFAULT_ACCENT = '#d11f2f'

export const THEME_PRESETS: { readonly name: string; color: string; accent?: string }[] = [
  { get name() { return t('theme.red') }, color: '#d11f2f', accent: '#ef4444' },
  { get name() { return t('theme.orange') }, color: '#f97316' },
  { get name() { return t('theme.yellow') }, color: '#facc15' },
  { get name() { return t('theme.lime') }, color: '#a3e635' },
  { get name() { return t('theme.green') }, color: '#22c55e' },
  { get name() { return t('theme.mint') }, color: '#2dd4bf' },
  { get name() { return t('theme.cyan') }, color: '#06b6d4' },
  { get name() { return t('theme.blue') }, color: '#3b82f6' },
  { get name() { return t('theme.indigo') }, color: '#6366f1' },
  { get name() { return t('theme.violet') }, color: '#8b5cf6' },
  { get name() { return t('theme.pink') }, color: '#ec4899' },
  { get name() { return t('theme.white') }, color: '#e7e5e4' },
]

const BG = '#0a0a0a'

export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function hex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')
}

function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

/** Éclaircit la couleur vers le blanc jusqu'à être lisible sur le fond noir. */
function readableOnBlack(color: string): string {
  let c = color
  const base = rgb(color)
  for (let t = 0; t <= 1 && contrast(c, BG) < 4.8; t += 0.05) {
    c = hex(base.map((v) => v + (255 - v) * t) as [number, number, number])
  }
  return c
}

export interface ThemeColors {
  accent: string
  accentFill: string
  onAccent: string
}

export function themeFromColor(color: string): ThemeColors {
  const fill = isHexColor(color) ? color.toLowerCase() : DEFAULT_ACCENT
  const preset = THEME_PRESETS.find((p) => p.color === fill)
  return {
    accent: preset?.accent ?? readableOnBlack(fill),
    accentFill: fill,
    onAccent: contrast('#ffffff', fill) >= contrast(BG, fill) ? '#ffffff' : BG,
  }
}

/** Applique le thème à toute l'app (les classes Tailwind lisent ces variables). */
export function applyTheme(color: string) {
  const t = themeFromColor(color)
  const root = document.documentElement.style
  root.setProperty('--color-accent', t.accent)
  root.setProperty('--color-accent-fill', t.accentFill)
  root.setProperty('--color-on-accent', t.onAccent)
}
