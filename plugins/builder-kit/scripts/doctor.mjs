#!/usr/bin/env node
// builder-kit doctor: setup health check, and the kit's installer.
//
// Read-only by default. `--fix` installs what it can and prints an exact paste
// line for everything else, so nobody has to go scrounging for tooling.
//
// Three rules the fixer never breaks:
//   1. It does NOT filter by tier. forge's `doctor --fix` filtered its targets to
//      recommended + optional, so it could never install git, the one thing a
//      beginner is most likely to be missing. Every missing tool with a recipe is
//      a target here, core included.
//   2. It never runs anything that could sit waiting for a password. Elevation is
//      probed with `sudo -n true`; when that fails the command is written to
//      bootstrap.sh and printed, not run. `sudo` is only ever invoked as
//      `sudo -n`, so a hang is not reachable.
//   3. Every candidate declares `admin: 'none' | 'sudo' | 'uac' | 'gui'`. That
//      field is what lets the kit fix everything it can and hand back one exact
//      line for the rest.
//
// Usage: node doctor.mjs [--json] [--fix] [--dry-run] [--fast]
//   --json     machine-readable result (support artifact); exit contract unchanged
//   --fix      install missing tooling, then re-probe
//   --dry-run  with --fix: show the plan, run nothing
//   --fast     skip the two live-session probes that shell out to `claude`
//
// Pure Node, no dependencies. Importable: nothing runs unless this file is the
// entry point, so lint-kit and the fixture tests can read the tables directly.

import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOME = homedir()
const PLATFORM = platform()

// --- Small helpers ----------------------------------------------------------

function run(cmd, cmdArgs = [], timeout = 20000) {
  try {
    const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', timeout })
    if (r.error || r.status == null) return { ok: false, out: '' }
    return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() }
  } catch {
    return { ok: false, out: '' }
  }
}

function firstVersion(s) {
  const m = String(s).match(/v?(\d+\.\d+(\.\d+)?)/)
  return m ? m[1] : ''
}

// Is a command on PATH? ENOENT means "not installed"; any other outcome (even a
// non-zero exit from an unsupported --version flag) means the binary is present.
function probeCmd(cmd) {
  try {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 20000 })
    if (r.error) return { present: r.error.code !== 'ENOENT', version: '' }
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim()
    const v = firstVersion(out)
    return { present: true, version: r.status === 0 && v ? `v${v}` : 'present on PATH' }
  } catch {
    return { present: false, version: '' }
  }
}

// Presence test used by the installer. `command -v` is POSIX; where.exe is the
// Windows equivalent. Deliberately separate from probeCmd: package managers are
// asked "are you there", never "what version are you".
function which(cmd) {
  const inv = PLATFORM === 'win32' ? ['where.exe', [cmd]] : ['sh', ['-c', `command -v ${cmd}`]]
  return run(inv[0], inv[1], 4000).ok
}

function expandHome(p) {
  return p.startsWith('~') ? join(HOME, p.slice(1)) : p
}

// --- Surface detection ------------------------------------------------------
// Which Claude Code is this, and where is it running? Only used for advice: no
// surface is ever a failure. A Desktop user has no `claude` on PATH and their
// setup is fine, which is exactly the row the old doctor called broken.

function detectSurface(env = process.env) {
  const evidence = []
  let wsl = false
  if (PLATFORM === 'linux') {
    if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) {
      wsl = true
      evidence.push(`WSL (${env.WSL_DISTRO_NAME || 'interop set'})`)
    } else {
      try {
        if (/microsoft/i.test(readFileSync('/proc/version', 'utf8'))) {
          wsl = true
          evidence.push('WSL (/proc/version names Microsoft)')
        }
      } catch {}
    }
  }
  const ciVar = ['GITHUB_ACTIONS', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI', 'JENKINS_URL', 'CI'].find((k) => env[k])
  const cloudVar = ['CODESPACES', 'GITPOD_WORKSPACE_ID', 'CLOUD_SHELL', 'REPL_ID', 'STACKBLITZ_ENV'].find((k) => env[k])
  // SSH_AUTH_SOCK is agent forwarding and says nothing about where the shell is,
  // so it is NOT in this list. Including it marks every Mac as a remote session.
  const sshVar = ['SSH_CONNECTION', 'SSH_TTY', 'SSH_CLIENT'].find((k) => env[k])
  const entry = env.CLAUDE_CODE_ENTRYPOINT || ''
  const inClaude = env.CLAUDECODE === '1' || Boolean(entry)
  if (cloudVar) evidence.push(`cloud (${cloudVar})`)
  if (ciVar) evidence.push(`CI (${ciVar})`)
  if (sshVar) evidence.push(`SSH (${sshVar})`)
  if (entry) evidence.push(`entrypoint ${entry}`)
  if (env.TERM_PROGRAM) evidence.push(`host ${env.TERM_PROGRAM}`)

  let id = 'terminal'
  let label = 'terminal'
  if (/desktop|app/i.test(entry)) {
    id = 'desktop'
    label = 'Claude Desktop'
  } else if (inClaude && entry && entry !== 'cli') {
    id = 'embedded'
    label = `embedded Claude Code (${entry})`
  } else if (cloudVar) {
    id = 'cloud'
    label = `cloud workspace (${cloudVar})`
  } else if (ciVar) {
    id = 'ci'
    label = `CI runner (${ciVar})`
  } else if (wsl) {
    id = 'wsl'
    label = 'WSL'
  } else if (sshVar) {
    id = 'ssh'
    label = 'SSH session'
  } else if (!process.stdout.isTTY && !env.TERM && inClaude) {
    id = 'non-terminal'
    label = 'non-terminal host (Desktop or an SDK)'
  }
  // WSL and SSH are qualifiers, not verdicts: report them alongside the primary.
  if (wsl && id !== 'wsl') label += ' on WSL'
  if (sshVar && id !== 'ssh') label += ' over SSH'
  return { id, label, wsl, ssh: Boolean(sshVar), cloud: Boolean(cloudVar || ciVar), evidence }
}

// --- Installer mechanism ----------------------------------------------------
// Ported from jiffi-forge's toolchain-install.ts: detectInstaller,
// resolveInstallCommand and the streaming runner. Nothing else came across.
// `forge install` probes and exits without installing anything, and forge's
// `doctor --fix` is the tier-filtered version this file exists to replace.

// Keyed by the binary a candidate requires. `bootstrap` is a REAL command that
// gets you that binary, or '' when there isn't one, in which case `hint` is the
// prose. The split matters: bootstrap lines are written into bootstrap.sh as
// executable steps, and a hint written as a step would be a broken script.
// We never run these ourselves. Bootstrapping a package manager is the user's call.
const MANAGERS = {
  brew: { label: 'Homebrew', bootstrap: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/brew/HEAD/install.sh)"', hint: 'See https://brew.sh', admin: 'sudo' },
  scoop: { label: 'Scoop', bootstrap: 'irm get.scoop.sh | iex', hint: 'See https://scoop.sh', admin: 'none' },
  winget: { label: 'winget', bootstrap: '', hint: 'Install "App Installer" from the Microsoft Store', admin: 'gui' },
  choco: { label: 'Chocolatey', bootstrap: '', hint: 'See https://chocolatey.org/install (needs an elevated PowerShell)', admin: 'uac' },
  'apt-get': { label: 'apt', bootstrap: '', hint: 'This machine has no apt', admin: 'sudo' },
  dnf: { label: 'dnf', bootstrap: '', hint: 'This machine has no dnf', admin: 'sudo' },
  pacman: { label: 'pacman', bootstrap: '', hint: 'This machine has no pacman', admin: 'sudo' },
  apk: { label: 'apk', bootstrap: '', hint: 'This machine has no apk', admin: 'sudo' },
  curl: { label: 'curl', bootstrap: '', hint: 'Install curl with your package manager, e.g. sudo apt-get install -y curl', admin: 'sudo' },
  npm: { label: 'npm', bootstrap: '', hint: 'npm ships with Node; fix the Node row first', admin: 'none' },
  uv: { label: 'uv', bootstrap: 'curl -LsSf https://astral.sh/uv/install.sh | sh', hint: 'See https://astral.sh/uv', admin: 'none' },
}

