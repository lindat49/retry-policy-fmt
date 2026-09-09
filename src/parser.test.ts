import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePolicy, PolicyError } from './parser'

test('parses a full policy with all optional fields present', () => {
  const policy = parsePolicy(`
    policy "checkout-api" {
      max_attempts: 5
      backoff: exponential(base=200ms, factor=2.0, max=10s)
      jitter: full
      retry_on: [502, 503, 429, timeout]
      give_up_after: 30s
    }
  `)
  assert.equal(policy.name, 'checkout-api')
  assert.equal(policy.maxAttempts, 5)
  assert.deepEqual(policy.backoff, { kind: 'exponential', baseMs: 200, factor: 2, maxMs: 10_000 })
  assert.equal(policy.jitter, 'full')
  assert.deepEqual(policy.retryOn, [502, 503, 429, 'timeout'])
  assert.equal(policy.giveUpAfterMs, 30_000)
})

test('jitter defaults to none and give_up_after defaults to null when omitted', () => {
  const policy = parsePolicy(`
    policy "p" {
      max_attempts: 1
      backoff: fixed(delay=1s)
      retry_on: [500]
    }
  `)
  assert.equal(policy.jitter, 'none')
  assert.equal(policy.giveUpAfterMs, null)
})

test('a comment running to end of line is ignored', () => {
  const policy = parsePolicy(`
    policy "p" { # trailing comment on the header
      max_attempts: 1 # another one
      backoff: fixed(delay=1s)
      retry_on: [500]
    }
  `)
  assert.equal(policy.maxAttempts, 1)
})

test('rejects a policy missing max_attempts', () => {
  assert.throws(
    () => parsePolicy('policy "p" { backoff: fixed(delay=1s) retry_on: [500] }'),
    /missing required field 'max_attempts'/,
  )
})

test('rejects a policy missing backoff', () => {
  assert.throws(
    () => parsePolicy('policy "p" { max_attempts: 1 retry_on: [500] }'),
    /missing required field 'backoff'/,
  )
})

test('rejects a policy with an empty retry_on list', () => {
  assert.throws(
    () => parsePolicy('policy "p" { max_attempts: 1 backoff: fixed(delay=1s) retry_on: [] }'),
    /must list at least one entry in 'retry_on'/,
  )
})

test('rejects a duplicate field', () => {
  assert.throws(
    () => parsePolicy(`
      policy "p" {
        max_attempts: 1
        max_attempts: 2
        backoff: fixed(delay=1s)
        retry_on: [500]
      }
    `),
    /duplicate field 'max_attempts'/,
  )
})

test('rejects an unknown field', () => {
  assert.throws(
    () => parsePolicy('policy "p" { max_attempts: 1 backoff: fixed(delay=1s) retry_on: [500] bogus: 1 }'),
    /unknown field 'bogus'/,
  )
})

test('rejects max_attempts outside 1..1000', () => {
  assert.throws(
    () => parsePolicy('policy "p" { max_attempts: 0 backoff: fixed(delay=1s) retry_on: [500] }'),
    /max_attempts must be between 1 and 1000/,
  )
  assert.throws(
    () => parsePolicy('policy "p" { max_attempts: 1001 backoff: fixed(delay=1s) retry_on: [500] }'),
    /max_attempts must be between 1 and 1000/,
  )
})

test('rejects a non-integer max_attempts', () => {
  assert.throws(
    () => parsePolicy('policy "p" { max_attempts: 1.5 backoff: fixed(delay=1s) retry_on: [500] }'),
    /max_attempts must be a whole number/,
  )
})

test('rejects an empty policy name', () => {
  assert.throws(
    () => parsePolicy('policy "" { max_attempts: 1 backoff: fixed(delay=1s) retry_on: [500] }'),
    /policy name cannot be empty/,
  )
})

