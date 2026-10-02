import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { acceptFollower, getFollowList, removeFollower, type Profile, type ProfileCard } from '../../lib/cloud/social'
import { cx } from '../../lib/utils'
import PersonRow from './PersonRow'
import Sheet from './Sheet'
import { useSocial } from './SocialProvider'

type Tab = 'followers' | 'following' | 'requests'

/** Abonnés / abonnements d'un profil ; pour le mien, aussi les demandes en attente. */
export default function FollowList({ profile, initial, onClose }: { profile: Profile; initial: 'followers' | 'following'; onClose: () => void }) {
  const social = useSocial()
  const showRequests = profile.isMe && social.requests.length > 0
  const [tab, setTab] = useState<Tab>(showRequests && initial === 'followers' ? 'requests' : initial)
  const [list, setList] = useState<ProfileCard[]>()
  const [busy, setBusy] = useState<string>()

  useEffect(() => {
    if (tab === 'requests') return setList(social.requests)
    let alive = true
    setList(undefined)
    getFollowList(profile.id, tab)
      .then((l) => alive && setList(l))
      .catch(() => alive && setList([]))
    return () => {
      alive = false
    }
  }, [tab, profile.id, social.requests])

  const act = async (person: ProfileCard, action: 'accept' | 'remove') => {
    setBusy(person.id)
    try {
      if (action === 'accept') await acceptFollower(person.id)
      else await removeFollower(person.id)
      setList((l) => l?.filter((p) => p.id !== person.id))
      await social.refresh()
    } finally {
      setBusy(undefined)
    }
  }

  const tabs: Tab[] = showRequests ? ['requests', 'followers', 'following'] : ['followers', 'following']

  return (
    <Sheet label={profile.displayName} title={profile.displayName} onClose={onClose}>
      <div className="px-4 pt-4">
        <div className={cx('grid gap-1 rounded-full border border-line p-1', tabs.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
          {tabs.map((v) => (
            <button key={v} onClick={() => setTab(v)} className={cx('rounded-full py-2 text-xs font-semibold transition-colors', tab === v ? 'bg-ink text-bg' : 'text-ink-3')}>
              {v === 'requests'
                ? t('social.requestsTab', { count: social.requests.length })
                : v === 'followers'
                  ? t('social.followers', { count: profile.followers })
                  : t('social.followingCount', { count: profile.following })}
            </button>
          ))}
        </div>

        {list === undefined ? (
          <p className="flex justify-center py-10">
            <Loader2 size={16} className="animate-spin text-ink-3" />
          </p>
        ) : list.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-3">{tab === 'following' ? t('social.noFollowing') : t('social.noFollowers')}</p>
        ) : (
          <div className="mt-3 divide-y divide-line">
            {list.map((p) => (
              <PersonRow
                key={p.id}
                person={p}
                actions={
                  tab === 'requests' ? (
                    <span className="flex shrink-0 gap-1.5">
                      <button onClick={() => act(p, 'accept')} disabled={!!busy} className="h-8 rounded-full bg-accent-fill px-3 text-xs font-semibold text-on-accent">
                        {t('social.accept')}
                      </button>
                      <button onClick={() => act(p, 'remove')} disabled={!!busy} className="h-8 rounded-full border border-line-strong px-3 text-xs font-semibold text-ink-2">
                        {t('social.decline')}
                      </button>
                    </span>
                  ) : profile.isMe && tab === 'followers' ? (
                    <button onClick={() => act(p, 'remove')} disabled={!!busy} className="h-8 shrink-0 rounded-full border border-line-strong px-3 text-xs font-semibold text-ink-2">
                      {t('social.removeFollower')}
                    </button>
                  ) : undefined
                }
              />
            ))}
          </div>
        )}
      </div>
    </Sheet>
  )
}
