import { t } from '../i18n'
import { LanguageSelect } from '../i18n/react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { PASSWORD_MIN, requestPasswordReset, signIn, signUp, updatePassword } from '../lib/cloud/auth'
import { cx } from '../lib/utils'

type Mode = 'login' | 'signup' | 'forgot'

function PasswordField({ value, onChange, placeholder, autoComplete }: { value: string; onChange: (v: string) => void; placeholder: string; autoComplete: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        className="field pr-11"
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        minLength={PASSWORD_MIN}
        maxLength={72}
        required
      />
      <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3" aria-label={show ? t('auth.hidePassword') : t('auth.showPassword')}>
        {show ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  )
}

function Shell({ children, subtitle }: { children: ReactNode; subtitle: string }) {
  return (
    <div className="safe-top safe-bottom flex min-h-dvh flex-col items-center justify-center bg-bg px-5 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-[2.4rem] font-bold leading-none">
          Azuu<span className="text-accent">Cine</span>
        </h1>
        <p className="mt-3 text-center text-sm text-ink-3">{subtitle}</p>
        <div className="mt-9">{children}</div>
        <div className="mt-10 flex justify-center">
          <LanguageSelect className="rounded-full border border-line bg-transparent px-3 py-1.5 text-xs text-ink-3" />
        </div>
      </div>
    </div>
  )
}

/** Écran de connexion / inscription (affiché quand les comptes sont activés et qu'on n'est pas connecté). */
export default function AuthScreen({ notice }: { notice?: string }) {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [info, setInfo] = useState<string | undefined>(notice)

  const switchTo = (m: Mode) => {
    setMode(m)
    setError(undefined)
    setInfo(undefined)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(undefined)
    setInfo(undefined)
    if (mode === 'signup' && password !== confirm) return setError(t('auth.mismatch'))
    setBusy(true)
    try {
      if (mode === 'login') await signIn(email, password)
      else if (mode === 'signup') {
        const needsConfirm = await signUp(email, password)
        if (needsConfirm) {
          setInfo(t('auth.created', { email: email.trim() }))
          setMode('login')
          setPassword('')
          setConfirm('')
        }
      } else {
        await requestPasswordReset(email)
        setInfo(t('auth.resetSent'))
        setMode('login')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell subtitle={t('auth.tagline')}>
      {mode !== 'forgot' && (
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-full border border-line p-1">
          {(['login', 'signup'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchTo(m)}
              className={cx('rounded-full py-2 text-sm font-medium transition-colors', mode === m ? 'bg-ink text-bg' : 'text-ink-3')}
            >
              {m === 'login' ? t('auth.loginTab') : t('auth.signupTab')}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="space-y-3">
        {mode === 'forgot' && <h2 className="mb-1 text-lg font-semibold">{t('auth.forgotTitle')}</h2>}
        <input
          className="field"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('auth.email')}
          autoComplete="email"
          inputMode="email"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={320}
          required
        />
        {mode !== 'forgot' && (
          <PasswordField value={password} onChange={setPassword} placeholder={t('auth.password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        )}
        {mode === 'signup' && (
          <>
            <PasswordField value={confirm} onChange={setConfirm} placeholder={t('auth.confirmPassword')} autoComplete="new-password" />
            <p className="text-xs text-ink-3">{t('auth.minChars', { n: PASSWORD_MIN })}</p>
          </>
        )}

        {error && (
          <p role="alert" className="rounded-xl border border-accent px-3 py-2.5 text-sm text-ink">
            {error}
          </p>
        )}
        {info && (
          <p role="status" className="rounded-xl border border-line-strong px-3 py-2.5 text-sm text-ink-2">
            {info}
          </p>
        )}

        <button type="submit" disabled={busy} className="btn btn-primary w-full py-3">
          {busy && <Loader2 size={17} className="animate-spin" />}
          {mode === 'login' ? t('auth.login') : mode === 'signup' ? t('auth.signup') : t('auth.sendLink')}
        </button>
      </form>

      <div className="mt-5 text-center text-sm">
        {mode === 'login' && (
          <button type="button" onClick={() => switchTo('forgot')} className="text-ink-3">
            {t('auth.forgot')}
          </button>
        )}
        {mode === 'forgot' && (
          <button type="button" onClick={() => switchTo('login')} className="text-ink-3">
            ← {t('auth.backToLogin')}
          </button>
        )}
      </div>

      <p className="mt-10 text-center text-[11px] leading-relaxed text-ink-3">
        {t('auth.privacy')}
      </p>
    </Shell>
  )
}

/** Choix d'un nouveau mot de passe (après le lien « mot de passe oublié »). */
export function NewPasswordScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) return setError(t('auth.mismatch'))
    setBusy(true)
    setError(undefined)
    try {
      await updatePassword(password)
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell subtitle={t('auth.newPasswordTitle')}>
      <form onSubmit={submit} className="space-y-3">
        <PasswordField value={password} onChange={setPassword} placeholder={t('auth.newPassword')} autoComplete="new-password" />
        <PasswordField value={confirm} onChange={setConfirm} placeholder={t('auth.confirmPassword')} autoComplete="new-password" />
        <p className="text-xs text-ink-3">{t('auth.minChars', { n: PASSWORD_MIN })}</p>
        {error && (
          <p role="alert" className="rounded-xl border border-accent px-3 py-2.5 text-sm">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="btn btn-primary w-full py-3">
          {busy && <Loader2 size={17} className="animate-spin" />}
          {t('common.save')}
        </button>
      </form>
    </Shell>
  )
}