test('rejects an invalid jitter value', () => {
  assert.throws(
    () => parsePolicy('policy "p" { max_attempts: 1 backoff: fixed(delay=1s) jitter: some retry_on: [500] }'),
    /jitter must be 'none', 'full', or 'equal'/,
  )
})

test('rejects give_up_after of zero or negative', () => {
  assert.throws(
    () => parsePolicy('policy "p" { max_attempts: 1 backoff: fixed(delay=1s) retry_on: [500] give_up_after: 0s }'),
    /give_up_after must be greater than zero/,
  )
})

test('rejects trailing content after the closing brace', () => {
  assert.throws(
    () => parsePolicy('policy "p" { max_attempts: 1 backoff: fixed(delay=1s) retry_on: [500] } extra'),
    /end of input after the policy block/,
  )
})

test('rejects an unknown duration unit', () => {
  assert.throws(
    () => parsePolicy('policy "p" { max_attempts: 1 backoff: fixed(delay=1y) retry_on: [500] }'),
    /unknown duration unit 'y'/,
  )
})

test('rejects an unterminated string literal', () => {
  assert.throws(() => parsePolicy('policy "p { max_attempts: 1 }'), /unterminated string literal/)
})

test('fixed backoff rejects a non-positive delay', () => {
  assert.throws(
    () => parsePolicy('policy "p" { max_attempts: 1 backoff: fixed(delay=0ms) retry_on: [500] }'),
    /fixed delay must be greater than zero/,
  )
})

test('linear backoff rejects a negative increment and a max smaller than delay', () => {
  assert.throws(
    () => parsePolicy('policy "p" { max_attempts: 1 backoff: linear(delay=1s, increment=-1s) retry_on: [500] }'),
    /linear increment cannot be negative/,
  )
  assert.throws(
    () => parsePolicy('policy "p" { max_attempts: 1 backoff: linear(delay=5s, increment=1s, max=1s) retry_on: [500] }'),
    /linear max must be at least as large as delay/,
  )
})

test('exponential backoff rejects a factor that is not greater than 1', () => {
  assert.throws(
    () => parsePolicy('policy "p" { max_attempts: 1 backoff: exponential(base=1s, factor=1) retry_on: [500] }'),
    /exponential factor must be greater than 1/,
  )
})

test('exponential backoff rejects a max smaller than base', () => {
  assert.throws(
    () => parsePolicy('policy "p" { max_attempts: 1 backoff: exponential(base=5s, factor=2, max=1s) retry_on: [500] }'),
    /exponential max must be at least as large as base/,
  )
})

test('exponential backoff rejects a duration passed where factor expects a plain number', () => {
  assert.throws(
    () => parsePolicy('policy "p" { max_attempts: 1 backoff: exponential(base=5s, factor=2s) retry_on: [500] }'),
    /argument 'factor' must be a plain number, not a duration/,
  )
})

test('backoff rejects a missing required argument', () => {
  assert.throws(
    () => parsePolicy('policy "p" { max_attempts: 1 backoff: fixed() retry_on: [500] }'),
    /an argument name/,
  )
  assert.throws(
    () => parsePolicy('policy "p" { max_attempts: 1 backoff: exponential(base=1s) retry_on: [500] }'),
    /missing argument 'factor'/,
  )
})

test('retry_on accepts a mix of status codes and bare words', () => {
  const policy = parsePolicy('policy "p" { max_attempts: 1 backoff: fixed(delay=1s) retry_on: [500, timeout, connection_error] }')
  assert.deepEqual(policy.retryOn, [500, 'timeout', 'connection_error'])
})

test('errors report line and column', () => {
  try {
    parsePolicy('policy "p" {\n  max_attempts: 0\n  backoff: fixed(delay=1s)\n  retry_on: [500]\n}')
    assert.fail('expected parsePolicy to throw')
  } catch (err) {
    assert.ok(err instanceof PolicyError)
    assert.match(err.message, /\(line \d+, col \d+\)/)
  }
})
