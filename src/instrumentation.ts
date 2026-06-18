import { initObservability } from './observability'

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    initObservability()
  }
}
