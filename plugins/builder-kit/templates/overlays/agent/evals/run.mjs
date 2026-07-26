#!/usr/bin/env node
// Eval harness (stub). Runs on `npm test`.
//
// What it does TODAY: it lints the scenario files in this folder. Every
// scenario must have a title and an "Expected behaviour" section, so a broken
// or empty scenario fails the build. This is a real check, not a no-op.
//
// What it does NOT do yet: invoke your agent and score it. The starter ships
// with no model wired (see src/agent.ts, EXTENSION POINT 3), so the behavioural
// result is reported as PENDING, never PASS. Wiring that is the extension point
// described in README.md. Keeping it honest matters: a green run here means
// "the scenarios are well formed", not "the agent passed".

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// Scenario files are the .md files in this folder, except this README.
const scenarios = readdirSync(HERE)
  .filter((f) => f.toLowerCase().endsWith('.md') && f.toLowerCase() !== 'readme.md')
  .sort()

if (scenarios.length === 0) {
  console.error('eval: no scenario files found in evals/. Add at least one, e.g. smoke.md.')
  process.exit(1)
}

const titleRe = /^#\s+(.+)$/m
const expectedRe = /^#+\s+expected behaviour\s*$/im

let structuralFailures = 0

console.log(`eval harness (stub): checking ${scenarios.length} scenario(s)\n`)
for (const file of scenarios) {
  const text = readFileSync(join(HERE, file), 'utf8')
  const titleMatch = text.match(titleRe)
  const hasExpected = expectedRe.test(text)

  const problems = []
  if (!titleMatch) problems.push('missing "# " title')
  if (!hasExpected) problems.push('missing "Expected behaviour" section')

  const title = titleMatch ? titleMatch[1].trim() : '(no title)'
  if (problems.length > 0) {
    structuralFailures++
    console.log(`  FAIL  ${file}: ${problems.join('; ')}`)
  } else {
    // Structure is good; the behavioural eval is not wired yet.
    console.log(`  ok    ${file}: "${title}"`)
    console.log(`        behavioural eval: PENDING (no model wired, see README.md)`)
  }
}

console.log('')
if (structuralFailures > 0) {
  console.error(`eval: ${structuralFailures} scenario(s) malformed. Fix the files above.`)
  process.exit(1)
}

console.log(
  'eval: scenarios are well formed. Behavioural evaluation is a stub. Wire a ' +
    'ModelClient in src/agent.ts and follow evals/README.md to make these real checks.',
)
process.exit(0)
