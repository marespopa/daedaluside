import { registerServiceWorker } from './register'

const registerSW = vi.hoisted(() => vi.fn())
vi.mock('virtual:pwa-register', () => ({ registerSW }))

describe('registerServiceWorker', () => {
  it('registers without an update prompt or an automatic reload', () => {
    registerSW.mockReturnValue(vi.fn())
    registerServiceWorker()
    expect(registerSW).toHaveBeenCalledWith({})
  })
})
