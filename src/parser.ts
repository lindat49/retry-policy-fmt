// Lexer + recursive-descent parser + validation for the retry policy
// language. Kept in one file because the grammar is small enough that
// splitting it up would just add navigation overhead.

export type Jitter = 'none' | 'full' | 'equal'

export type Backoff =
  | { kind: 'fixed'; delayMs: number }
  | { kind: 'linear'; delayMs: number; incrementMs: number; maxMs: number | null }
  | { kind: 'exponential'; baseMs: number; factor: number; maxMs: number | null }

export interface RetryPolicy {
  name: string
  maxAttempts: number
  backoff: Backoff
  jitter: Jitter
  retryOn: Array<number | string>
  giveUpAfterMs: number | null
}

export class PolicyError extends Error {
  readonly line?: number
  readonly col?: number

  constructor(message: string, line?: number, col?: number) {
    super(line !== undefined && col !== undefined ? `${message} (line ${line}, col ${col})` : message)
    this.name = 'PolicyError'
    this.line = line
    this.col = col
  }
}

type TokenType =
  | 'lbrace' | 'rbrace' | 'lparen' | 'rparen' | 'lbracket' | 'rbracket'
  | 'colon' | 'comma' | 'equals'
  | 'string' | 'ident' | 'number' | 'duration'
  | 'eof'

interface Token {
  type: TokenType
  text: string
  value: string | number
  line: number
  col: number
}

// Milliseconds per unit. "ms" must come before nothing needs precedence
// here since units are matched whole, not by longest-prefix.
const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }

const SINGLE_CHAR_TOKENS: Record<string, TokenType> = {
  '{': 'lbrace', '}': 'rbrace', '(': 'lparen', ')': 'rparen',
  '[': 'lbracket', ']': 'rbracket', ':': 'colon', ',': 'comma', '=': 'equals',
}

class Lexer {
  private pos = 0
  private line = 1
  private col = 1

  constructor(private readonly source: string) {}

  tokenize(): Token[] {
    const tokens: Token[] = []
    for (;;) {
      this.skipWhitespaceAndComments()
      if (this.pos >= this.source.length) {
        tokens.push({ type: 'eof', text: '', value: '', line: this.line, col: this.col })
        break
      }
      tokens.push(this.readToken())
    }
    return tokens
  }

  private peekChar(): string | undefined {
    return this.source[this.pos]
  }

  private advance(): string {
    const ch = this.source[this.pos] as string
    this.pos++
    if (ch === '\n') {
      this.line++
      this.col = 1
    } else {
      this.col++
    }
    return ch
  }

  private skipWhitespaceAndComments(): void {
    for (;;) {
      const ch = this.peekChar()
      if (ch === undefined) return
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.advance()
        continue
      }
      if (ch === '#') {
        while (this.pos < this.source.length && this.peekChar() !== '\n') this.advance()
        continue
      }
      return
    }
  }

  private readToken(): Token {
    const line = this.line
    const col = this.col
    const ch = this.peekChar() as string

    const single = SINGLE_CHAR_TOKENS[ch]
    if (single !== undefined) {
      this.advance()
      return { type: single, text: ch, value: ch, line, col }
    }

    if (ch === '"') return this.readString(line, col)
    if (ch >= '0' && ch <= '9') return this.readNumberOrDuration(line, col)
    if (/[A-Za-z_]/.test(ch)) return this.readIdent(line, col)

    throw new PolicyError(`unexpected character '${ch}'`, line, col)
  }

  private readString(line: number, col: number): Token {
    this.advance() // opening quote
    let value = ''
    for (;;) {
      if (this.pos >= this.source.length) {
        throw new PolicyError('unterminated string literal', line, col)
      }
      const ch = this.advance()
      if (ch === '"') break
      if (ch === '\n') {
        throw new PolicyError('string literal cannot contain a newline', line, col)
      }
      if (ch === '\\') {
        const next = this.advance()
        if (next === '"') value += '"'
        else if (next === '\\') value += '\\'
        else if (next === 'n') value += '\n'
        else throw new PolicyError(`unknown escape sequence '\\${next}'`, this.line, this.col)
        continue
      }
      value += ch
    }
    return { type: 'string', text: value, value, line, col }
  }

  private readNumberOrDuration(line: number, col: number): Token {
    let text = ''
    while (this.pos < this.source.length && /[0-9]/.test(this.peekChar() as string)) text += this.advance()
    if (this.peekChar() === '.' && /[0-9]/.test(this.source[this.pos + 1] ?? '')) {
      text += this.advance()
      while (this.pos < this.source.length && /[0-9]/.test(this.peekChar() as string)) text += this.advance()
    }
    let unit = ''
    while (this.pos < this.source.length && /[A-Za-z]/.test(this.peekChar() as string)) unit += this.advance()
    if (unit === '') {
      return { type: 'number', text, value: Number(text), line, col }
    }
    const factor = UNIT_MS[unit]
    if (factor === undefined) {
      throw new PolicyError(`unknown duration unit '${unit}'`, line, col)
    }
    return { type: 'duration', text: text + unit, value: Number(text) * factor, line, col }
  }

  private readIdent(line: number, col: number): Token {
    let text = ''
    while (this.pos < this.source.length && /[A-Za-z0-9_]/.test(this.peekChar() as string)) text += this.advance()
    return { type: 'ident', text, value: text, line, col }
  }
}

