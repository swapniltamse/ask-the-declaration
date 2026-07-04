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
    const out = await embed(c.text, { pooling: "mean", normalize: true });
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

  const index = {
    model: "Xenova/all-MiniLM-L6-v2",
    dims: vectors[0].length,
    built: new Date().toISOString(),
    chunks: chunks.map((c, i) => ({ ...c, vector: vectors[i] })),
    answers,
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
