import { t } from '../i18n'
import { X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { normalizeText } from '../lib/utils'

interface Props {
  value: string[]
  onChange: (tags: string[]) => void
  suggestions: string[]
  placeholder?: string
  /** Texte affiché pour une valeur enregistrée (ex. genre traduit) */
  display?: (value: string) => string
  /** Valeur enregistrée à partir du texte saisi (ex. nom de référence d'un genre) */
  normalize?: (input: string) => string
}

/** Saisie de tags libres ; des suggestions apparaissent quand on commence à taper. */
export default function TagInput({ value, onChange, suggestions, placeholder, display = (v) => v, normalize = (v) => v }: Props) {
  const [text, setText] = useState('')

  const add = (raw: string) => {
    const typed = raw.trim().replace(/,$/, '').trim()
    if (!typed) return
    const tag = normalize(typed)
    if (!value.some((v) => normalizeText(v) === normalizeText(tag))) onChange([...value, tag])
    setText('')
  }

  const filtered = useMemo(() => {
    const q = normalizeText(text)
    const taken = new Set(value.map((v) => normalizeText(display(v))))
    // Suggestions seulement pendant la saisie (pas de rangée de genres affichée en permanence)
    if (!q) return []
    return suggestions.filter((s) => !taken.has(normalizeText(s)) && normalizeText(s).includes(q)).slice(0, 12)
  }, [text, value, suggestions])

  return (
    <div>
      <div className="field flex flex-wrap items-center gap-1.5 py-2!">
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-line-strong py-1 pl-3 pr-1.5 text-sm text-ink">
            {display(tag)}
            <button type="button" onClick={() => onChange(value.filter((v) => v !== tag))} aria-label={t('common.removeX', { name: display(tag) })} className="text-ink-3">
              <X size={14} />
            </button>
          </span>
        ))}
        <input
          value={text}
          onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value) : setText(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(text)
            } else if (e.key === 'Backspace' && !text && value.length) {
              onChange(value.slice(0, -1))
            }
          }}
          onBlur={() => add(text)}
          placeholder={value.length ? '' : placeholder}
          className="min-w-24 flex-1 bg-transparent py-0.5 outline-none placeholder:text-ink-3"
          enterKeyHint="done"
        />
      </div>
      {filtered.length > 0 && (
        <div className="no-scrollbar -mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {filtered.map((s) => (
            <button key={s} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(s)} className="chip py-1! text-xs">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
