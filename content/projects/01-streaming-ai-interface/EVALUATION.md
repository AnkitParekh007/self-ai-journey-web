# Evaluation criteria

| Area | Pass condition |
|---|---|
| Cancellation | After Stop, the server logs "client closed, scenario stopped" within 200 ms; UI shows partial text + "Stopped"; no error toast |
| Parser | Tests cover chunk boundaries inside events and inside multi-byte characters |
| State | No boolean flags for status; exhaustive switch compiles; illegal states unrepresentable |
| Approval | Reject → no tool_result event; Approve → step results rendered; keyboard-only flow works |
| Errors | Each scenario shows its specific message; rate limit shows a countdown; retry re-sends the same prompt |
| Accessibility | axe has no violations; screen reader announces "responding", "complete", "stopped" once each |
| Determinism | All tests pass 20 runs in a row (no sleeps) |
| Labelling | UI shows "Mock provider" badge; no real API key in code or env |
