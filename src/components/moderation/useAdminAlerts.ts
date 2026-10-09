import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { adminAlerts, type AdminAlerts } from '../../lib/cloud/adminModeration'

/** Compteurs « à traiter » de l'administration (signalements ouverts, nouveaux bugs, nouvelles erreurs). */
export function useAdminAlerts(enabled: boolean, refreshKey: unknown = 0): AdminAlerts | null {
  const [alerts, setAlerts] = useState<AdminAlerts | null>(null)
  useEffect(() => {
    if (!enabled) return setAlerts(null)
    let alive = true
    adminAlerts()
      .then((a) => alive && setAlerts(a))
      .catch(() => alive && setAlerts(null))
    return () => {
      alive = false
    }
  }, [enabled, refreshKey])
  return alerts
}

/** Résumé court pour la ligne « Administration » des réglages (undefined s'il n'y a rien à traiter). */
export function alertsSummary(a: AdminAlerts | null): string | undefined {
  if (!a) return undefined
  const parts = [
    a.reports ? t('adminMod.alertReports', { count: a.reports }) : '',
    a.bugs ? t('adminMod.alertBugs', { count: a.bugs }) : '',
    a.errors ? t('adminMod.alertErrors', { count: a.errors }) : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}
