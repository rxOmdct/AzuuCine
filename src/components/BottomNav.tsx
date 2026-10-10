import { t } from '../i18n'
import { BarChart3, Home, LibraryBig, Search, Settings } from 'lucide-react'
import { cx } from '../lib/utils'

export type Tab = 'home' | 'catalog' | 'stats' | 'settings'

const ITEMS: { tab: Tab; readonly label: string; Icon: typeof Home }[] = [
  { tab: 'home', get label() { return t('nav.home') }, Icon: Home },
  { tab: 'catalog', get label() { return t('nav.catalog') }, Icon: LibraryBig },
  { tab: 'stats', get label() { return t('nav.stats') }, Icon: BarChart3 },
  { tab: 'settings', get label() { return t('nav.settings') }, Icon: Settings },
]

interface Props {
  current: Tab
  onChange: (tab: Tab) => void
  onAdd: () => void
}

export default function BottomNav({ current, onChange, onAdd }: Props) {
  const button = ({ tab, label, Icon }: (typeof ITEMS)[number]) => {
    const active = current === tab
    return (
      <button
        key={tab}
        onClick={() => onChange(tab)}
        aria-current={active ? 'page' : undefined}
        className={cx('flex flex-1 flex-col items-center gap-1 pb-1.5 pt-2.5 text-[11px] font-medium transition-colors', active ? 'text-ink' : 'text-ink-3')}
      >
        <Icon size={21} strokeWidth={active ? 2.2 : 1.6} />
        <span className="relative">
          {label}
          {/* soulignement fin, comme le lien actif de rdacet.fr */}
          <span className={cx('absolute -bottom-1 start-0 h-px w-full bg-accent transition-opacity', active ? 'opacity-100' : 'opacity-0')} />
        </span>
      </button>
    )
  }

  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 backdrop-blur-md lg:hidden">
      <div className="mx-auto flex max-w-2xl items-center px-2">
        {ITEMS.slice(0, 2).map(button)}
        <div className="flex flex-1 justify-center">
          <button
            onClick={onAdd}
            aria-label={t('search.title')}
            className="grid size-12 place-items-center rounded-full bg-accent-fill text-on-accent transition active:scale-95"
          >
            <Search size={22} strokeWidth={2.4} />
          </button>
        </div>
        {ITEMS.slice(2).map(button)}
      </div>
    </nav>
  )
}
