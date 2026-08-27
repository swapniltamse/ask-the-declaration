// Measures query-embedding latency and dot-product search time in Node (a laptop proxy).
// The search itself is the cheap part; almost all of a query's time is embedding it on-device.
// Re-run whenever the corpus or model changes to keep how.html numbers honest.
const fs = require("fs");
async function main() {
  const { pipeline } = await import("@xenova/transformers");
  const idx = JSON.parse(fs.readFileSync("./public/data/index.json", "utf8"));
  const embed = await pipeline("feature-extraction", idx.model || "Xenova/all-MiniLM-L6-v2");
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  const qs = ["what protects free speech", "can the government search my house", "what abolished slavery", "who can declare war", "the right to keep and bear arms"];
  const embMs = [], searchMs = [];
  for (let r = 0; r < 20; r++) for (const q of qs) {
    let t = performance.now();
    const qv = Array.from((await embed(q, { pooling: "mean", normalize: true })).data);
    embMs.push(performance.now() - t);
    t = performance.now();
    idx.chunks.map((c) => dot(qv, c.vector)).sort((a, b) => b - a);
    searchMs.push(performance.now() - t);
  }
  const sorted = (a) => a.slice().sort((x, y) => x - y);
  const med = (a) => sorted(a)[Math.floor(a.length / 2)];
  const p95 = (a) => sorted(a)[Math.floor(a.length * 0.95)];
  const bytes = fs.statSync("./public/data/index.json").size;
  console.log(`Query embedding (${idx.model}): median ${med(embMs).toFixed(1)} ms, p95 ${p95(embMs).toFixed(1)} ms`);
  console.log(`Dot-product search over ${idx.chunks.length} vectors: ${med(searchMs).toFixed(2)} ms median`);
  console.log(`Index on disk: ${(bytes / 1024).toFixed(0)} KB (${idx.dims}-dim x ${idx.chunks.length} chunks + ${idx.answers.length} curated questions)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
