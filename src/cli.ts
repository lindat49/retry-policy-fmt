#!/usr/bin/env node
import { readFileSync } from 'fs'
import { parsePolicy } from './parser'
import { printPolicy } from './printer'

// fd 0 is stdin; used both when no path is given and when the path is
// explicitly "-", so pipelines like `cat p.retry | retryfmt` and
// `retryfmt -` behave the same way.
function readInput(path: string | undefined): string {
  if (path === undefined || path === '-') {
    return readFileSync(0, 'utf8')
  }
  return readFileSync(path, 'utf8')
}

function main(): void {
  const path = process.argv[2]

  let source: string
  try {
    source = readInput(path)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`retryfmt: could not read input: ${message}\n`)
    process.exitCode = 1
    return
  }

  try {
    const policy = parsePolicy(source)
    process.stdout.write(printPolicy(policy) + '\n')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`retryfmt: ${message}\n`)
    process.exitCode = 1
  }
}

main()
