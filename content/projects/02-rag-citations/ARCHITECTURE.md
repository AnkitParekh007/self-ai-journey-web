# Architecture

```
corpus/*.md ─▶ chunker ─▶ chunks.json (id, docId, sectionPath, text, header)
                        ├▶ bm25 index
                        └▶ mockEmbed(text) → vectors.json
query ─▶ (rewrite: off by default) ─▶ bm25 top-20 + vector top-20 ─▶ RRF ─▶ rerank (optional) ─▶ top-5
      ─▶ generator (mock | real-adapter, disabled) ─▶ answer with [n] ─▶ citation verifier ─▶ output
eval/questions.json ─▶ runner ─▶ metrics ─▶ eval-report.md
```

Mock embedding: tokenise, hash tokens into 256 buckets, L2-normalise. Deterministic, semantic only in a crude bag-of-words sense — which is the point: identifier queries show why hybrid search matters.

Real adapter contract (disabled): `generate({ passages, question, maxOutputTokens: 400 })`, refuses to run unless `RAG_REAL=1` **and** `RAG_COST_CAP_USD` is set; logs token usage.
