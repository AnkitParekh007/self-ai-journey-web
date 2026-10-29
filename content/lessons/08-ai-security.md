# AI application security

## Assume the model can be steered
Prompt injection (direct or via documents, web pages, emails, tool results) cannot be fully prevented by wording. Design so a steered model cannot do serious harm.

| Layer | Controls |
|---|---|
| Privilege | Agent ≤ user permissions; user-scoped credentials; no secrets in context |
| Actions | Allowlisted tools, risk classes, approvals for writes and external sends |
| Output | Sanitise rendered Markdown, block remote images, CSP, no raw HTML |
| Data | Minimise and redact PII; tenant-partitioned retrieval and caches |
| Execution | Sandboxes: isolated, no network/metadata, resource limits, ephemeral |
| Supply chain | Pin models/tools/MCP servers/skills; review; evals on upgrades |
| Accountability | Append-only audit ledger, protected from the agent |

## Secrets in browser apps
Never in bundles (`VITE_*` variables are public), logs or prompts. If a static app must call an API, use a narrowly scoped token kept in memory only. This app: fine-grained GitHub token, one repository, memory only, verified private repository before writes, tests proving it never persists.

## Questions to ask in any design review
1. What can the model do if it is fully compromised by injected text?
2. Which actions are irreversible, and who approves them?
3. Where could private data leave the system (URLs, images, tools, logs)?
4. How would we know an incident happened, and reconstruct it?
