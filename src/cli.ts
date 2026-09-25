#!/usr/bin/env node
import { readFileSync } from 'fs'
import { parsePolicies } from './parser'
import { printPolicies } from './printer'

// fd 0 is stdin; used both when no path is given and when the path is
// explicitly "-", so pipelines like `cat p.retry | retryfmt` and
// `retryfmt -` behave the same way.
function readInput(path: string | undefined): string {
  if (path === undefined || path === '-') {
    return readFileSync(0, 'utf8')
  }
  return readFileSync(path, 'utf8')
}

interface Args {
  path: string | undefined
  check: boolean
}

function parseArgs(argv: string[]): Args {
  let path: string | undefined
  let check = false
  for (const arg of argv) {
    if (arg === '--check') {
      check = true
    } else if (path === undefined) {
      path = arg
    } else {
      throw new Error(`unexpected extra argument '${arg}'`)
    }
  }
  return { path, check }
}

function main(): void {
  let args: Args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`retryfmt: ${message}\n`)
    process.exitCode = 1
    return
  }

  let source: string
  try {
    source = readInput(args.path)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`retryfmt: could not read input: ${message}\n`)
    process.exitCode = 1
    return
  }

  try {
    const policies = parsePolicies(source)
    const formatted = printPolicies(policies) + '\n'
    if (args.check) {
      if (formatted !== source) {
        const label = args.path === undefined || args.path === '-' ? 'stdin' : args.path
        process.stderr.write(`retryfmt: ${label} is not formatted\n`)
        process.exitCode = 1
      }
      return
    }
    process.stdout.write(formatted)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`retryfmt: ${message}\n`)
    process.exitCode = 1
  }
}

main()
