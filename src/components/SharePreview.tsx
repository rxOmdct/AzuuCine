import { t } from '../i18n'
import { Download, Share2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { shareImage } from '../lib/shareCard'

interface Props {
  blob: Blob
  filename: string
  title: string
  onClose: () => void
}

/** Aperçu de l'image générée avant de la partager ou de l'enregistrer. */
export default function SharePreview({ blob, filename, title, onClose }: Props) {
  const [url, setUrl] = useState<string>()
  const [busy, setBusy] = useState(false)
  const canShare = useMemo(() => {
    try {
      return !!navigator.canShare?.({ files: [new File([blob], filename, { type: 'image/png' })] })
    } catch {
      return false
    }
  }, [blob, filename])

  // L'adresse temporaire de l'image est créée puis libérée avec l'aperçu
  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const go = async () => {
    setBusy(true)
    try {
      await shareImage(blob, filename, title)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sheet-in fixed inset-0 z-[60] flex flex-col bg-bg/95 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t('share.previewLabel')}>
      <div className="safe-top flex items-center justify-between px-3 py-2.5">
        <button onClick={onClose} className="grid size-10 place-items-center rounded-full text-ink-2" aria-label={t('common.close')}>
          <X size={22} />
        </button>
        <span className="text-sm font-semibold">{t('share.preview')}</span>
        <span className="size-10" />
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-6">
        {url && <img src={url} alt={t('share.posterAlt', { title })} className="max-h-full max-w-full rounded-2xl border border-line object-contain" />}
      </div>
      <div className="safe-bottom mx-auto grid w-full max-w-md grid-cols-1 gap-2 px-4 pb-4 pt-4">
        <button onClick={go} disabled={busy} className="btn btn-primary py-3">
          {canShare ? <Share2 size={18} /> : <Download size={18} />}
          {canShare ? t('share.share') : t('share.saveImage')}
        </button>
      </div>
    </div>
  )
}
