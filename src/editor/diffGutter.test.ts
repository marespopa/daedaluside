import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { Hunk } from '../review/diff'
import { diffGutter, hunksField, setHunks } from './diffGutter'

const hunk = (kind: Hunk['kind'], start: number, count: number): Hunk => ({
  kind,
  baseRange: { start, count: kind === 'add' ? 0 : 1 },
  newRange: { start, count },
})

function make(doc: string) {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: [diffGutter] }),
  })
  return { view, parent }
}

const marks = (parent: HTMLElement) =>
  [...parent.querySelectorAll<HTMLElement>('[data-diff]')].map((e) => e.dataset.diff)

describe('diffGutter', () => {
  it('draws no marks without hunks', () => {
    const { parent } = make('a\nb\nc\n')
    expect(marks(parent)).toEqual([])
  })

  it('marks added and changed lines and the line after a deletion', () => {
    const { view, parent } = make('a\nb\nc\nd\ne')
    view.dispatch({
      effects: setHunks.of([hunk('add', 0, 1), hunk('change', 2, 2), hunk('remove', 4, 0)]),
    })
    expect(marks(parent)).toEqual(['add', 'change', 'change', 'remove'])
    expect(parent.querySelector('[data-diff=remove]')?.textContent).toBe('▲')
  })

  it('clamps a deletion at the end of the file to the last line', () => {
    const { view, parent } = make('a\nb')
    view.dispatch({ effects: setHunks.of([hunk('remove', 2, 0)]) })
    expect(marks(parent)).toEqual(['remove'])
  })

  it('keeps its hunks in the state, so a state swap carries them', () => {
    const { view } = make('a\nb')
    view.dispatch({ effects: setHunks.of([hunk('add', 0, 1)]) })
    expect(view.state.field(hunksField)).toHaveLength(1)
    view.dispatch({ effects: setHunks.of([]) })
    expect(view.state.field(hunksField)).toEqual([])
  })
})
