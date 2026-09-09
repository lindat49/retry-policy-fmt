import { test } from 'node:test'
import assert from 'node:assert/strict'
import { printPolicy } from './printer'
import { parsePolicy } from './parser'
import type { RetryPolicy } from './parser'

function basePolicy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return {
    name: 'p',
    maxAttempts: 3,
    backoff: { kind: 'fixed', delayMs: 1000 },
    jitter: 'none',
    retryOn: [500],
    giveUpAfterMs: null,
    ...overrides,
  }
}

test('durations normalize to the largest unit that divides evenly', () => {
  assert.equal(printPolicy(basePolicy({ backoff: { kind: 'fixed', delayMs: 3_600_000 } })).includes('delay=1h'), true)
  assert.equal(printPolicy(basePolicy({ backoff: { kind: 'fixed', delayMs: 60_000 } })).includes('delay=1m'), true)
  assert.equal(printPolicy(basePolicy({ backoff: { kind: 'fixed', delayMs: 1_000 } })).includes('delay=1s'), true)
  assert.equal(printPolicy(basePolicy({ backoff: { kind: 'fixed', delayMs: 1_500 } })).includes('delay=1500ms'), true)
})

test('an exponential factor with no fractional part still prints with .0', () => {
  const output = printPolicy(
    basePolicy({ backoff: { kind: 'exponential', baseMs: 200, factor: 2, maxMs: null } }),
  )
  assert.match(output, /factor=2\.0/)
})

test('a fractional exponential factor prints as-is', () => {
  const output = printPolicy(
    basePolicy({ backoff: { kind: 'exponential', baseMs: 200, factor: 1.5, maxMs: null } }),
  )
  assert.match(output, /factor=1\.5/)
})

test('optional backoff max is omitted when null and included when set', () => {
  const withoutMax = printPolicy(basePolicy({ backoff: { kind: 'linear', delayMs: 1000, incrementMs: 500, maxMs: null } }))
  assert.equal(withoutMax.includes('max='), false)

  const withMax = printPolicy(basePolicy({ backoff: { kind: 'linear', delayMs: 1000, incrementMs: 500, maxMs: 5000 } }))
  assert.match(withMax, /max=5s/)
})

test('give_up_after line is omitted when null and rendered when set', () => {
  assert.equal(printPolicy(basePolicy({ giveUpAfterMs: null })).includes('give_up_after'), false)
  assert.match(printPolicy(basePolicy({ giveUpAfterMs: 90_000 })), /give_up_after: 90s/)
})

test('retry_on renders a mix of status codes and bare words in order', () => {
  const output = printPolicy(basePolicy({ retryOn: [502, 'timeout', 429] }))
  assert.match(output, /retry_on: \[502, timeout, 429\]/)
})

test('field order and indentation are fixed regardless of input order', () => {
  const output = printPolicy(
    basePolicy({ jitter: 'full', retryOn: [500], giveUpAfterMs: 30_000 }),
  )
  const lines = output.split('\n')
  assert.deepEqual(
    lines.map((line) => line.split(':')[0]?.trim()),
    ['policy "p" {', 'max_attempts', 'backoff', 'jitter', 'retry_on', 'give_up_after', '}'],
  )
})

test('re-printing a parsed policy is idempotent (already-canonical input round-trips)', () => {
  const canonical = [
    'policy "checkout-api" {',
    '  max_attempts: 5',
    '  backoff: exponential(base=200ms, factor=2.0, max=10s)',
    '  jitter: full',
    '  retry_on: [502, 503, 429, timeout]',
    '  give_up_after: 30s',
    '}',
  ].join('\n')
  assert.equal(printPolicy(parsePolicy(canonical)), canonical)
})

test('differently formatted equivalent input prints identically to the canonical form', () => {
  const messy = `
    policy    "checkout-api"     {
      backoff: exponential( base = 200ms , factor=2.0,max=10000ms )
      max_attempts:5
      retry_on: [ 502,503,429 ,timeout ]
      give_up_after: 30000ms
      jitter: full
    }
  `
  const canonical = [
    'policy "checkout-api" {',
    '  max_attempts: 5',
    '  backoff: exponential(base=200ms, factor=2.0, max=10s)',
    '  jitter: full',
    '  retry_on: [502, 503, 429, timeout]',
    '  give_up_after: 30s',
    '}',
  ].join('\n')
  assert.equal(printPolicy(parsePolicy(messy)), canonical)
})