interface BackoffArg {
  value: number
  type: 'number' | 'duration'
  line: number
  col: number
}

class Parser {
  private pos = 0

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos] as Token
  }

  private advance(): Token {
    return this.tokens[this.pos++] as Token
  }

  private expect(type: TokenType, what: string): Token {
    const token = this.peek()
    if (token.type !== type) {
      throw new PolicyError(`expected ${what}, found '${token.text || token.type}'`, token.line, token.col)
    }
    return this.advance()
  }

  parsePolicy(): RetryPolicy {
    const keyword = this.expect('ident', "'policy'")
    if (keyword.text !== 'policy') {
      throw new PolicyError(`expected 'policy', found '${keyword.text}'`, keyword.line, keyword.col)
    }
    const nameToken = this.expect('string', 'a quoted policy name')
    const name = String(nameToken.value)
    if (name.trim() === '') {
      throw new PolicyError('policy name cannot be empty', nameToken.line, nameToken.col)
    }
    this.expect('lbrace', "'{'")

    const seen = new Set<string>()
    let maxAttempts: number | undefined
    let backoff: Backoff | undefined
    let jitter: Jitter = 'none'
    let retryOn: Array<number | string> | undefined
    let giveUpAfterMs: number | null = null

    while (this.peek().type !== 'rbrace') {
      const keyToken = this.expect('ident', 'a field name')
      const key = keyToken.text
      if (seen.has(key)) {
        throw new PolicyError(`duplicate field '${key}'`, keyToken.line, keyToken.col)
      }
      seen.add(key)
      this.expect('colon', "':'")

      switch (key) {
        case 'max_attempts': {
          const token = this.expect('number', 'an integer')
          const value = token.value as number
          if (!Number.isInteger(value)) {
            throw new PolicyError('max_attempts must be a whole number', token.line, token.col)
          }
          maxAttempts = value
          break
        }
        case 'backoff':
          backoff = this.parseBackoff()
          break
        case 'jitter': {
          const token = this.expect('ident', "'none', 'full', or 'equal'")
          if (token.text !== 'none' && token.text !== 'full' && token.text !== 'equal') {
            throw new PolicyError(`jitter must be 'none', 'full', or 'equal', found '${token.text}'`, token.line, token.col)
          }
          jitter = token.text
          break
        }
        case 'retry_on':
          retryOn = this.parseRetryOnList()
          break
        case 'give_up_after': {
          const token = this.expect('duration', 'a duration such as 30s')
          giveUpAfterMs = token.value as number
          break
        }
        default:
          throw new PolicyError(`unknown field '${key}'`, keyToken.line, keyToken.col)
      }
    }
    const closeBrace = this.expect('rbrace', "'}'")

    if (maxAttempts === undefined) {
      throw new PolicyError("policy is missing required field 'max_attempts'", closeBrace.line, closeBrace.col)
    }
    if (backoff === undefined) {
      throw new PolicyError("policy is missing required field 'backoff'", closeBrace.line, closeBrace.col)
    }
    if (retryOn === undefined || retryOn.length === 0) {
      throw new PolicyError("policy must list at least one entry in 'retry_on'", closeBrace.line, closeBrace.col)
    }
    if (maxAttempts < 1 || maxAttempts > 1000) {
      throw new PolicyError('max_attempts must be between 1 and 1000', closeBrace.line, closeBrace.col)
    }
    if (giveUpAfterMs !== null && giveUpAfterMs <= 0) {
      throw new PolicyError('give_up_after must be greater than zero', closeBrace.line, closeBrace.col)
    }

    this.expect('eof', 'end of input after the policy block')

    return { name, maxAttempts, backoff, jitter, retryOn, giveUpAfterMs }
  }

  private parseBackoff(): Backoff {
    const kindToken = this.expect('ident', "a backoff kind ('fixed', 'linear', or 'exponential')")
    const kind = kindToken.text
    this.expect('lparen', "'('")

    const args = new Map<string, BackoffArg>()
    for (;;) {
      const nameToken = this.expect('ident', 'an argument name')
      this.expect('equals', "'='")
      const valueToken = this.peek()
      if (valueToken.type !== 'duration' && valueToken.type !== 'number') {
        throw new PolicyError('expected a number or duration', valueToken.line, valueToken.col)
      }
      this.advance()
      args.set(nameToken.text, {
        value: valueToken.value as number,
        type: valueToken.type,
        line: valueToken.line,
        col: valueToken.col,
      })
      if (this.peek().type === 'comma') {
        this.advance()
        continue
      }
      break
    }
    const closeParen = this.expect('rparen', "')'")

    const needDuration = (argName: string): number => {
      const arg = args.get(argName)
      if (arg === undefined) {
        throw new PolicyError(`backoff '${kind}' is missing argument '${argName}'`, closeParen.line, closeParen.col)
      }
      if (arg.type !== 'duration') {
        throw new PolicyError(`argument '${argName}' must be a duration such as 200ms`, arg.line, arg.col)
      }
      return arg.value
    }
    const optionalDuration = (argName: string): number | null => {
      const arg = args.get(argName)
      if (arg === undefined) return null
      if (arg.type !== 'duration') {
        throw new PolicyError(`argument '${argName}' must be a duration such as 200ms`, arg.line, arg.col)
      }
      return arg.value
    }
    const needNumber = (argName: string): number => {
      const arg = args.get(argName)
      if (arg === undefined) {
        throw new PolicyError(`backoff '${kind}' is missing argument '${argName}'`, closeParen.line, closeParen.col)
      }
      if (arg.type !== 'number') {
        throw new PolicyError(`argument '${argName}' must be a plain number, not a duration`, arg.line, arg.col)
      }
      return arg.value
    }

    switch (kind) {
      case 'fixed': {
        const delayMs = needDuration('delay')
        if (delayMs <= 0) throw new PolicyError('fixed delay must be greater than zero', closeParen.line, closeParen.col)
        return { kind: 'fixed', delayMs }
      }
      case 'linear': {
        const delayMs = needDuration('delay')
        const incrementMs = needDuration('increment')
        const maxMs = optionalDuration('max')
        if (delayMs <= 0) throw new PolicyError('linear delay must be greater than zero', closeParen.line, closeParen.col)
        if (incrementMs < 0) throw new PolicyError('linear increment cannot be negative', closeParen.line, closeParen.col)
        if (maxMs !== null && maxMs < delayMs) {
          throw new PolicyError('linear max must be at least as large as delay', closeParen.line, closeParen.col)
        }
        return { kind: 'linear', delayMs, incrementMs, maxMs }
      }
      case 'exponential': {
        const baseMs = needDuration('base')
        const factor = needNumber('factor')
        const maxMs = optionalDuration('max')
        if (baseMs <= 0) throw new PolicyError('exponential base must be greater than zero', closeParen.line, closeParen.col)
        if (factor <= 1) throw new PolicyError('exponential factor must be greater than 1', closeParen.line, closeParen.col)
        if (maxMs !== null && maxMs < baseMs) {
          throw new PolicyError('exponential max must be at least as large as base', closeParen.line, closeParen.col)
        }
        return { kind: 'exponential', baseMs, factor, maxMs }
      }
      default:
        throw new PolicyError(`unknown backoff kind '${kind}'`, kindToken.line, kindToken.col)
    }
  }

  private parseRetryOnList(): Array<number | string> {
    this.expect('lbracket', "'['")
    const items: Array<number | string> = []
    if (this.peek().type !== 'rbracket') {
      for (;;) {
        const token = this.peek()
        if (token.type === 'number') {
          this.advance()
          items.push(token.value as number)
        } else if (token.type === 'ident') {
          this.advance()
          items.push(token.text)
        } else {
          throw new PolicyError('expected a status code or an identifier', token.line, token.col)
        }
        if (this.peek().type === 'comma') {
          this.advance()
          continue
        }
        break
      }
    }
    this.expect('rbracket', "']'")
    return items
  }
}

export function parsePolicy(source: string): RetryPolicy {
  const tokens = new Lexer(source).tokenize()
  return new Parser(tokens).parsePolicy()
}
