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
3. **Search.** The browser loads the same model as quantized ONNX via Transformers.js and embeds your question locally. All vectors are normalized, so cosine similarity is just a dot product: 108 x 384 multiplications, under a millisecond.
4. **Answer.** The query vector is also compared against 27 curated questions. Close match (cosine 0.60 or higher) shows a human-written short answer above the passages. When multiple passages match a non-curated query, a small browser-side generative model synthesizes a grounded answer from the retrieved text. Retrieved passages are exact quotations — nothing can be hallucinated.

The full write-up is on the site: [Under the Hood](https://askthedeclaration.com/how.html).

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
node build-corpus.js        # parse Gutenberg texts into corpus/chunks.json
node build-embeddings.js    # embed chunks + curated questions into public/data/index.json
cd public && python -m http.server 8317
# open http://localhost:8317
```

Run the end-to-end tests (needs Chrome installed):

```bash
node e2e-test.js                                        # against localhost:8317
node e2e-test.js https://askthedeclaration.com/index.html  # against prod
```

11 checks cover the short-answer box, pinned citations, explainer rendering, curated-answer thresholds, fallback behavior, and the flags section.

## Project layout

```
corpus/
  declaration.txt, constitution.txt,     Project Gutenberg source texts
  billofrights.txt, federalist.txt
  explainers.json                        108 hand-written plain-words explainers
  answers.json                           27 curated Q&A entries
  chunks.json                            generated by build-corpus.js
build-corpus.js                          structure-aware parser
build-embeddings.js                      offline embedding, writes the search index
public/
  index.html                             search + world flags
  how.html                               architecture and economics write-up
  review.html                            the Declaration reviewed as a product spec
  about.html                             about + FAQ
  data/index.json                        the shipped search index
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
