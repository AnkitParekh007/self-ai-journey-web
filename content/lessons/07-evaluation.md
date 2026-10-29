# Evaluation and observability

## Dataset first
Start with 30–50 hand-written cases: main intents, edge cases, adversarial inputs, must-refuse cases. Each needs a checkable expectation. Every production failure becomes a case.

## Graders, cheapest first
1. Code checks: schema, required fields, IDs exist, numbers appear in sources.
2. Reference comparisons where ground truth exists.
3. LLM-as-judge with a specific rubric, calibrated against human labels; watch for verbosity and self-preference bias.
4. Human review samples.

## CI without pain
- Fast deterministic smoke set on every PR (replay/mocks).
- Real-model suite on prompt/model/retrieval changes and nightly.
- Compare to baseline with tolerances; publish a report artifact.

## Agents
Verify outcomes in the environment (not the agent's claims) and judge trajectories: correct tools, approvals before writes, no forbidden actions, steps, cost. Use resettable fixtures and fault injection.

## Error analysis loop
Sample failures → label causes → count → fix the biggest bucket → add cases → re-measure.

## Tracing
Per run: trace ID, prompt/model version, inputs/outputs (redacted), tool calls with timing, retrieval doc IDs, approvals, tokens/cost, outcome, user feedback.
