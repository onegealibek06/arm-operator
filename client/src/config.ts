export const WS_URL: string = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8000/ws'

export const LINK = {
  connectTimeoutMs: 4000,
  staleAfterMs: 1500,
  deadAfterMs: 4000,
  retryBaseMs: 500,
  retryMaxMs: 10_000,
}

export const UI_FLUSH_MS = 250

export const COMMAND_ACK_TIMEOUT_MS = 5000

export const MAX_LOG_EVENTS = 200
