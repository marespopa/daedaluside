import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { handlePreloadError, registerServiceWorker } from './register'
import UpdatePrompt from './UpdatePrompt'
import { pendingUpdateAtom } from './updateAtom'

const registerSW = vi.hoisted(() => vi.fn())
vi.mock('virtual:pwa-register', () => ({ registerSW }))

describe('registerServiceWorker', () => {
  it('shows a prompt when an update waits, and activates it only on accept', async () => {
    const updateSW = vi.fn().mockResolvedValue(undefined)
    let needRefresh: () => void = () => {}
    registerSW.mockImplementation((opts: { onNeedRefresh: () => void }) => {
      needRefresh = opts.onNeedRefresh
      return updateSW
    })
    const store = createStore()
    registerServiceWorker(store)
    render(
      <Provider store={store}>
        <UpdatePrompt />
      </Provider>,
    )
    expect(screen.queryByRole('status')).toBeNull()

    needRefresh()
    expect(await screen.findByText(/new version is available/i)).toBeInTheDocument()
    expect(updateSW).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(updateSW).toHaveBeenCalledWith(true)
  })

  it('"Later" dismisses the prompt without applying', async () => {
    const store = createStore()
    const apply = vi.fn()
    store.set(pendingUpdateAtom, { message: 'Update ready.', apply })
    render(
      <Provider store={store}>
        <UpdatePrompt />
      </Provider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(apply).not.toHaveBeenCalled()
  })
})

describe('handlePreloadError', () => {
  it('offers a reload instead of failing silently', () => {
    const store = createStore()
    const target = new EventTarget() as unknown as Window
    const reload = vi.fn()
    Object.defineProperty(target, 'location', { value: { reload } })
    const stop = handlePreloadError(store, target)

    const event = new Event('vite:preloadError', { cancelable: true })
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    const pending = store.get(pendingUpdateAtom)
    expect(pending?.message).toMatch(/failed to load/i)
    expect(reload).not.toHaveBeenCalled()
    pending?.apply()
    expect(reload).toHaveBeenCalled()

    stop()
    store.set(pendingUpdateAtom, null)
    target.dispatchEvent(new Event('vite:preloadError'))
    expect(store.get(pendingUpdateAtom)).toBeNull()
  })
})
