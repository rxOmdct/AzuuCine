import { Check, Loader2, PenLine, Search, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '../../i18n'
import { useBackToClose } from '../../lib/backNav'
import { searchAll, type SearchResult } from '../../lib/catalogApi'
import { searchProfiles, type ProfileCard } from '../../lib/cloud/social'
import { useEscape } from '../../lib/escape'
import { findFranchiseItem } from '../../lib/franchise'
import { searchPeople, type PersonHit } from '../../lib/people'
import { useScrollLock } from '../../lib/scrollLock'
import { cx } from '../../lib/utils'
import { useMedia } from '../../store'
import type { MediaItem } from '../../types'
import PersonRow from '../social/PersonRow'
import { useSocial } from '../social/SocialProvider'

type Tab = 'all' | 'titles' | 'people' | 'members'

/** Une recherche (titres, personnes ou membres) : résultats, chargement, erreur. */
interface Slot<T> {
  items: T[]
  loading: boolean
  error?: string
}
const empty = <T,>(): Slot<T> => ({ items: [], loading: false })

/**
 * Recherche : titres (films, séries, animes), personnes (acteurs, réalisateurs, doubleurs) et membres, en une fois.
 * Un titre déjà dans la bibliothèque (ou une autre saison de la même série) ouvre directement ma fiche.
 */
export default function AddTitle({
  onClose,
  onPick,
  onOpenItem,
  onOpenPerson,
  onManual,
  onGoToSettings,
}: {
  onClose: () => void
  onPick: (r: SearchResult) => void
  onOpenItem: (item: MediaItem) => void
  onOpenPerson: (p: PersonHit) => void
  onManual: (title: string) => void
  onGoToSettings?: () => void
}) {
  const { items, settings } = useMedia()
  const social = useSocial()
  useScrollLock()
  useEscape(onClose)
  useBackToClose(onClose)
  const hasKey = !!settings.tmdbKey?.trim()
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('all')
  const [titles, setTitles] = useState<Slot<SearchResult>>(empty)
  const [people, setPeople] = useState<Slot<PersonHit>>(empty)
  const [members, setMembers] = useState<Slot<ProfileCard>>(empty)
  const request = useRef(0)
  const inLibrary = (r: SearchResult) =>
    items.find((i) => i.externalId === r.externalId) ?? findFranchiseItem(items, [r.title, r.originalTitle, ...(r.altTitles ?? [])], { type: r.typeGuess })

  useEffect(() => {
    const q = query.trim()
    // Toute réponse d'une recherche précédente devient caduque
    const id = ++request.current
    if (q.length < 2) {
      setTitles(empty)
      setPeople(empty)
      setMembers(empty)
      return
    }
    setTitles((s) => ({ ...s, loading: true, error: undefined }))
    setPeople((s) => ({ ...s, loading: true, error: undefined }))
    setMembers((s) => ({ ...s, loading: social.enabled, error: undefined }))
    const errorText = (e: unknown) => (navigator.onLine ? (e as Error).message : t('search.offline'))
    const run = <T,>(p: Promise<T[]>, set: (s: Slot<T>) => void) =>
      p.then(
        (list) => id === request.current && set({ items: list, loading: false }),
        (e) => id === request.current && set({ items: [], loading: false, error: errorText(e) }),
      )
    const timer = setTimeout(() => {
      void run(searchAll(q, hasKey ? settings.tmdbKey : undefined), setTitles)
      void run(searchPeople(q, hasKey ? settings.tmdbKey : undefined), setPeople)
      if (social.enabled) void run(searchProfiles(q), setMembers)
    }, 350)
    return () => clearTimeout(timer)
  }, [query, hasKey, settings.tmdbKey, social.enabled])

  const searched = query.trim().length >= 2
  const loading = titles.loading || people.loading || members.loading
  const tabs: { id: Tab; label: string; n?: number }[] = [
    { id: 'all', label: t('search.tabAll') },
    { id: 'titles', label: t('search.tabTitles'), n: searched ? titles.items.length : undefined },
    { id: 'people', label: t('search.tabPeople'), n: searched ? people.items.length : undefined },
    ...(social.enabled ? [{ id: 'members' as const, label: t('search.tabMembers'), n: searched ? members.items.length : undefined }] : []),
  ]

  const titleList = (list: SearchResult[]) => (
    <ul className="divide-y divide-line lg:grid lg:grid-cols-2 lg:gap-x-10 lg:divide-y-0 xl:grid-cols-3">
      {list.map((r) => {
        const mine = inLibrary(r)
        return (
          <li key={r.externalId}>
            <button onClick={() => (mine ? onOpenItem(mine) : onPick(r))} className="flex w-full items-center gap-3 py-3 text-start active:bg-surface lg:border-b lg:border-line">
              {r.thumb ? (
                <img src={r.thumb} alt="" loading="lazy" className="h-[5.25rem] w-14 shrink-0 rounded-lg border border-line bg-surface-2 object-cover" />
              ) : (
                <span className="grid h-[5.25rem] w-14 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 font-semibold text-ink-3">{r.title.charAt(0)}</span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{r.title}</span>
                {r.originalTitle && <span className="block truncate text-xs text-ink-3">{r.originalTitle}</span>}
                <span className="mt-1 block text-[11px] uppercase tracking-wide text-ink-3">{[r.year, r.kindLabel].filter(Boolean).join(' · ')}</span>
                {mine && (
                  <span className="mt-1 inline-flex items-center gap-1 text-xs text-accent">
                    <Check size={12} /> {t('title.inLibrary')}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-accent rtl:-scale-x-100">→</span>
            </button>
          </li>
        )
      })}
    </ul>
  )

  const personList = (list: PersonHit[]) => (
    <ul className="divide-y divide-line lg:grid lg:grid-cols-2 lg:gap-x-10 lg:divide-y-0 xl:grid-cols-3">
      {list.map((p) => (
        <li key={p.id}>
          <button onClick={() => onOpenPerson(p)} className="flex w-full items-center gap-3 py-2.5 text-start active:bg-surface lg:border-b lg:border-line">
            {p.photo ? (
              <img src={p.photo} alt="" loading="lazy" className="size-14 shrink-0 rounded-full border border-line bg-surface-2 object-cover" />
            ) : (
              <span className="grid size-14 shrink-0 place-items-center rounded-full border border-line bg-surface-2 text-lg font-semibold text-ink-3">{p.name.charAt(0)}</span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{p.name}</span>
              {p.department && <span className="block text-[11px] uppercase tracking-wide text-ink-3">{p.department}</span>}
              {p.knownFor.length > 0 && <span className="mt-0.5 block truncate text-xs text-ink-2">{p.knownFor.join(' · ')}</span>}
            </span>
            <span className="shrink-0 text-accent rtl:-scale-x-100">→</span>
          </button>
        </li>
      ))}
    </ul>
  )

  const memberList = (list: ProfileCard[]) => (
    <div className="divide-y divide-line lg:grid lg:grid-cols-2 lg:gap-x-10 lg:divide-y-0 xl:grid-cols-3">
      {list.map((m) => (
        <div key={m.id} className="lg:border-b lg:border-line">
          {/* Les profils s'ouvrent sous les fenêtres de l'app : on referme la recherche pour que le profil soit visible */}
          <PersonRow person={m} onOpen={onClose} />
        </div>
      ))}
    </div>
  )

  const section = (label: string, body: ReactNode, more?: () => void) => (
    <section className="mt-6">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="eyebrow text-ink-2">{label}</h3>
        {more && (
          <button onClick={more} className="text-xs font-medium text-ink-2">
            {t('search.seeAll')} <span className="text-accent rtl:-scale-x-100">→</span>
          </button>
        )}
      </div>
      {body}
    </section>
  )

  const errorLine = (e?: string) => e && <p className="mt-4 text-sm text-accent">{e}</p>
  const none = (text: string) => <p className="mt-6 text-center text-sm text-ink-3">{text}</p>
  const nothingAtAll = searched && !loading && !titles.items.length && !people.items.length && !members.items.length

  return (
    <div className="sheet sheet-in" role="dialog" aria-modal="true" aria-label={t('search.title')}>
      <header className="safe-top border-b border-line">
        <div className="mx-auto max-w-2xl px-3 pb-3 pt-2.5 lg:max-w-none lg:px-10">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-full text-ink-2" aria-label={t('common.close')}>
              <X size={22} />
            </button>
            <h2 className="min-w-0 flex-1 truncate text-center text-base font-semibold">{t('search.title')}</h2>
            <span className="size-10 shrink-0" />
          </div>
          <div className="relative mt-2">
            <Search size={18} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={social.enabled ? t('search.placeholder') : t('search.placeholderNoMembers')}
              aria-label={t('search.title')}
              className="field ps-10"
              enterKeyHint="search"
              autoComplete="off"
              autoFocus
            />
            {loading && <Loader2 size={17} className="absolute end-3.5 top-1/2 -translate-y-1/2 animate-spin text-ink-3" />}
          </div>
          <div className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1" role="tablist">
            {tabs.map((x) => (
              <button key={x.id} role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)} className={cx('chip shrink-0', tab === x.id && 'chip-on')}>
                {x.label}
                {x.n !== undefined && x.n > 0 && <span className="opacity-60">{x.n}</span>}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="sheet-scroll">
        <div className="mx-auto max-w-2xl px-4 pb-[calc(10rem+env(safe-area-inset-bottom))] pt-2 lg:max-w-none lg:px-10">
          {!hasKey && (tab === 'all' || tab === 'titles' || tab === 'people') && (
            <div className="mt-4 rounded-2xl border border-dashed border-line-strong p-4 text-sm text-ink-2">
              {t('search.animeOnly')}
              {onGoToSettings && (
                <button onClick={onGoToSettings} className="mt-2 block font-medium text-ink">
                  {t('search.openSettings')} <span className="text-accent">→</span>
                </button>
              )}
            </div>
          )}

          {!searched && <p className="mt-8 text-center text-sm text-ink-3">{social.enabled ? t('search.hint') : t('search.hintNoMembers')}</p>}

          {searched && tab === 'all' && (
            <>
              {nothingAtAll && none(t('title.noResults'))}
              {people.items.length > 0 && section(t('search.tabPeople'), personList(people.items.slice(0, 3)), people.items.length > 3 ? () => setTab('people') : undefined)}
              {members.items.length > 0 && section(t('search.tabMembers'), memberList(members.items.slice(0, 3)), members.items.length > 3 ? () => setTab('members') : undefined)}
              {titles.items.length > 0 && section(t('search.tabTitles'), titleList(titles.items))}
              {errorLine(titles.error)}
            </>
          )}
          {searched && tab === 'titles' && (
            <>
              {errorLine(titles.error)}
              {titleList(titles.items)}
              {!titles.loading && !titles.error && titles.items.length === 0 && none(t('title.noResults'))}
            </>
          )}
          {searched && tab === 'people' && (
            <>
              {errorLine(people.error)}
              {personList(people.items)}
              {!people.loading && !people.error && people.items.length === 0 && none(t('search.noPeople'))}
            </>
          )}
          {searched && tab === 'members' && (
            <>
              {errorLine(members.error)}
              {memberList(members.items)}
              {!members.loading && !members.error && members.items.length === 0 && none(t('search.noMembers'))}
            </>
          )}

          {(tab === 'all' || tab === 'titles') && (
            <button onClick={() => onManual(query.trim())} className="mt-8 flex w-full items-center gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-3.5 text-start">
              <PenLine size={18} className="shrink-0 text-accent" />
              <span>
                <span className="block text-sm font-medium">{t('title.manual')}</span>
                <span className="block text-xs text-ink-3">{t('title.manualHint')}</span>
              </span>
            </button>
          )}

          <p className="mt-6 text-center text-[11px] leading-relaxed text-ink-3">{t('search.privacy', { source: hasKey ? 'TMDB / AniList' : 'AniList' })}</p>
        </div>
      </div>
    </div>
  )
}