const MANAGER_BINS = Object.keys(MANAGERS)

// Probe the platform for the tools a recipe might need. Never throws.
function detectInstaller(probe = which) {
  const available = new Set(MANAGER_BINS.filter((b) => probe(b)))
  let sudo = 'unavailable'
  if (PLATFORM === 'win32') {
    sudo = 'n/a'
  } else if (typeof process.getuid === 'function' && process.getuid() === 0) {
    sudo = 'root'
  } else if (probe('sudo')) {
    sudo = run('sudo', ['-n', 'true'], 5000).ok ? 'passwordless' : 'password-required'
  }
  return { platform: PLATFORM, available, sudo }
}

function pasteLine(candidate) {
  const joiner = candidate.shell === 'powershell' ? '; ' : ' && '
  return candidate.steps.join(joiner)
}

// Pick the concrete candidate for this platform. Returns a candidate whenever
// the platform has one at all, even if it cannot be run here. An unrunnable
// candidate is still the exact line the user needs, which is the whole point.
function resolveInstallCommand(check, installer) {
  const install = check.install
  if (!install) return { found: false, reason: 'no install metadata', manualReason: '' }
  const candidates = (install.candidates || []).filter((c) => c.platform === installer.platform)
  if (candidates.length === 0) {
    return { found: false, reason: `no recipe for ${installer.platform}`, manualReason: install.manualReason || '' }
  }
  const runnable = candidates.find((c) => !c.requires || installer.available.has(c.requires))
  if (runnable) {
    return { found: true, runnable: true, candidate: runnable, paste: pasteLine(runnable), manualReason: install.manualReason || '' }
  }
  // Nothing is satisfied. The first candidate is the platform's preferred route,
  // so report it plus what is missing to unlock it.
  const fallback = candidates[0]
  const blockedBy = fallback.requires
  const mgr = MANAGERS[blockedBy] || {}
  return {
    found: true,
    runnable: false,
    candidate: fallback,
    paste: pasteLine(fallback),
    blockedBy,
    bootstrap: mgr.bootstrap || '',
    bootstrapHint: mgr.hint || '',
    manualReason: install.manualReason || '',
  }
}

// Every missing tool that has a recipe. NOT filtered by tier: that filter is the
// exact hole that stopped forge's fixer from ever installing git.
function installTargets(entries) {
  return entries.filter((e) => e.row.missing && e.def.install && (e.def.install.candidates || []).length > 0)
}

// Can this candidate run here without a prompt anyone has to answer?
function attemptable(candidate, installer) {
  if (candidate.admin === 'none') return { ok: true }
  if (candidate.admin === 'sudo') {
    if (installer.sudo === 'root') return { ok: true }
    if (installer.sudo === 'passwordless') return { ok: true }
    return { ok: false, why: 'needs a sudo password' }
  }
  if (candidate.admin === 'uac') return { ok: false, why: 'needs an elevated PowerShell' }
  return { ok: false, why: 'needs a GUI step' }
}

// `sudo` is written into the recipes because that is what a human pastes. Before
// we run one we either drop it (already root, and containers often have no sudo
// binary at all) or force -n so it fails fast instead of waiting on a password.
function applySudo(step, installer) {
  if (installer.sudo === 'root') return step.replace(/\bsudo\s+/g, '')
  return step.replace(/\bsudo\s+/g, 'sudo -n ')
}

function shellInvocation(step, shell) {
  if (shell === 'powershell') return { cmd: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', step] }
  return { cmd: 'sh', args: ['-c', step] }
}

const INSTALL_ENV = {
  ...process.env,
  DEBIAN_FRONTEND: 'noninteractive',
  NEEDRESTART_MODE: 'a',
  NONINTERACTIVE: '1',
  HOMEBREW_NO_AUTO_UPDATE: '1',
  HOMEBREW_NO_INSTALL_CLEANUP: '1',
}

// Spawn and stream, so a long install visibly moves. stdin is closed, so nothing
// downstream can block on input. Keeps the last 4KB of each stream for the report.
function runStreaming(cmd, args, timeoutMs, onOutput) {
  return new Promise((resolve) => {
    let proc
    try {
      proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: INSTALL_ENV })
    } catch (err) {
      resolve({ ok: false, stdout: '', stderr: '', reason: `spawn failed: ${err.message}` })
      return
    }
    let stdoutTail = ''
    let stderrTail = ''
    const CAP = 4096
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        proc.kill('SIGKILL')
      } catch {}
    }, timeoutMs)
    proc.stdout.on('data', (c) => {
      const s = c.toString('utf8')
      onOutput(s)
      stdoutTail = (stdoutTail + s).slice(-CAP)
    })
    proc.stderr.on('data', (c) => {
      const s = c.toString('utf8')
      onOutput(s)
      stderrTail = (stderrTail + s).slice(-CAP)
    })
    proc.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, stdout: stdoutTail, stderr: stderrTail, reason: err.message })
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) resolve({ ok: false, stdout: stdoutTail, stderr: stderrTail, reason: `timed out after ${Math.round(timeoutMs / 1000)}s` })
      else if (code === 0) resolve({ ok: true, stdout: stdoutTail, stderr: stderrTail })
      else resolve({ ok: false, stdout: stdoutTail, stderr: stderrTail, reason: `exit code ${code}` })
    })
  })
}

// --- Install recipes --------------------------------------------------------
// A candidate: { platform, id, admin, requires, shell?, steps[], after? }.
// `requires` is a binary that must already exist. `steps` are shell lines, run in
// order, and joined into the paste line. `admin` decides whether we run it.
// The tested-clean set is deliberately small: uv, fnm into ~/.local/bin, scoop on
// Windows, and brew only when brew is already there. Everything else is a paste line.

// --force-no-brew is load-bearing on macOS: without it fnm's own installer shells
// out to `brew install fnm` and aborts on a machine with no Homebrew, which is
// exactly the machine this route exists for. Found by running it.
const FNM_INSTALL = 'curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir "$HOME/.local/bin" --skip-shell --force-no-brew'
const FNM_AFTER = 'Add `eval "$(fnm env --use-on-cd)"` to your shell profile, or put ~/.local/share/fnm/aliases/default/bin on PATH.'
const UV_INSTALL = 'curl -LsSf https://astral.sh/uv/install.sh | sh'

