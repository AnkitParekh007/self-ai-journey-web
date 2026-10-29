# Architecture

```
MCP host (any) ⇄ stdio JSON-RPC ⇄ server
  tools/        → handlers → validate args (Zod) → RepoStore (root-confined)
  resources/    → read-only views
  prompts/      → daily_brief
RepoStore: reuses scripts/lib/fs-store.ts semantics (atomic writes, journal, revision head)
Fixtures: tests/fixtures-project3/ synthetic data/ tree, reset before each test
```

Concurrency: each write includes the expected blob SHA of the file read; mismatch → `conflict` error telling the model to re-read. Event writes are new files (no conflicts).

Threat model highlights: tool descriptions are static (no user data); returned file content is wrapped and labelled as data; write tools require host confirmation; server has no network access.
