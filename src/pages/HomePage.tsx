import { useSocial } from '../components/social/SocialProvider'
import { t } from '../i18n'
import { CalendarDays, Dices, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { TYPE_BY_VALUE } from '../lib/constants'
import Avatar from '../components/social/Avatar'
import FriendsFeed from '../components/social/FriendsFeed'
import Poster from '../components/Poster'
import TopFive from '../components/TopFive'
import Recommendations from '../components/Recommendations'
import HomeHero, { ContinueCard } from '../components/HomeHero'
import type { Tab } from '../components/BottomNav'
import { EmptyState, LinkArrow, PageHeader, SectionTitle, StatTile } from '../components/ui'
import { CACHE_EVENT, loadAiring, needsCheck, refreshAiring, saveAiring, trackable } from '../lib/airing'
import { calendarEvents } from '../lib/releases'
import { computeStats } from '../lib/stats'
import { formatDuration, todayISO } from '../lib/utils'
import { useMedia } from '../store'
import type { MediaItem } from '../types'

interface Props {
  onOpen: (item: MediaItem) => void
  onAdd: () => void
  onNavigate: (tab: Tab) => void
  onRoulette: () => void
  onCalendar: () => void
}

function PosterStrip({ items, onOpen }: { items: MediaItem[]; onOpen: (item: MediaItem) => void }) {
  return (
    <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
      {items.map((item) => (
        <button key={item.id} onClick={() => onOpen(item)} className="w-32 shrink-0 text-left">
          <Poster src={item.poster} title={item.title} />
          <p className="mt-2 truncate text-sm font-semibold leading-snug">{item.title}</p>
          <p className="truncate text-[11px] text-ink-3">{[TYPE_BY_VALUE[item.type].label, item.year].filter(Boolean).join(' · ')}</p>
        </button>
      ))}
    </div>
  )
}

export default function HomePage({ onOpen, onAdd, onNavigate, onRoulette, onCalendar }: Props) {
  const { items, loading, account, settings, patchMany } = useMedia()
  const social = useSocial()
  const stats = useMemo(() => computeStats(items), [items])
  // Sorties dans les 7 prochains jours (pastille sur l'icône calendrier)
  // Vérification discrète des nouveaux épisodes (au plus toutes les 12 h) : pastille du calendrier et nombre d'épisodes à jour
  const airingStarted = useRef(false)
  useEffect(() => {
    if (loading || airingStarted.current || !navigator.onLine) return
    airingStarted.current = true
    const cache = loadAiring()
    if (!trackable(items).some((i) => needsCheck(i, cache))) return
    void refreshAiring(items, cache, settings.tmdbKey)
      .then((next) => {
        saveAiring(next)
        const patches = trackable(items).flatMap((i) => {
          const info = next[i.id]
          if (!info) return []
          const patch: Partial<MediaItem> = {}
          if (i.status !== 'termine' && info.aired > (i.episodesTotal ?? 0)) patch.episodesTotal = info.aired
          // Découpage par saison (nouvelle saison annoncée, ou fiche ajoutée avant le suivi par saison)
          if (info.seasonSizes && info.seasonSizes.join() !== (i.seasons ?? []).join()) patch.seasons = info.seasonSizes
          if (info.backdrop && !i.backdrop) patch.backdrop = info.backdrop
          return Object.keys(patch).length ? [{ id: i.id, patch }] : []
        })
        if (patches.length) return patchMany(patches)
      })
      .catch(() => {})
  }, [loading, items, settings.tmdbKey, patchMany])

  const [cacheVersion, setCacheVersion] = useState(0)
  useEffect(() => {
    const bump = () => setCacheVersion((v) => v + 1)
    window.addEventListener(CACHE_EVENT, bump)
    return () => window.removeEventListener(CACHE_EVENT, bump)
  }, [])
  const soon = useMemo(() => {
    const today = todayISO()
    const d = new Date(Date.now() + 7 * 86400000)
    const end = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return calendarEvents(items).filter((e) => e.date >= today && e.date <= end).length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, cacheVersion])

  const inProgress = items.filter((i) => i.status === 'en_cours')
  // Bannière : ce que je regarde en ce moment (le plus récemment touché), sinon le prochain « à voir »
  const featured = [...inProgress].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? items.find((i) => i.status === 'a_voir')
  const toWatch = items.filter((i) => i.status === 'a_voir').slice(0, 12)
  const recent = items
    .filter((i) => i.status === 'termine')
    .sort((a, b) => (b.endDate ?? b.updatedAt).localeCompare(a.endDate ?? a.updatedAt))
    .slice(0, 12)

  const seeAll = <LinkArrow onClick={() => onNavigate('catalog')}>{t('home.seeAll')}</LinkArrow>

  return (
    <>
      <PageHeader
        title="Azuu"
        accent="Cine"
        subtitle={t('home.subtitle')}
        action={
          <span className="flex shrink-0 items-center gap-2">
          <button
            onClick={onCalendar}
            className="relative grid size-11 shrink-0 place-items-center rounded-full border border-line text-ink-2 transition-colors active:bg-surface-2"
            aria-label={soon ? t('home.calendarSoon', { count: soon }) : t('calendar.title')}
          >
            <CalendarDays size={20} />
            {soon > 0 && (
              <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-accent-fill px-1 text-[10px] font-bold text-on-accent">{soon}</span>
            )}
          </button>
          {social.enabled && (
            <button onClick={() => (social.me ? social.openProfile(social.me.username) : social.openSearch())} className="relative shrink-0 rounded-full" aria-label={t('social.myProfile')}>
              <Avatar url={social.me?.avatarUrl} name={social.me?.displayName ?? '?'} size={44} />
              {social.requests.length > 0 && (
                <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-accent-fill px-1 text-[10px] font-bold text-on-accent">{social.requests.length}</span>
              )}
            </button>
          )}
          </span>
        }
      />

      {!loading && items.length === 0 ? (
        <>
        <EmptyState
          title={t('home.emptyTitle')}
          text={account ? t('home.emptyCloud') : t('home.emptyLocal')}
          action={
            <button onClick={onAdd} className="btn btn-primary">
              <Plus size={18} /> {t('nav.addTitle')}
            </button>
          }
        />
        <FriendsFeed />
        </>
      ) : (
        <>
          {featured && <HomeHero item={featured} onOpen={onOpen} />}

          {inProgress.length > 0 && (
            <>
              <SectionTitle>{t('homeHero.continueRow')}</SectionTitle>
              <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
                {[...inProgress]
                  .sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))
                  .map((item) => (
                    <ContinueCard key={item.id} item={item} onOpen={onOpen} />
                  ))}
              </div>
            </>
          )}

          {toWatch.length > 0 && (
            <>
              <SectionTitle action={seeAll}>{t('status.a_voir')}</SectionTitle>
              <PosterStrip items={toWatch} onOpen={onOpen} />
            </>
          )}

          <FriendsFeed />

          {/* Roulette : pour les soirs sans idée */}
          <button onClick={onRoulette} className="card mt-8 flex w-full items-center gap-4 p-4 text-left transition-colors active:bg-surface-2">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-accent-fill text-on-accent">
              <Dices size={24} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">
                {t('home.noIdea')} <span className="text-accent">{t('roulette.name')}</span>
              </span>
              <span className="mt-0.5 block text-xs text-ink-3">
                {stats.toWatch ? t('home.rouletteHint', { count: stats.toWatch }) : t('home.rouletteHintAll')}
              </span>
            </span>
            <span className="text-accent">→</span>
          </button>


          <TopFive onOpen={onOpen} />

          <Recommendations />

          {recent.length > 0 && (
            <>
              <SectionTitle action={seeAll}>{t('home.recentlyFinished')}</SectionTitle>
              <PosterStrip items={recent} onOpen={onOpen} />
            </>
          )}

          <SectionTitle>{t('nav.stats')}</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <StatTile label={t('home.completed')} value={stats.completed} hint={t('home.thisYear', { count: stats.completedThisYear })} />
            <StatTile label={t('status.en_cours')} value={stats.inProgress} hint={t('home.toWatchN', { count: stats.toWatch })} />
            <StatTile label={t('home.screenTime')} value={formatDuration(stats.totalMinutes)} hint={t('home.estimate')} />
            <StatTile label={t('home.episodesSeen')} value={stats.episodesWatched} />
          </div>

        </>
      )}
    </>
  )
}