const NODE_INSTALL = {
  candidates: [
    { platform: 'darwin', id: 'brew', admin: 'none', requires: 'brew', steps: ['brew install node'] },
    { platform: 'darwin', id: 'fnm', admin: 'none', requires: 'curl', steps: [FNM_INSTALL, '"$HOME/.local/bin/fnm" install 22', '"$HOME/.local/bin/fnm" alias 22 default'], after: FNM_AFTER },
    { platform: 'linux', id: 'fnm', admin: 'none', requires: 'curl', steps: [FNM_INSTALL, '"$HOME/.local/bin/fnm" install 22', '"$HOME/.local/bin/fnm" alias 22 default'], after: FNM_AFTER },
    { platform: 'linux', id: 'apt', admin: 'sudo', requires: 'apt-get', steps: ['sudo apt-get update', 'sudo apt-get install -y nodejs npm'], after: 'Distro packages lag; if this lands below Node 22, use the fnm route instead.' },
    { platform: 'linux', id: 'dnf', admin: 'sudo', requires: 'dnf', steps: ['sudo dnf install -y nodejs npm'] },
    { platform: 'linux', id: 'pacman', admin: 'sudo', requires: 'pacman', steps: ['sudo pacman -S --noconfirm nodejs npm'] },
    { platform: 'linux', id: 'apk', admin: 'sudo', requires: 'apk', steps: ['sudo apk add --no-cache nodejs npm'] },
    { platform: 'win32', id: 'scoop', admin: 'none', requires: 'scoop', shell: 'powershell', steps: ['scoop install nodejs-lts'] },
    { platform: 'win32', id: 'winget', admin: 'uac', requires: 'winget', shell: 'powershell', steps: ['winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements'] },
  ],
}

const GIT_INSTALL = {
  candidates: [
    { platform: 'darwin', id: 'brew', admin: 'none', requires: 'brew', steps: ['brew install git'] },
    { platform: 'darwin', id: 'xcode-clt', admin: 'gui', requires: null, steps: ['xcode-select --install'], after: 'macOS shows a dialog; accept it, then rerun the doctor.' },
    { platform: 'linux', id: 'apt', admin: 'sudo', requires: 'apt-get', steps: ['sudo apt-get update', 'sudo apt-get install -y git'] },
    { platform: 'linux', id: 'dnf', admin: 'sudo', requires: 'dnf', steps: ['sudo dnf install -y git'] },
    { platform: 'linux', id: 'pacman', admin: 'sudo', requires: 'pacman', steps: ['sudo pacman -S --noconfirm git'] },
    { platform: 'linux', id: 'apk', admin: 'sudo', requires: 'apk', steps: ['sudo apk add --no-cache git'] },
    { platform: 'win32', id: 'scoop', admin: 'none', requires: 'scoop', shell: 'powershell', steps: ['scoop install git'] },
    { platform: 'win32', id: 'winget', admin: 'uac', requires: 'winget', shell: 'powershell', steps: ['winget install --id Git.Git --silent --accept-source-agreements --accept-package-agreements'] },
  ],
}

// The apt route is GitHub's own keyring script, because `gh` is not in Debian or
// Ubuntu's default repositories on the releases most people are running.
const GH_APT = '(type -p wget >/dev/null || (sudo apt-get update && sudo apt-get install wget -y)) && sudo mkdir -p -m 755 /etc/apt/keyrings && wget -nv -O/tmp/githubcli.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg && sudo install -o root -g root -m 644 /tmp/githubcli.gpg /etc/apt/keyrings/githubcli-archive-keyring.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null && sudo apt-get update && sudo apt-get install gh -y'

const GH_INSTALL = {
  candidates: [
    { platform: 'darwin', id: 'brew', admin: 'none', requires: 'brew', steps: ['brew install gh'] },
    { platform: 'linux', id: 'apt', admin: 'sudo', requires: 'apt-get', steps: [GH_APT], label: 'apt (GitHub keyring)' },
    { platform: 'linux', id: 'dnf', admin: 'sudo', requires: 'dnf', steps: ['sudo dnf install -y gh'] },
    { platform: 'linux', id: 'pacman', admin: 'sudo', requires: 'pacman', steps: ['sudo pacman -S --noconfirm github-cli'] },
    { platform: 'linux', id: 'apk', admin: 'sudo', requires: 'apk', steps: ['sudo apk add --no-cache github-cli'] },
    { platform: 'win32', id: 'scoop', admin: 'none', requires: 'scoop', shell: 'powershell', steps: ['scoop install gh'] },
    { platform: 'win32', id: 'winget', admin: 'uac', requires: 'winget', shell: 'powershell', steps: ['winget install --id GitHub.cli --silent --accept-source-agreements --accept-package-agreements'] },
  ],
}

// The native installer, verified live. Node cannot install Node and this file is
// Node, so the CLI recipe only ever matters to someone who already has a runtime.
const CLAUDE_INSTALL = {
  candidates: [
    { platform: 'darwin', id: 'native', admin: 'none', requires: 'curl', steps: ['curl -fsSL https://claude.ai/install.sh | bash'] },
    { platform: 'linux', id: 'native', admin: 'none', requires: 'curl', steps: ['curl -fsSL https://claude.ai/install.sh | bash'] },
    { platform: 'win32', id: 'native', admin: 'none', requires: null, shell: 'powershell', steps: ['irm https://claude.ai/install.ps1 | iex'] },
  ],
}

const UV_TOOL_INSTALL = {
  candidates: [
    { platform: 'darwin', id: 'astral', admin: 'none', requires: 'curl', steps: [UV_INSTALL] },
    { platform: 'linux', id: 'astral', admin: 'none', requires: 'curl', steps: [UV_INSTALL] },
    { platform: 'win32', id: 'astral', admin: 'none', requires: null, shell: 'powershell', steps: ['irm https://astral.sh/uv/install.ps1 | iex'] },
  ],
}

const PYTHON_INSTALL = {
  candidates: [
    { platform: 'darwin', id: 'uv', admin: 'none', requires: 'uv', steps: ['uv python install 3.12'] },
    { platform: 'darwin', id: 'brew', admin: 'none', requires: 'brew', steps: ['brew install python@3.12'] },
    { platform: 'darwin', id: 'uv-bootstrap', admin: 'none', requires: 'curl', steps: [UV_INSTALL, '"$HOME/.local/bin/uv" python install 3.12'] },
    { platform: 'linux', id: 'uv', admin: 'none', requires: 'uv', steps: ['uv python install 3.12'] },
    { platform: 'linux', id: 'uv-bootstrap', admin: 'none', requires: 'curl', steps: [UV_INSTALL, '"$HOME/.local/bin/uv" python install 3.12'] },
    { platform: 'linux', id: 'apt', admin: 'sudo', requires: 'apt-get', steps: ['sudo apt-get update', 'sudo apt-get install -y python3 python3-venv'] },
    { platform: 'win32', id: 'scoop', admin: 'none', requires: 'scoop', shell: 'powershell', steps: ['scoop install python'] },
    { platform: 'win32', id: 'uv-bootstrap', admin: 'none', requires: null, shell: 'powershell', steps: ['irm https://astral.sh/uv/install.ps1 | iex', 'uv python install 3.12'] },
  ],
}

const NPM_GLOBAL = (pkg) => ({
  candidates: ['darwin', 'linux', 'win32'].map((p) => ({
    platform: p,
    id: 'npm',
    admin: 'none',
    requires: 'npm',
    shell: p === 'win32' ? 'powershell' : 'sh',
    steps: [`npm i -g ${pkg}`],
  })),
})

const PATH_DIRS = {
  node: ['~/.local/bin', '~/.local/share/fnm/aliases/default/bin', '/opt/homebrew/bin', '/usr/local/bin', '~/scoop/shims'],
  cli: ['~/.local/bin', '/opt/homebrew/bin', '/usr/local/bin', '~/scoop/shims'],
  python: ['~/.local/bin', '~/.local/share/uv/python', '/opt/homebrew/bin', '~/scoop/shims'],
}

// --- Project-type model -----------------------------------------------------
// A scaffolded project records its target in .claude/builder-kit.json, e.g.
//   { "projectType": "web" | "ios" | "agent", ... }
// The doctor runs the SHARED checks for every type, then appends the checks for
// that type's toolchain. A missing, unreadable, or unknown config falls back to
// "web" so existing (pre-type) projects behave exactly as before. The agent
// branch also reads two optional flat keys when present: "runtime" ("node" |
// "python") and "host" (the deploy-target CLI command, e.g. the agent host).
const KNOWN_TYPES = ['web', 'ios', 'agent']

