import { captureError, flushObservability, initObservability } from './observability'

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    initObservability()
  }
}

export async function onRequestError(error: unknown): Promise<void> {
  captureError(error)
  await flushObservability()
}
