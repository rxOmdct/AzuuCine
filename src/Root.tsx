import { useEffect, useMemo, useState } from 'react'
import App from './App'
import AuthScreen, { NewPasswordScreen } from './components/AuthScreen'
import { consumeAuthRedirect, getSession, onSessionChange, type Session } from './lib/cloud/auth'
import { cloudEnabled } from './lib/cloud/config'
import { setScope } from './lib/scope'
import { MediaProvider } from './store'

/**
 * Point d'entrée : sans configuration Supabase, l'app reste 100 % locale.
 * Avec, il faut être connecté ; chaque compte a son propre espace sur l'appareil.
 */
export default function Root() {
  const [session, setSession] = useState<Session | null>(() => (cloudEnabled ? getSession() : null))
  // Lien reçu par email en cours de traitement (#access_token=…)
  const [redirect, setRedirect] = useState<'checking' | 'recovery' | 'none'>(() =>
    cloudEnabled && /(^#|&)(access_token|error)=/.test(location.hash) ? 'checking' : 'none',
  )
  const [notice, setNotice] = useState<string>()
  const userId = session?.user.id
  const userEmail = session?.user.email
  const user = useMemo(() => (userId ? { id: userId, email: userEmail ?? '' } : undefined), [userId, userEmail])

  useEffect(() => {
    if (!cloudEnabled) return
    const off = onSessionChange(setSession)
    if (redirect === 'checking') {
      consumeAuthRedirect().then((r) => {
        if (r.error) setNotice(r.error)
        setRedirect(r.type === 'recovery' ? 'recovery' : 'none')
        setSession(getSession())
      })
    }
    return () => {
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!cloudEnabled) {
    setScope(null)
    return (
      <MediaProvider>
        <App />
      </MediaProvider>
    )
  }
  if (redirect === 'checking') return <div className="min-h-dvh bg-bg" />
  if (redirect === 'recovery' && session) return <NewPasswordScreen onDone={() => setRedirect('none')} />
  if (!session) {
    setScope(null)
    return <AuthScreen notice={notice} />
  }

  // L'espace de stockage doit être choisi avant que le fournisseur de données ne lise quoi que ce soit
  setScope(session.user.id)
  return (
    <MediaProvider key={session.user.id} cloudUser={user}>
      <App />
    </MediaProvider>
  )
}
