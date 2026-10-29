# Evaluation criteria
| Metric | Target (fixture corpus) |
|---|---|
| recall@5 (answerable) | ≥ 0.85 with hybrid; report vector-only and BM25-only for comparison |
| Identifier queries recall@5 | hybrid clearly above vector-only |
| Citation validity | 100% of cited IDs were provided; 0 numbers without support |
| Abstention | ≥ 7/8 unanswerable questions abstain |
| Determinism | identical report on repeated runs |
| Cost | $0 by default; real adapter refuses without explicit flag and cap |
