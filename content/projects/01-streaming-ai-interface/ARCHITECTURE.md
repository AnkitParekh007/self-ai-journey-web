# Architecture

```
Browser (React or Angular, TypeScript)
  ChatView ──dispatch──▶ reducer(state, event)  ◀── SSE parser ◀── fetch(POST /chat, signal)
     │                                                          ▲
     └── ApprovalCard ── POST /runs/:id/approve|reject ─────────┘
Mock server (Node, no dependencies)
  POST /chat → scripted scenario by prompt keyword:
    "normal"   → token×N → citation → done
    "tool"     → token… → approval_required{plan} → (wait) → tool_result → done
    "drop"     → token… → socket destroyed mid-stream
    "limit"    → 429 + Retry-After: 5
    "toolfail" → approval → tool_error{changed:false}
  Honours backpressure; on client 'close' stops the scenario timer.
```

## Event protocol
| event | data |
|---|---|
| `token` | `{ "text": "…" }` |
| `citation` | `{ "id": "doc-2#p3", "title": "…" }` |
| `approval_required` | `{ "runId", "plan": [{ "action", "target", "values", "risk": "write", "reversible": true }] }` |
| `tool_result` / `tool_error` | `{ "step", "ok", "changed" }` |
| `done` | `{ "usage": { "outputTokens": 123 }, "mock": true }` |
| `error` | `{ "kind": "rate_limit" \| "server", "retryAfterSec"? }` |

## State (TypeScript)
```ts
type Chat =
  | { kind: 'idle' }
  | { kind: 'streaming'; text: string; citations: Cite[]; ctrl: AbortController }
  | { kind: 'approval'; text: string; runId: string; plan: Step[] }
  | { kind: 'done'; text: string; citations: Cite[] }
  | { kind: 'cancelled'; text: string }
  | { kind: 'error'; text: string; error: { kind: string; retryAfterSec?: number } };
```
