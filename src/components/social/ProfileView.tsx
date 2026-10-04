import { Check, Loader2, Lock, Share2, Star, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fmtNumber, t } from '../../i18n'
import { follow, getProfile, getProfileItems, profileLink, unfollow, type Profile } from '../../lib/cloud/social'
import { STATUSES, TOP_CATEGORIES } from '../../lib/constants'
import { cx, formatRating } from '../../lib/utils'
import { useMedia } from '../../store'
import type { MediaItem, WatchStatus } from '../../types'
import ConfirmDialog from '../ConfirmDialog'
import Poster from '../Poster'
import { EmptyState, SectionTitle } from '../ui'
import Avatar from './Avatar'
import Sheet from './Sheet'
import { useSocial } from './SocialProvider'

function PosterTile({ item, onOpen, caption }: { item: MediaItem; onOpen: () => void; caption?: string }) {
  const { settings } = useMedia()
  return (
    <button onClick={onOpen} className="block w-full text-left">
      <Poster src={item.poster} title={item.title} />
      <p className="mt-1.5 truncate text-[11px] font-medium text-ink-2">{item.title}</p>
      <p className="flex h-4 items-center gap-1 text-[11px] text-ink-3">
        {item.rating != null && (
          <>
            <Star size={10} className="fill-accent text-accent" />
            {formatRating(item.rating, settings.ratingScale)}
          </>
        )}
        {caption && <span className="truncate">{caption}</span>}
      </p>
    </button>
  )
}

function Stat({ value, label, onClick }: { value?: number; label: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="block text-lg font-bold tabular-nums leading-tight">{value == null ? '—' : fmtNumber(value)}</span>
      <span className="block text-[11px] text-ink-3">{label}</span>
    </>
  )
  return onClick ? (
    <button onClick={onClick} className="flex-1 text-center">
      {body}
    </button>
  ) : (
    <div className="flex-1 text-center">{body}</div>
  )
}

