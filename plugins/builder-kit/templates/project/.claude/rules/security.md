# Security rules

- Never read, print, or commit `.env` files or secrets. Real values live in the environment, never in the repo.
- Reference secrets via `process.env` / `import.meta.env`, never inline.
- `.env.example` with placeholder values is the only env file that belongs in git.
- A secret found in client-side code, a client bundle, or git history is COMPROMISED, not merely misplaced. The exposed value is already live to anyone who fetched the page or cloned the repo. Remediation is revoke and rotate the key at the provider, then wire the new value through the server env. Relocating the leaked key to a server env var leaves the exposed value valid, so it is not a fix.
