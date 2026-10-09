import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from '../i18n'
import { reportError } from '../lib/errorReporter'

/**
 * Filet de sécurité global : si l'affichage plante, on montre un écran propre
 * (« Oups… ») au lieu d'une page blanche, et l'erreur est remontée (sans donnée perso).
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    reportError(error, 'render', info.componentStack ?? '')
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <CrashScreen onRetry={() => this.setState({ failed: false })} />
  }
}

function CrashScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <main role="alert" className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 text-center text-ink">
      <p className="text-5xl font-bold text-accent" aria-hidden>
        :(
      </p>
      <h1 className="mt-6 text-2xl font-bold">{t('crash.title')}</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-2">{t('crash.text')}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => location.reload()} className="btn btn-primary">
          {t('crash.reload')}
        </button>
        <button type="button" onClick={onRetry} className="btn btn-ghost">
          {t('crash.retry')}
        </button>
      </div>
      <p className="mt-8 max-w-xs text-xs text-ink-3">{t('crash.privacy')}</p>
    </main>
  )
}
