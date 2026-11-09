import { ProviderError } from './types'

/** fetch wrapper that maps failures to ProviderError. Never puts request headers (keys) in a message. */
export async function request(
  doFetch: typeof fetch,
  url: string,
  init: Omit<RequestInit, 'signal'> & { signal?: AbortSignal | undefined },
): Promise<Response> {
  let res: Response
  try {
    res = await doFetch(url, { ...init, signal: init.signal ?? null })
  } catch (e) {
    if (init.signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
      throw new ProviderError('aborted', 'Request aborted')
    }
    throw new ProviderError('network', 'Network error: could not reach the provider')
  }
  if (res.ok) return res
  let detail = ''
  try {
    detail = (await res.text()).slice(0, 300)
  } catch {
    /* body unreadable; status alone is enough */
  }
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('auth', 'The provider rejected the API key', res.status)
  }
  if (res.status === 429) {
    throw new ProviderError('rate-limit', 'Rate limited by the provider', res.status)
  }
  throw new ProviderError(
    'http',
    `Provider error ${res.status}${detail ? `: ${detail}` : ''}`,
    res.status,
  )
}

/** Yields each line of a streamed body, without the line break. */
export async function* readLines(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<string> {
  if (!body) throw new ProviderError('protocol', 'Response has no body')
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch {
        throw new ProviderError('aborted', 'Stream aborted')
      }
      if (chunk.done) break
      buf += decoder.decode(chunk.value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        yield buf.slice(0, nl).replace(/\r$/, '')
        buf = buf.slice(nl + 1)
      }
    }
    buf += decoder.decode()
    if (buf) yield buf
  } finally {
    reader.cancel().catch(() => {})
  }
}

/** Server-sent events: yields the payload of each `data:` line. */
export async function* sseData(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<string> {
  for await (const line of readLines(body)) {
    if (line.startsWith('data:')) {
      const data = line.slice(5).trimStart()
      if (data && data !== '[DONE]') yield data
    }
  }
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new ProviderError('protocol', 'Provider sent malformed data')
  }
}
