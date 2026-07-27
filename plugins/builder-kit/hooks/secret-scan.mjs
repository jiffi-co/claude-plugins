#!/usr/bin/env node
// PreToolUse guard: block writes that would commit a secret to disk.
// Reads the tool-call JSON on stdin. Exit 2 = deny (the stderr message is shown
// to the model, which then avoids the write); exit 0 = allow.
//
// Fails OPEN: any parse/infra error allows the write. A secret guard that blocks
// every write because it itself broke (e.g. a missing `jq`) is worse than none —
// it makes the whole plugin look broken on a beginner's machine. Node is always
// present in a Claude Code project, so this has no external dependency.
//
// Every block is also recorded to .claude/builder-kit/last-block.md, because Claude
// Desktop renders nothing when a hook blocks and the user would otherwise see a hang.

// Loaded dynamically on purpose. A static import of a file that failed to ship, or
// that has a syntax error, would take the whole guard down with it and turn every
// secret write into a silent pass. The block must survive the reporter being broken,
// so a load failure costs the file, not the guard.
let reportBlock = null
try {
  ;({ reportBlock } = await import('./block-report.mjs'))
} catch {
  reportBlock = null
}

// The stderr text for a block, with or without the reporter. Both paths tell the
// model to speak up, which is the part Desktop users depend on.
//
// The try is load-bearing, not decoration. This runs inside the hook's outer
// fail-open catch, so a reporter that throws would be caught up there and exit 0,
// silently turning a blocked secret into an allowed write. The invariant has to
// hold here, at the call site, rather than by trusting the callee.
function deny(o) {
  try {
    if (typeof reportBlock === 'function') return reportBlock(o)
  } catch {
    // fall through to the message below
  }
  return (
    `BLOCKED by builder-kit (${o.hook}).\n\n${o.reason}\n\n${o.remedy}\n\n` +
    'Tell the user what was blocked and why. In the Claude Code panel of Claude Desktop ' +
    'a blocked turn renders nothing at all, so unless you say it they see a hang.\n'
  )
}

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => (raw += c))
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}')
    const ti = input.tool_input || {}
    // Normalise Windows backslashes so the path anchors work on every OS.
    const path = String(ti.file_path || '').replace(/\\/g, '/')
    // Scan Write/Edit content AND MultiEdit's edits[] — a MultiEdit payload has no
    // top-level content/new_string, so without this its writes went unscanned.
    const edits = Array.isArray(ti.edits) ? ti.edits.map((e) => e && e.new_string ? e.new_string : '').join('\n') : ''
    const content = String(ti.content ?? ti.new_string ?? '') + '\n' + edits

    // Never let the agent write a real .env file. Templates named .env.example
    // (placeholders) are fine and must not be blocked.
    if (/(^|\/)\.env(\.[A-Za-z0-9]+)*$/.test(path) && !/\.example$/.test(path)) {
      process.stderr.write(
        deny({
          hook: 'secret-scan',
          stopId: 'C-SEC',
          root: input.cwd,
          reason: `Refused to write a secret-bearing env file (${path}). Real env files do not belong in the repo.`,
          remedy:
            'Write .env.example with placeholder values instead, and keep the real values in the environment.',
        }),
      )
      process.exit(2)
    }

    // Flag obvious LIVE secrets in the content being written. Kept deliberately
    // narrow (live-key shapes only) to avoid false positives on placeholders.
    const liveSecret =
      /(sk_live_[A-Za-z0-9]{16,}|rk_live_[A-Za-z0-9]{16,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|AIza[0-9A-Za-z_-]{35}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|xox[baprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{36})/
    if (liveSecret.test(content)) {
      process.stderr.write(
        deny({
          hook: 'secret-scan',
          stopId: 'C-SEC',
          root: input.cwd,
          reason:
            `Refused to write ${path || 'this file'}: the content carries what looks like a LIVE ` +
            'secret (an API key, a private key, or a token).',
          remedy:
            'Move the value into an environment variable and reference it via process.env or ' +
            'import.meta.env. If it has already been committed or shipped to a client bundle, ' +
            'treat it as compromised and rotate it at the provider.',
        }),
      )
      process.exit(2)
    }

    process.exit(0)
  } catch {
    process.exit(0) // fail open — never block a build because the guard errored
  }
})
