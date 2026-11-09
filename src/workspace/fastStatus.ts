import git from 'isomorphic-git'
import type { GitFs } from './gitFs'
import { IGNORED } from './folderWalk'
import { NO_RULES, parseGitignoreDirs, type DirRules } from './ignore'

const DIR = '/'
/** In-flight file stats and reads while scanning. */
const SCAN_CONCURRENCY = 16

type Row = readonly [string, number, number, number]

interface Tracked {
  path: string
  head: string | null
  stage: string | null
  /** The index entry's size and mtime (seconds); null when the path is not staged. */
  size: number
  mtime: number
}

async function pool<T>(
  items: readonly T[],
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!)
  }
  await Promise.all(
    Array.from({ length: Math.min(SCAN_CONCURRENCY, items.length) }, worker),
  )
}

/**
 * The same rows `git.statusMatrix` gives, without its cost on a browser folder.
 *
 * `statusMatrix` trusts an index entry only when ctime, ino, uid, gid and mode all match,
 * and a folder handle cannot report those the way git wrote them, so it reads and hashes
 * every tracked file. Here a tracked file is trusted when its size and mtime match the
 * index (git's own "racy" rule included), so only edited files are read. Untracked files
 * come from a directory walk that skips ignored folders.
 *
 * Throws when the repository cannot be read; callers fall back to `statusMatrix`.
 */
export async function scanStatus(
  fs: GitFs,
  cache: object,
  headOid: string,
  isIgnored: (path: string) => Promise<boolean>,
): Promise<Row[]> {
  const tracked = new Map<string, Tracked>()
  await git.walk({
    fs,
    dir: DIR,
    cache,
    trees: [git.TREE({ ref: headOid }), git.STAGE()],
    map: async (path, [head, stage]) => {
      if (path === '.') return undefined
      const [th, ts] = [await head?.type(), await stage?.type()]
      if (th === 'commit' || ts === 'commit') return null
      if (th === 'tree' || ts === 'tree') return undefined
      if (th !== 'blob' && ts !== 'blob') return null
      const st = (await stage?.stat()) as
        { size: number; mtimeSeconds: number } | undefined
      tracked.set(path, {
        path,
        head: th === 'blob' ? ((await head?.oid()) ?? null) : null,
        stage: ts === 'blob' ? ((await stage?.oid()) ?? null) : null,
        size: st?.size ?? -1,
        mtime: st?.mtimeSeconds ?? -1,
      })
      return null
    },
  })

  let indexSeconds = 0
  try {
    indexSeconds = Math.floor((await fs.promises.stat('/.git/index')).mtimeMs / 1000)
  } catch {
    // no index file: nothing is trusted, everything is hashed
  }

  const rows: Row[] = []
  await pool([...tracked.values()], async (t) => {
    let workdir: string | null
    try {
      const s = await fs.promises.lstat(`/${t.path}`)
      if (!s.isFile()) throw new Error('not a file')
      const secs = Math.floor(s.mtimeMs / 1000)
      if (t.stage && s.size === t.size && secs === t.mtime && secs < indexSeconds) {
        workdir = t.stage // unchanged since git last looked
      } else {
        const raw = await fs.promises.readFile(`/${t.path}`)
        const bytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : raw
        workdir = (await git.hashBlob({ object: bytes })).oid
      }
    } catch {
      workdir = null // deleted (or replaced by a directory)
    }
    // statusMatrix codes: the index of the first equal value in [HEAD, workdir, stage].
    const w = workdir === null ? 0 : workdir === t.head ? 1 : 2
    const stage =
      t.stage === null ? 0 : t.stage === t.head ? 1 : t.stage === workdir ? 2 : 3
    rows.push([t.path, t.head === null ? 0 : 1, w, stage])
  })

  for (const path of await untracked(fs, tracked, isIgnored)) rows.push([path, 0, 2, 0])
  return rows
}

/** Files outside the index, found by walking the folder and skipping ignored directories. */
async function untracked(
  fs: GitFs,
  tracked: ReadonlyMap<string, unknown>,
  isIgnored: (path: string) => Promise<boolean>,
): Promise<string[]> {
  const dirs = new Set<string>()
  for (const p of tracked.keys()) {
    for (let i = p.indexOf('/'); i !== -1; i = p.indexOf('/', i + 1))
      dirs.add(p.slice(0, i))
  }
  let rules: DirRules = NO_RULES
  try {
    const raw = await fs.promises.readFile('/.gitignore', 'utf8')
    rules = parseGitignoreDirs(
      typeof raw === 'string' ? raw : new TextDecoder().decode(raw),
    )
  } catch {
    // no .gitignore
  }
  const out: string[] = []
  let queue: string[] = ['']
  while (queue.length) {
    const next: string[] = []
    await pool(queue, async (dir) => {
      let names: string[]
      try {
        names = await fs.promises.readdir(`/${dir}`)
      } catch {
        return
      }
      for (const name of names) {
        const path = dir ? `${dir}/${name}` : name
        if (IGNORED.has(name) || tracked.has(path)) continue
        if (dirs.has(path)) {
          next.push(path)
          continue
        }
        let isDir: boolean
        try {
          isDir = (await fs.promises.lstat(`/${path}`)).isDirectory()
        } catch {
          continue
        }
        if (isDir) {
          if (rules.names.has(name) || rules.paths.has(path)) continue
          if (await isIgnored(`${path}/`)) continue
          next.push(path)
        } else if (!(await isIgnored(path))) {
          out.push(path)
        }
      }
    })
    queue = next
  }
  return out
}
