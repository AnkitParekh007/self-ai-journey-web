# Project 2 — Document RAG assistant with citations and retrieval evaluation

**Goal:** answer questions over a synthetic policy corpus with passage-level citations, and prove retrieval quality with an eval. Zero cost by default: deterministic **mock embeddings** (hashing-based) and a **mock generator** that composes answers from retrieved passages using templates; an optional real-provider adapter is disabled by default and has a cost cap.

## Requirements
1. Corpus: 30 synthetic Markdown policy documents (fictional company), with headings, a table and IDs like "Policy HR-12".
2. Structure-aware chunker with section path, page/heading metadata and a context header per chunk.
3. Hybrid retrieval: BM25 (implement or a tiny library) + vector similarity over mock embeddings; reciprocal rank fusion; optional rerank step.
4. Answering: passages numbered; answer sentences carry `[n]` citations; code verifies every cited `n` was provided and that quoted numbers appear in a cited passage.
5. Abstain when no passage supports the question.
6. Eval set: 40 questions with gold passage IDs, incl. 8 unanswerable and 6 identifier queries ("HR-12"). Report recall@5, MRR, citation validity, abstention accuracy.
7. CLI: `rag ask "…"`, `rag eval` (writes `eval-report.md`), and a minimal web view with citation chips.

## Interview competencies
Chunking, hybrid search, reranking, citations and verification, retrieval vs generation metrics, error analysis, cost control.
