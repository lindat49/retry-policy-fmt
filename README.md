# retry-policy-fmt

Every service I've worked on ends up with retry logic described three
different ways: a comment in the client code, a paragraph in a wiki page,
and whatever the config file actually says (if it agrees with either of
the first two). None of it gets validated, so it's easy to end up with an
exponential backoff whose factor is `1` (does nothing), a `max` smaller
than the initial delay, or a `max_attempts` someone typed as `0`.

This project is a small text format for describing a retry policy, a
validating parser for it, and a pretty printer that turns a parsed policy
back into a canonical form. The idea is that retry policies live in
version control as plain files, get checked the same way code does, and
always render the same way regardless of who wrote them or how they were
spaced out.

## The format

```
policy "checkout-api" {
  max_attempts: 5
  backoff: exponential(base=200ms, factor=2.0, max=10s)
  jitter: full
  retry_on: [502, 503, 429, timeout]
  give_up_after: 30s
}
```

Fields:

- `max_attempts` — integer from 1 to 1000.
- `backoff` — one of:
  - `fixed(delay=<duration>)`
  - `linear(delay=<duration>, increment=<duration>, max=<duration>)` (`max` optional)
  - `exponential(base=<duration>, factor=<number>, max=<duration>)` (`max` optional, `factor` must be > 1)
- `jitter` — `none`, `full`, or `equal`. Optional, defaults to `none`.
- `retry_on` — a non-empty list of HTTP status codes and/or bare words
  (`timeout`, `connection_error`, ...).
- `give_up_after` — an overall deadline as a duration. Optional.

Durations are a number directly followed by a unit: `ms`, `s`, `m`, or `h`
(`200ms`, `1.5s`, `2m`). Comments start with `#` and run to end of line.

## Usage

Build once with a TypeScript compiler on your `PATH`:

```
tsc
```

Then run it against a file:

```
retryfmt checkout-api.retry
```

or pipe a policy in over stdin — this is the common case in a script or
a pre-commit hook that formats staged files one at a time:

```
cat checkout-api.retry | retryfmt
retryfmt - < checkout-api.retry
```

With no argument, or `-` as the argument, `retryfmt` reads from stdin.
Otherwise it treats the argument as a file path.

Tests use Node's built-in test runner, so there's nothing to install:

```
npm test
```

Output is the canonical rendering of the policy: fixed field order, two-space
indentation, durations normalized to the largest unit that divides evenly
(`60000ms` becomes `1m`). Two files that describe the same policy with
different formatting print identically, which is what makes this usable as
a formatter and not just a linter.

Invalid input is rejected with a message pointing at the offending line and
column, for example:

```
retryfmt: exponential factor must be greater than 1 (line 3, col 34)
```

## Status

This is the initial skeleton: the grammar above is implemented end to end
(lex, parse, validate, print) for a single policy per file. See the roadmap
for what's next.
