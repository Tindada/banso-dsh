export interface FetchedContent {
  content: string
  finalUrl: string
  truncated: boolean
  time: number
}

export interface Evidence {
  focus: string
  text: string
  time: number
}

export interface Material {
  handle: string
  url: string
  title?: string | undefined
  snippet?: string | undefined
  publishedAt?: string | undefined
  fetched?: FetchedContent | undefined
  evidence?: Evidence[] | undefined
}

export interface PendingCall {
  name: 'web_search' | 'web_read'
  callId: string
  turn: number
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
