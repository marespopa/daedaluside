/// <reference lib="webworker" />
import { OpfsBackend, probeOpfs } from './opfs-fs'
import { createHandler, type Request } from './rpc'

const getRoot = () => navigator.storage.getDirectory()
const handle = createHandler(new OpfsBackend(getRoot), () => probeOpfs(getRoot))

self.addEventListener('message', (e: MessageEvent<Request>) => {
  void handle(e.data).then((res) => {
    const v = res.ok ? res.value : null
    // Hand file bytes over without copying.
    if (v instanceof Uint8Array) self.postMessage(res, [v.buffer])
    else self.postMessage(res)
  })
})
