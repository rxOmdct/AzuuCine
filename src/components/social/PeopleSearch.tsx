import { Loader2, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { profileLink, searchProfiles, type ProfileCard } from '../../lib/cloud/social'
import PersonRow from './PersonRow'
import Sheet from './Sheet'
import { useSocial } from './SocialProvider'

/** Trouver des amis par pseudo ou par nom. */
export default function PeopleSearch({ onClose }: { onClose: () => void }) {
  const { me } = useSocial()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<ProfileCard[]>([])
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setLoading(false)
      return setResults([])
    }
    let alive = true
    setLoading(true)
    const timer = setTimeout(() => {
      searchProfiles(term)
        .then((r) => alive && setResults(r))
        .catch(() => alive && setResults([]))
        .finally(() => alive && setLoading(false))
    }, 300)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [q])

  const invite = async () => {
    if (!me) return
    const url = profileLink(me.username)
    try {
      if (navigator.share && window.matchMedia?.('(pointer: coarse)').matches) await navigator.share({ title: 'AzuuCine', text: t('social.inviteText'), url })
      else {
        await navigator.clipboard.writeText(url)
        setCopied(true)
      }
    } catch {
      /* annulé */
    }
  }

  return (
    <Sheet label={t('social.findFriends')} title={t('social.findFriends')} onClose={onClose}>
      <div className="px-4 pt-4">
        <div className="relative">
          <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('social.searchPh')}
            className="field pl-10"
            autoFocus
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
          />
          {loading && <Loader2 size={17} className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-ink-3" />}
        </div>

        {results.length > 0 ? (
          <div className="mt-3 divide-y divide-line">
            {results.map((p) => (
              <PersonRow key={p.id} person={p} />
            ))}
          </div>
        ) : (
          q.trim().length >= 2 && !loading && <p className="py-8 text-center text-sm text-ink-3">{t('social.noResults')}</p>
        )}

        {me && (
          <div className="mt-8 rounded-2xl border border-dashed border-line-strong p-4 text-sm">
            <p className="text-ink-2">{t('social.inviteHint')}</p>
            <button onClick={invite} className="mt-2 font-medium text-ink">
              {copied ? t('social.linkCopied') : t('social.shareMyProfile')} <span className="text-accent">→</span>
            </button>
          </div>
        )}
      </div>
    </Sheet>
  )
}
