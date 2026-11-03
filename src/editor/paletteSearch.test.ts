import type { Entry } from '../workspace/types'
import {
  matchCommands,
  matchFiles,
  paletteMode,
  paletteNeedle,
  type PaletteItem,
} from './paletteSearch'

const cmd = (label: string): PaletteItem => ({ id: label, label, run: () => undefined })
const file = (path: string): Entry => ({
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  kind: 'file',
})

describe('palette mode', () => {
  it('searches files unless the query starts with >', () => {
    expect(paletteMode('')).toBe('files')
    expect(paletteMode('app')).toBe('files')
    expect(paletteMode('> save')).toBe('commands')
    expect(paletteMode('>')).toBe('commands')
  })

  it('treats > as a prefix only, not anywhere in the text', () => {
    expect(paletteMode('a>b')).toBe('files')
    expect(paletteMode(' >save')).toBe('files')
  })

  it('strips the prefix and whitespace from the search text', () => {
    expect(paletteNeedle('>  Theme Dark ')).toBe('theme dark')
    expect(paletteNeedle('  App.TS ')).toBe('app.ts')
  })
})

describe('matchCommands', () => {
  const commands = [
    cmd('File: Save'),
    cmd('Theme: Dracula (dark)'),
    cmd('Theme: Paper (light)'),
  ]

  it('returns every command for an empty needle', () => {
    expect(matchCommands(commands, '')).toEqual(commands)
  })

  it('requires every word, case-insensitively', () => {
    expect(matchCommands(commands, 'theme dark').map((c) => c.label)).toEqual([
      'Theme: Dracula (dark)',
    ])
    expect(matchCommands(commands, 'SAVE').map((c) => c.label)).toEqual(['File: Save'])
  })
})

describe('matchFiles', () => {
  const files = [
    file('docs/app-notes.md'),
    file('src/app.ts'),
    file('src/deep/nested/application.ts'),
    file('README.md'),
  ]

  it('lists files in order for an empty needle, up to the limit', () => {
    expect(matchFiles(files, '', 2).map((e) => e.path)).toEqual([
      'docs/app-notes.md',
      'src/app.ts',
    ])
  })

  it('matches on the path, requiring every word', () => {
    expect(matchFiles(files, 'src app').map((e) => e.path)).toEqual([
      'src/app.ts',
      'src/deep/nested/application.ts',
    ])
    expect(matchFiles(files, 'nope')).toEqual([])
  })

  it('ranks file-name matches before path-only matches, then shorter paths', () => {
    expect(matchFiles(files, 'app').map((e) => e.path)).toEqual([
      'src/app.ts',
      'docs/app-notes.md',
      'src/deep/nested/application.ts',
    ])
  })

  it('stops at the limit on large trees', () => {
    const many = Array.from({ length: 5000 }, (_, i) => file(`d/f${i}.ts`))
    expect(matchFiles(many, 'f4', 50)).toHaveLength(50)
  })
})
