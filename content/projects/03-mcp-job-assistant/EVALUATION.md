# Evaluation criteria
| Area | Pass condition |
|---|---|
| Confinement | `../`, absolute, symlink-escape and NUL-byte paths rejected (tests) |
| Validation | Invalid grades/statuses rejected with actionable messages |
| Integrity | Interrupted write leaves either old or new file (journal test) |
| Concurrency | Concurrent edit returns `conflict`; no lost update |
| Idempotency | Same event ID twice → one event |
| Safety | No tool can delete files or mark an application submitted |
| Audit | Every call logged |
