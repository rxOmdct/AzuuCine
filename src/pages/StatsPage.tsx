import { t } from '../i18n'
import { PageHeader } from '../components/ui'

/** Statistiques : en cours de refonte complète. */
export default function StatsPage() {
  return (
    <>
      <PageHeader title={t('nav.stats')} />
      <div className="grid min-h-[50dvh] place-items-center">
        <p className="text-5xl font-bold tracking-tight text-ink-3 lg:text-7xl">Soon</p>
      </div>
    </>
  )
}
