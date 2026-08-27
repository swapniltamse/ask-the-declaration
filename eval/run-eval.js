// Retrieval eval harness. Replicates the browser's retrieval (dense bi-encoder, BM25 pool
// widening, optional cross-encoder rerank, curated-answer layer) and scores it against
// eval/queries.json. Reports recall@5 and MRR per configuration, plus a cross-document
// multi-hop slice. "Better than before" is a measured number, not a claim.
//
//   node eval/run-eval.js            # baseline vs enriched vs +bm25 (no reranker download)
//   RERANK=1 node eval/run-eval.js   # also run +rerank (cross-encoder, downloads once)
//
// Decision log (MiniLM vs bge-base): recorded by Milestone 3, see eval/EMBEDDER-DECISION.md.
const fs = require("fs");
const path = require("path");

const STOP = new Set("a an and are as at be but by can does do for from has have how i in is it its me my of on or shall that the this to was we what when where which who why will with you your".split(" "));
const tokenize = (t) => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

function buildLex(chunks) {
  const docs = chunks.map((c) => tokenize(c.text + " " + (c.plain || "") + " " + c.section));
  const df = new Map();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) || 0) + 1);
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / docs.length;
  return { docs, df, avgLen, N: docs.length };
}
function bm25(lex, q) {
  const k1 = 1.2, b = 0.75;
  const scores = new Array(lex.N).fill(0);
  for (const t of tokenize(q)) {
    const n = lex.df.get(t);
    if (!n) continue;
    const idf = Math.log(1 + (lex.N - n + 0.5) / (n + 0.5));
    for (let i = 0; i < lex.N; i++) {
      const tf = lex.docs[i].filter((w) => w === t).length;
      if (!tf) continue;
      scores[i] += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * lex.docs[i].length / lex.avgLen));
    }
  }
  return scores;
}
function denseTop(chunks, qv, k) {
  return chunks.map((c) => ({ c, s: dot(qv, c.vector) })).sort((a, b) => b.s - a.s).slice(0, k);
}
// Dense-ordered candidate pool, widened with BM25 hits (matches the browser).
function poolTop(chunks, lex, qv, q) {
  const denseRanked = chunks.map((c) => ({ c, s: dot(qv, c.vector), bm: false })).sort((a, b) => b.s - a.s);
  const byId = new Map(denseRanked.map((h) => [h.c.id, h]));
  const pool = denseRanked.slice(0, 20);
  const poolIds = new Set(pool.map((h) => h.c.id));
  bm25(lex, q).map((s, i) => ({ id: chunks[i].id, s })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s).slice(0, 10)
    .forEach((d) => { const e = byId.get(d.id); if (!e) return; e.bm = true; if (!poolIds.has(d.id)) { pool.push(e); poolIds.add(d.id); } });
  return pool.sort((a, b) => b.s - a.s);
}
// Curated-answer layer: matches the query against curated questions; if one is close
// enough, pin its cited passages first (exactly as the live site does).
function curatedMatch(answers, qv, threshold) {
  let best = null;
  for (const a of answers) {
    const s = dot(qv, a.vector);
    if (!best || s > best.s) best = { a, s };
  }
  return best && best.s >= (threshold || 0.6) ? best.a : null;
}
function endToEnd(idx, ranked, qv) {
  const cur = curatedMatch(idx.answers, qv);
  if (!cur) return ranked.slice(0, 5);
  const pinnedIds = new Set(cur.chunkIds || []);
  const pinned = (cur.chunkIds || []).map((id) => idx.chunks.find((c) => c.id === id)).filter(Boolean).map((c) => ({ c }));
  return pinned.concat(ranked.filter((h) => !pinnedIds.has(h.c.id))).slice(0, 5);
}
const sectionMatches = (section, exp) => section === exp || section.startsWith(exp + " ") || section.startsWith(exp + ",");
function rankOfHit(results, expect) {
  for (let i = 0; i < results.length; i++)
    if (expect.some((e) => sectionMatches(results[i].c.section, e))) return i + 1;
  return 0;
}
function score(name, perQuery) {
  const hits = perQuery.filter((r) => r.rank > 0 && r.rank <= 5).length;
  const mrr = perQuery.reduce((s, r) => s + (r.rank > 0 ? 1 / r.rank : 0), 0) / perQuery.length;
  return { name, recall5: hits / perQuery.length, mrr, hits, total: perQuery.length };
}

