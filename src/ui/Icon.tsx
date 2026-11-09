import type { ReactNode } from 'react'

export type IconName =
  | 'folder'
  | 'plus'
  | 'drive'
  | 'arrow'
  | 'upload'
  | 'file-plus'
  | 'folder-plus'
  | 'save'
  | 'copy'
  | 'pencil'
  | 'trash'
  | 'x'
  | 'menu'
  | 'home'
  | 'sidebar'
  | 'chat'
  | 'pin'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'check'
  | 'git-branch'
  | 'width'
  | 'expand-all'
  | 'search'
  | 'collapse-all'

const paths: Record<IconName, ReactNode> = {
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </>
  ),
  save: (
    <>
      <path d="M4 3h13l4 4v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M7 3v6h10V3M7 21v-8h10v8" />
      <path d="M14 5v2" />
    </>
  ),
  'file-plus': (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M12 11v6M9 14h6" />
    </>
  ),
  'folder-plus': (
    <>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H10l2 2h7.5A1.5 1.5 0 0 1 21 9.5v7a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5z" />
      <path d="M12 11v5M9.5 13.5h5" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </>
  ),
  trash: (
    <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5L17.5 7M10 11v6M14 11v6" />
  ),
  x: <path d="M6 6l12 12M18 6 6 18" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  home: <path d="M4 11l8-6.5 8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" />,
  sidebar: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M9 5v14" />
    </>
  ),
  chat: (
    <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
  ),
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  'git-branch': (
    <>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="8" r="2" />
      <path d="M6 7v10M18 10c0 4-6 3-11 7" />
    </>
  ),
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  pin: (
    <>
      <path d="M8.5 3.5h7l-1 5.5 2.5 3v1.5h-10V12l2.5-3z" />
      <path d="M12 13.5V20.5" />
    </>
  ),
  folder: (
    <>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H10l2 2h7.5A1.5 1.5 0 0 1 21 9.5v7a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5z" />
      <path d="M3.5 10h17" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14M5 12h14" />
      <path d="M4.5 3.5h15v17h-15z" />
    </>
  ),
  drive: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M7 15h.01M11 15h.01" />
    </>
  ),
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  width: <path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  'expand-all': <path d="M6 5l6 5 6-5M6 12l6 5 6-5" />,
  'collapse-all': <path d="M6 9l6-5 6 5M6 16l6-5 6 5" />,
  upload: (
    <>
      <path d="M12 15V4m0 0-4 4m4-4 4 4" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
}

/** Inline stroke icon. Decorative by default; pair with visible or aria text. */
export function Icon({
  name,
  className = 'h-5 w-5',
}: {
  name: IconName
  className?: string
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  )
}
