import { ArrowLeft, Check, ChevronDown, FileUp, Loader2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { t, type TKey } from '../i18n'
import { useBackToClose } from '../lib/backNav'
import { useEscape } from '../lib/escape'
import { ImportFileError, readImportFile, type TextFile } from '../lib/import/files'
import { buildImportPlan, countByKind, type ImportPlan } from '../lib/import/merge'
import { CancelledError, fetchAniListUser, isAniListUserName, resolveEntries, type CancelToken, type Match, type Progress } from '../lib/import/resolve'
import { letterboxdRole, parseLetterboxd, parseMal, parseTvTime, type ImportEntry, type ImportSource } from '../lib/import/sources'
import { useScrollLock } from '../lib/scrollLock'
import { LIMITS } from '../lib/security'
import { cx } from '../lib/utils'
import { useMedia } from '../store'

/**
 * Assistant « Importer depuis une autre app » : Letterboxd, TV Time, MyAnimeList, AniList.
 * Source → fichier (ou nom d'utilisateur) → recherche des fiches → aperçu → fusion → résumé.
 * Tout se passe sur l'appareil ; la synchro existante enverra ensuite les fiches au compte.
 */

type Step = 'source' | 'input' | 'working' | 'preview' | 'done'

const SOURCES: { id: ImportSource; name: string; mark: string; accept?: string; multiple?: boolean }[] = [
  { id: 'letterboxd', name: 'Letterboxd', mark: 'Lb', accept: '.zip,.csv,application/zip,text/csv', multiple: true },
  { id: 'tvtime', name: 'TV Time', mark: 'TV', accept: '.zip,.csv,application/zip,text/csv', multiple: true },
  { id: 'mal', name: 'MyAnimeList', mark: 'MAL', accept: '.xml,.gz,application/xml,text/xml,application/gzip' },
  { id: 'anilist', name: 'AniList', mark: 'AL' },
]

const NEEDS_TMDB: ImportSource[] = ['letterboxd', 'tvtime']

/** Message lisible pour une erreur de lecture / de réseau. */
function errorText(e: unknown): string {
  if (e instanceof ImportFileError) {
    const k = `import.err.${e.message}` as TKey
    return ['tooBig', 'badZip', 'encrypted', 'unsupported'].includes(e.message) ? t(k) : t('import.err.read')
  }
  const msg = (e as Error)?.message
  if (msg === 'anilist-user') return t('import.err.user')
  if (msg === 'rate') return t('err.anilistRate')
  if (!navigator.onLine) return t('search.offline')
  return msg || t('import.err.read')
}

async function readEntries(source: ImportSource, files: File[]): Promise<ImportEntry[]> {
  const texts: TextFile[] = []
  for (const f of files.slice(0, 40)) {
    const keep = source === 'letterboxd' ? (p: string) => !!letterboxdRole(p) : source === 'mal' ? (p: string) => /\.xml$/.test(p) : (p: string) => /\.csv$/.test(p)
    texts.push(...(await readImportFile(f, keep, LIMITS.importFileBytes)))
  }
  if (source === 'letterboxd') return parseLetterboxd(texts)
  if (source === 'tvtime') return parseTvTime(texts)
  const xml = texts.find((x) => x.text.includes('<myanimelist') || x.text.includes('<anime>'))
  if (!xml) throw new ImportFileError('read')
  return parseMal(xml.text)
}

export default function ImportWizard({ onClose }: { onClose: () => void }) {
  const { items, settings, importItems } = useMedia()
  const [step, setStep] = useState<Step>('source')
  const [source, setSource] = useState<ImportSource>()
  const [userName, setUserName] = useState('')
  const [error, setError] = useState<string>()
  const [phase, setPhase] = useState<'reading' | 'resolving' | 'saving'>('reading')
  const [progress, setProgress] = useState<Progress>({ done: 0, total: 0 })
  const [entries, setEntries] = useState<ImportEntry[]>([])
  const [matches, setMatches] = useState<Map<string, Match>>(new Map())
  const [includeUnmatched, setIncludeUnmatched] = useState(false)
  const [showMissing, setShowMissing] = useState(false)
  const [result, setResult] = useState<{ added: number; updated: number; unchanged: number; notFound: number }>()
  const [dragging, setDragging] = useState(false)
  const [now, setNow] = useState(Date.now())
  const token = useRef<CancelToken>({ cancelled: false })
  const fileRef = useRef<HTMLInputElement>(null)

  const close = () => {
    token.current.cancelled = true
    onClose()
  }
  useScrollLock()
  useEscape(close)
  useBackToClose(close)
  // Fermeture de l'assistant : la recherche en cours s'arrête
  useEffect(() => () => void (token.current.cancelled = true), [])

  // Compte à rebours pendant une pause imposée par la limite de débit
  useEffect(() => {
    if (!progress.waitUntil) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [progress.waitUntil])

  const info = SOURCES.find((s) => s.id === source)
  const hasTmdb = !!settings.tmdbKey?.trim()

  const plan: ImportPlan | undefined = useMemo(
    () => (step === 'preview' ? buildImportPlan(entries, matches, items, { includeUnmatched }) : undefined),
    [step, entries, matches, items, includeUnmatched],
  )

  const run = async (load: () => Promise<ImportEntry[]>) => {
    const tk = { cancelled: false }
    token.current = tk
    setError(undefined)
    setStep('working')
    setPhase('reading')
    setProgress({ done: 0, total: 0 })
    try {
      const list = await load()
      if (tk.cancelled) return
      if (!list.length) throw new Error(t('import.err.empty'))
      setEntries(list)
      setPhase('resolving')
      const found = await resolveEntries(list, { tmdbKey: settings.tmdbKey, token: tk, onProgress: (p) => !tk.cancelled && setProgress(p) })
      if (tk.cancelled) return
      setMatches(found)
      setShowMissing(false)
      setIncludeUnmatched(false)
      setStep('preview')
    } catch (e) {
      if (e instanceof CancelledError || tk.cancelled) return
      setError(errorText(e))
      setStep('input')
    }
  }

  const onFiles = (list: FileList | null | undefined) => {
    const files = Array.from(list ?? [])
    if (fileRef.current) fileRef.current.value = ''
    if (!files.length || !source || source === 'anilist') return
    void run(() => readEntries(source, files))
  }

  const onAniList = () => {
    const name = userName.trim()
    if (!isAniListUserName(name)) return setError(t('import.err.user'))
    void run(async () => (await fetchAniListUser(name)).entries)
  }

  const cancelWork = () => {
    token.current.cancelled = true
    setStep('input')
  }

  const confirm = async () => {
    if (!plan) return
    setStep('working')
    setPhase('saving')
    try {
      await importItems([...plan.added, ...plan.updated], 'merge')
      setResult({ added: plan.added.length, updated: plan.updated.length, unchanged: plan.unchanged, notFound: includeUnmatched ? 0 : plan.notFound.length })
      setStep('done')
    } catch (e) {
      setError(errorText(e))
      setStep('preview')
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    onFiles(e.dataTransfer?.files)
  }

  const back = () => {
    setError(undefined)
    setStep(step === 'preview' ? 'input' : 'source')
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  const wait = progress.waitUntil ? Math.max(0, Math.ceil((progress.waitUntil - now) / 1000)) : 0
  const kinds = plan ? countByKind(plan.added) : undefined

  return (
    <div className="sheet sheet-in z-[60]" role="dialog" aria-modal="true" aria-label={t('import.title')}>
      <header className="safe-top border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5 lg:max-w-none lg:px-10">
          {step === 'input' || step === 'preview' ? (
            <button onClick={back} className="grid size-10 shrink-0 place-items-center rounded-full text-ink-2 rtl:-scale-x-100" aria-label={t('import.back')}>
              <ArrowLeft size={21} />
            </button>
          ) : (
            <span className="size-10 shrink-0" />
          )}
          <h2 className="min-w-0 flex-1 truncate text-center text-base font-semibold">{info && step !== 'source' ? info.name : t('import.title')}</h2>
          <button onClick={close} className="grid size-10 shrink-0 place-items-center rounded-full text-ink-2" aria-label={t('common.close')}>
            <X size={22} />
          </button>
        </div>
      </header>

      <div className="sheet-scroll">
        <div className="mx-auto max-w-2xl px-4 pb-[calc(10rem+env(safe-area-inset-bottom))] pt-5 lg:px-10">
          {step === 'source' && (
            <>
              <p className="text-sm text-ink-2">{t('import.chooseSource')}</p>
              <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                {SOURCES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSource(s.id)
                      setError(undefined)
                      setStep('input')
                    }}
                    className="card flex items-center gap-3.5 p-4 text-start transition-colors active:bg-surface-2"
                  >
                    <span className="grid size-12 shrink-0 place-items-center rounded-xl border border-line-strong bg-surface-2 text-sm font-bold tracking-tight text-ink">{s.mark}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{s.name}</span>
                      <span className="mt-0.5 block text-xs text-ink-3">{t(`import.src.${s.id}` as TKey)}</span>
                    </span>
                    <span className="text-ink-3 rtl:-scale-x-100">→</span>
                  </button>
                ))}
              </div>
              <p className="mt-5 text-xs leading-relaxed text-ink-3">{t('import.mergeHint')}</p>
            </>
          )}

          {step === 'input' && info && (
            <>
              <span className="eyebrow">{t('import.how')}</span>
              <ol className="mt-3 space-y-3">
                {t(`import.steps.${info.id}` as TKey)
                  .split('\n')
                  .map((line, i) => (
                    <li key={i} className="flex gap-3 text-sm leading-relaxed text-ink-2">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-bold text-ink">{i + 1}</span>
                      <span>{line}</span>
                    </li>
                  ))}
              </ol>

              {NEEDS_TMDB.includes(info.id) && !hasTmdb && (
                <p className="mt-5 rounded-2xl border border-dashed border-line-strong p-3.5 text-xs leading-relaxed text-ink-2">{t('import.noTmdb')}</p>
              )}

              {info.id === 'anilist' ? (
                <form
                  className="mt-6 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    onAniList()
                  }}
                >
                  <input
                    className="field flex-1"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value.slice(0, 20))}
                    placeholder={t('import.userName')}
                    aria-label={t('import.userName')}
                    autoCapitalize="off"
                    autoComplete="off"
                    spellCheck={false}
                    enterKeyHint="go"
                  />
                  <button type="submit" className="btn btn-primary px-5" disabled={!userName.trim()}>
                    {t('import.continue')}
                  </button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault()
                      setDragging(true)
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                    className={cx(
                      'mt-6 flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-9 text-center transition-colors',
                      dragging ? 'border-accent bg-surface-2' : 'border-line-strong active:bg-surface-2',
                    )}
                  >
                    <FileUp size={28} className="text-accent" />
                    <span className="font-semibold">{t('import.drop')}</span>
                    <span className="text-xs text-ink-3">{info.accept?.split(',').filter((x) => x.startsWith('.')).join(' · ')}</span>
                  </button>
                  <input ref={fileRef} type="file" accept={info.accept} multiple={info.multiple} hidden onChange={(e) => onFiles(e.target.files)} />
                </>
              )}
              <p className="mt-3 text-xs text-ink-3">{t('import.privacy')}</p>
              {error && (
                <p role="alert" className="mt-4 rounded-2xl border border-accent p-3.5 text-sm text-ink">
                  {error}
                </p>
              )}
            </>
          )}

          {step === 'working' && (
            <div className="flex flex-col items-center pt-10 text-center" aria-live="polite">
              <Loader2 size={30} className="animate-spin text-accent" />
              <p className="mt-4 font-semibold">{phase === 'reading' ? t('import.reading') : phase === 'saving' ? t('import.importing') : t('import.resolving')}</p>
              {phase === 'resolving' && progress.total > 0 && (
                <>
                  <div className="mt-5 h-2 w-full max-w-sm overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                    <div className="h-full rounded-full bg-accent-fill transition-[width] duration-300" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-2 text-xs tabular-nums text-ink-3">{t('import.progress', { done: progress.done, total: progress.total })}</p>
                  {wait > 0 && <p className="mt-3 max-w-sm text-xs text-ink-2">{t('import.rateWait', { s: wait })}</p>}
                </>
              )}
              {phase !== 'saving' && (
                <button onClick={cancelWork} className="btn btn-ghost mt-8 px-6">
                  {t('import.cancel')}
                </button>
              )}
            </div>
          )}

          {step === 'preview' && plan && kinds && (
            <>
              <p className="text-sm text-ink-2">{t('import.found', { n: entries.length })}</p>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {(
                  [
                    [kinds.films, t('typePlural.film')],
                    [kinds.series, t('typePlural.serie')],
                    [kinds.anime, t('typePlural.anime')],
                  ] as const
                ).map(([n, label]) => (
                  <div key={label} className="card p-3.5">
                    <span className="block text-2xl font-bold tabular-nums">{n}</span>
                    <span className="text-xs text-ink-3">{label}</span>
                  </div>
                ))}
              </div>
              <div className="card mt-3 divide-y divide-line">
                <Line label={t('import.new')} value={plan.added.length} strong />
                <Line label={t('import.toUpdate')} value={plan.updated.length} />
                <Line label={t('import.already')} value={plan.unchanged} />
                <Line label={t('import.notFound')} value={plan.notFound.length} accent={plan.notFound.length > 0} />
              </div>

              {plan.notFound.length > 0 && (
                <div className="mt-3">
                  <button onClick={() => setShowMissing((v) => !v)} className="flex items-center gap-1.5 text-sm font-medium text-ink-2" aria-expanded={showMissing}>
                    <ChevronDown size={16} className={cx('transition-transform', showMissing && 'rotate-180')} />
                    {showMissing ? t('import.hideNotFound') : t('import.showNotFound')}
                  </button>
                  {showMissing && (
                    <ul className="mt-2 max-h-72 divide-y divide-line overflow-y-auto rounded-2xl border border-line px-3.5 text-sm">
                      {plan.notFound.slice(0, 500).map((e) => (
                        <li key={e.key} className="flex justify-between gap-3 py-2">
                          <span className="min-w-0 truncate">{e.title}</span>
                          {e.year && <span className="shrink-0 text-ink-3">{e.year}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={includeUnmatched}
                    onClick={() => setIncludeUnmatched((v) => !v)}
                    className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-line px-4 py-3 text-start"
                  >
                    <span className="flex-1 text-sm">{t('import.includeUnmatched')}</span>
                    <span className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors', includeUnmatched ? 'bg-accent-fill' : 'border border-line-strong bg-surface-2')}>
                      <span className={cx('absolute top-0.5 size-5 rounded-full transition-all', includeUnmatched ? 'start-[22px] bg-on-accent' : 'start-0.5 bg-ink')} />
                    </span>
                  </button>
                </div>
              )}

              <p className="mt-4 text-xs leading-relaxed text-ink-3">{t('import.mergeHint')}</p>
              {error && <p className="mt-3 text-sm text-accent">{error}</p>}
              {plan.added.length + plan.updated.length > 0 ? (
                <button onClick={() => void confirm()} className="btn btn-primary mt-5 w-full">
                  <Check size={18} /> {t('import.confirm', { n: plan.added.length + plan.updated.length })}
                </button>
              ) : (
                <p className="mt-5 rounded-2xl border border-line p-4 text-center text-sm text-ink-2">{t('import.nothing')}</p>
              )}
            </>
          )}

          {step === 'done' && result && (
            <div className="pt-6">
              <div className="flex flex-col items-center text-center">
                <span className="grid size-14 place-items-center rounded-full bg-accent-fill text-on-accent">
                  <Check size={28} strokeWidth={2.5} />
                </span>
                <h3 className="mt-4 text-lg font-semibold">{t('import.done')}</h3>
              </div>
              <div className="card mt-6 divide-y divide-line">
                <Line label={t('import.doneAdded')} value={result.added} strong />
                <Line label={t('import.toUpdate')} value={result.updated} />
                <Line label={t('import.already')} value={result.unchanged} />
                {result.notFound > 0 && <Line label={t('import.notFound')} value={result.notFound} />}
              </div>
              <button onClick={close} className="btn btn-primary mt-6 w-full">
                {t('import.close')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Line({ label, value, strong, accent }: { label: string; value: number; strong?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm">
      <span className={strong ? 'font-medium' : 'text-ink-2'}>{label}</span>
      <span className={cx('tabular-nums', strong && 'font-semibold', accent && 'text-accent')}>{value}</span>
    </div>
  )
}
