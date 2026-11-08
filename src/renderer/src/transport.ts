import {
  ApiError,
  WEB_TOKEN_HEADER,
  type ApiArgs,
  type ApiEvent,
  type ApiMethod,
  type ApiResult,
  type Transport
} from '../../shared/api'

type Envelope = { ok: true; result: unknown } | { ok: false; error: { code: string; message: string } }

interface PreloadBridge {
  invoke(method: string, args: unknown): Promise<Envelope>
  onEvent(handler: (event: ApiEvent) => void): () => void
}

declare global {
  interface Window {
    ppd?: PreloadBridge
  }
}

function unwrap<M extends ApiMethod>(envelope: Envelope): ApiResult<M> {
  if (envelope.ok) return envelope.result as ApiResult<M>
  throw new ApiError(envelope.error.code, envelope.error.message)
}

function ipcTransport(bridge: PreloadBridge): Transport {
  return {
    invoke: async (method, args) => unwrap(await bridge.invoke(method, args)),
    subscribe: (handler) => bridge.onEvent(handler)
  }
}

function webToken(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('token')
  try {
    if (fromUrl) {
      sessionStorage.setItem('ppd-token', fromUrl)
      return fromUrl
    }
    return sessionStorage.getItem('ppd-token') ?? ''
  } catch {
    return fromUrl ?? ''
  }
}

/** Loopback web mode: same API over HTTP, events over Server-Sent Events (DEC-006). */
function httpTransport(): Transport {
  const token = webToken()
  const handlers = new Set<(event: ApiEvent) => void>()
  let source: EventSource | null = null

  const ensureSource = (): void => {
    if (source) return
    source = new EventSource(`/events?token=${encodeURIComponent(token)}`)
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data as string) as ApiEvent
        for (const h of handlers) h(event)
      } catch {
        // Ignore malformed frames.
      }
    }
  }

  return {
    async invoke<M extends ApiMethod>(method: M, args: ApiArgs<M>): Promise<ApiResult<M>> {
      let response: Response
      try {
        response = await fetch(`/api/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', [WEB_TOKEN_HEADER]: token },
          body: JSON.stringify({ args: args ?? null })
        })
      } catch {
        throw new ApiError('offline', 'The application is not reachable.')
      }
      return unwrap<M>((await response.json()) as Envelope)
    },
    subscribe(handler) {
      handlers.add(handler)
      ensureSource()
      return () => handlers.delete(handler)
    }
  }
}

export const transport: Transport = window.ppd ? ipcTransport(window.ppd) : httpTransport()
