import { getLang } from '../i18n'
import type { ThemeMode } from '../types'

/** Version de l'app (package.json). */
export const APP_VERSION = __APP_VERSION__

/** Navigateur et système, en clair et sans détail identifiant (« Chrome 129 », « Android 14 »). */
export function browserInfo(ua = navigator.userAgent): { browser: string; os: string } {
  const m = (re: RegExp) => ua.match(re)?.[1]?.split('.')[0]
  const browser = /Edg\//.test(ua)
    ? `Edge ${m(/Edg\/([\d.]+)/) ?? ''}`
    : /OPR\//.test(ua)
      ? `Opera ${m(/OPR\/([\d.]+)/) ?? ''}`
      : /SamsungBrowser\//.test(ua)
        ? `Samsung Internet ${m(/SamsungBrowser\/([\d.]+)/) ?? ''}`
        : /Firefox\/|FxiOS\//.test(ua)
          ? `Firefox ${m(/(?:Firefox|FxiOS)\/([\d.]+)/) ?? ''}`
          : /CriOS\/|Chrome\//.test(ua)
            ? `Chrome ${m(/(?:CriOS|Chrome)\/([\d.]+)/) ?? ''}`
            : /Safari\//.test(ua)
              ? `Safari ${m(/Version\/([\d.]+)/) ?? ''}`
              : 'Other'
  const os = /Android/.test(ua)
    ? `Android ${m(/Android ([\d.]+)/) ?? ''}`
    : /iPhone|iPad|iPod/.test(ua)
      ? `iOS ${ua.match(/OS (\d+)_/)?.[1] ?? ''}`
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Other'
  return { browser: browser.trim(), os: os.trim() }
}

/** Page affichée, sans ce qui pourrait identifier quelqu'un (« #/u/pseudo » → « #/u »). */
export const currentRoute = () => (location.hash.match(/^#\/[a-z-]{1,20}/i)?.[0] ?? '#/') || '#/'

/**
 * Infos techniques jointes à un signalement de bug (affichées avant l'envoi).
 * Rien de personnel : ni compte, ni e-mail, ni contenu de la bibliothèque.
 */
export function techInfo(theme: ThemeMode): Record<string, string> {
  const { browser, os } = browserInfo()
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  return {
    version: APP_VERSION,
    browser,
    os,
    lang: getLang(),
    theme,
    screen: `${screen.width}×${screen.height} @${Math.round((window.devicePixelRatio || 1) * 10) / 10}x`,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    route: currentRoute(),
    standalone: standalone ? 'yes' : 'no',
    online: navigator.onLine ? 'yes' : 'no',
  }
}
