import { ChevronDown, ExternalLink, Globe } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { t } from '../../i18n'
import type { TitleExtras } from '../../lib/catalogApi'
import { tmdbSized } from '../../lib/tmdbImage'
import { countryName, defaultWatchRegion, OFFER_KINDS, setWatchRegion, useWatchRegion, type StreamLink, type WatchProvider } from '../../lib/watchProviders'

const JUSTWATCH = 'https://www.justwatch.com'

/**
 * « Où regarder » sur la fiche d'un titre :
 *  - TMDB : offres du pays choisi (abonnement, gratuit, location, achat), données JustWatch ;
 *  - AniList : liens directs vers les plateformes de streaming.
 * Rien de connu → rien n'est affiché.
 */
export default function WhereToWatch({ extras }: { extras?: TitleExtras }) {
  if (extras?.watch && Object.keys(extras.watch).length > 0) return <TmdbOffers watch={extras.watch} />
  if (extras?.streaming && extras.streaming.length > 0) return <StreamLinks links={extras.streaming} />
  return null
}

function Section({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="mx-4 mt-8" aria-labelledby="where-to-watch">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 id="where-to-watch" className="eyebrow text-ink-2">
          {t('watch.title')}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function TmdbOffers({ watch }: { watch: NonNullable<TitleExtras['watch']> }) {
  const country = useWatchRegion()
  const offers = watch[country]
  const rows = OFFER_KINDS.map((kind) => ({ kind, list: offers?.[kind] ?? [] })).filter((r) => r.list.length > 0)

  // Pays proposés : ceux où le titre est disponible (+ le pays actuel), triés par nom
  const countries = useMemo(() => {
    const codes = new Set([...Object.keys(watch), country])
    return [...codes].map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name))
  }, [watch, country])

  const picker = (
    <label className="relative flex items-center gap-1 rounded-full border border-line py-1 pe-2 ps-2 text-xs text-ink-2 focus-within:border-line-strong">
      <Globe size={13} className="shrink-0 text-ink-3" aria-hidden />
      <span className="sr-only">{t('watch.country')}</span>
      <select
        value={country}
        onChange={(e) => setWatchRegion(e.target.value === defaultWatchRegion() ? null : e.target.value)}
        className="max-w-36 appearance-none truncate bg-transparent pe-0.5 text-xs font-medium text-ink outline-none"
      >
        {countries.map((c) => (
          <option key={c.code} value={c.code} className="bg-surface text-ink">
            {c.name}
          </option>
        ))}
      </select>
      <ChevronDown size={12} className="pointer-events-none shrink-0 text-ink-3" aria-hidden />
    </label>
  )

  return (
    <Section aside={picker}>
      {rows.length > 0 ? (
        <div className="space-y-3">
          {rows.map(({ kind, list }) => (
            <div key={kind} className="flex items-start gap-3">
              <span className="w-20 shrink-0 pt-3 text-xs text-ink-3">{t(`watch.${kind}`)}</span>
              <ul className="flex min-w-0 flex-1 flex-wrap gap-2">
                {list.map((p) => (
                  <li key={p.id}>
                    <ProviderLogo provider={p} href={offers?.link} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-3">{t('watch.none')}</p>
      )}
      <p className="mt-3 text-[11px] text-ink-3">
        <a href={JUSTWATCH} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
          {t('watch.source')}
        </a>
      </p>
    </Section>
  )
}

function ProviderLogo({ provider, href }: { provider: WatchProvider; href?: string }) {
  const logo = provider.logo ? (
    <img
      src={provider.logo}
      srcSet={`${provider.logo} 1x, ${tmdbSized(provider.logo, 'w154')} 2x`}
      alt={provider.name}
      title={provider.name}
      loading="lazy"
      className="size-11 rounded-xl border border-line bg-surface-2 object-cover"
    />
  ) : (
    <span title={provider.name} className="grid size-11 place-items-center rounded-xl border border-line bg-surface-2 text-sm font-semibold text-ink-2">
      <span aria-hidden>{provider.name.charAt(0)}</span>
      <span className="sr-only">{provider.name}</span>
    </span>
  )
  if (!href) return logo
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={t('watch.open', { name: provider.name })} className="block rounded-xl transition-transform active:scale-95">
      {logo}
    </a>
  )
}

function StreamLinks({ links }: { links: StreamLink[] }) {
  return (
    <Section>
      <ul className="flex flex-wrap gap-2">
        {links.map((l) => (
          <li key={l.site}>
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('watch.open', { name: l.site })}
              title={l.language ? `${l.site} · ${l.language}` : l.site}
              className="flex items-center gap-2 rounded-full border border-line py-1 pe-3 ps-1 text-sm font-medium text-ink transition-colors active:bg-surface-2"
            >
              {l.icon ? (
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2" style={l.color ? { backgroundColor: l.color } : undefined}>
                  <img src={l.icon} alt="" loading="lazy" className="size-4 object-contain" />
                </span>
              ) : (
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-ink-2" aria-hidden>
                  {l.site.charAt(0)}
                </span>
              )}
              {l.site}
              <ExternalLink size={13} className="text-ink-3" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </Section>
  )
}
