import { ApiError, type ApiArgs, type ApiMethod, type ApiResult } from '../../shared/api'

export type Handler<M extends ApiMethod> = (args: ApiArgs<M>) => Promise<ApiResult<M>> | ApiResult<M>
export type Handlers = { [M in ApiMethod]?: Handler<M> }

/** Dispatches API calls (from IPC or HTTP) to the handlers registered by core modules. */
export class ApiRouter {
  private readonly handlers = new Map<string, (args: unknown) => unknown>()

  register(handlers: Handlers): void {
    for (const [method, handler] of Object.entries(handlers)) {
      if (this.handlers.has(method)) throw new Error(`API method registered twice: ${method}`)
      this.handlers.set(method, handler as (args: unknown) => unknown)
    }
  }

  has(method: string): boolean {
    return this.handlers.has(method)
  }

  methods(): string[] {
    return [...this.handlers.keys()]
  }

  async call<M extends ApiMethod>(method: M, args: ApiArgs<M>): Promise<ApiResult<M>> {
    const handler = this.handlers.get(method)
    if (!handler) throw new ApiError('not_implemented', `Unknown API method: ${method}`)
    try {
      return (await handler(args)) as ApiResult<M>
    } catch (error) {
      if (error instanceof ApiError) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new ApiError('internal', message)
    }
  }
}
