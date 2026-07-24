# Security rules

- Never read, print, or commit `.env` files or secrets. Real values live in the environment, never in the repo.
- Reference secrets via `process.env` / `import.meta.env`, never inline.
- `.env.example` with placeholder values is the only env file that belongs in git.
