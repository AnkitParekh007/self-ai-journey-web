# AI interfaces: streaming, cancellation, approvals

## State machine, not booleans
`idle → submitting → streaming(text) → tool(waiting|approval) → done(citations) | cancelled(partial) | error(kind, retryable)`

## Transport
Default: `fetch` + `text/event-stream` (POST bodies, headers, AbortController). EventSource is GET-only without custom headers. WebSockets for true bidirectional sessions. Watch proxy buffering; send heartbeats.

## Parsing
Buffer across chunks; split on blank lines for SSE; decode with a streaming TextDecoder; parse each complete event; never act on partial JSON.

## Cancellation
One AbortController per request; abort on stop/new request/navigation; server stops upstream generation on disconnect; keep partial text marked "stopped"; cancelled ≠ error.

## Approvals
Consequence-first plan cards (action, target, values, reversible?), equal-weight approve/reject, no timers, keyboard accessible, progress per step, stop always available. Model text never styled as system UI.

## Errors
Specific copy per class: connection lost (retry, partial kept), rate limit (countdown), refusal (honest), tool failure (what changed / didn't), unknown (reference ID).

## Accessibility
Polite live region for state changes, not tokens; transcript as a log/list; focus stays with the user; reduced motion respected.

## Trust
Inline passage-level citations; unsupported claims flagged; no uncalibrated confidence percentages.
