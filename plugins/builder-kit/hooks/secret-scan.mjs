#!/usr/bin/env node
// PreToolUse guard: block writes that would commit a secret to disk.
// Reads the tool-call JSON on stdin. Exit 2 = deny (the stderr message is shown
// to the model, which then avoids the write); exit 0 = allow.
//
// Fails OPEN: any parse/infra error allows the write. A secret guard that blocks
// every write because it itself broke (e.g. a missing `jq`) is worse than none —
// it makes the whole plugin look broken on a beginner's machine. Node is always
// present in a Claude Code project, so this has no external dependency.

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => (raw += c))
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}')
    const ti = input.tool_input || {}
    const path = String(ti.file_path || '')
    const content = String(ti.content ?? ti.new_string ?? '')

    // Never let the agent write a real .env file. Templates named .env.example
    // (placeholders) are fine and must not be blocked.
    if (/(^|\/)\.env(\.[A-Za-z0-9]+)*$/.test(path) && !/\.example$/.test(path)) {
      process.stderr.write(
        `Refusing to write a secret-bearing env file (${path}). ` +
          `Use .env.example with placeholder values, and keep real values out of the repo.\n`,
      )
      process.exit(2)
    }

    // Flag obvious LIVE secrets in the content being written. Kept deliberately
    // narrow (live-key shapes only) to avoid false positives on placeholders.
    const liveSecret =
      /(sk_live_[A-Za-z0-9]{16,}|rk_live_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|xox[baprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{36})/
    if (liveSecret.test(content)) {
      process.stderr.write(
        'Refusing to write: the content contains what looks like a LIVE secret ' +
          '(API key, private key, or token). Move it to an environment variable and ' +
          'reference it via process.env / import.meta.env instead.\n',
      )
      process.exit(2)
    }

    process.exit(0)
  } catch {
    process.exit(0) // fail open — never block a build because the guard errored
  }
})
