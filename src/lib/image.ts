import { t } from '../i18n'
import { LIMITS, safePosterUrl } from './security'

/**
 * Convertit une image (photo de la galerie, affiche téléchargée…) en petit JPEG
 * compressé (data URL), pour garder la base légère et 100 % hors-ligne.
 */
export function blobToPosterDataURL(blob: Blob, maxWidth = 360, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const ratio = Math.min(1, maxWidth / img.width)
      const w = Math.round(img.width * ratio)
      const h = Math.round(img.height * ratio)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error(t('image.canvas')))
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(t('image.unreadable')))
    }
    img.src = url
  })
}

/** Photo choisie par l'utilisateur : uniquement des images, taille raisonnable. */
export function fileToPosterDataURL(file: File) {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return Promise.reject(new Error(t('image.notImage')))
  if (file.size > LIMITS.imageFileBytes) return Promise.reject(new Error(t('image.tooBig')))
  // Le passage par un canvas ré-encode l'image en JPEG : aucune donnée cachée (EXIF, GPS…) n'est conservée
  return blobToPosterDataURL(file)
}

/**
 * Télécharge une affiche distante et la garde en local (visible hors-ligne).
 * Si le serveur refuse (CORS, réseau), on garde simplement l'URL.
 */
export async function remotePosterToLocal(url: string): Promise<string | undefined> {
  const safe = safePosterUrl(url)
  if (!safe || safe.startsWith('data:')) return safe
  try {
    const res = await fetch(safe, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' })
    const blob = await res.blob()
    if (!res.ok || !blob.type.startsWith('image/') || blob.size > LIMITS.imageFileBytes) return safe
    return await blobToPosterDataURL(blob)
  } catch {
    return safe
  }
}

/**
 * Photo de profil ou bannière : recadrée au centre aux dimensions voulues et ré-encodée en JPEG
 * (aucune métadonnée cachée n'est conservée).
 */
export function cropImageToJpeg(file: File, width: number, height: number, quality = 0.86): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return Promise.reject(new Error(t('image.notImage')))
  if (file.size > LIMITS.imageFileBytes) return Promise.reject(new Error(t('image.tooBig')))
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.max(width / img.width, height / img.height)
      const sw = width / scale
      const sh = height / scale
      const sx = (img.width - sw) / 2
      const sy = (img.height - sh) / 2
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error(t('image.canvas')))
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height)
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('image.unreadable')))), 'image/jpeg', quality)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(t('image.unreadable')))
    }
    img.src = url
  })
}
