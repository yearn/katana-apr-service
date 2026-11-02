import * as Sentry from '@sentry/node'

const FLUSH_TIMEOUT_MS = 2_000

export function initObservability(): void {
  if (!process.env.SENTRY_DSN || Sentry.isInitialized()) return
  Sentry.init({ dsn: process.env.SENTRY_DSN })
}

export function captureError(error: unknown): void {
  initObservability()
  Sentry.captureException(error)
}

export async function flushObservability(): Promise<void> {
  await Sentry.flush(FLUSH_TIMEOUT_MS)
}
