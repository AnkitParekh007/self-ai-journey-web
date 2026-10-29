# Claude Code and agent tooling

> Concepts only; check the official docs for current syntax and options.

| Feature | What it is | Use it for |
|---|---|---|
| CLAUDE.md | Always-loaded project guidance | Commands, contracts, invariants (no secrets) |
| Slash commands | Reusable prompts in `.claude/commands/*.md` | Daily brief, prepare application, etc. (this repo has eight) |
| Subagents | Specialised assistants with their own context and tools | Exploration, reviews, test triage |
| Skills | Packaged capabilities loaded on demand (SKILL.md + files) | Renderers, house-style procedures |
| Hooks | Deterministic commands on lifecycle events | Enforce rules that must never break |
| Permissions | Allow/deny rules and modes | Least privilege for teams |
| MCP servers | External tools/resources | Connect project 3's server |
| Agent SDK | The agent harness as a library | Building your own agents |

## Rules of thumb
- Put must-never-break rules in hooks/permissions, not only in prose.
- Keep CLAUDE.md short; link to docs.
- Subagents for self-contained tasks with a clear deliverable.
- Review agent diffs like a colleague's PR.
- A chat subscription is not an API entitlement; SDK and API usage are billed as API usage unless the provider states otherwise.
