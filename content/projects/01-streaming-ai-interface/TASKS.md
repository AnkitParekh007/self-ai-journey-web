# Implementation tasks

1. Mock server: scenarios, SSE writer with `res.write` backpressure, disconnect handling, heartbeat comment every 15 s. (2 h)
2. SSE parser: buffer, split on blank line, multi-line `data:`, streaming TextDecoder; unit tests incl. split UTF-8. (1.5 h)
3. Reducer + types with exhaustive `assertNever`; unit tests for every transition. (1.5 h)
4. ChatView: input, transcript (role="log"), stop button, live region. (2 h)
5. Approval card with plan rendering and approve/reject endpoints. (1.5 h)
6. Error UX per kind; countdown for rate limit; retry keeps the prompt. (1 h)
7. Citations chips + source drawer with fixture documents. (1 h)
8. Playwright tests: stop keeps partial text; approve runs tool; reject leaves data unchanged; drop → retry. (2 h)
9. README polish, screenshots, demo script dry run. (1 h)
