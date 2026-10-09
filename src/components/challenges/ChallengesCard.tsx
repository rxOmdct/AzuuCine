import { Target, Trophy, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { t } from '../../i18n'
import { celebrated, challengeTitle, computeProgress, markCelebrated } from '../../lib/challenges'
import { todayISO } from '../../lib/utils'
import { useMedia } from '../../store'
import type { MediaItem } from '../../types'
import { LinkArrow, SectionTitle } from '../ui'
import { ChallengeSummary } from './ChallengeBits'
import ChallengesSheet, { type ChallengesView } from './ChallengesSheet'

const HOME_MAX = 3

/** Carte « Défis » de l'accueil : défis en cours, rythme, petite célébration à la réussite. */
export default function ChallengesCard({ onOpen }: { onOpen: (item: MediaItem) => void }) {
  const { items, settings } = useMedia()
  const [sheet, setSheet] = useState<ChallengesView | null>(null)
  const today = todayISO()

  const rows = useMemo(
    () =>
      (settings.challenges ?? [])
        .filter((c) => !c.archived && c.end >= today)
        .map((c) => ({ c, p: computeProgress(c, items, today) }))
        // En cours d'abord (fin la plus proche), puis à venir, puis réussis
        .sort((a, b) => rank(a.p.state) - rank(b.p.state) || a.c.end.localeCompare(b.c.end)),
    [settings.challenges, items, today],
  )

  // Célébration : une fois par défi réussi (et par appareil)
  const [party, setParty] = useState<string[]>([])
  useEffect(() => {
    const seen = celebrated()
    const fresh = rows.filter((r) => r.p.done && !seen.has(r.c.id)).map((r) => r.c.id)
    if (!fresh.length) return
    fresh.forEach(markCelebrated)
    setParty((prev) => [...new Set([...prev, ...fresh])])
  }, [rows])
  const partyRow = rows.find((r) => party.includes(r.c.id))

  const shown = rows.slice(0, HOME_MAX)
  const sheetEl = sheet && <ChallengesSheet initial={sheet} onClose={() => setSheet(null)} onOpen={onOpen} />

  if (!rows.length) {
    return (
      <>
        <SectionTitle>{t('challenges.title')}</SectionTitle>
        <div className="card flex items-center gap-4 p-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-full border border-line-strong text-accent">
            <Target size={22} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{t('challenges.emptyTitle')}</span>
            <span className="mt-0.5 block text-xs text-ink-3">{t('challenges.emptyText')}</span>
          </span>
        </div>
        <div className="mt-2 flex gap-2">
          <button onClick={() => setSheet({ kind: 'list' })} className="btn btn-ghost flex-1 px-3 py-2 text-sm">
            {t('challenges.templates')}
          </button>
          <button onClick={() => setSheet({ kind: 'new' })} className="btn btn-primary flex-1 px-3 py-2 text-sm">
            {t('challenges.create')}
          </button>
        </div>
        {sheetEl}
      </>
    )
  }

  return (
    <>
      <SectionTitle action={<LinkArrow onClick={() => setSheet({ kind: 'list' })}>{t('challenges.manage')}</LinkArrow>}>{t('challenges.title')}</SectionTitle>

      {partyRow && (
        <div className="card mb-3 flex items-center gap-3 border-accent p-3.5" role="status">
          <span className="challenge-pop relative grid size-11 shrink-0 place-items-center rounded-full bg-accent-fill text-on-accent">
            <Trophy size={20} />
            <span className="challenge-halo absolute inset-0 rounded-full border-2 border-accent" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{t('challenges.celebrate')}</span>
            <span className="block truncate text-xs text-ink-2">{t('challenges.celebrateText', { name: challengeTitle(partyRow.c) })}</span>
          </span>
          <button onClick={() => setParty((p) => p.filter((id) => id !== partyRow.c.id))} className="grid size-9 shrink-0 place-items-center rounded-full text-ink-3" aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </div>
      )}

      <div className="card divide-y divide-line overflow-hidden">
        {shown.map(({ c, p }) => (
          <ChallengeSummary key={c.id} c={c} p={p} onClick={() => setSheet({ kind: 'detail', id: c.id })} />
        ))}
      </div>
      {rows.length > HOME_MAX && (
        <button onClick={() => setSheet({ kind: 'list' })} className="mt-2 w-full py-1.5 text-center text-xs text-ink-3">
          {t('challenges.more', { count: rows.length - HOME_MAX })}
        </button>
      )}
      {sheetEl}
    </>
  )
}

const rank = (s: string) => (s === 'active' ? 0 : s === 'upcoming' ? 1 : 2)
