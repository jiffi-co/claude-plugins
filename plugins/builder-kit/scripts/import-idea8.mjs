#!/usr/bin/env node
/**
 * /jiffi-import-idea8 — bring an idea8 planning session into a builder-kit project
 * so the build continues straight from /architect.
 *
 * idea8 (ai.jiffi.co) does the deep interview + research and emits richer artifacts
 * than the native /idea-pack. This drops each of those artifacts into builder-kit's
 * canonical docs/ paths (where /architect, /prd and /implementation-plan already
 * read from) and marks the idea validated, so the hand-off is one command.
 *
 * Input: the idea8 MARKDOWN export — the combined file (Export -> Markdown) or the
 * bundle.md from the zip. Both carry per-artifact `<!-- type: X -->` markers, which
 * is what we key off (the per-file zip names are title-slugs, not types).
 *
 *   node import-idea8.mjs <path-to-idea8-export.md | folder-with-bundle.md>
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

// idea8 artifact type -> builder-kit canonical path. The first two have native
// equivalents; the rest are idea8's deeper-only artifacts.
const TYPE_TO_PATH = {
  idea_pack: 'docs/idea/idea-pack.md',
  prd: 'docs/prd/prd.md',
  competitive_landscape: 'docs/idea/competitive-landscape.md',
  assumption_register: 'docs/idea/assumptions.md',
  dependency_register: 'docs/idea/dependencies.md',
  feature_brief: 'docs/idea/feature-brief.md',
  commercialisation_blueprint: 'docs/idea/commercialisation.md',
}

const fail = (m) => { console.error(m); process.exit(1) }

let input = process.argv[2]
if (!input) fail('Usage: /jiffi-import-idea8 <path to the idea8 markdown export (the combined .md, or the bundle.md from the zip)>')
input = resolve(input)
if (!existsSync(input)) fail(`Not found: ${input}`)

// A folder (the unzipped export) -> use its bundle.md.
let file = input
if (statSync(input).isDirectory()) {
  const cand = join(input, 'bundle.md')
  if (!existsSync(cand)) fail(`No bundle.md in ${input}. In idea8, Export -> Markdown, or point me at the combined .md file.`)
  file = cand
}

const text = readFileSync(file, 'utf8')
const markerRe = /<!--\s*type:\s*([a-z_]+)\s*(?:\|[^>]*)?-->/g
const markers = [...text.matchAll(markerRe)]
if (markers.length === 0) fail('No idea8 artifacts found (expected `<!-- type: ... -->` markers). Use idea8\'s markdown export.')

const written = []
const skipped = []
for (let i = 0; i < markers.length; i++) {
  const type = markers[i][1]
  const path = TYPE_TO_PATH[type]
  const contentStart = markers[i].index + markers[i][0].length
  // This artifact's title is the last "# heading" before its marker.
  const before = text.slice(0, markers[i].index)
  const tm = before.match(/(?:^|\n)(#\s+.+?)\s*$/)
  const title = tm ? tm[1] : `# ${type}`
  // Content runs to the next artifact's heading (before the next marker), or EOF.
  let end = text.length
  if (i + 1 < markers.length) {
    const nextHeading = text.lastIndexOf('\n#', markers[i + 1].index)
    end = nextHeading > contentStart ? nextHeading : markers[i + 1].index
  }
  const body = text.slice(contentStart, end).trim()
  if (!path) { skipped.push(`${type} (no builder-kit mapping)`); continue }
  const dest = join(process.cwd(), path)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, `${title}\n\n${body}\n`)
  written.push(`${type.padEnd(26)} -> ${path}`)
}

// Satisfy the /idea-pack gate: the idea was validated inside idea8's deep pass.
const valPath = join(process.cwd(), 'docs/idea/validation.md')
mkdirSync(dirname(valPath), { recursive: true })
if (!existsSync(valPath)) {
  writeFileSync(
    valPath,
    '# Idea validation\n\nStatus: PASSED (via an idea8 deep planning session).\n\nThe idea was pressure-tested in idea8 and its Idea Pack + PRD were imported. See docs/idea/ and docs/prd/.\n',
  )
}

console.log(`Imported ${written.length} idea8 artifact(s) into this project:`)
for (const w of written) console.log(`  ✓ ${w}`)
if (skipped.length) { console.log('Skipped (no mapping):'); for (const s of skipped) console.log(`  - ${s}`) }
console.log('\nNext: run /architect to turn this into architecture + ADRs, then /implementation-plan and /phase-start.')