function loadConfig() {
  const path = '.claude/builder-kit.json'
  if (!existsSync(path)) return { projectType: 'web', unset: true, source: 'not scaffolded yet (no .claude/builder-kit.json)', raw: {} }
  // The try wraps ONLY the read + parse, so a real bug elsewhere can never be
  // silently swallowed and disguised as an "invalid JSON" web fallback.
  let raw
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return { projectType: 'web', source: '.claude/builder-kit.json (invalid JSON, treating as web)', raw: {} }
  }
  const declared = raw && raw.projectType
  const pt = String(declared || 'web').toLowerCase()
  if (!KNOWN_TYPES.includes(pt)) {
    return { projectType: 'web', source: `.claude/builder-kit.json (unknown projectType "${declared}", treating as web)`, raw: raw && typeof raw === 'object' ? raw : {} }
  }
  return { projectType: pt, source: '.claude/builder-kit.json', raw: raw && typeof raw === 'object' ? raw : {} }
}

function agentRuntime(raw) {
  const r = String((raw && raw.runtime) || 'node').toLowerCase()
  return /^(py|python|uv)/.test(r) ? 'python' : 'node'
}

function agentHost(raw) {
  const h = raw && raw.host
  return h ? String(h) : ''
}

function describeType(cfg) {
  // Outside a project there is no answer yet, and printing "web" to someone standing
  // on the iOS or agent track contradicts the page they are reading. The CHECKS still
  // fall back to web (they have to run something); the LINE says what is true.
  if (cfg.unset) return 'not yet chosen (running the shared web checks until it is)'
  if (cfg.projectType !== 'agent') return cfg.projectType
  const host = agentHost(cfg.raw)
  return `agent (runtime: ${agentRuntime(cfg.raw)}, host: ${host || 'not declared'})`
}

// Per-type toolchain checks, appended to the shared CHECKS. Each has the same
// shape as a CHECKS entry, so the existing probe loop, tiering, and output
// handle them unchanged. Only core failures affect the ready verdict, so the web
// branch stays non-core (preserving the exact pre-type behaviour).
function typeChecks(cfg) {
  if (cfg.projectType === 'ios') return iosChecks()
  if (cfg.projectType === 'agent') return agentChecks(cfg.raw)
  return webChecks()
}

function webChecks() {
  return [
    {
      tier: 'recommended', name: 'Vercel CLI', fix: 'Install with `npm i -g vercel` (only needed to deploy via the ship skill).',
      install: NPM_GLOBAL('vercel'), pathDirs: PATH_DIRS.cli,
      probe() {
        const r = run('vercel', ['--version'])
        if (!r.ok) return { status: 'warn', found: 'not found', missing: true, note: 'needed only to deploy (ship); local build and dev do not require it' }
        return { status: 'ok', found: firstVersion(r.out) ? `v${firstVersion(r.out)}` : 'present' }
      },
    },
  ]
}

function iosChecks() {
  const isMac = PLATFORM === 'darwin'
  return [
    {
      tier: 'core', name: 'Xcode (xcodebuild)',
      fix: isMac ? 'Install Xcode from the App Store, run `xcode-select --install`, then open Xcode once to accept the licence.' : 'iOS builds require macOS with Xcode; this machine is not macOS.',
      install: {
        manualReason: 'Xcode is an App Store install that needs an Apple ID and a licence acceptance, and it exists only on macOS. No package manager can do it unattended.',
        candidates: [{ platform: 'darwin', id: 'xcode-clt', admin: 'gui', requires: null, steps: ['xcode-select --install'], after: 'Command Line Tools only. The full Xcode still comes from the App Store.' }],
      },
      probe() {
        if (!isMac) return { status: 'fail', found: 'not macOS', note: 'iOS builds require macOS + Xcode' }
        const r = run('xcodebuild', ['-version'])
        if (!r.ok) return { status: 'fail', found: 'not found', missing: true, note: 'install Xcode and its Command Line Tools' }
        return { status: 'ok', found: (r.out.split('\n')[0] || 'present').trim() }
      },
    },
    {
      tier: 'core', name: 'Swift', fix: 'Ships with Xcode / Command Line Tools; install Xcode.',
      install: { manualReason: 'Swift ships inside Xcode and its Command Line Tools; there is nothing separate to install.' },
      probe() {
        if (!isMac) return { status: 'fail', found: 'not macOS' }
        const r = run('swift', ['--version'])
        if (!r.ok) return { status: 'fail', found: 'not found' }
        const m = r.out.match(/Swift version (\d+\.\d+(\.\d+)?)/i)
        return { status: 'ok', found: m ? `v${m[1]}` : (r.out.split('\n')[0] || 'present').trim() }
      },
    },
    {
      tier: 'recommended', name: 'iOS Simulator', fix: 'Open Xcode, then Settings, then Components, and download a simulator runtime.',
      install: { manualReason: 'Simulator runtimes are downloaded inside Xcode.' },
      probe() {
        if (!isMac) return { status: 'warn', found: 'not macOS' }
        const r = run('xcrun', ['simctl', 'list', 'devices', 'available'])
        if (!r.ok) return { status: 'warn', found: 'simctl unavailable', note: 'run `xcrun simctl list devices` to check' }
        // Available device lines carry a UUID in parens; `available` already
        // filters out devices whose runtime is missing, so these are bootable.
        const devices = r.out.split('\n').filter((l) => /\([0-9A-Fa-f-]{36}\)/.test(l))
        if (devices.length === 0) return { status: 'warn', found: 'none installed', note: 'no bootable simulator; add one in Xcode' }
        const booted = devices.filter((l) => /\(Booted\)/.test(l)).length
        return { status: 'ok', found: `${devices.length} bootable${booted ? `, ${booted} booted` : ''}` }
      },
    },
    {
      tier: 'optional', name: 'fastlane', fix: 'Optional: `brew install fastlane` (used by ship for TestFlight / App Store upload).',
      install: {
        manualReason: 'fastlane targets macOS; on other platforms there is nothing to install.',
        candidates: [{ platform: 'darwin', id: 'brew', admin: 'none', requires: 'brew', steps: ['brew install fastlane'] }],
      },
      probe() {
        const r = run('fastlane', ['--version'])
        if (!r.ok) return { status: 'warn', found: 'not found', missing: true, note: 'optional; needed only for automated TestFlight / App Store upload' }
        return { status: 'ok', found: firstVersion(r.out) ? `v${firstVersion(r.out)}` : 'present' }
      },
    },
  ]
}

