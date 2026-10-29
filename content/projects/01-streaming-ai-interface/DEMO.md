# Demonstration script (5 minutes)

1. "This is a streaming chat UI with a **mocked** provider — no API calls, deterministic scenarios." Point at the Mock badge.
2. Type `normal`: show token streaming and a citation chip; open the source.
3. Type `normal` again and press **Stop** halfway: partial text stays, marked Stopped; switch to the server terminal to show the scenario stopped.
4. Type `tool`: the approval card shows the plan (action, target, values, reversible). Press **Reject**: explain nothing changed. Repeat and **Approve**: step results render.
5. Type `drop`: connection-lost message, press Retry — same prompt resent.
6. Type `limit`: countdown, input preserved.
7. Show the reducer type and the Playwright run (`npx playwright test`).
8. Close with trade-offs: fetch+SSE vs WebSockets, why approvals are enforced server-side in a real system.
