import { t } from '../i18n'

/** Route inconnue (#/…) : on le dit, plutôt que d'afficher l'accueil sans explication. */
export default function NotFoundPage({ onHome }: { onHome: () => void }) {
  return (
    <div className="grid min-h-[70dvh] place-items-center text-center">
      <div className="max-w-md px-2">
        <p aria-hidden="true" className="text-8xl font-extrabold tracking-tighter text-line-strong lg:text-9xl">
          4<span className="text-accent">0</span>4
        </p>
        <h1 className="mt-5 text-2xl font-bold">{t('notFound.title')}</h1>
        <p className="mt-2 text-sm text-ink-2">{t('notFound.text')}</p>
        <button onClick={onHome} className="btn btn-primary mt-7 px-6 py-3">
          {t('notFound.back')}
        </button>
      </div>
    </div>
  )
}
