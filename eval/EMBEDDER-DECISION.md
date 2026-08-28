# Embedder decision: all-MiniLM-L6-v2 vs bge-base-en-v1.5

Date: 2026-08-27. Reproduce with `node eval/run-eval.js` and `EMBEDDER=bge RERANK=1 node eval/run-eval.js`
(rebuild `eval/index-bge.json` first with the bge build snippet in the Phase 1 plan).

The US site targets a broadband audience, so a larger embedder was a candidate: spend download
bytes to buy retrieval quality. The rule was to ship bge-base only if it lifted end-to-end
recall@5 by >= 3 points OR MRR by >= 0.03 without regressing the multi-hop slice. It cleared
none of those bars.

| Config | all-MiniLM-L6-v2 (384d, ~23 MB) | bge-base-en-v1.5 (768d, ~110 MB) |
|---|---|---|
| enriched (dense) recall@5 | **95.6%** | 91.1% |
| +rerank recall@5 | 97.8% | 97.8% (tie) |
| end-to-end MRR | **0.952** | 0.793 |
| multi-hop MRR | **1.000** | 0.875 |
| index on disk | **551 KB** | 979 KB |
| first-visit model download | **~23 MB** | ~110 MB |

**Decision: keep all-MiniLM-L6-v2.** On this 108-passage corpus the larger model had *lower*
dense recall, tied only after the cross-encoder rerank, and dragged end-to-end MRR down because
the curated-answer threshold (0.60 cosine) is calibrated to MiniLM's distribution. It is also
5x the download. The bigger model did not earn its bytes here, and the measurement is the point:
this is why the site ships the small model, not a guess that "bigger is better."
