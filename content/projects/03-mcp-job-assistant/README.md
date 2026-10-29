# Project 3 — MCP-enabled job & learning assistant with safe file operations

**Goal:** an MCP server (stdio first, optional Streamable HTTP) that lets an MCP host read and update a **synthetic** copy of this repository's data — applications, review events — safely. No model calls are needed to build or test it; integration with a real host is optional.

## Requirements
1. Tools: `list_applications(status?)`, `get_application(id)`, `list_due_reviews(limit)`, `record_review(questionId, grade)`, `propose_status_change(id, status, note)`.
2. Resources: `saj://profile/evidence` (read-only, synthetic), `saj://application/{id}`.
3. Prompt: `daily_brief` template.
4. Safety: root confinement (reject `..`, absolute paths, symlinks out of root), schema validation with the project's Zod schemas, atomic writes, revision checks (expected blob SHA), append-only event batches, **no delete tool**, `propose_status_change` writes a *proposal* file — it never marks anything submitted.
5. Logging: every tool call appended to an audit log (tool, args hash, result, time).
6. Tests: traversal attempts, invalid arguments, concurrent edit detection (simulated browser write between read and write), idempotent `record_review` with a client-supplied event ID.
7. Optional: Streamable HTTP transport bound to 127.0.0.1 with Origin validation.

## Interview competencies
MCP primitives, tool design, transports, authorization boundaries, prompt-injection awareness, safe file operations, concurrency.
