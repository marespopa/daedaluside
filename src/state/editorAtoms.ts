import { atom } from 'jotai'
import type { EditorHandle } from '../editor/createEditor'

/** Metadata only. CodeMirror owns the document text. */
export interface BufferMeta {
  id: string
  name: string
  language: string | null
  dirty: boolean
  line: number
  column: number
  length: number
}

export const initialBuffer: BufferMeta = {
  id: 'scratch',
  name: 'scratch.ts',
  language: null,
  dirty: false,
  line: 1,
  column: 1,
  length: 0,
}

export const activeBufferAtom = atom<BufferMeta>(initialBuffer)
export const editorHandleAtom = atom<EditorHandle | null>(null)
export const paletteOpenAtom = atom(false)
