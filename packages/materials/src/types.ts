export interface FetchedContent {
  content: string
  finalUrl: string
  statusCode: number
  truncated: boolean
  time: number
}

export interface FetchAttempt {
  status: 'success' | 'error'
  time: number
  statusCode?: number | undefined
  error?: string | undefined
}

export interface Material {
  handle: string
  url: string
  title?: string | undefined
  snippet?: string | undefined
  publishedAt?: string | undefined
  fetched?: FetchedContent | undefined
  lastFetch?: FetchAttempt | undefined
}

export interface PendingCall {
  name: 'web_search' | 'web_fetch'
  callId: string
  turn: number
  url?: string | undefined
}

/** JSON-only replay state. Treat all values read through stateOf as read-only. */
export interface MaterialsState {
  items: Record<string, Material>
  urlIndex: Record<string, string>
  nextHandle: number
  pendingCalls: Record<string, PendingCall>
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    bansoMaterials: MaterialsState
  }
}
