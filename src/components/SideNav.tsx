import { type Tab } from './BottomNav'
import { t } from '../i18n'
import { BarChart3, Home, LibraryBig, Plus, Settings } from 'lucide-react'
import { cx } from '../lib/utils'

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

export default function SideNav({ current, onChange, onAdd }: Props) {
  return (
    <nav className="fixed inset-y-0 start-0 z-30 hidden w-60 flex-col border-e border-line bg-bg px-4 py-6 lg:flex">
      <h1 className="px-2 text-2xl font-bold">
        Azuu<span className="text-accent">Cine</span>
      </h1>

      <button
        onClick={onAdd}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-accent-fill px-4 py-2.5 text-sm font-semibold text-on-accent transition active:scale-95"
      >
        <Plus size={18} strokeWidth={2.2} />
        {t('nav.addTitle')}
      </button>

      <div className="mt-6 flex flex-col gap-1">
        {ITEMS.map(({ tab, label, Icon }) => {
          const active = current === tab
          return (
            <button
              key={tab}
              onClick={() => onChange(tab)}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                active ? 'bg-surface-2 text-ink' : 'text-ink-3 hover:text-ink',
              )}
            >
              <Icon size={20} strokeWidth={active ? 2.2 : 1.6} />
              {label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
