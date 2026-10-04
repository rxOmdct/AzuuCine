import { Camera, ImagePlus, Loader2, Lock, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { deleteProfileImage, updateProfile, uploadProfileImage, USERNAME_RE, type ProfilePatch } from '../../lib/cloud/social'
import { cropImageToJpeg } from '../../lib/image'
import { cx } from '../../lib/utils'
import Avatar from './Avatar'
import Sheet from './Sheet'
import { useSocial } from './SocialProvider'

/** Modifier mon profil : photo, bannière, nom, pseudo, bio, compte privé. */
export default function EditProfile({ onClose }: { onClose: () => void }) {
  const { me, refresh } = useSocial()
  const [displayName, setDisplayName] = useState(me?.displayName ?? '')
  const [username, setUsername] = useState(me?.username ?? '')
  const [bio, setBio] = useState(me?.bio ?? '')
  const [isPrivate, setIsPrivate] = useState(me?.isPrivate ?? false)
  const [avatar, setAvatar] = useState<{ blob?: Blob; preview?: string; removed?: boolean }>({ preview: me?.avatarUrl })
  const [banner, setBanner] = useState<{ blob?: Blob; preview?: string; removed?: boolean }>({ preview: me?.bannerUrl })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const avatarInput = useRef<HTMLInputElement>(null)
  const bannerInput = useRef<HTMLInputElement>(null)

  // Aperçus locaux : libérés dès qu'ils sont remplacés ou que la fenêtre se ferme
  useEffect(() => {
    const url = avatar.preview
    return () => {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
    }
  }, [avatar.preview])
  useEffect(() => {
    const url = banner.preview
    return () => {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
    }
  }, [banner.preview])

  const cleanUsername = username.trim().toLowerCase().replace(/^@/, '')
  const usernameOk = USERNAME_RE.test(cleanUsername)
  const nameOk = displayName.trim().length >= 1 && displayName.trim().length <= 40

  const pick = async (kind: 'avatar' | 'banner', file?: File) => {
    if (!file) return
    setError(undefined)
    try {
      const blob = kind === 'avatar' ? await cropImageToJpeg(file, 400, 400) : await cropImageToJpeg(file, 1500, 500, 0.84)
      const preview = URL.createObjectURL(blob)
      if (kind === 'avatar') setAvatar({ blob, preview })
      else setBanner({ blob, preview })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const save = async () => {
    if (!me || !usernameOk || !nameOk) return
    setSaving(true)
    setError(undefined)
    const uploaded: string[] = []
    try {
      const patch: ProfilePatch = {}
      if (displayName.trim() !== me.displayName) patch.display_name = displayName.trim()
      if (cleanUsername !== me.username) patch.username = cleanUsername
      if (bio.trim() !== me.bio) patch.bio = bio.trim()
      if (isPrivate !== me.isPrivate) patch.is_private = isPrivate
      if (avatar.blob) {
        patch.avatar_url = await uploadProfileImage('avatar', avatar.blob)
        uploaded.push(patch.avatar_url)
      } else if (avatar.removed) patch.avatar_url = null
      if (banner.blob) {
        patch.banner_url = await uploadProfileImage('banner', banner.blob)
        uploaded.push(patch.banner_url)
      } else if (banner.removed) patch.banner_url = null
      if (Object.keys(patch).length) await updateProfile(patch)
      // Les anciennes images ne servent plus
      if ('avatar_url' in patch) await deleteProfileImage(me.avatarUrl)
      if ('banner_url' in patch) await deleteProfileImage(me.bannerUrl)
      await refresh()
      onClose()
    } catch (e) {
      for (const url of uploaded) await deleteProfileImage(url)
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!me) {
    return (
      <Sheet label={t('social.editProfile')} title={t('social.editProfile')} onClose={onClose}>
        <p className="px-4 py-12 text-center text-sm text-ink-3">{t('social.loadError')}</p>
      </Sheet>
    )
  }

  return (
    <Sheet
      label={t('social.editProfile')}
      title={t('social.editProfile')}
      onClose={onClose}
      right={
        <button onClick={save} disabled={saving || !usernameOk || !nameOk} className="btn btn-light px-3 py-1.5 text-sm">
          {saving ? <Loader2 size={15} className="animate-spin" /> : t('common.save')}
        </button>
      }
    >
      {/* Bannière */}
      <button type="button" onClick={() => bannerInput.current?.click()} className="relative block aspect-[3/1] w-full overflow-hidden bg-surface-2" aria-label={t('social.changeBanner')}>
        {banner.preview && !banner.removed && <img src={banner.preview} alt="" className="size-full object-cover" />}
        <span className="absolute inset-0 grid place-items-center bg-black/25">
          <span className="flex items-center gap-2 rounded-full bg-bg/85 px-3 py-1.5 text-xs font-semibold">
            <ImagePlus size={14} /> {t('social.changeBanner')}
          </span>
        </span>
      </button>
      <input ref={bannerInput} type="file" accept="image/*" hidden onChange={(e) => pick('banner', e.target.files?.[0])} />

      <div className="px-4">
        <div className="-mt-11 flex items-end gap-3">
          <button type="button" onClick={() => avatarInput.current?.click()} className="relative rounded-full" aria-label={t('social.changeAvatar')}>
            <Avatar url={avatar.removed ? undefined : avatar.preview} name={displayName || me.username} size={88} className="border-4 border-bg" />
            <span className="absolute bottom-1 end-1 grid size-7 place-items-center rounded-full bg-accent-fill text-on-accent">
              <Camera size={14} />
            </span>
          </button>
          <input ref={avatarInput} type="file" accept="image/*" hidden onChange={(e) => pick('avatar', e.target.files?.[0])} />
          <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
            {avatar.preview && !avatar.removed && (
              <button type="button" onClick={() => setAvatar({ removed: true })} className="flex items-center gap-1">
                <Trash2 size={12} /> {t('social.removeAvatar')}
              </button>
            )}
            {banner.preview && !banner.removed && (
              <button type="button" onClick={() => setBanner({ removed: true })} className="flex items-center gap-1">
                <Trash2 size={12} /> {t('social.removeBanner')}
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="label">{t('social.displayName')}</span>
            <input className="field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} required />
          </label>
          <label className="block">
            <span className="label">{t('social.username')}</span>
            <div className="relative">
              <span className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-3">@</span>
              <input
                className={cx('field ps-8', username && !usernameOk && 'border-accent!')}
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                maxLength={21}
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <span className={cx('mt-1.5 block text-xs', usernameOk ? 'text-ink-3' : 'text-accent')}>{t('social.usernameRule')}</span>
          </label>
          <label className="block">
            <span className="label">{t('social.bio')}</span>
            <textarea className="field min-h-24 resize-y" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={300} placeholder={t('social.bioPh')} />
            <span className="mt-1 block text-end text-[11px] text-ink-3">{bio.length}/300</span>
          </label>

          <button type="button" role="switch" aria-checked={isPrivate} onClick={() => setIsPrivate((v) => !v)} className="flex w-full items-center gap-3 rounded-2xl border border-line px-4 py-3.5 text-start">
            <Lock size={18} className="shrink-0 text-ink-2" />
            <span className="flex-1">
              <span className="block text-sm font-medium">{t('social.privateAccount')}</span>
              <span className="mt-0.5 block text-xs text-ink-3">{t('social.privateHint')}</span>
            </span>
            <span className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors', isPrivate ? 'bg-accent-fill' : 'bg-surface-2 border border-line-strong')}>
              <span className={cx('absolute top-0.5 size-5 rounded-full bg-ink transition-all', isPrivate ? 'start-[22px] bg-on-accent' : 'start-0.5')} />
            </span>
          </button>

          {error && (
            <p role="alert" className="rounded-xl border border-accent px-3 py-2.5 text-sm">
              {error}
            </p>
          )}
          <p className="text-xs leading-relaxed text-ink-3">{t('social.publicHint')}</p>
        </div>
      </div>
    </Sheet>
  )
}
