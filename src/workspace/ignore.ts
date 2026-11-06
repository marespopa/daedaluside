/** Build output and caches: regenerable and never worth indexing for quick-open or search. */
export const WALK_SKIPPED = new Set([
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'coverage',
  'target',
  '.venv',
  '__pycache__',
])

export interface DirRules {
  /** Names skipped at any depth. */
  names: Set<string>
  /** Paths (no leading or trailing slash) skipped from the root only. */
  paths: Set<string>
}

/**
 * Directory rules from a `.gitignore`: plain names (`out`, `out/`) and anchored paths
 * (`/out`, `packages/x/out`). Globs, negations and file patterns are left to git.
 */
export function parseGitignoreDirs(text: string): DirRules {
  const rules: DirRules = { names: new Set(), paths: new Set() }
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('!')) continue
    if (/[*?[\\]/.test(line)) continue
    const anchored = line.startsWith('/')
    line = line.replace(/^\/+/, '').replace(/\/+$/, '')
    if (!line) continue
    if (anchored || line.includes('/')) rules.paths.add(line)
    else rules.names.add(line)
  }
  return rules
}

export const NO_RULES: DirRules = { names: new Set(), paths: new Set() }

export function skipsDir(name: string, path: string, rules: DirRules): boolean {
  return WALK_SKIPPED.has(name) || rules.names.has(name) || rules.paths.has(path)
}
