# Demonstration script (5 minutes)
1. Show the corpus is synthetic and the generator is a mock (labelled).
2. `rag ask "What is the notice period in Policy HR-12?"` → answer with [1][2]; open the cited passages.
3. `rag ask "What is the CEO's favourite colour?"` → abstains.
4. `rag eval` → walk through recall@5 for vector-only vs BM25 vs hybrid; point at identifier queries.
5. Show one failure category from error analysis and the fix.
6. Trade-offs: chunk size, reranking cost, when long context would be simpler.
