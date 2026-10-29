# LLM fundamentals for application engineers

> Original study notes. Verify details against the provider documentation linked in the course catalog.

## Mental model
- A model predicts the next **token** given everything before it. Tokens are sub-word pieces: cost, limits and latency are all counted in tokens.
- The **context window** holds system prompt + tool definitions + conversation + retrieved documents + the answer being generated.
- **Prefill** (reading input) is parallel and fast per token; **decoding** (writing output) is sequential. Output length dominates latency.

## Sampling
| Parameter | Effect | Use |
|---|---|---|
| Temperature | Sharpens (low) or flattens (high) the next-token distribution | Low for extraction/classification; higher for ideation |
| Top-p | Samples only from the smallest set of tokens covering probability p | Usually tune one of temperature/top-p, not both |

Low temperature reduces variance; it does **not** make answers true, and it does not guarantee identical outputs across runs. Test properties, not strings.

## Why models are wrong
1. Missing or stale knowledge → ground with retrieval or tools.
2. Pressure to answer → explicit permission to abstain.
3. Ambiguous instructions → clarify scope and format.
4. Noisy long context → select and order passages.
5. No verification → citations you check in code, schema validation, evals with unanswerable questions.

## Long context vs retrieval
Long context is great for bounded, global-reading tasks (one contract, one codebase with caching). Retrieval wins for large, changing, permissioned corpora and precise citations. Many systems combine them: retrieve documents, then send whole sections.

## Cost & latency levers (in order of usual impact)
1. Shorter outputs (format constraints, max tokens).
2. Less context (selection, compact formats, trimmed tool outputs).
3. Prompt caching of stable prefixes (stable content first, variable content last).
4. Smaller model for simple steps; routing.
5. Parallel independent calls.

## Interview soundbites
- "I budget in tokens, measure with real usage logs, and treat output length as the main latency lever."
- "Temperature controls variance, not truth."
- "I design for detection and recovery because hallucination never reaches zero."
