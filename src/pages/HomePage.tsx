import { useSocial } from '../components/social/SocialProvider'
import { t } from '../i18n'
import { Bell, CalendarDays, Dices, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TYPE_BY_VALUE } from '../lib/constants'
import Avatar from '../components/social/Avatar'
import FriendsFeed from '../components/social/FriendsFeed'
import Poster from '../components/Poster'
import TopFive from '../components/TopFive'
import ChallengesCard from '../components/challenges/ChallengesCard'
import Recommendations from '../components/Recommendations'
import HomeHero, { ContinueCard } from '../components/HomeHero'
import type { Tab } from '../components/BottomNav'
import { EmptyState, LinkArrow, PageHeader, SectionTitle, StatTile } from '../components/ui'
import { CACHE_EVENT, isCaughtUp, loadAiring, needsCheck, refreshAiring, saveAiring, trackable } from '../lib/airing'
import { addEpisodeNotifications } from '../lib/cloud/notifications'
import { useOnResume } from '../lib/onResume'
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
        <button key={item.id} onClick={() => onOpen(item)} className="w-32 shrink-0 text-start">
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
  // Revérifié aussi au retour dans l'app : un épisode sorti entre-temps fait réapparaître la série dans « Continuer »
  const airingStarted = useRef(false)
  const airingRunning = useRef(false)
  // Vérification des sorties en cours (au lancement) : sert à ne pas afficher une série dont on ignore encore si je suis à jour
  const [checkingAiring, setCheckingAiring] = useState(() => navigator.onLine)
  const latest = useRef({ items, tmdbKey: settings.tmdbKey })
  latest.current = { items, tmdbKey: settings.tmdbKey }
  const checkAiring = useCallback(() => {
    const { items, tmdbKey } = latest.current
    if (airingRunning.current) return
    const cache = loadAiring()
    if (!navigator.onLine || !trackable(items).some((i) => needsCheck(i, cache))) {
      setCheckingAiring(false)
      return
    }
    airingRunning.current = true
    setCheckingAiring(true)
    void refreshAiring(items, cache, tmdbKey)
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
        // Notifications : on envoie le dernier épisode sorti de chaque série encore en diffusion ;
        // le serveur retient le précédent et ne signale que ce qui est sorti depuis (le passé n'est pas « nouveau »).
        if (social.enabled) {
          const notices = trackable(items).flatMap((i) => {
            const info = next[i.id]
            if (!info || info.ended || info.aired < 1 || i.status === 'abandonne') return []
            const kind = i.status === 'termine' ? ('new_season' as const) : ('new_episode' as const)
            return [{ item_id: i.id, kind, episode: info.aired, count: Math.max(1, info.aired - i.episodesWatched) }]
          })
          void (async () => {
            let created = 0
            for (let k = 0; k < notices.length; k += 50) created += await addEpisodeNotifications(notices.slice(k, k + 50))
            if (created > 0) void social.refresh()
          })()
        }
        if (patches.length) return patchMany(patches)
      })
      .catch(() => {})
      .finally(() => {
        airingRunning.current = false
        setCheckingAiring(false)
      })
  }, [patchMany, social])
  useEffect(() => {
    if (loading || airingStarted.current) return
    airingStarted.current = true
    checkAiring()
  }, [loading, checkAiring])
  useOnResume(checkAiring, !loading)
  // Séries arrivées après le lancement (synchro du compte) : on vérifie aussi leurs sorties
  const unknownCount = useMemo(() => {
    const cache = loadAiring()
    return trackable(items).filter((i) => !cache[i.id]).length
  }, [items])
  useEffect(() => {
    if (loading || !airingStarted.current || !unknownCount) return
    const id = setTimeout(checkAiring, 800)
    return () => clearTimeout(id)
  }, [loading, unknownCount, checkAiring])

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

  // En cours, sans les séries où j'ai tout vu en attendant le prochain épisode
  const airing = useMemo(() => loadAiring(), [cacheVersion]) // eslint-disable-line react-hooks/exhaustive-deps
  // Pendant la vérification, une série suivie dont on ne connaît pas encore les sorties reste masquée :
  // sinon elle s'affichait puis disparaissait quelques secondes après (une fois vue « à jour »).
  const unknownWhileChecking = (i: MediaItem) => (checkingAiring || loading) && !airing[i.id] && trackable([i]).length > 0
  const inProgress = items.filter((i) => i.status === 'en_cours' && !isCaughtUp(i, airing) && !unknownWhileChecking(i))
  // Bannière : ce que je regarde en ce moment (le plus récemment touché), sinon le prochain « à voir »
  const byRecent = [...inProgress].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const firstToWatch = items.find((i) => i.status === 'a_voir')
  const featured = (byRecent.length ? byRecent.slice(0, 8) : firstToWatch ? [firstToWatch] : [])
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
              <span className="absolute -end-1 -top-1 grid min-w-5 place-items-center rounded-full bg-accent-fill px-1 text-[10px] font-bold text-on-accent">{soon}</span>
            )}
          </button>
          {social.enabled && (
            <button
              onClick={social.openNotifications}
              className="relative grid size-11 shrink-0 place-items-center rounded-full border border-line text-ink-2 transition-colors active:bg-surface-2"
              aria-label={social.unread > 0 ? t('home.notificationsN', { count: social.unread }) : t('home.notifications')}
            >
              <Bell size={20} />
              {social.unread > 0 && (
                <span className="absolute -end-1 -top-1 grid min-w-5 place-items-center rounded-full bg-accent-fill px-1 text-[10px] font-bold text-on-accent">{social.unread}</span>
              )}
            </button>
          )}
          {social.enabled && (
            <button onClick={() => (social.me ? social.openProfile(social.me.username) : social.openSearch())} className="relative shrink-0 rounded-full" aria-label={t('social.myProfile')}>
              <Avatar url={social.me?.avatarUrl} name={social.me?.displayName ?? '?'} size={44} />
              {social.requests.length > 0 && (
                <span className="absolute -end-1 -top-1 grid min-w-5 place-items-center rounded-full bg-accent-fill px-1 text-[10px] font-bold text-on-accent">{social.requests.length}</span>
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
          {featured.length > 0 && <HomeHero items={featured} onOpen={onOpen} />}

          <FriendsFeed />

          {/* Roulette : pour les soirs sans idée */}
          <button onClick={onRoulette} className="card mt-8 flex w-full items-center gap-4 p-4 text-start transition-colors active:bg-surface-2">
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

          <ChallengesCard onOpen={onOpen} />

          {toWatch.length > 0 && (
            <>
              <SectionTitle action={seeAll}>{t('status.a_voir')}</SectionTitle>
              <PosterStrip items={toWatch} onOpen={onOpen} />
            </>
          )}

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
