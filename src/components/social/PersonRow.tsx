import { Check, Loader2, Lock } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { t } from '../../i18n'
import { follow, unfollow, type ProfileCard } from '../../lib/cloud/social'
import { cx } from '../../lib/utils'
import Avatar from './Avatar'
import { useSocial } from './SocialProvider'

/** Ligne « personne » : photo, nom, @pseudo, et bouton d'abonnement (ou actions personnalisées). */
export default function PersonRow({ person, actions }: { person: ProfileCard; actions?: ReactNode }) {
  const social = useSocial()
  const [relation, setRelation] = useState(person.relation)
  const [busy, setBusy] = useState(false)
  const isMe = social.me?.id === person.id

  const toggle = async () => {
    setBusy(true)
    try {
      if (relation === 'none') setRelation(await follow(person.id))
      else {
        await unfollow(person.id)
        setRelation('none')
      }
      void social.refresh()
    } catch {
      /* réseau : rien ne change */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3 py-2.5">
      <button onClick={() => social.openProfile(person.username)} className="flex min-w-0 flex-1 items-center gap-3 text-start">
        <Avatar url={person.avatarUrl} name={person.displayName} size={44} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{person.displayName}</span>
          <span className="flex items-center gap-1 text-xs text-ink-3">
            @{person.username}
            {person.isPrivate && <Lock size={10} />}
          </span>
        </span>
      </button>
      {actions ??
        (!isMe && (
          <button
            onClick={toggle}
            disabled={busy}
            className={cx(
              'flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold transition active:scale-95',
              relation === 'none' ? 'bg-accent-fill text-on-accent' : 'border border-line-strong text-ink-2',
            )}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : relation === 'accepted' ? <Check size={13} /> : null}
            {relation === 'accepted' ? t('social.following') : relation === 'pending' ? t('social.requested') : t('social.follow')}
          </button>
        ))}
    </div>
  )
}