/** Page de profil (la mienne ou celle d'un autre). */
export default function ProfileView({ username, onClose }: { username: string; onClose: () => void }) {
  const social = useSocial()
  const { settings } = useMedia()
  const [profile, setProfile] = useState<Profile | null>()
  const [error, setError] = useState<string>()
  const [tab, setTab] = useState<'profile' | 'library'>('profile')
  const [busy, setBusy] = useState(false)
  const [confirmUnfollow, setConfirmUnfollow] = useState(false)
  const [toast, setToast] = useState<string>()

  const load = useCallback(async () => {
    setError(undefined)
    try {
      setProfile(await getProfile(username))
    } catch (e) {
      setError((e as Error).message)
      setProfile(null)
    }
  }, [username])

  useEffect(() => {
    void load()
  }, [load])

  // Mon profil a changé (modification) : on recharge
  useEffect(() => {
    if (profile?.isMe && social.me) setProfile(social.me)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [social.me])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(undefined), 2500)
    return () => clearTimeout(timer)
  }, [toast])

  const owner = profile ? { username: profile.username, displayName: profile.displayName, avatarUrl: profile.avatarUrl } : undefined
  const openItem = (item: MediaItem) => social.openItem(item, profile?.isMe ? undefined : owner)

  const share = async () => {
    if (!profile) return
    const url = profileLink(profile.username)
    try {
      if (navigator.share && window.matchMedia?.('(pointer: coarse)').matches) await navigator.share({ title: profile.displayName, url })
      else {
        await navigator.clipboard.writeText(url)
        setToast(t('social.linkCopied'))
      }
    } catch {
      /* partage annulé */
    }
  }

  const toggleFollow = async () => {
    if (!profile) return
    if (profile.relation !== 'none') return setConfirmUnfollow(true)
    setBusy(true)
    try {
      await follow(profile.id)
      await load()
      void social.refresh()
    } catch (e) {
      setToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const doUnfollow = async () => {
    if (!profile) return
    setConfirmUnfollow(false)
    setBusy(true)
    try {
      await unfollow(profile.id)
      await load()
      void social.refresh()
    } catch (e) {
      setToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const topByCategory = useMemo(() => {
    const out: { label: string; items: MediaItem[] }[] = []
    // Mon profil : mes réglages locaux font foi tout de suite (même avant la synchro)
    const shown = profile?.isMe ? TOP_CATEGORIES.filter((c) => settings.topCategories.includes(c.value)) : TOP_CATEGORIES
    for (const c of shown) {
      const list = (profile?.top ?? []).filter((i) => i.top?.category === c.value).sort((a, b) => a.top!.rank - b.top!.rank)
      if (list.length) out.push({ label: c.plural, items: list })
    }
    return out
  }, [profile, settings.topCategories])

  return (
    <Sheet
      label={t('social.profile')}
      title={profile ? `@${profile.username}` : ''}
      onClose={onClose}
      right={
        profile ? (
          <button onClick={share} className="grid size-10 place-items-center rounded-full text-ink-2" aria-label={t('social.shareProfile')}>
            <Share2 size={18} />
          </button>
        ) : undefined
      }
    >
      {profile === undefined ? (
        <p className="flex items-center justify-center gap-2 py-16 text-sm text-ink-3">
          <Loader2 size={16} className="animate-spin" /> {t('social.loading')}
        </p>
      ) : profile === null ? (
        <div className="px-4">
          <EmptyState title={error ? t('social.loadError') : t('social.notFound')} text={error ?? t('social.notFoundHint', { username })} />
        </div>
      ) : (
        <>
          {/* Bannière + photo */}
          <div className="relative aspect-[3/1] w-full overflow-hidden bg-surface-2">
            {profile.bannerUrl && <img src={profile.bannerUrl} alt="" className="size-full object-cover" />}
          </div>
          <div className="px-4">
            <div className="relative -mt-11 flex items-end justify-between gap-3">
              <Avatar url={profile.avatarUrl} name={profile.displayName} size={88} className="border-4 border-bg" />
              {profile.isMe ? (
                <button onClick={social.openEdit} className="btn btn-ghost mb-1 px-4 py-2 text-sm">
                  {t('social.editProfile')}
                </button>
              ) : (
                <button
                  onClick={toggleFollow}
                  disabled={busy}
                  className={cx('btn mb-1 px-4 py-2 text-sm', profile.relation === 'none' ? 'btn-primary' : 'btn-ghost')}
                >
                  {busy ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : profile.relation === 'accepted' ? (
                    <Check size={15} />
                  ) : profile.relation === 'none' ? (
                    <UserPlus size={15} />
                  ) : null}
                  {profile.relation === 'accepted'
                    ? t('social.following')
                    : profile.relation === 'pending'
                      ? t('social.requested')
                      : profile.followsMe
                        ? t('social.followBack')
                        : t('social.follow')}
                </button>
              )}
            </div>

            <h1 className="mt-3 text-2xl font-bold leading-tight">{profile.displayName}</h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-3">
              @{profile.username}
              {profile.isPrivate && <Lock size={12} aria-label={t('social.private')} />}
              {profile.followsMe && !profile.isMe && (
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-ink-2">
                  {t('social.followsYou')}
                </span>
              )}
            </p>
            {profile.bio && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-2">{profile.bio}</p>}

            <div className="mt-5 flex divide-x divide-line rounded-2xl border border-line py-3">
              <Stat value={profile.visible ? (profile.stats?.finished ?? 0) : undefined} label={t('social.seen')} />
              <Stat value={profile.followers} label={t('social.followers', { count: profile.followers })} onClick={profile.visible ? () => social.openFollowList(profile, 'followers') : undefined} />
              <Stat value={profile.following} label={t('social.followingCount', { count: profile.following })} onClick={profile.visible ? () => social.openFollowList(profile, 'following') : undefined} />
            </div>

            {profile.isMe && social.requests.length > 0 && (
              <button onClick={() => social.openFollowList(profile, 'followers')} className="mt-3 flex w-full items-center justify-between rounded-2xl border border-accent px-4 py-3 text-sm">
                <span>{t('social.requests', { count: social.requests.length })}</span>
                <span className="text-accent">→</span>
              </button>
            )}

            {!profile.visible ? (
              <div className="mt-8 flex flex-col items-center rounded-2xl border border-line px-6 py-10 text-center">
                <Lock size={26} className="text-ink-3" />
                <p className="mt-3 font-semibold">{t('social.privateTitle')}</p>
                <p className="mt-1 text-sm text-ink-3">{t('social.privateText')}</p>
              </div>
            ) : (
              <>
                <div className="mt-6 grid grid-cols-2 gap-1 rounded-full border border-line p-1">
                  {(['profile', 'library'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setTab(v)}
                      className={cx('rounded-full py-2 text-sm font-medium transition-colors', tab === v ? 'bg-ink text-bg' : 'text-ink-3')}
                    >
                      {v === 'profile' ? t('social.tabProfile') : t('social.tabLibrary')}
                    </button>
                  ))}
                </div>
                {tab === 'profile' ? (
                  <ProfileTab profile={profile} topByCategory={topByCategory} onOpen={openItem} />
                ) : (
                  <LibraryTab profile={profile} onOpen={openItem} />
                )}
              </>
            )}
          </div>
        </>
      )}

      {toast && (
        <p role="status" className="sheet-in fixed inset-x-4 bottom-8 z-[70] mx-auto max-w-md rounded-2xl border border-line-strong bg-surface-2 p-3.5 text-center text-sm">
          {toast}
        </p>
      )}
      <ConfirmDialog
        open={confirmUnfollow}
        title={profile?.relation === 'pending' ? t('social.cancelRequestTitle') : t('social.unfollowTitle', { name: profile?.displayName ?? '' })}
        message={profile?.isPrivate && profile.relation === 'accepted' ? t('social.unfollowPrivate') : undefined}
        confirmLabel={profile?.relation === 'pending' ? t('social.cancelRequest') : t('social.unfollow')}
        onConfirm={doUnfollow}
        onCancel={() => setConfirmUnfollow(false)}
      />
    </Sheet>
  )
}

function ProfileTab({ profile, topByCategory, onOpen }: { profile: Profile; topByCategory: { label: string; items: MediaItem[] }[]; onOpen: (i: MediaItem) => void }) {
  const s = profile.stats
  return (
    <>
      {topByCategory.map((c) => (
        <section key={c.label}>
          <SectionTitle>
            {t('social.top5')} · {c.label}
          </SectionTitle>
          <div className="grid grid-cols-5 gap-2">
            {c.items.map((item) => (
              <div key={item.id} className="relative">
                <PosterTile item={item} onOpen={() => onOpen(item)} />
                <span className="absolute left-1 top-1 grid size-5 place-items-center rounded-full bg-bg/85 text-[10px] font-bold">{item.top!.rank}</span>
              </div>
            ))}
          </div>
        </section>
      ))}

      {profile.watching.length > 0 && (
        <>
          <SectionTitle>{t('social.watching')}</SectionTitle>
          <div className="grid grid-cols-4 gap-2.5">
            {profile.watching.map((item) => (
              <PosterTile key={item.id} item={item} onOpen={() => onOpen(item)} />
            ))}
          </div>
        </>
      )}

      <SectionTitle>{t('social.recent')}</SectionTitle>
      {profile.recent.length ? (
        <div className="grid grid-cols-4 gap-2.5">
          {profile.recent.map((item) => (
            <PosterTile key={item.id} item={item} onOpen={() => onOpen(item)} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-3">{t('social.noRecent')}</p>
      )}

      {profile.watchlist.length > 0 && (
        <>
          <SectionTitle>{t('social.watchlist')}</SectionTitle>
          <div className="grid grid-cols-4 gap-2.5">
            {profile.watchlist.map((item) => (
              <PosterTile key={item.id} item={item} onOpen={() => onOpen(item)} />
            ))}
          </div>
        </>
      )}

      {s && (
        <>
          <SectionTitle>{t('nav.stats')}</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            {[
              [s.finishedYear, t('social.statYear')],
              [s.films, t('social.statFilms')],
              [s.series, t('social.statSeries')],
              [s.episodes, t('home.episodesSeen')],
            ].map(([v, label]) => (
              <div key={label as string} className="card p-4">
                <div className="eyebrow">{label}</div>
                <div className="mt-2 text-2xl font-bold tabular-nums leading-none">{fmtNumber(v as number)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function LibraryTab({ profile, onOpen }: { profile: Profile; onOpen: (i: MediaItem) => void }) {
  const [status, setStatus] = useState<WatchStatus | ''>('')
  const [list, setList] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const request = useRef(0)

  const loadPage = useCallback(
    async (reset: boolean) => {
      // Une réponse arrivée après un changement de filtre ne doit pas écraser la nouvelle liste
      const id = ++request.current
      setLoading(true)
      if (reset) setList([])
      try {
        const page = await getProfileItems(profile.id, status || null, reset ? 0 : list.length)
        if (id !== request.current) return
        setList((prev) => (reset ? page : [...prev, ...page]))
        setDone(page.length < 48)
      } catch {
        if (id === request.current) setDone(true)
      } finally {
        if (id === request.current) setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile.id, status, list.length],
  )

  useEffect(() => {
    void loadPage(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, status])

  return (
    <div className="mt-5">
      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
        <button onClick={() => setStatus('')} className={cx('chip shrink-0 py-1! text-[13px]', !status && 'chip-on')}>
          {t('catalog.all')}
        </button>
        {STATUSES.map((s) => (
          <button key={s.value} onClick={() => setStatus(s.value)} className={cx('chip shrink-0 py-1! text-[13px]', status === s.value && 'chip-on')}>
            {s.label}
          </button>
        ))}
      </div>
      {list.length ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {list.map((item) => (
            <PosterTile key={item.id} item={item} onOpen={() => onOpen(item)} />
          ))}
        </div>
      ) : (
        !loading && <p className="py-6 text-center text-sm text-ink-3">{t('social.emptyLibrary')}</p>
      )}
      {loading && (
        <p className="flex items-center justify-center gap-2 py-6 text-sm text-ink-3">
          <Loader2 size={14} className="animate-spin" />
        </p>
      )}
      {!loading && !done && list.length > 0 && (
        <button onClick={() => loadPage(false)} className="btn btn-ghost mt-5 w-full">
          {t('social.loadMore')}
        </button>
      )}
    </div>
  )
}
