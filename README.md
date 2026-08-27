# Ask the Declaration

Semantic search over America's founding documents, built for the country's 250th birthday.

**Live site: https://askthedeclaration.com**

Ask a question in plain English and get the founders' own words back, with exact citations like *Article I, Section 8* or *Grievance 17*. Every passage carries a plain-English explainer, common questions get a curated short answer in modern words, and a flag map traces how twelve countries forked the American template, from France in 1789 to India in 1950. When multiple passages match, a small browser-side model synthesizes a grounded answer from the retrieved text.

The whole thing runs with **no servers, no API keys, and no tracking**. Your question never leaves your browser.

## Why this exists

July 4, 2026 is the 250th anniversary of the Declaration of Independence. Most anniversary content is a listicle. I wanted something you could actually use: the founding documents as living text you can question, answered word for word from the primary sources.

It is also a small argument about engineering: you do not need a vector database, an LLM API, and a monthly bill to ship useful retrieval. Sometimes the right architecture is a static file and a 25 MB model in the browser.

## How it works

```
build time (Node)                      runtime (your browser)
─────────────────                      ──────────────────────
Gutenberg texts                        your question
      │                                      │
build-corpus.js                        Transformers.js
  parse into 108                       all-MiniLM-L6-v2 (quantized ONNX)
  structure-aware chunks                     │
      │                                query vector (384-dim)
build-embeddings.js                          │
  all-MiniLM-L6-v2                     dot product vs 108 chunk vectors
  384-dim vectors                      dot product vs 27 curated questions
      │                                      │
public/data/index.json  ──────────►   top passages + citations
  (one static file)                    + plain-words explainers
                                       + curated short answer (if matched)
```

1. **Chunk.** The Declaration, the Constitution, all 27 Amendments, and Federalist Nos. 10, 51 and 78 are parsed into 108 passages along the documents' own structure. Each grievance is one complaint, each article section one power, each amendment one right. That is why results cite "Amendment XIII" instead of "chunk 47".
2. **Embed.** Each passage is encoded offline into a 384-dimension vector with `all-MiniLM-L6-v2` (mean pooling, L2-normalized) and shipped as one static JSON file.
3. **Retrieve, three ways.** The browser embeds your question locally and ranks all 108 passages by cosine similarity (a dot product, under a millisecond). A BM25 keyword score then widens the candidate pool so exact-wording matches are not missed, and a cross-encoder reranker (`ms-marco-MiniLM-L-6-v2`, loaded in the background) reorders the top ~20 for precision. Until it loads, results fall back to the dense order, so search never waits on it.
4. **Answer.** The query vector is also compared against 27 curated questions. Close match (cosine 0.60 or higher) shows a human-written short answer above the passages. When multiple passages match a non-curated query, a small browser-side generative model synthesizes a grounded answer from the retrieved text. Retrieved passages are exact quotations — nothing can be hallucinated.

