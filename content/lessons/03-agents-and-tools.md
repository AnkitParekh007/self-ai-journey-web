# Agents, tools and orchestration

## Start with the simplest thing
Single call → prompt chain → routing → parallel workers → orchestrator-workers → autonomous agent. Move right only when an eval shows the simpler pattern fails.

## Tool design checklist
- One clear job per tool; task-level beats raw primitives (`publish_sku` > `http_request`).
- Precise name, description with when/when-not, typed schema with enums.
- Concise structured output, stable IDs, pagination, truncated text.
- Actionable errors ("not found; try search_skus").
- Risk class: read vs write vs external send. Enforce in code.
- Idempotency keys for writes.

## Loop control
- Budgets: steps, tokens/cost, wall-clock.
- Repeat-action and no-progress detection.
- Explicit terminal states: done / needs input / failed(reason).
- The orchestrator enforces limits, not the model.

## Human in the loop
- Plans bound to concrete parameters (plan hash), approved by an authenticated user, with expiry.
- Server re-checks permissions and preconditions at execution.
- Verify each step after execution; re-plan on failure instead of blind retry.
- Audit ledger: who, what, when, plan, approvals, results.

## Durable runs
Persist a state machine per run (append-only events). Resume from the last verified step; streaming to the UI is a view over the ledger, so reconnects work. Aim for idempotent at-least-once.

## Error taxonomy
| Class | Response |
|---|---|
| Transient (timeout, 429) | Backoff retry, same idempotency key |
| Caller error | Return message to model for repair (capped) |
| Not found / conflict | Re-read state, re-plan |
| Forbidden | Stop that path, tell the user |
| Unknown outcome | Verify before anything else |

## Multi-agent: when it pays
Context isolation and true parallelism. Costs: tokens, latency, lossy hand-offs, harder tracing. Use structured hand-offs and trace the whole tree.
