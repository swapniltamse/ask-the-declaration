// Offline groundedness eval for the generated-answer feature. For each query it retrieves the
// top passages and generates an answer from ONLY those passages, then measures how much of the
// answer is actually supported by them: grounding = share of the answer's content words that
// appear in the retrieved passages. A faithfulness proxy, not a judge model, but fully
// reproducible in Node with no API.
//
//   node eval/groundedness.js
//
// Caveat: the live site generates with Llama-3.2-1B via WebLLM (WebGPU, browser only). WebLLM
// cannot run in Node, so this harness generates with the same small flan-t5 model the site uses
// as its non-GPU fallback. It therefore APPROXIMATES the browser output; it measures whether the
// "answer only from these passages" constraint holds, which is model-independent.
const fs = require("fs");
const path = require("path");

const STOP = new Set("a an and are as at be but by can did do does for from had has have how i if in into is it its me my no not of on or our shall so than that the their them then there these this to was we were what when where which who whom why will with you your".split(" "));
const tokenize = (t) => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

async function main() {
  const { pipeline } = await import("@xenova/transformers");
  const idx = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "data", "index.json"), "utf8"));
  const { queries } = JSON.parse(fs.readFileSync(path.join(__dirname, "queries.json"), "utf8"));

  const embed = await pipeline("feature-extraction", idx.model || "Xenova/all-MiniLM-L6-v2");
  const gen = await pipeline("text2text-generation", "Xenova/LaMini-Flan-T5-77M");

  // A representative subset: skip the multi-hop framing queries (they are retrieval tests).
  const sample = queries.filter((q) => !q.multiHop).slice(0, 12);

  let sumGround = 0;
  const rows = [];
  for (const { q } of sample) {
    const qv = Array.from((await embed(q, { pooling: "mean", normalize: true })).data);
    const hits = idx.chunks.map((c) => ({ c, s: dot(qv, c.vector) })).sort((a, b) => b.s - a.s).slice(0, 3);
    const context = hits.map((h) => `[${h.c.source}, ${h.c.section}]: ${h.c.text}`).join("\n\n");
    const prompt = `Based only on these passages from America's founding documents, give a brief, accurate answer.\n\nQuestion: ${q}\n\nPassages:\n${context}\n\nAnswer:`;
    const out = await gen(prompt, { max_new_tokens: 100, temperature: 0.2 });
    const answer = (out[0]?.generated_text || "").trim();

    const passageWords = new Set(hits.flatMap((h) => tokenize(h.c.text + " " + (h.c.plain || ""))));
    const answerWords = tokenize(answer);
    const supported = answerWords.filter((w) => passageWords.has(w));
    const grounding = answerWords.length ? supported.length / answerWords.length : 0;
    const unsupported = [...new Set(answerWords.filter((w) => !passageWords.has(w)))];
    sumGround += grounding;
    rows.push({ q, grounding, unsupported: unsupported.slice(0, 6), answer });
  }

  console.log("\n=== Groundedness eval: " + sample.length + " queries, flan-t5 fallback generator ===\n");
  console.log("grounding".padEnd(11) + "query");
  console.log("-".repeat(60));
  for (const r of rows.sort((a, b) => a.grounding - b.grounding))
    console.log((`${(r.grounding * 100).toFixed(0)}%`).padEnd(11) + r.q);
  console.log("\nMean grounding: " + ((sumGround / rows.length) * 100).toFixed(1) + "%");

  const worst = rows.sort((a, b) => a.grounding - b.grounding)[0];
  console.log("\nLowest-grounded example (for inspection):");
  console.log("  Q: " + worst.q);
  console.log("  A: " + worst.answer);
  console.log("  words not found in passages: " + worst.unsupported.join(", "));
}
main().catch((e) => { console.error(e); process.exit(1); });
