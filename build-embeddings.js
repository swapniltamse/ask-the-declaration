// Embeds every corpus chunk with all-MiniLM-L6-v2 (384-dim, quantized ONNX)
// and writes the search index the browser loads at runtime.
// The browser embeds only the query with the same model, so vectors match.
const fs = require("fs");
const path = require("path");

async function main() {
  const { pipeline } = await import("@xenova/transformers");
  const chunks = JSON.parse(
    fs.readFileSync(path.join(__dirname, "corpus", "chunks.json"), "utf8")
  );

  const embed = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

  const vectors = [];
  const t0 = Date.now();
  for (const c of chunks) {
    // Enriched embedding: passage text plus its plain-words explainer and its citation label.
    // Lay phrasing ("free speech") reaches the right passage even when the founding text uses
    // period vocabulary. Isolated as a measured lift in eval/run-eval.js.
    const enriched = `${c.text} ${c.plain || ""} ${c.section}`.trim();
    const out = await embed(enriched, { pooling: "mean", normalize: true });
    // Round to 5 decimals: cuts index size ~40% with no retrieval impact
    vectors.push(Array.from(out.data).map((v) => Math.round(v * 1e5) / 1e5));
  }
  console.log(`Embedded ${chunks.length} chunks in ${Date.now() - t0}ms`);

  // Curated Q&A: embed each question so the browser can match user queries
  // against them in the same vector space as the passages.
  const answers = JSON.parse(
    fs.readFileSync(path.join(__dirname, "corpus", "answers.json"), "utf8")
  );
  for (const a of answers) {
    const out = await embed(a.question, { pooling: "mean", normalize: true });
    a.vector = Array.from(out.data).map((v) => Math.round(v * 1e5) / 1e5);
  }
  console.log(`Embedded ${answers.length} curated questions`);

  // Cross-document lineage (computed backfill): each chunk's nearest neighbors in a DIFFERENT
  // source document, above a similarity floor. Curated threads (corpus/lineage.json) lead in the
  // UI; these fill the long tail. The US corpus is intertextual in a way a single document is not.
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  const withVec = chunks.map((c, i) => ({ ...c, vector: vectors[i] }));
  for (const c of withVec) {
    c.related = withVec
      .filter((o) => o.id !== c.id && o.source !== c.source)
      .map((o) => ({ id: o.id, s: dot(c.vector, o.vector) }))
      .filter((o) => o.s > 0.45)
      .sort((a, b) => b.s - a.s)
      .slice(0, 3)
      .map((o) => o.id);
  }

  // Validate curated lineage cites against the corpus (fail the build on a bad cite).
  const lineage = JSON.parse(fs.readFileSync(path.join(__dirname, "corpus", "lineage.json"), "utf8"));
  const resolves = (cite, source) =>
    chunks.some((c) => c.source === source && (c.section === cite || c.section.startsWith(cite + " ") || c.section.startsWith(cite + ",")));
  const badCites = lineage.flatMap((t) => t.thread).filter((it) => !resolves(it.cite, it.source)).map((it) => `${it.cite} / ${it.source}`);
  if (badCites.length) { console.error("Lineage cites not in corpus:", [...new Set(badCites)]); process.exit(1); }
  console.log(`Validated ${lineage.length} lineage threads`);

  const index = {
    model: "Xenova/all-MiniLM-L6-v2",
    dims: vectors[0].length,
    built: new Date().toISOString(),
    chunks: withVec,
    answers,
    lineage,
  };
  const outDir = path.join(__dirname, "public", "data");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "index.json");
  fs.writeFileSync(outFile, JSON.stringify(index));
  console.log(
    `Wrote ${outFile} (${(fs.statSync(outFile).size / 1024).toFixed(0)} KB)`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
