import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { createStore, Provider } from 'jotai'
import { vi } from 'vitest'
import App from '../App'
import { noticeAtom, workspaceStatusAtom } from '../state/workspaceAtoms'
import { getController } from './controller'
import { MemDisk } from './testing/memoryDisk'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])
const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>',
)

async function setup(disk: MemDisk) {
  const store = createStore()
  render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
  await waitFor(() => expect(store.get(workspaceStatusAtom).state).toBe('ready'))
  await act(async () => {
    await getController(store).importFolderHandle(disk.handle() as never)
  })
  return store
}

describe('image viewer', () => {
  const created: Blob[] = []
  const revoked: string[] = []
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    created.length = 0
    revoked.length = 0
    URL.createObjectURL = vi.fn((b: Blob) => {
      created.push(b)
      return `blob:test/${created.length}`
    })
    URL.revokeObjectURL = vi.fn((u: string) => void revoked.push(u))
  })

  it('shows a png in an img with a fixed MIME and never writes it', async () => {
    const disk = new MemDisk()
    disk.setFile('a.png', PNG)
    const store = await setup(disk)
    await act(async () => getController(store).openFile('a.png'))
    const img = (await screen.findByTestId('image-viewer')).querySelector('img')!
    expect(img.getAttribute('src')).toBe('blob:test/1')
    expect(created[0]!.type).toBe('image/png')
    const user = userEvent.setup()
    await user.keyboard('{Control>}s{/Control}')
    expect(disk.files.get('a.png')).toEqual(PNG)
    expect(screen.queryByLabelText('unsaved')).not.toBeInTheDocument()
  })

  it('renders svg only through img, never inline', async () => {
    const disk = new MemDisk()
    disk.setFile('a.svg', SVG)
    const store = await setup(disk)
    await act(async () => getController(store).openFile('a.svg'))
    const viewer = await screen.findByTestId('image-viewer')
    expect(viewer.querySelector('img')).not.toBeNull()
    expect(document.querySelector('svg script, script[src], object, embed')).toBeNull()
    expect(viewer.querySelector('svg')).toBeNull()
    expect(created[0]!.type).toBe('image/svg+xml')
  })

  it('rejects content that does not match the extension', async () => {
    const disk = new MemDisk()
    disk.setFile('fake.jpg', new TextEncoder().encode('<script>alert(1)</script>'))
    const store = await setup(disk)
    await act(async () => getController(store).openFile('fake.jpg'))
    await waitFor(() => expect(store.get(noticeAtom)?.kind).toBe('error'))
    expect(screen.queryByTestId('image-viewer')).not.toBeInTheDocument()
    expect(created).toHaveLength(0)
  })

  it('revokes the object URL when the tab changes', async () => {
    const disk = new MemDisk()
    disk.setFile('a.png', PNG)
    disk.setFile('b.txt', new TextEncoder().encode('hi'))
    const store = await setup(disk)
    await act(async () => getController(store).openFile('a.png'))
    await screen.findByTestId('image-viewer')
    await act(async () => getController(store).openFile('b.txt'))
    await waitFor(() => expect(screen.queryByTestId('image-viewer')).toBeNull())
    expect(revoked).toContain('blob:test/1')
  })
})
