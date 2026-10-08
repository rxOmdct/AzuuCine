import { t } from '../i18n'
import type { ThemeMode } from '../types'
/**
 * Thèmes de couleur : à partir d'une seule couleur, on calcule
 *  - accent      : version lisible comme TEXTE sur le fond du thème résolu
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

/** Couleur de fond (canvas) de chaque thème résolu, pour calculer un accent lisible. */
const CANVAS: Record<Exclude<ThemeMode, 'auto'>, string> = {
  light: '#ffffff',
  dark: '#0a0a0a',
  night: '#000000',
  starfield: '#0a1230',
}

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

/**
 * Rend la couleur lisible comme texte sur le canvas donné :
 *  - canvas clair  → on assombrit vers le noir jusqu'à un contraste suffisant
 *  - canvas sombre → on éclaircit vers le blanc (comme avant)
 */
function readableOn(color: string, canvas: string): string {
  const target = luminance(canvas) > 0.5 ? 0 : 255 // vers noir ou vers blanc
  let c = color
  const base = rgb(color)
  for (let m = 0; m <= 1 && contrast(c, canvas) < 4.8; m += 0.05) {
    c = hex(base.map((v) => v + (target - v) * m) as [number, number, number])
  }
  return c
}

export interface ThemeColors {
  accent: string
  accentFill: string
  onAccent: string
}

function themeColors(color: string, resolved: Exclude<ThemeMode, 'auto'>): ThemeColors {
  const fill = isHexColor(color) ? color.toLowerCase() : DEFAULT_ACCENT
  const canvas = CANVAS[resolved]
  const darkCanvas = '#0a0a0a'
  const preset = THEME_PRESETS.find((p) => p.color === fill)
  // Les overrides d'accent des presets sont pensés pour un fond sombre :
  // sur fond clair on recalcule un accent assombri.
  const accent = resolved === 'light' ? readableOn(fill, canvas) : (preset?.accent ?? readableOn(fill, canvas))
  return {
    accent,
    accentFill: fill,
    onAccent: contrast('#ffffff', fill) >= contrast(darkCanvas, fill) ? '#ffffff' : darkCanvas,
  }
}

/** Compat : thème calculé pour le rendu sombre par défaut. */
export function themeFromColor(color: string): ThemeColors {
  return themeColors(color, 'dark')
}

/** Applique le thème à toute l'app (les classes Tailwind lisent ces variables). */
export function applyTheme(accentColor: string, mode: ThemeMode) {
  const resolved: Exclude<ThemeMode, 'auto'> =
    mode === 'auto'
      ? window.matchMedia?.('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : mode
  document.documentElement.dataset.theme = resolved
  const c = themeColors(accentColor, resolved)
  const root = document.documentElement.style
  root.setProperty('--color-accent', c.accent)
  root.setProperty('--color-accent-fill', c.accentFill)
  root.setProperty('--color-on-accent', c.onAccent)
  // Couleur de la barre du navigateur / de l'app installée
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CANVAS[resolved])
  // Retenu pour le prochain lancement : appliqué avant même le premier affichage (voir applySavedTheme)
  try {
    localStorage.setItem(BOOT_KEY, JSON.stringify({ color: accentColor, mode }))
  } catch {
    /* stockage indisponible : on garde le thème par défaut au lancement */
  }
}

const BOOT_KEY = 'azuucine:theme'
const MODES: ThemeMode[] = ['auto', 'light', 'dark', 'night', 'starfield']

/**
 * Au lancement, avant tout affichage (chargement de la langue, de la session, de la bibliothèque) :
 * on remet tout de suite la couleur et le mode choisis la dernière fois, au lieu du thème par défaut.
 */
export function applySavedTheme() {
  try {
    const saved = JSON.parse(localStorage.getItem(BOOT_KEY) ?? 'null') as { color?: unknown; mode?: unknown } | null
    if (!saved || !isHexColor(saved.color) || !MODES.includes(saved.mode as ThemeMode)) return
    applyTheme(saved.color, saved.mode as ThemeMode)
  } catch {
    /* valeur illisible : thème par défaut */
  }
}

export const THEME_MODES: { value: ThemeMode; readonly label: string }[] = [
  { value: 'auto', get label() { return t('theme.modeAuto') } },
  { value: 'light', get label() { return t('theme.modeLight') } },
  { value: 'dark', get label() { return t('theme.modeDark') } },
  { value: 'night', get label() { return t('theme.modeNight') } },
  { value: 'starfield', get label() { return t('theme.modeStarfield') } },
]