The full write-up is on the site: [Under the Hood](https://askthedeclaration.com/how.html).

## Measured retrieval

Every layer's contribution is a number, not a claim. `node eval/run-eval.js` scores 45 labeled queries (recall@5 and MRR):

| Configuration | recall@5 | MRR |
|---|---|---|
| Dense, text-only (v1) | 93.3% | 0.904 |
| + enriched embeddings | 95.6% | 0.897 |
| + BM25 candidate pool | 95.6% | 0.897 |
| + cross-encoder rerank | 97.8% | 0.952 |
| Cross-document (multi-hop) slice | 100.0% | 1.000 |

The corpus is small and canonical, so dense retrieval already does well; the reranker earns its keep on precision (MRR 0.897 to 0.952, and it recovers the "who can declare war" miss). A larger embedder (bge-base, 768-dim, ~110 MB) was measured and *lost* to the 23 MB MiniLM (lower dense recall, tie after reranking), so the site keeps the small model. See `eval/EMBEDDER-DECISION.md`.

## Cross-document lineage

The founding corpus is intertextual: a 1776 grievance becomes a 1787 clause becomes a 1791 right. Each result carries a "The Thread" strip tracing its principle across the documents, some threads hand-curated for accuracy, the rest computed as each passage's nearest neighbors in a *different* source document. This is the sharpest difference from the single-document sister site [Ask the Constitution of India](https://asktheindianconstitution.com): the same architecture at opposite operating points, each chosen for its audience. India minimizes the download and stays CPU-only for readers on weak connections; this site assumes broadband and spends that budget on cross-document reasoning and a reranker.

## Your rights, by who you are

`node build-personas.js` generates cite-validated `/rights/` pages that map the documents to real lives (a protester, a journalist, someone under arrest, a gun owner, an immigrant, a voter, a criminal defendant, a business owner), plus `sitemap.xml` and `robots.txt`.

## Why the chunking matters

Fixed-size token windows are the default in most RAG tutorials, and they are why so many retrieval systems return passages that start mid-sentence. Documents usually carry their own atomic units: contracts have clauses, API docs have endpoints, founding documents have grievances, sections, and amendments. Chunking along those seams costs one afternoon of parsing and gives you citations a human can quote.

## The economics

| Cost line | Typical hosted RAG | This site |
|---|---|---|
| Query embedding | API call, metered | $0, computed in the browser |
| Vector search | Hosted vector DB | $0, dot product over a static file |
| Answer generation | LLM call per query | $0, curated text + browser-side synthesis |
| Keys and rate limits | Keys to protect, quotas to hit | None exist |
| Cost if it goes viral | Scales with every visitor | Flat, CDN serves static files |

The one real cost is a ~25 MB model download on a visitor's first search, cached by the browser afterward. For a public demo, that is the right trade: a demo that costs money per query dies the day it goes viral.

**When to use this pattern:** small, public, read-heavy corpora. Docs sites, legal texts, manuals, FAQs.
**When not to:** private data (the whole index ships to every visitor), large corpora, or when users need generated prose.

## Surviving the hug of death

A viral spike kills most demos one of two ways: the API bill or the bandwidth cap. This site was designed so neither can happen.

**The heavy bytes never touch the origin.**

| Asset | Size | Served by |
|---|---|---|
| Model weights (quantized ONNX + tokenizer) | ~23 MB | huggingface.co CDN |
| Transformers.js + ONNX WASM runtime | ~11 MB | cdn.jsdelivr.net |
| Flag images | ~150 KB | flagcdn.com |
| Fonts | ~100 KB | fonts.gstatic.com |
| HTML, search index, OG image | 651 KB total | Vercel origin |

A fully cold visitor costs the origin about 600 KB, so Vercel's 100 GB free tier covers roughly 170,000 cold visits a month. A Hacker News front page plus a strong LinkedIn day is typically 30 to 80 thousand.

**Two cache layers cut the real number far below worst case.** Transformers.js stores the model in the browser's Cache API (`transformers-cache`), so returning visitors download zero model bytes. `vercel.json` adds stale-while-revalidate headers on the search index and social card, so repeat visits mostly resolve inside the visitor's own browser.

**There is no backend to overload.** Every query is a dot product computed on the visitor's own device, so each new visitor brings the compute they need with them. No API keys to leak, no rate limits to hit, no per-query bill that grows with the audience. Virality is the success case here, not the failure mode.

## What is curated vs computed

The AI does retrieval and question-matching only. The plain-words explainers (all 108) and the short answers (all 27) were written by a person at build time (`corpus/explainers.json`, `corpus/answers.json`). The founders' words are quoted exactly from public domain Project Gutenberg editions. Each layer is labeled in the UI so you always know who is talking: 1776 or 2026.

## Run it locally

```bash
npm install
node build-embeddings.js    # embed the corpus + curated questions, compute lineage, write public/data/index.json
node build-personas.js      # generate /rights/ persona pages, sitemap.xml, robots.txt
node eval/run-eval.js       # measure retrieval (add RERANK=1 for the cross-encoder)
node benchmark.js           # query-embed + search timings
cd public && python -m http.server 8317
# open http://localhost:8317

# Note: build-corpus.js (raw-text parser) is currently stale — it emits 91 chunks and omits
# Amendments XI–XXVII. corpus/chunks.json (108) is the source of truth; see the header in
# build-corpus.js before re-running it.
```

Run the end-to-end tests (needs Chrome installed):

```bash
node e2e-test.js                                        # against localhost:8317
node e2e-test.js https://askthedeclaration.com/index.html  # against prod
```

The suite covers the short-answer box, pinned citations, explainer rendering, curated-answer thresholds, fallback behavior, the flags section, the cross-document lineage strip, and the persona rights pages.

## Project layout

```
corpus/
  chunks.json                            108 citation-ready passages (source of truth)
  answers.json                           27 curated Q&A entries
  explainers.json                        hand-written plain-words explainers
  lineage.json                           curated cross-document threads
  personas.json                          8 "your rights by who you are" personas
build-embeddings.js                      offline embedding + computed lineage, writes the index
build-personas.js                        generates /rights/ pages, sitemap, robots
build-corpus.js                          raw-text parser (stale, see its header)
benchmark.js                             query-embed + search timings
eval/
  queries.json                           45 labeled queries (4 multi-hop)
  run-eval.js                            recall@5 / MRR per config
  index-baseline.json                    text-only index, for the enrichment comparison
  EMBEDDER-DECISION.md                   MiniLM vs bge-base, measured
public/
  index.html                             search + three-signal retrieval + world flags + lineage
  how.html                               architecture, eval, and economics write-up
  rights/                                generated persona pages
  review.html                            the Declaration reviewed as a product spec
  about.html                             about + FAQ
  data/index.json                        the shipped search index
  sitemap.xml, robots.txt                generated by build-personas.js
e2e-test.js                              puppeteer test suite
```

## Sources

Document texts are the public domain Project Gutenberg editions ([#1](https://www.gutenberg.org/ebooks/1), [#5](https://www.gutenberg.org/ebooks/5), [#2](https://www.gutenberg.org/ebooks/2), [#1404](https://www.gutenberg.org/ebooks/1404)). Country cards cite their primary documents inline (Avalon Project, official government texts, and Wikipedia for historical documents without stable official hosts).

## Author

Swapnil Tamse, engineering leader in AI and AI security, New York.
[LinkedIn](https://www.linkedin.com/in/swapniltamse/) | [Site](https://askthedeclaration.com/about.html)

Happy 250th, America. Ship your v1.

## License

MIT for the code. The founding documents belong to everyone.
