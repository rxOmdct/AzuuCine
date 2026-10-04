import { Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { t } from '../../i18n'
import { updateProfile, USERNAME_RE, type ProfilePatch } from '../../lib/cloud/social'
import { cx } from '../../lib/utils'
import Avatar from './Avatar'
import { useSocial } from './SocialProvider'

/** Pseudo attribué automatiquement à l'inscription (cinephile_xxxxxx) : pas encore choisi. */
export const RANDOM_USERNAME = /^cinephile_[0-9a-f]{6}$/

/** « Zoé Ciné » → « zoe_cine » : accents retirés, espaces en _, le reste ignoré. */
const toUsername = (v: string) =>
  v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 20)

/** Premier lancement d'un compte : on choisit son pseudo (et son nom) avant tout. */
export default function WelcomeProfile({ onLater }: { onLater: () => void }) {
  const { me, refresh } = useSocial()
  const suggested = me && !RANDOM_USERNAME.test(me.displayName) ? me.displayName : ''
  const [displayName, setDisplayName] = useState(suggested)
  const [username, setUsername] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  const clean = username.trim().toLowerCase().replace(/^@/, '')
  const usernameOk = USERNAME_RE.test(clean) && !RANDOM_USERNAME.test(clean)
  const name = displayName.trim() || clean

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!me || !usernameOk || name.length > 40) return
    setSaving(true)
    setError(undefined)
    try {
      const patch: ProfilePatch = { username: clean }
      if (name !== me.displayName) patch.display_name = name
      await updateProfile(patch)
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!me) return null

  return (
    <div className="sheet-in fixed inset-0 z-50 overflow-y-auto bg-bg" role="dialog" aria-modal="true" aria-label={t('welcome.title')}>
      <div className="safe-top safe-bottom mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
        <div className="flex justify-center">
          <Avatar url={me.avatarUrl} name={name || '?'} size={88} />
        </div>
        <h1 className="mt-6 text-center text-[1.75rem] font-bold leading-tight">
          {t('welcome.titleA')} <span className="text-accent">{t('welcome.titleB')}</span>
        </h1>
        <p className="mt-2 text-center text-sm text-ink-3">{t('welcome.text')}</p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block">
            <span className="label">{t('social.username')}</span>
            <div className="relative">
              <span className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-3">@</span>
              <input
                className={cx('field ps-8', clean && !usernameOk && 'border-accent!')}
                value={username}
                onChange={(e) => setUsername(toUsername(e.target.value))}
                maxLength={21}
                placeholder={t('welcome.usernamePh')}
                autoCapitalize="off"
                autoComplete="username"
                spellCheck={false}
                autoFocus
                required
              />
            </div>
            <span className={cx('mt-1.5 block text-xs', !clean || usernameOk ? 'text-ink-3' : 'text-accent')}>{t('social.usernameRule')}</span>
          </label>
          <label className="block">
            <span className="label">{t('social.displayName')}</span>
            <input className="field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} placeholder={clean || t('welcome.namePh')} />
            <span className="mt-1.5 block text-xs text-ink-3">{t('welcome.nameHint')}</span>
          </label>

          {error && (
            <p role="alert" className="rounded-xl border border-accent px-3 py-2.5 text-sm">
              {error}
            </p>
          )}

          <button type="submit" disabled={saving || !usernameOk} className="btn btn-primary w-full py-3">
            {saving && <Loader2 size={17} className="animate-spin" />}
            {t('welcome.go')}
          </button>
        </form>

        <button type="button" onClick={onLater} className="mt-5 text-center text-sm text-ink-3">
          {t('welcome.later')}
        </button>
      </div>
    </div>
  )
}
