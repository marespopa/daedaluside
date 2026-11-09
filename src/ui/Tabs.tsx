import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'

export type TabItem = { id: string; label: string }

type Props = {
  label: string
  tabs: TabItem[]
  value: string
  onChange: (id: string) => void
  /** Content of the selected tab. */
  children: ReactNode
  className?: string
  /** Classes for the panel, e.g. to let it fill the space below the strip. */
  panelClassName?: string
}

/** A tab strip with a single panel. Arrow keys, Home and End move between tabs. */
export function Tabs({
  label,
  tabs,
  value,
  onChange,
  children,
  className = '',
  panelClassName = '',
}: Props) {
  const uid = useId()
  const list = useRef<HTMLDivElement>(null)

  const move = (e: KeyboardEvent, index: number) => {
    const last = tabs.length - 1
    const next =
      e.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : e.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1
    if (next < 0) return
    e.preventDefault()
    const target = tabs[next]
    if (target) onChange(target.id)
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus()
  }

  return (
    <div className={className}>
      <div
        ref={list}
        role="tablist"
        aria-label={label}
        className="mb-4 flex gap-4 border-b border-line"
      >
        {tabs.map((t, i) => {
          const selected = t.id === value
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${uid}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${uid}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.id)}
              onKeyDown={(e) => move(e, i)}
              className={`-mb-px border-b-2 px-1 pb-2 transition-colors active:scale-95 motion-reduce:transition-none ${
                selected
                  ? 'border-accent font-medium text-text'
                  : 'border-transparent text-muted hover:text-text'
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      <div
        key={value}
        role="tabpanel"
        id={`${uid}-panel`}
        aria-labelledby={`${uid}-tab-${value}`}
        className={`anim-fade ${panelClassName}`}
      >
        {children}
      </div>
    </div>
  )
}