async function main() {
  const useBge = process.env.EMBEDDER === "bge";
  const MODEL = useBge ? "Xenova/bge-base-en-v1.5" : "Xenova/all-MiniLM-L6-v2";
  const PREFIX = useBge ? "Represent this sentence for searching relevant passages: " : "";

  const { pipeline } = await import("@xenova/transformers");
  const embed = await pipeline("feature-extraction", MODEL);
  const qEmb = async (q) => Array.from((await embed(PREFIX + q, { pooling: "mean", normalize: true })).data);

  const { queries } = JSON.parse(fs.readFileSync(path.join(__dirname, "queries.json"), "utf8"));
  // When comparing bge, load the bge-embedded index built by Milestone 3; else the shipped one.
  const newPath = useBge ? path.join(__dirname, "index-bge.json") : path.join(__dirname, "..", "public", "data", "index.json");
  const newIdx = JSON.parse(fs.readFileSync(newPath, "utf8"));
  const basePath = path.join(__dirname, "index-baseline.json");
  const baseIdx = fs.existsSync(basePath) && !useBge ? JSON.parse(fs.readFileSync(basePath, "utf8")) : null;
  const newLex = buildLex(newIdx.chunks);

  const doRerank = process.env.RERANK === "1";
  let rr = null;
  if (doRerank) {
    const { AutoModelForSequenceClassification, AutoTokenizer } = await import("@xenova/transformers");
    const model = await AutoModelForSequenceClassification.from_pretrained("Xenova/ms-marco-MiniLM-L-6-v2", { quantized: true });
    const tokenizer = await AutoTokenizer.from_pretrained("Xenova/ms-marco-MiniLM-L-6-v2");
    rr = { model, tokenizer };
  }
  async function rerank(q, cands) {
    const passages = cands.map((h) => h.c.text);
    const inputs = rr.tokenizer(new Array(passages.length).fill(q), { text_pair: passages, padding: true, truncation: true });
    const { logits } = await rr.model(inputs);
    const scores = logits.sigmoid().tolist().map((row) => row[0]);
    return cands.map((h, i) => ({ ...h, rr: scores[i] })).sort((a, b) => b.rr - a.rr);
  }

  const rows = { baseline: [], enriched: [], pool: [], rerank: [], e2e: [] };
  for (const { q, expect, multiHop } of queries) {
    const qv = await qEmb(q);
    if (baseIdx) rows.baseline.push({ q, multiHop, rank: rankOfHit(denseTop(baseIdx.chunks, qv, 5), expect) });
    rows.enriched.push({ q, multiHop, rank: rankOfHit(denseTop(newIdx.chunks, qv, 5), expect) });
    const pool = poolTop(newIdx.chunks, newLex, qv, q);
    rows.pool.push({ q, multiHop, rank: rankOfHit(pool.slice(0, 5), expect) });
    const ranked = doRerank ? await rerank(q, pool) : pool;
    if (doRerank) rows.rerank.push({ q, multiHop, rank: rankOfHit(ranked.slice(0, 5), expect) });
    rows.e2e.push({ q, multiHop, rank: rankOfHit(endToEnd(newIdx, ranked, qv), expect) });
  }

  const results = [];
  if (baseIdx) results.push(score("baseline (text-only, dense)", rows.baseline));
  results.push(score(useBge ? "bge enriched (dense)" : "enriched (text+plain, dense)", rows.enriched));
  results.push(score("+bm25 pool (dense order)", rows.pool));
  if (doRerank) results.push(score("+rerank (cross-encoder)", rows.rerank));
  results.push(score("end-to-end (+curated layer)", rows.e2e));

  console.log("\n=== Retrieval eval: " + queries.length + " labeled queries" + (useBge ? " [EMBEDDER=bge-base]" : " [all-MiniLM-L6-v2]") + ", recall@5 + MRR ===\n");
  console.log("config".padEnd(34) + "recall@5".padEnd(15) + "MRR");
  console.log("-".repeat(60));
  for (const r of results) console.log(r.name.padEnd(34) + (`${(r.recall5 * 100).toFixed(1)}% (${r.hits}/${r.total})`).padEnd(15) + r.mrr.toFixed(3));

  const mh = rows.e2e.filter((r) => r.multiHop);
  if (mh.length) { const s = score("multi-hop slice (end-to-end)", mh); console.log("\n" + s.name.padEnd(34) + (`${(s.recall5 * 100).toFixed(1)}% (${s.hits}/${s.total})`).padEnd(15) + s.mrr.toFixed(3)); }

  const misses = rows.e2e.filter((r) => !(r.rank > 0 && r.rank <= 5)).map((r) => r.q);
  console.log("\nStill missed by best config (" + misses.length + "):");
  misses.forEach((q) => console.log("  - " + q));
}
main().catch((e) => { console.error(e); process.exit(1); });
