import { genreLabel } from './genres'
import { t } from '../i18n'
import type { MediaItem, RatingScale } from '../types'
import { TYPE_BY_VALUE } from './constants'
import { episodeCap } from './franchise'
import { safePosterUrl } from './security'
import { formatRating } from './utils'

/**
 * Génère des images à partager (story / message) directement dans le navigateur,
 * avec un <canvas> : fiche d'un titre, ou Top 5.
 */

const W = 1080
const H = 1350
const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function colors() {
  return {
    bg: '#0a0a0a',
    surface: '#161615',
    line: '#2a2a28',
    ink: '#f4f2ee',
    ink2: '#b3b0a8',
    ink3: '#8a8781',
    accent: cssVar('--color-accent', '#ef4444'),
    fill: cssVar('--color-accent-fill', '#d11f2f'),
  }
}

/** Charge une image utilisable dans le canvas (null si le serveur l'interdit). */
async function loadImage(raw?: string): Promise<HTMLImageElement | null> {
  const src = safePosterUrl(raw)
  if (!src) return null
  try {
    let url = src
    let revoke = false
    if (!src.startsWith('data:')) {
      const res = await fetch(src, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' })
      if (!res.ok) return null
      url = URL.createObjectURL(await res.blob())
      revoke = true
    }
    const img = new Image()
    img.src = url
    await img.decode()
    if (revoke) setTimeout(() => URL.revokeObjectURL(url), 5000)
    return img
  } catch {
    return null
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Affiche en « cover » dans un rectangle arrondi (ou vignette avec l'initiale). */
function drawPoster(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  title: string,
  x: number,
  y: number,
  w: number,
  h: number,
  r = 24,
  /** Point de cadrage vertical (0 = haut, 0,5 = centre) */
  focusY = 0.5,
) {
  const c = colors()
  ctx.save()
  roundRect(ctx, x, y, w, h, r)
  ctx.clip()
  if (img) {
    const scale = Math.max(w / img.width, h / img.height)
    const iw = img.width * scale
    const ih = img.height * scale
    ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) * focusY, iw, ih)
  } else {
    ctx.fillStyle = c.surface
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = c.ink3
    ctx.font = `700 ${Math.round(w * 0.35)}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(title.trim().charAt(0).toUpperCase() || '?', x + w / 2, y + h / 2)
    ctx.fillStyle = c.fill
    ctx.fillRect(x, y + h - 8, w / 3, 8)
  }
  ctx.restore()
  ctx.strokeStyle = c.line
  ctx.lineWidth = 2
  roundRect(ctx, x, y, w, h, r)
  ctx.stroke()
}

/** Coupe un texte en lignes qui tiennent dans maxWidth (avec « … » si trop long). */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width <= maxWidth) line = test
    else {
      if (line) lines.push(line)
      line = word
      if (lines.length === maxLines) break
    }
  }
  if (lines.length < maxLines && line) lines.push(line)
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    let last = lines[maxLines - 1]
    while (ctx.measureText(last + '…').width > maxWidth && last.length) last = last.slice(0, -1)
    lines[maxLines - 1] = last.trimEnd() + '…'
  }
  return lines
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    ctx.lineTo(cx + rad * Math.cos(a), cy + rad * Math.sin(a))
  }
  ctx.closePath()
}

/** 5 étoiles avec demi-étoiles, ou « 8,5/10 ». Renvoie la largeur dessinée. */
function drawRating(ctx: CanvasRenderingContext2D, rating: number, scale: RatingScale, x: number, y: number, size: number): number {
  const c = colors()
  if (scale === '10') {
    ctx.font = `700 ${size}px ${FONT}`
    ctx.fillStyle = c.accent
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const t = `${formatRating(rating, '10')}/10`
    ctx.fillText(t, x, y)
    return ctx.measureText(t).width
  }
  const stars = rating / 2
  const gap = size * 0.25
  for (let i = 0; i < 5; i++) {
    const cx = x + size / 2 + i * (size + gap)
    const fill = Math.max(0, Math.min(1, stars - i))
    drawStar(ctx, cx, y, size / 2)
    ctx.fillStyle = c.line
    ctx.fill()
    if (fill > 0) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(cx - size / 2, y - size / 2, size * fill, size)
      ctx.clip()
      drawStar(ctx, cx, y, size / 2)
      ctx.fillStyle = c.accent
      ctx.fill()
      ctx.restore()
    }
  }
  return 5 * size + 4 * gap
}

function drawBrand(ctx: CanvasRenderingContext2D, y: number) {
  const c = colors()
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.font = `700 34px ${FONT}`
  const a = 'Azuu'
  const total = ctx.measureText('AzuuCine').width
  const x = (W - total) / 2
  ctx.fillStyle = c.ink
  ctx.fillText(a, x, y)
  ctx.fillStyle = c.accent
  ctx.fillText('Cine', x + ctx.measureText(a).width, y)
}

async function newCanvas() {
  try {
    await Promise.all([document.fonts.load(`700 40px Inter`), document.fonts.load(`400 40px Inter`), document.fonts.load(`600 40px Inter`)])
  } catch {
    /* police système en secours */
  }
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = colors().bg
  ctx.fillRect(0, 0, W, H)
  return { canvas, ctx }
}

const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('share.err.create')))), 'image/png'))

/** Texte en capitales avec un léger espacement (si le navigateur le permet). */
function setTracking(ctx: CanvasRenderingContext2D, px: number) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  if ('letterSpacing' in c) c.letterSpacing = `${px}px`
}

/** Plus grande taille de police (≤ max) pour que le texte tienne sur une ligne ; sinon null. */
function fitSize(ctx: CanvasRenderingContext2D, text: string, weight: number, max: number, min: number, width: number): number | null {
  for (let size = max; size >= min; size -= 2) {
    ctx.font = `${weight} ${size}px ${FONT}`
    if (ctx.measureText(text).width <= width) return size
  }
  return null
}

export interface CardCredits {
  directors: string[]
  producers: string[]
  cast: string[]
  runtime?: number
  image?: string
}

/** Pour les affiches TMDB déjà en ligne, on demande une version plus grande (plus nette). */
const hiRes = (url?: string) => (url?.startsWith('https://image.tmdb.org/t/p/w342/') ? url.replace('/w342/', '/w780/') : url)

/**
 * Affiche d'une fiche, façon « poster minimaliste » :
 * image en haut, gros titre en capitales + année, puis une fiche technique
 * (durée, réalisation, production, casting, genres, ma note) — aux couleurs d'AzuuCine.
 */
export async function renderItemCard(item: MediaItem, scale: RatingScale, credits?: CardCredits): Promise<Blob> {
  const { canvas, ctx } = await newCanvas()
  const c = colors()
  // Image de scène HD si TMDB en fournit une, sinon l'affiche (en HD si possible)
  const poster = (credits?.image ? await loadImage(credits.image) : null) ?? (await loadImage(hiRes(item.poster))) ?? (await loadImage(item.poster))
  const isScene = !!credits?.image?.includes('/w1280/')

  // Carte
  const cx = 56
  const cy = 56
  const cw = W - 112
  const ch = H - 112
  ctx.fillStyle = c.surface
  roundRect(ctx, cx, cy, cw, ch, 40)
  ctx.fill()

  // Fiche technique
  const episodic = TYPE_BY_VALUE[item.type].episodic
  const minutes = credits?.runtime ?? item.duration
  const rows: [string, string][] = []
  const totalEps = episodeCap(item)
  if (episodic && totalEps) {
    rows.push([t('form.episodes'), `${t('stats.episodesN', { count: totalEps })}${item.episodeDuration ? ` · ${t('common.minutes', { n: item.episodeDuration })}` : ''}`])
  } else if (!episodic && minutes) {
    rows.push([t('form.duration'), t('share.minutesLong', { n: minutes })])
  }
  const notesDirector = item.notes?.match(/Réalisation\s*:\s*(.+)/)?.[1]
  const directors = credits?.directors.length ? credits.directors : notesDirector ? [notesDirector.trim()] : []
  if (directors.length) rows.push([episodic ? t('share.createdBy') : t('share.directedBy'), directors.join('  ·  ')])
  if (credits?.producers.length) rows.push([t('share.producedBy'), credits.producers.join('  ·  ')])
  if (credits?.cast.length) rows.push([t('share.starring'), credits.cast.join('  ·  ')])
  if (item.genres.length) rows.push([t('share.genres'), item.genres.slice(0, 3).map(genreLabel).join('  ·  ')])
  if (!credits?.cast.length && item.platform) rows.push([t('form.platform'), item.platform])

  // Image (cadrée sur le haut de l'affiche, là où sont souvent les visages).
  // Moins il y a de lignes d'infos, plus l'image est grande : pas de vide en bas de carte.
  const pad = 44
  const ix = cx + pad
  const iy = cy + pad
  const iw = cw - pad * 2
  const ih = Math.min(840, 690 + Math.max(0, 5 - rows.length) * 46)
  drawPoster(ctx, poster, item.title, ix, iy, iw, ih, 22, isScene ? 0.5 : 0.28)

  // Titre + année
  const title = item.title.toUpperCase()
  const year = item.year ? String(item.year) : ''
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  setTracking(ctx, -2)
  ctx.font = `600 42px ${FONT}`
  const yearW = year ? ctx.measureText(year).width + 16 : 0
  let y = iy + ih + 118
  const size = fitSize(ctx, title, 900, 104, 64, iw - yearW)
  ctx.fillStyle = c.ink
  if (size) {
    ctx.font = `900 ${size}px ${FONT}`
    ctx.fillText(title, ix, y)
    const tw = ctx.measureText(title).width
    if (year) {
      setTracking(ctx, 0)
      ctx.font = `600 42px ${FONT}`
      ctx.fillStyle = c.accent
      ctx.fillText(year, ix + tw + 16, y)
    }
  } else {
    // Titre très long : deux lignes plus petites
    ctx.font = `900 62px ${FONT}`
    const lines = wrap(ctx, title, iw, 2)
    y -= 58
    lines.forEach((l, i) => ctx.fillText(l, ix, y + i * 64))
    y += (lines.length - 1) * 64
    if (year) {
      setTracking(ctx, 0)
      const last = lines[lines.length - 1]
      const lw = ctx.measureText(last).width
      ctx.font = `600 36px ${FONT}`
      ctx.fillStyle = c.accent
      ctx.fillText(year, Math.min(ix + lw + 14, ix + iw - ctx.measureText(year).width), y)
    }
  }
  setTracking(ctx, 0)

  const labelW = 220
  const valueX = ix + labelW
  const valueW = iw - labelW
  y += 58
  const bottom = cy + ch - 120
  for (const [label, value] of rows) {
    if (y > bottom) break
    ctx.font = `600 22px ${FONT}`
    setTracking(ctx, 1.5)
    ctx.fillStyle = c.ink3
    ctx.fillText(label.toUpperCase(), ix, y)
    ctx.font = `700 25px ${FONT}`
    setTracking(ctx, 0.5)
    ctx.fillStyle = c.ink
    const lines = wrap(ctx, value.toUpperCase(), valueW, 2)
    lines.forEach((l, i) => ctx.fillText(l, valueX, y + i * 32))
    y += 32 * lines.length + 16
  }
  setTracking(ctx, 0)

  // Pied de carte : ma note à gauche, marque à droite
  const fy = cy + ch - 56
  if (item.rating) {
    ctx.font = `600 22px ${FONT}`
    setTracking(ctx, 1.5)
    ctx.fillStyle = c.ink3
    ctx.fillText(t('share.myRating').toUpperCase(), ix, fy + 9)
    setTracking(ctx, 0)
    drawRating(ctx, item.rating, scale, valueX, fy, 34)
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `800 30px ${FONT}`
  const brandW = ctx.measureText('AzuuCine').width
  const bx = ix + iw - brandW
  ctx.fillStyle = c.ink
  ctx.fillText('Azuu', bx, fy + 11)
  ctx.fillStyle = c.accent
  ctx.fillText('Cine', bx + ctx.measureText('Azuu').width, fy + 11)

  return toBlob(canvas)
}

/** Image d'un Top 5 : n°1 en grand, n°2 à 5 à côté. */
export async function renderTopCard(title: string, entries: (MediaItem | undefined)[]): Promise<Blob> {
  const { canvas, ctx } = await newCanvas()
  const c = colors()
  const imgs = await Promise.all(entries.map((e) => loadImage(e?.poster)))

  // Titre « Mon Top 5 · Films »
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `700 72px ${FONT}`
  let x = 80
  ctx.fillStyle = c.ink
  const heading = `${t('share.myTop')} `
  ctx.fillText(heading, x, 150)
  x += ctx.measureText(heading).width
  ctx.fillStyle = c.accent
  ctx.fillText('5', x, 150)
  ctx.fillStyle = c.ink3
  ctx.font = `600 30px ${FONT}`
  ctx.fillText(title.toUpperCase(), 80, 205)

  // N°1
  const bigW = 460
  const bigH = 690
  const top = 270
  ctx.font = `900 300px ${FONT}`
  ctx.lineWidth = 5
  ctx.strokeStyle = c.accent
  ctx.textBaseline = 'alphabetic'
  ctx.strokeText('1', 50, top + 520)
  drawPoster(ctx, imgs[0], entries[0]?.title ?? '?', 150, top, bigW - 90, bigH - 135, 24)
  ctx.fillStyle = c.ink
  ctx.font = `700 34px ${FONT}`
  const t1 = wrap(ctx, entries[0]?.title ?? '—', bigW - 90, 2)
  t1.forEach((l, i) => ctx.fillText(l, 150, top + bigH - 85 + i * 42))

  // N°2 à 5 en grille 2×2
  const gx = 590
  const cw = 200
  const ch = 300
  const cells = [
    [gx, top],
    [gx + cw + 30, top],
    [gx, top + ch + 110],
    [gx + cw + 30, top + ch + 110],
  ]
  cells.forEach(([cx, cy], k) => {
    const idx = k + 1
    const e = entries[idx]
    drawPoster(ctx, imgs[idx], e?.title ?? '?', cx, cy, cw, ch, 18)
    // numéro dans une pastille
    ctx.fillStyle = c.bg
    ctx.beginPath()
    ctx.arc(cx + 34, cy + 34, 26, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = c.ink
    ctx.font = `800 30px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(idx + 1), cx + 34, cy + 35)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = c.ink2
    ctx.font = `600 24px ${FONT}`
    ctx.fillText(wrap(ctx, e?.title ?? '—', cw, 1)[0] ?? '', cx, cy + ch + 38)
  })

  drawBrand(ctx, H - 60)
  return toBlob(canvas)
}

/** Ouvre la feuille de partage (mobile) ou télécharge l'image. */
export async function shareImage(blob: Blob, filename: string, title: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], filename, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'shared'
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return 'downloaded'
}

export const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'azuucine'
