import { ArrowLeft, Check, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { t } from '../../i18n'
import { useBackToClose } from '../../lib/backNav'
import type { SearchResult } from '../../lib/catalogApi'
import { STATUS_BY_VALUE } from '../../lib/constants'
import { useEscape } from '../../lib/escape'
import { findFranchiseItem } from '../../lib/franchise'
import { CREDIT_GROUPS, getPerson, groupLabel, type CreditGroup, type PersonCredit, type PersonDetails } from '../../lib/people'
import { useScrollLock } from '../../lib/scrollLock'
import { cx, formatDate } from '../../lib/utils'
import { useMedia } from '../../store'
import type { MediaItem } from '../../types'
import Poster from '../Poster'

type Sort = 'popular' | 'recent'

/**
 * Page d'une personne (acteur·rice, réalisateur·rice, doubleur·se…) : photo, biographie,
 * et toute sa filmographie, rangée par métier. Un titre s'ouvre en fiche (déjà dans ma bibliothèque ou non).
 */
export default function PersonSheet({
  personId,
  name: initialName,
  photo: initialPhoto,
  onClose,
  onOpenItem,
  onOpenSeed,
}: {
  personId: string
  name?: string
  photo?: string
  onClose: () => void
  onOpenItem: (item: MediaItem) => void
  onOpenSeed: (seed: SearchResult) => void
}) {
  const { items, settings } = useMedia()
  useScrollLock()
  useEscape(onClose)
  useBackToClose(onClose)

  const [person, setPerson] = useState<PersonDetails>()
  const [error, setError] = useState<string>()
  const [group, setGroup] = useState<CreditGroup>()
  const [sort, setSort] = useState<Sort>('popular')
  const [bioOpen, setBioOpen] = useState(false)

  useEffect(() => {
    let alive = true
    setError(undefined)
    getPerson(personId, settings.tmdbKey)
      .then((p) => {
        if (!alive) return
        setPerson(p)
        setGroup((g) => g ?? p.mainGroup)
      })
      .catch((e: Error) => alive && setError(navigator.onLine ? e.message : t('search.offline')))
    return () => {
      alive = false
    }
  }, [personId, settings.tmdbKey])

  const mine = (r: SearchResult) =>
    items.find((i) => i.externalId === r.externalId) ?? (r.typeGuess !== 'film' ? findFranchiseItem(items, [r.title, r.originalTitle, ...(r.altTitles ?? [])], { type: r.typeGuess }) : undefined)

  const groups = useMemo(() => {
    const counts = new Map<CreditGroup, number>()
    for (const c of person?.credits ?? []) counts.set(c.group, (counts.get(c.group) ?? 0) + 1)
    return CREDIT_GROUPS.filter((g) => counts.has(g)).map((g) => ({ g, n: counts.get(g)! }))
  }, [person])

  const shown = useMemo(() => {
    const list = (person?.credits ?? []).filter((c) => c.group === group)
    const byYear = (a: PersonCredit, b: PersonCredit) => (b.year ?? 0) - (a.year ?? 0)
    return [...list].sort(sort === 'recent' ? byYear : (a, b) => b.popularity - a.popularity || byYear(a, b))
  }, [person, group, sort])

  // Combien de ses titres sont déjà dans ma bibliothèque (tous métiers confondus, sans doublon)
  const library = useMemo(() => {
    const all = new Map<string, SearchResult>()
    for (const c of person?.credits ?? []) all.set(c.result.externalId, c.result)
    let n = 0
    for (const r of all.values()) if (mine(r)) n++
    return { n, total: all.size }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person, items])

  const name = person?.name ?? initialName ?? ''
  const photo = person?.photo ?? initialPhoto
  const life = person && [person.birthday && t('person.born', { date: formatDate(person.birthday) }), person.deathday && t('person.died', { date: formatDate(person.deathday) }), person.place].filter(Boolean)

  return (
    <div className="sheet sheet-in" role="dialog" aria-modal="true" aria-label={name || t('person.title')}>
      <header className="safe-top border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5 lg:max-w-none lg:px-10">
          <button onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-full text-ink-2" aria-label={t('common.close')}>
            <ArrowLeft size={22} className="rtl:-scale-x-100" />
          </button>
          <h2 className="min-w-0 flex-1 truncate text-center text-base font-semibold">{name}</h2>
          <span className="size-10 shrink-0" />
        </div>
      </header>

      <div className="sheet-scroll">
        <div className="mx-auto max-w-2xl px-4 pb-[calc(10rem+env(safe-area-inset-bottom))] pt-6 lg:max-w-none lg:px-10">
          {/* En-tête : photo + identité */}
          <div className="flex items-start gap-4 lg:gap-8">
            <div className="w-28 shrink-0 lg:w-48">
              {photo ? (
                <img src={photo} alt={name} className="aspect-[2/3] w-full rounded-xl border border-line bg-surface-2 object-cover" />
              ) : (
                <div className="grid aspect-[2/3] w-full place-items-center rounded-xl border border-line bg-surface-2 text-4xl font-bold text-ink-3" aria-hidden="true">
                  {name.charAt(0) || '?'}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl leading-tight lg:text-5xl">{name}</h1>
              {person?.department && <p className="eyebrow mt-2 text-accent">{person.department}</p>}
              {life && life.length > 0 && <p className="mt-2 text-sm text-ink-2">{life.join(' · ')}</p>}
              {person && library.n > 0 && (
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs text-ink-2">
                  <Check size={13} className="text-accent" /> {t('person.inLibrary', { count: library.n, total: library.total })}
                </p>
              )}
              {/* Biographie (bureau : à côté de la photo) */}
              {person?.bio && (
                <div className="mt-4 hidden max-w-3xl lg:block">
                  <Bio text={person.bio} open={bioOpen} onToggle={() => setBioOpen((v) => !v)} />
                </div>
              )}
            </div>
          </div>
          {person?.bio && (
            <div className="mt-5 lg:hidden">
              <Bio text={person.bio} open={bioOpen} onToggle={() => setBioOpen((v) => !v)} />
            </div>
          )}

          {error && <p className="mt-6 text-sm text-accent">{error}</p>}
          {!person && !error && (
            <p className="mt-10 flex items-center justify-center gap-2 text-sm text-ink-3">
              <Loader2 size={16} className="animate-spin" /> {t('social.loading')}
            </p>
          )}

          {person && (
            <section className="mt-8" aria-label={t('person.filmography')}>
              <div className="flex flex-wrap items-center gap-2">
                {groups.map(({ g, n }) => (
                  <button key={g} onClick={() => setGroup(g)} className={cx('chip', group === g && 'chip-on')} aria-pressed={group === g}>
                    {groupLabel(g)} <span className="opacity-60">{n}</span>
                  </button>
                ))}
                <div className="ms-auto flex gap-1 rounded-full border border-line p-0.5 text-xs">
                  {(['popular', 'recent'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setSort(s)}
                      aria-pressed={sort === s}
                      className={cx('rounded-full px-3 py-1.5 font-medium transition-colors', sort === s ? 'bg-ink text-bg' : 'text-ink-3')}
                    >
                      {s === 'popular' ? t('person.sortPopular') : t('person.sortRecent')}
                    </button>
                  ))}
                </div>
              </div>

              {shown.length === 0 ? (
                <p className="mt-8 text-center text-sm text-ink-3">{t('person.empty')}</p>
              ) : (
                <ul className="mt-5 grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10">
                  {shown.map((c) => {
                    const it = mine(c.result)
                    return (
                      <li key={c.group + c.result.externalId}>
                        <button onClick={() => (it ? onOpenItem(it) : onOpenSeed(c.result))} className="group block w-full text-start">
                          <div className="relative">
                            <Poster src={c.result.posterUrl ?? c.result.thumb} title={c.result.title} />
                            {it && (
                              <span
                                className="absolute end-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-accent-fill text-on-accent"
                                title={STATUS_BY_VALUE[it.status].label}
                                aria-label={STATUS_BY_VALUE[it.status].label}
                              >
                                <Check size={14} strokeWidth={2.6} />
                              </span>
                            )}
                          </div>
                          <p className="mt-1.5 line-clamp-2 text-xs font-medium leading-snug">{c.result.title}</p>
                          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-3">{[c.year, c.role].filter(Boolean).join(' · ')}</p>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )}

          {person && (
            <p className="mt-10 text-center text-[11px] text-ink-3">{personId.startsWith('tmdbp:') ? t('person.sourceTmdb') : t('person.sourceAnilist')}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function Bio({ text, open, onToggle }: { text: string; open: boolean; onToggle: () => void }) {
  const long = text.length > 320
  return (
    <div>
      <p className={cx('whitespace-pre-line text-sm leading-relaxed text-ink-2', !open && long && 'line-clamp-4')}>{text}</p>
      {long && (
        <button onClick={onToggle} className="mt-1.5 text-sm font-medium text-ink" aria-expanded={open}>
          {open ? t('person.bioLess') : t('person.bioMore')}
        </button>
      )}
    </div>
  )
}
