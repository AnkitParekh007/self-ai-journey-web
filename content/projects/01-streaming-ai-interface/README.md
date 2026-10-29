# Project 1 — Streaming AI interface with cancellation, errors and tool approvals

**Goal:** a small, production-quality chat UI that streams a reply, can be stopped, shows specific errors, and asks for approval before a (mock) data-changing tool runs. Zero API cost: a mocked provider streams deterministic fixtures. **All mock behaviour is labelled in the UI.**

## Requirements
1. Stream tokens over `text/event-stream` from a local mock server (Node) using `fetch` + manual SSE parsing.
2. Explicit state machine (discriminated union): idle, submitting, streaming, tool-running, awaiting-approval, done, cancelled, error.
3. Stop button aborts the request (AbortController) **and** the mock server stops generating; partial text is kept and marked "stopped".
4. Error kinds with specific copy: connection lost mid-stream (retry), rate limit with retry-after (countdown), tool failure (what changed / did not).
5. Tool approval: the mock emits `approval_required` with a plan (action, target, values, reversible?). Approve/Reject are equal weight, keyboard accessible; no auto-approve.
6. Citations: `citation` events render as inline chips linking to a fixture source.
7. Accessibility: polite live region announces state changes (not tokens); focus management; visible focus; reduced motion.
8. Tests: unit tests for the parser (split chunks, multi-byte characters, multi-line data) and reducer; Playwright for stop, approve, reject, error retry.

## Non-goals
Real model calls (optional behind `REAL_PROVIDER=1` with a hard cost cap, disabled by default), auth, persistence beyond the session.

## Interview competencies
Streaming transports, cancellation propagation, UI state modelling, approval UX, accessible dynamic content, deterministic testing of AI features.

## Evidence to record (Learning → Skills & evidence, context: learning)
Repo link, test run, a short write-up with screenshots, the demo script below.