function agentChecks(raw) {
  const checks = []
  // Runtime. Node is already a shared CORE check (Claude Code and the plugin's
  // own scripts need it), so a Node agent adds no duplicate row. A Python agent
  // adds Python 3 as core and uv as recommended.
  if (agentRuntime(raw) === 'python') {
    checks.push({
      tier: 'core', name: 'Python 3 (agent runtime)', fix: 'Install Python 3.11+ (uv, python.org, or your package manager).',
      install: PYTHON_INSTALL, pathDirs: PATH_DIRS.python,
      probe() {
        let r = run('python3', ['--version'])
        if (!r.ok) r = run('python', ['--version'])
        if (!r.ok) return { status: 'fail', found: 'not found', missing: true }
        return { status: 'ok', found: firstVersion(r.out) ? `v${firstVersion(r.out)}` : r.out.trim() }
      },
    })
    checks.push({
      tier: 'recommended', name: 'uv (Python runner)', fix: 'Install uv (astral.sh/uv), the runner the agent template uses; pip/venv also works.',
      install: UV_TOOL_INSTALL, pathDirs: PATH_DIRS.cli,
      probe() {
        const r = run('uv', ['--version'])
        if (!r.ok) return { status: 'warn', found: 'not found', missing: true, note: 'recommended; pip/venv also works' }
        return { status: 'ok', found: firstVersion(r.out) ? `v${firstVersion(r.out)}` : 'present' }
      },
    })
  }
  // Declared host CLI (the deploy target). Read from the optional "host" key.
  const host = agentHost(raw)
  if (host) {
    checks.push({
      tier: 'recommended', name: `Agent host CLI (${host})`, fix: `Install the '${host}' CLI (the deploy target); needed for the ship skill.`,
      install: { manualReason: `"${host}" is declared in .claude/builder-kit.json; the kit does not know its installer. Follow that tool's own install docs.` },
      probe() {
        const p = probeCmd(host)
        if (!p.present) return { status: 'warn', found: 'not found', note: `declared host "${host}" is not on PATH; needed to deploy` }
        return { status: 'ok', found: p.version }
      },
    })
  } else {
    checks.push({
      tier: 'recommended', name: 'Agent host CLI', fix: 'Add a "host" key to .claude/builder-kit.json (the deploy-target CLI command) so ship/deploy checks can run.',
      install: { manualReason: 'No host declared, so there is nothing to install yet.' },
      probe() {
        return { status: 'warn', found: 'not declared', note: 'set "host" in .claude/builder-kit.json to check the deploy target' }
      },
    })
  }
  return checks
}

// A check: { tier, name, probe(): {status:'ok'|'warn'|'fail', found, note, missing}, fix, install?, pathDirs? }
const CHECKS = [
  {
    tier: 'core', name: 'Node.js (>= 22)', fix: 'Install Node 22 LTS+ from nodejs.org (or fnm/nvm/volta).',
    install: NODE_INSTALL, pathDirs: PATH_DIRS.node,
    probe() {
      const r = run('node', ['--version'])
      const v = firstVersion(r.out)
      const major = Number(v.split('.')[0] || 0)
      if (!r.ok || !v) return { status: 'fail', found: 'not found', missing: true }
      // Below the floor is a CORE fail, not a warning — current stacks (Next.js 16,
      // Vite, etc.) need Node 22+, so "ready" would be a lie on Node 18/20.
      return { status: major >= 22 ? 'ok' : 'fail', found: `v${v}`, missing: major < 22, note: major >= 22 ? '' : 'below the Node 22 floor — upgrade before building' }
    },
  },
  {
    tier: 'core', name: 'git', fix: 'Install git (git-scm.com, Homebrew, WinGet, or your package manager).',
    install: GIT_INSTALL, pathDirs: PATH_DIRS.cli,
    probe() {
      const r = run('git', ['--version'])
      if (!r.ok) return { status: 'fail', found: 'not found', missing: true }
      const repo = run('git', ['rev-parse', '--is-inside-work-tree']).ok
      return { status: 'ok', found: r.out.replace('git version ', 'v'), note: repo ? 'inside a git repo' : 'not a git repo yet' }
    },
  },
  {
    tier: 'core', name: 'GitHub CLI (gh) + auth', fix: 'Install gh (cli.github.com) then `gh auth login`.',
    install: GH_INSTALL, pathDirs: PATH_DIRS.cli,
    probe() {
      const r = run('gh', ['--version'])
      if (!r.ok) return { status: 'fail', found: 'not found', missing: true }
      const authed = run('gh', ['auth', 'status']).ok
      return { status: authed ? 'ok' : 'warn', found: firstVersion(r.out) ? `v${firstVersion(r.out)}` : 'present', note: authed ? 'authenticated' : 'installed but NOT authenticated — run `gh auth login`' }
    },
  },
  {
    // NOT a core failure. If this file is running then a Claude Code exists; a
    // Desktop user has no `claude` on PATH and their setup is perfectly fine.
    // The old row told them their working setup was broken.
    tier: 'session', name: 'Claude Code CLI', fix: 'Optional for Desktop users. For the terminal: `curl -fsSL https://claude.ai/install.sh | bash`.',
    install: CLAUDE_INSTALL, pathDirs: PATH_DIRS.cli,
    probe() {
      const r = run('claude', ['--version'])
      if (r.ok) return { status: 'ok', found: r.out.split('\n')[0] }
      const s = detectSurface()
      const desktopish = s.id === 'desktop' || s.id === 'non-terminal' || s.id === 'embedded'
      // `missing` is what --fix acts on, so it stays false on Desktop. Saying
      // "nothing to fix" and then installing a CLI they never asked for is the
      // same row contradicting itself.
      return {
        status: 'warn',
        found: 'not on PATH',
        missing: !desktopish,
        note: desktopish ? 'normal on Claude Desktop, which does not put a CLI on PATH. Nothing to fix.' : 'the terminal CLI is not installed; Desktop still works',
      }
    },
  },
  {
    tier: 'optional', name: 'Node package runner (npx)', fix: 'Ships with Node; if missing, reinstall Node.',
    install: { manualReason: 'npx ships with Node. Fixing the Node row fixes this one.' },
    probe() {
      const r = run('npx', ['--version'])
      return r.ok ? { status: 'ok', found: `v${firstVersion(r.out)}` } : { status: 'warn', found: 'not found' }
    },
  },
]

// --- Live-session checks ----------------------------------------------------
// The mechanical rows the guides are written against: is the plugin actually
// loaded, does an MCP server actually answer, can this machine actually commit
// and push. None of these install anything, so none carry a recipe. Two shell
// out to `claude`, which is slow, so --fast skips them.

