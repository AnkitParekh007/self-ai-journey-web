# Demonstration script (5 minutes)
1. Explain synthetic fixtures and that no model is required for tests.
2. Run the test suite: traversal, conflict and idempotency tests.
3. Connect the server to an MCP-capable host (optional) and ask: "Which reviews are due today?" → tool call → answer.
4. Ask the host to mark an application as applied → server returns a proposal, not a status change; explain why.
5. Simulate a concurrent edit and show the conflict response.
6. Walk through the threat model.
