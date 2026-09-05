import type { Backoff, RetryPolicy } from './parser'

// Produces a canonical rendering of a policy: fixed field order, fixed
// indentation, and durations normalized to the largest unit that divides
// evenly. Two policies that mean the same thing print identically.
export function printPolicy(policy: RetryPolicy): string {
  const lines: string[] = []
  lines.push(`policy "${policy.name}" {`)
  lines.push(`  max_attempts: ${policy.maxAttempts}`)
  lines.push(`  backoff: ${formatBackoff(policy.backoff)}`)
  lines.push(`  jitter: ${policy.jitter}`)
  lines.push(`  retry_on: [${policy.retryOn.map(String).join(', ')}]`)
  if (policy.giveUpAfterMs !== null) {
    lines.push(`  give_up_after: ${formatDuration(policy.giveUpAfterMs)}`)
  }
  lines.push('}')
  return lines.join('\n')
}

function formatBackoff(backoff: Backoff): string {
  switch (backoff.kind) {
    case 'fixed':
      return `fixed(delay=${formatDuration(backoff.delayMs)})`
    case 'linear': {
      const parts = [`delay=${formatDuration(backoff.delayMs)}`, `increment=${formatDuration(backoff.incrementMs)}`]
      if (backoff.maxMs !== null) parts.push(`max=${formatDuration(backoff.maxMs)}`)
      return `linear(${parts.join(', ')})`
    }
    case 'exponential': {
      const parts = [`base=${formatDuration(backoff.baseMs)}`, `factor=${formatFactor(backoff.factor)}`]
      if (backoff.maxMs !== null) parts.push(`max=${formatDuration(backoff.maxMs)}`)
      return `exponential(${parts.join(', ')})`
    }
  }
}

function formatFactor(factor: number): string {
  return Number.isInteger(factor) ? `${factor}.0` : String(factor)
}

function formatDuration(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`
  if (ms % 60_000 === 0) return `${ms / 60_000}m`
  if (ms % 1_000 === 0) return `${ms / 1_000}s`
  return `${ms}ms`
}