function sessionChecks(opts) {
  // Memoised, and only paid for by the probes that need it: building the table
  // must stay side-effect free so lint-kit can read it without shelling out.
  let cliCache = null
  const claudeOnPath = () => {
    if (cliCache === null) cliCache = run('claude', ['--version'], 10000).ok
    return cliCache
  }
  return [
    {
      tier: 'session', name: 'builder-kit plugin loaded', blocking: true,
      fix: 'Install it: /plugin marketplace add jiffi-co/claude-plugins then /plugin install builder-kit@jiffi-claude-plugins. If it is installed and erroring, the error text below is the fix.',
      install: { manualReason: 'The plugin is installed through Claude Code itself, not a package manager.' },
      probe() {
        if (opts.fast) return { status: 'warn', found: 'skipped (--fast)' }
        if (!claudeOnPath()) return { status: 'warn', found: 'cannot check', note: 'no `claude` CLI here; check the plugin pane in Claude Desktop' }
        const r = run('claude', ['plugin', 'list', '--json'], 25000)
        if (!r.ok) return { status: 'warn', found: 'cannot check', note: '`claude plugin list --json` did not answer' }
        let list
        try {
          list = JSON.parse(r.out)
        } catch {
          return { status: 'warn', found: 'unreadable', note: 'could not parse `claude plugin list --json`' }
        }
        const p = Array.isArray(list) ? list.find((x) => String(x.id || '').startsWith('builder-kit@')) : null
        if (!p) return { status: 'warn', found: 'not installed', note: 'the kit is not installed as a plugin here' }
        // enabled:true with a non-empty errors array is the shape that breaks
        // silently: the plugin claims to be on and loads nothing.
        const errs = Array.isArray(p.errors) ? p.errors : []
        if (errs.length) return { status: 'fail', found: `installed but failed to load (${p.version || 'unknown'})`, note: errs[0].slice(0, 220) }
        if (!p.enabled) return { status: 'warn', found: 'installed but disabled', note: 'enable it in /plugin, then reload' }
        return { status: 'ok', found: `enabled (${p.version || 'unknown'})` }
      },
    },
    {
      tier: 'session', name: 'Docs MCP answers',
      fix: 'builder-kit bundles Context7 in .mcp.json. Enable the plugin, reload, and approve the server when Claude Code asks.',
      install: { manualReason: 'Ships in the plugin. Enable and reload rather than installing anything.' },
      probe() {
        if (opts.fast) return { status: 'warn', found: 'skipped (--fast)' }
        if (claudeOnPath()) {
          // `claude mcp list` health-checks every configured server, so a line
          // marked connected means the server answered, not merely that it is
          // named in a config file.
          const r = run('claude', ['mcp', 'list'], 45000)
          if (r.out) {
            const line = r.out.split('\n').find((l) => /context7/i.test(l))
            if (line && /connected/i.test(line)) return { status: 'ok', found: 'context7 answered a health check' }
            if (line) return { status: 'warn', found: 'configured but not connected', note: line.trim().slice(0, 160) }
            const anyConnected = r.out.split('\n').filter((l) => /connected/i.test(l)).length
            if (anyConnected) return { status: 'warn', found: `no context7; ${anyConnected} other server(s) answered`, note: 'enable builder-kit to get the docs MCP' }
            return { status: 'warn', found: 'no server answered', note: 'run /mcp in session to see why' }
          }
          return { status: 'warn', found: 'health check timed out', note: 'rerun, or check /mcp in session' }
        }
        // No CLI (Desktop). Fall back to "is it configured at all".
        const home = process.env.HOME || process.env.USERPROFILE || ''
        const candidates = ['.mcp.json', home && `${home}/.claude.json`, home && `${home}/.claude/.mcp.json`].filter(Boolean)
        for (const p of candidates) {
          try {
            if (existsSync(p) && /context7/i.test(readFileSync(p, 'utf8'))) return { status: 'warn', found: `configured in ${p}`, note: 'cannot health-check without the CLI; run /mcp in session' }
          } catch {}
        }
        return { status: 'warn', found: 'not detected', note: 'the plugin ships it; enable builder-kit + reload, or run /mcp to check' }
      },
    },
    {
      tier: 'session', name: 'git identity set', blocking: true,
      fix: 'git config --global user.name "Your Name" && git config --global user.email "you@example.com"',
      install: { manualReason: 'Two config lines, not an install. The kit will not guess your name.' },
      probe() {
        // Without git on PATH, `git config` fails for a reason that has nothing
        // to do with the identity. Saying "not set" there would be a lie, and
        // the core git row already carries the real problem.
        if (!run('git', ['--version']).ok) return { status: 'warn', found: 'cannot check', note: 'git is not on PATH; fix the core git row first' }
        const name = run('git', ['config', '--get', 'user.name'])
        const email = run('git', ['config', '--get', 'user.email'])
        if (!name.ok && !email.ok) return { status: 'fail', found: 'not set', note: 'every commit will fail until this is set' }
        if (!name.ok || !email.ok) return { status: 'fail', found: name.ok ? 'email missing' : 'name missing', note: 'commits fail without both' }
        return { status: 'ok', found: `${name.out} <${email.out}>` }
      },
    },
    {
      tier: 'session', name: 'gh scopes (repo, workflow)',
      fix: 'gh auth refresh -h github.com -s repo -s workflow',
      install: { manualReason: 'A scope grant, not an install.' },
      probe() {
        const v = run('gh', ['--version'])
        if (!v.ok) return { status: 'warn', found: 'gh not installed', note: 'see the core row above' }
        const r = run('gh', ['auth', 'status'], 25000)
        if (!r.ok) return { status: 'warn', found: 'not authenticated', note: 'run `gh auth login`' }
        const m = r.out.match(/Token scopes:([^\n]*)/i)
        if (!m) return { status: 'warn', found: 'scopes not reported', note: 'a fine-grained or app token; push and CI may still work' }
        const scopes = m[1].split(',').map((s) => s.replace(/['\s]/g, '')).filter(Boolean)
        const missing = ['repo', 'workflow'].filter((s) => !scopes.includes(s))
        if (missing.length) return { status: 'warn', found: scopes.join(', ') || 'none', note: `missing ${missing.join(' + ')}. CI setup pushes workflow files and needs both` }
        return { status: 'ok', found: scopes.join(', ') }
      },
    },
    {
      tier: 'session', name: 'git worktree',
      fix: 'Nothing to fix. Worktrees are supported; the note says what is per-worktree.',
      install: { manualReason: 'Informational.' },
      probe() {
        if (!run('git', ['rev-parse', '--is-inside-work-tree']).ok) {
          return {
            status: 'warn',
            found: 'not a git repo',
            note: 'the build loop commits every phase, so it needs one',
            // This row's own fix, not the worktree note's. They are two different
            // findings and only one of them is "nothing to fix".
            fix: '/builder-kit:start does this for you when you scaffold the project. To do it by hand: `git init -b main`.',
          }
        }
        // In a linked worktree --git-dir points at .git/worktrees/<name> while
        // --git-common-dir points at the main .git; in a normal checkout they
        // are the same directory. They must be compared as resolved paths: git
        // answers one absolute and the other relative from a subdirectory, so a
        // string compare calls every subdirectory a worktree.
        const gitDir = run('git', ['rev-parse', '--git-dir'])
        const common = run('git', ['rev-parse', '--git-common-dir'])
        if (!gitDir.ok || !common.ok) return { status: 'ok', found: 'repo' }
        const abs = (p) => {
          const full = resolve(process.cwd(), p)
          try {
            return realpathSync(full)
          } catch {
            return full
          }
        }
        const commonAbs = abs(common.out)
        if (abs(gitDir.out) !== commonAbs) {
          return { status: 'warn', found: 'linked worktree', note: `main checkout is ${dirname(commonAbs)}; node_modules, .env and .claude/settings.local.json are per-worktree, so install and configure them here too` }
        }
        return { status: 'ok', found: 'main checkout' }
      },
    },
  ]
}

// Project config checks — only meaningful inside a project.
const PROJECT = [
  { name: 'CLAUDE.md', path: 'CLAUDE.md', fix: 'Run /builder-kit:start to scaffold it.' },
  { name: 'AGENTS.md', path: 'AGENTS.md', fix: 'Run /builder-kit:start.' },
  { name: '.claude/settings.json (deny .env)', path: '.claude/settings.json', fix: 'Run /builder-kit:start, which writes the deny-.env rule.', check: (b) => /"deny"\s*:\s*\[[^\]]*\.env/.test(b) || /(Read|Bash)\([^)]*\.env/.test(b) },
  { name: 'docs/prd/', path: 'docs/prd', fix: 'Run the prd skill.' },
  { name: 'docs/adr/', path: 'docs/adr', fix: 'Run the create-adr skill.' },
  { name: 'docs/implementation-plan.md', path: 'docs/implementation-plan.md', fix: 'Run the implementation-plan skill.' },
]

// Every definition the kit can produce, for lint-kit's core-coverage assertion.
// Both agent runtimes and all three project types are included, because a check
// that only exists on someone else's machine still has to carry a recipe.
function allCheckDefinitions() {
  return [
    ...CHECKS,
    ...webChecks(),
    ...iosChecks(),
    ...agentChecks({ runtime: 'node' }),
    ...agentChecks({ runtime: 'python' }),
    ...sessionChecks({ fast: true }),
  ]
}

// Coverage report consumed by lint-kit assertion 8.
function installCoverage(defs = allCheckDefinitions()) {
  const seen = new Set()
  const out = []
  for (const d of defs) {
    if (seen.has(d.name)) continue
    seen.add(d.name)
    const cands = (d.install && d.install.candidates) || []
    out.push({
      name: d.name,
      tier: d.tier,
      manualReason: (d.install && d.install.manualReason) || '',
      platforms: {
        darwin: cands.some((c) => c.platform === 'darwin'),
        linux: cands.some((c) => c.platform === 'linux'),
        win32: cands.some((c) => c.platform === 'win32'),
      },
    })
  }
  return out
}

// --- Probe ------------------------------------------------------------------

// Something the fixer installed earlier is on disk but not on this shell's PATH.
// Reporting that as "not found" sends the user round the loop: install, rerun,
// told it is missing, install again. Find it, then say the one thing that fixes
// it. Only runs on the failure path, so the happy path costs nothing.
function findOffPath(def) {
  for (const dir of def.pathDirs || []) {
    const full = expandHome(dir)
    if (!existsSync(full)) continue
    const prev = process.env.PATH
    process.env.PATH = [full, prev].join(PLATFORM === 'win32' ? ';' : ':')
    let r
    try {
      r = def.probe()
    } finally {
      process.env.PATH = prev
    }
    if (r.status !== 'fail' && !r.missing) return { result: r, dir }
  }
  return null
}

// The probe every caller should use: a plain probe, then the off-PATH rescue.
// Used before a fix (so nothing is called missing when it is merely unreachable)
// and after one (so a tool installed into ~/.local/bin counts as installed).
function probeResolving(def) {
  const r = def.probe()
  if ((r.status === 'fail' || r.missing) && (def.pathDirs || []).length) {
    const found = findOffPath(def)
    if (found) {
      return {
        ...found.result,
        status: 'warn',
        missing: false,
        note: `installed in ${found.dir} but not on your PATH. Add it to your shell profile, or open a new terminal if you just installed it.`,
      }
    }
  }
  return r
}

function probeAll(config, opts) {
  const defs = [...CHECKS, ...sessionChecks(opts), ...typeChecks(config)]
  const entries = []
  for (const def of defs) {
    const r = probeResolving(def)
    entries.push({
      def,
      row: {
        tier: def.tier,
        name: def.name,
        status: r.status,
        found: r.found || '',
        note: r.note || '',
        missing: Boolean(r.missing),
        blocking: def.tier === 'core' || Boolean(def.blocking),
        // A probe may carry its own fix for the state it actually found. One row can
        // report two different things (this is not a repo / this is a linked worktree)
        // and a single row-level fix has to be wrong for one of them. It was: the one
        // row that was not green printed "Nothing to fix" underneath itself, to a
        // reader who had just been told to follow the fix beside any line not green.
        fix: r.status === 'ok' ? '' : r.fix || def.fix,
      },
    })
  }
  return entries
}

function projectRows() {
  const rows = []
  for (const p of PROJECT) {
    let status = 'warn'
    let found = 'missing'
    if (existsSync(p.path)) {
      if (p.check) {
        try {
          status = p.check(readFileSync(p.path, 'utf8')) ? 'ok' : 'warn'
          found = status === 'ok' ? 'present + rule set' : 'present but no .env deny rule'
        } catch {
          status = 'warn'
          found = 'present (unreadable)'
        }
      } else {
        status = 'ok'
        found = 'present'
      }
    }
    rows.push({ tier: 'project', name: p.name, status, found, note: '', missing: false, blocking: false, fix: status === 'ok' ? '' : p.fix })
  }
  return rows
}

// --- Fix --------------------------------------------------------------------

function bootstrapPath() {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  return join(root, '.claude', 'builder-kit', PLATFORM === 'win32' ? 'bootstrap.ps1' : 'bootstrap.sh')
}

// The one paste line has to actually work, so this script has to actually run.
// Two rules follow from that. Prerequisites are emitted as REAL steps, once each,
// before anything that needs them. A commented-out `brew` install above a
// `brew install node` is a script that fails on line one. And there is no
// `set -e`: the blocks are independent, and `xcode-select --install` exiting
// non-zero because the tools are already there must not kill the rest.
function writeBootstrap(deferred) {
  const path = bootstrapPath()
  const ps = PLATFORM === 'win32'
  const say = (s) => (ps ? `Write-Host "${s.replace(/"/g, "'")}"` : `echo "${s.replace(/"/g, "'")}"`)
  const lines = ps
    ? ['# builder-kit bootstrap: the steps the doctor would not run for you.', '# Read it, then run it. Steps are independent: one failing does not stop the rest.', '# Some steps need an elevated PowerShell (right-click, Run as Administrator).', '']
    : ['#!/usr/bin/env bash', '# builder-kit bootstrap: the steps the doctor would not run for you.', '# Read it, then run it. Steps are independent: one failing does not stop the rest.', '# It will ask for your password where a step needs one.', '']

  // Prerequisites first, deduplicated, each labelled with who needs it.
  const prereqs = new Map()
  for (const d of deferred) {
    if (!d.bootstrap) continue
    if (!prereqs.has(d.bootstrap)) prereqs.set(d.bootstrap, { name: d.blockedBy, needers: [] })
    prereqs.get(d.bootstrap).needers.push(d.name)
  }
  for (const [cmd, meta] of prereqs) {
    lines.push(say(`==> ${meta.name} (needed by: ${meta.needers.join(', ')})`), cmd, '')
  }

  for (const d of deferred) {
    lines.push(say(`==> ${d.name}`))
    lines.push(`# ${d.why}`)
    if (!d.bootstrap && d.bootstrapHint) lines.push(`# first you need ${d.blockedBy}: ${d.bootstrapHint}`)
    for (const s of d.steps) lines.push(s)
    if (d.after) lines.push(`# then: ${d.after}`)
    lines.push('')
  }
  lines.push(say('==> done. Rerun the doctor to confirm.'))

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${lines.join('\n')}\n`)
  if (!ps) {
    try {
      chmodSync(path, 0o755)
    } catch {}
  }
  return path
}

async function doFix(entries, opts, out) {
  const installer = detectInstaller()
  const targets = installTargets(entries)
  const results = []
  const deferred = []

  out(`\nfixer: platform ${installer.platform}, managers [${[...installer.available].join(', ') || 'none'}], sudo ${installer.sudo}\n`)
  if (targets.length === 0) out('nothing missing that the kit installs.\n')

  for (const t of targets) {
    const res = resolveInstallCommand(t.def, installer)
    if (!res.found) {
      results.push({ name: t.def.name, tier: t.def.tier, status: 'no-recipe', reason: res.reason, manualReason: res.manualReason })
      continue
    }
    const can = res.runnable ? attemptable(res.candidate, installer) : { ok: false, why: `needs ${res.blockedBy} first` }
    if (!can.ok) {
      const carry = {
        name: t.def.name,
        why: can.why,
        admin: res.candidate.admin,
        blockedBy: res.blockedBy || '',
        bootstrap: res.bootstrap || '',
        bootstrapHint: res.bootstrapHint || '',
        steps: res.candidate.steps,
        after: res.candidate.after || '',
        paste: res.paste,
      }
      deferred.push(carry)
      results.push({ ...carry, tier: t.def.tier, status: 'deferred', reason: can.why })
      continue
    }
    if (opts.dryRun) {
      results.push({ name: t.def.name, tier: t.def.tier, status: 'would-run', admin: res.candidate.admin, paste: res.paste })
      out(`  would run (${t.def.tier}) ${t.def.name}: ${res.paste}\n`)
      continue
    }
    out(`\n  installing ${t.def.name} via ${res.candidate.id} (${res.candidate.admin})\n`)
    let ok = true
    let reason = ''
    for (const rawStep of res.candidate.steps) {
      const step = applySudo(rawStep, installer)
      const inv = shellInvocation(step, res.candidate.shell || (PLATFORM === 'win32' ? 'powershell' : 'sh'))
      const r = await runStreaming(inv.cmd, inv.args, 10 * 60 * 1000, out)
      if (!r.ok) {
        ok = false
        reason = `${r.reason}: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' ')}`.slice(0, 300)
        break
      }
    }
    // Did it actually land? Re-probe the one row, including the dirs installers
    // write to, since a tool put in ~/.local/bin is not on this process's PATH.
    const after = ok ? probeResolving(t.def) : null
    const cleared = Boolean(after && after.status !== 'fail' && !after.missing)
    if (cleared) {
      // Update this row in place rather than re-probing everything: the session
      // rows shell out to `claude` and a second full pass costs half a minute.
      t.row.status = after.status
      t.row.found = after.found || ''
      t.row.missing = false
      t.row.fix = after.status === 'ok' ? '' : after.fix || t.def.fix
      t.row.note = after.note || 'installed just now'
    }
    results.push({
      name: t.def.name,
      tier: t.def.tier,
      status: ok && cleared ? 'installed' : 'failed',
      admin: res.candidate.admin,
      reason: ok ? (cleared ? '' : 'installed but still not detected') : reason,
      paste: res.paste,
      after: res.candidate.after || '',
    })
    if (ok && cleared && res.candidate.after) out(`  note: ${res.candidate.after}\n`)
  }

  // A read-only project directory must not take the whole run down: every
  // deferred step is printed individually anyway, so losing the file costs the
  // convenience, not the information.
  let bootstrap = ''
  let bootstrapError = ''
  if (deferred.length && !opts.dryRun) {
    try {
      bootstrap = writeBootstrap(deferred)
    } catch (err) {
      bootstrapError = err.message
      out(`\ncould not write the bootstrap script (${err.message}). The steps are listed below instead.\n`)
    }
  }
  return { installer: { platform: installer.platform, managers: [...installer.available], sudo: installer.sudo }, results, bootstrap, bootstrapError }
}

// --- Report -----------------------------------------------------------------

const ICON = { ok: '✅', warn: '⚠️ ', fail: '❌' }
const ORDER = { core: 0, session: 1, recommended: 2, optional: 3, project: 4 }

function printTable(rows, config, surface) {
  const sorted = [...rows].sort((a, b) => ORDER[a.tier] - ORDER[b.tier])
  console.log('\nbuilder-kit doctor')
  console.log(`  surface: ${surface.label}`)
  console.log(`  project type: ${describeType(config)}  (source: ${config.source})\n`)
  let lastTier = ''
  for (const r of sorted) {
    if (r.tier !== lastTier) {
      console.log(`  ${r.tier.toUpperCase()}`)
      lastTier = r.tier
    }
    const detail = [r.found, r.note].filter(Boolean).join(' — ')
    console.log(`    ${ICON[r.status] || ''} ${r.name.padEnd(30)} ${detail}${r.fix ? `\n         fix: ${r.fix}` : ''}`)
  }
  console.log('')
}

function printFix(fix) {
  const by = (s) => fix.results.filter((r) => r.status === s)
  const installed = by('installed')
  const failed = by('failed')
  const deferred = by('deferred')
  const wouldRun = by('would-run')
  const noRecipe = by('no-recipe')
  console.log('')
  if (installed.length) console.log(`installed: ${installed.map((r) => r.name).join(', ')}`)
  if (wouldRun.length) console.log(`would install: ${wouldRun.map((r) => r.name).join(', ')}`)
  if (failed.length) {
    console.log('\nfailed:')
    for (const r of failed) console.log(`  ${r.name}: ${r.reason}\n    retry by hand: ${r.paste}`)
  }
  if (noRecipe.length) {
    console.log('\nno recipe (do these by hand):')
    for (const r of noRecipe) console.log(`  ${r.name}: ${r.manualReason || r.reason}`)
  }
  if (deferred.length) {
    console.log('\nleft for you, because each needs a password, an elevated shell, a click, or a tool that is not here yet:')
    for (const r of deferred) {
      console.log(`  ${r.name}: ${r.reason}`)
      // Printing the install line alone would be a trap when the thing it needs
      // is itself missing, so the prerequisite goes first.
      const first = r.bootstrap || r.bootstrapHint
      if (first) console.log(`    1. get ${r.blockedBy}:  ${first}`)
      console.log(`    ${first ? '2. then:  ' : ''}${r.paste}`)
    }
    if (fix.bootstrap) console.log(`\nAll of it is written out here. One line, then rerun the doctor:\n\n  ${PLATFORM === 'win32' ? 'powershell -ExecutionPolicy Bypass -File' : 'bash'} ${fix.bootstrap}\n`)
  }
}

// --- Main -------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const opts = {
    json: args.includes('--json'),
    fix: args.includes('--fix'),
    dryRun: args.includes('--dry-run'),
    fast: args.includes('--fast'),
  }
  // With --json the installer's live output goes to stderr, so stdout stays a
  // single parseable document.
  const out = opts.json ? (s) => process.stderr.write(s) : (s) => process.stdout.write(s)

  const config = loadConfig()
  const surface = detectSurface()
  const entries = probeAll(config, opts)

  // doFix updates the rows it clears in place, so the table printed below is the
  // state after the fixer ran.
  const fix = opts.fix ? await doFix(entries, opts, out) : null

  const inProject = existsSync('docs') || existsSync('CLAUDE.md') || existsSync('.git')
  const rows = [...entries.map((e) => e.row), ...(inProject ? projectRows() : [])]
  const blockingFail = rows.filter((r) => r.blocking && r.status === 'fail')
  const coreFail = rows.filter((r) => r.tier === 'core' && r.status === 'fail').length

  if (opts.json) {
    console.log(JSON.stringify({
      ready: blockingFail.length === 0,
      projectType: config.projectType,
      platform: PLATFORM,
      surface,
      coreFail,
      blockingFail: blockingFail.length,
      checks: rows,
      fix,
    }, null, 2))
  } else {
    printTable(rows, config, surface)
    if (fix) printFix(fix)
    if (blockingFail.length === 0) {
      const warns = rows.filter((r) => r.status === 'warn').length
      console.log(`\n✅ Ready to build.${warns ? ` ${warns} recommended/optional item(s) to look at above.` : ''}`)
    } else if (fix) {
      // Saying "not ready" and exiting 0 would look like a contradiction. After a
      // fix run the remaining work is the list above, by design.
      console.log(`\n⚠️  Installed everything it could. ${blockingFail.length} item(s) still need you: the lines above, then rerun this.`)
    } else {
      const first = blockingFail[0]
      console.log(`\n❌ Not ready: fix "${first.name}" first. ${first.fix}`)
    }
  }

  // Exit contract. Plain run: non-zero when something BLOCKING failed (core
  // tooling, or a session row that stops the build loop dead). With --fix: the
  // fixer succeeded if everything it could attempt worked; items it deliberately
  // left for the user are reported, not failures.
  if (opts.fix) {
    const attemptFailed = fix.results.some((r) => r.status === 'failed')
    process.exit(attemptFailed ? 1 : 0)
  }
  process.exit(blockingFail.length === 0 ? 0 : 1)
}

const isEntryPoint = (() => {
  const argv1 = process.argv[1]
  if (!argv1) return false
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()

if (isEntryPoint) {
  main().catch((err) => {
    console.error(`doctor: ${err && err.stack ? err.stack : err}`)
    process.exit(1)
  })
}

export {
  CHECKS,
  MANAGERS,
  allCheckDefinitions,
  applySudo,
  attemptable,
  detectInstaller,
  detectSurface,
  installCoverage,
  installTargets,
  pasteLine,
  resolveInstallCommand,
  runStreaming,
}
