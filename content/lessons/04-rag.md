# Retrieval-augmented generation

## Pipeline
```
ingest → structure-aware chunking (+ context header, metadata, ACL) → embed + keyword index
query → (rewrite) → filtered hybrid retrieval (BM25 + vector) → fusion → rerank top-k → top-n context
      → generate with passage IDs → verify citations → stream answer with sources
```

## Chunking
- Split by headings/paragraphs/table rows; keep chunks self-contained.
- Attach title, section path, page, date, tenant, ACL.
- Parent-child: retrieve small, send the parent section.
- Contextual headers make isolated chunks interpretable.

## Hybrid search
Embeddings miss exact identifiers; BM25 misses paraphrases. Fuse (e.g., reciprocal rank fusion), then rerank.

## Citations you can trust
Stable passage IDs → model cites IDs per claim → code verifies IDs were provided (and spans exist) → UI links to exact passage → unsupported claims are flagged.

## Evaluate in two halves
| Retrieval | Generation |
|---|---|
| recall@k, precision@n, MRR | faithfulness, correctness, citation accuracy, abstention on unanswerable |

Then end-to-end success, latency and cost. If recall is high but answers are wrong, look at generation.

## Permissions
Filter inside retrieval with the caller's identity; never filter after and leak snippets. Partition caches. Probe cross-tenant access in tests.

## RAG vs long context
Long context for small/bounded corpora and global reading; RAG for large, changing, permissioned corpora. Combine: retrieve, then send whole sections.
