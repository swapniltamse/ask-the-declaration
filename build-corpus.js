// Parses Project Gutenberg plain-text editions of the founding documents
// into citation-ready chunks for embedding. Output: corpus/chunks.json
const fs = require("fs");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "corpus", f), "utf8");
const paragraphs = (text) =>
  text
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);

const chunks = [];
let id = 0;
const add = (source, section, year, text) => {
  chunks.push({ id: id++, source, section, year, text });
};

// ---------- Declaration of Independence ----------
{
  const raw = read("declaration.txt");
  const start = raw.indexOf("IN CONGRESS, July 4, 1776");
  const end = raw.indexOf("*** END OF THE PROJECT");
  const body = raw.slice(start, end);
  const paras = paragraphs(body).filter(
    (p) => !/^IN CONGRESS/.test(p) && !/^The unanimous Declaration/.test(p)
  );
  let grievance = 0;
  for (const p of paras) {
    let section;
    if (/^(He has|He is|For |In every stage)/.test(p)) {
      // The grievance list: the "prioritized bug list" against George III
      grievance++;
      section = `Grievance ${grievance}`;
    } else if (/^When in the Course/.test(p)) {
      section = "Opening";
    } else if (/^We hold these truths/.test(p)) {
      section = "Preamble";
    } else if (/^We, therefore/.test(p) || /mutually pledge/.test(p)) {
      section = "Conclusion & Pledge";
    } else {
      section = "Body";
    }
    add("Declaration of Independence", section, 1776, p);
  }
}

// ---------- U.S. Constitution (1787, original seven articles) ----------
{
  const raw = read("constitution.txt");
  const start = raw.search(/We the people/i);
  const end = raw.indexOf("*** END OF THE PROJECT");
  const body = raw.slice(start, end);

  const roman = {
    "1": "I", "2": "II", THREE: "III", FOUR: "IV",
    FIVE: "V", SIX: "VI", SEVEN: "VII",
  };
  // Article headers appear as "Article 1", "ARTICLE 2", "ARTICLE THREE", ...
  const parts = body.split(/\r?\n(?:Article|ARTICLE)\s+([0-9A-Z]+)\s*\r?\n/);
  // parts[0] = preamble, then alternating [articleLabel, articleText]
  add("U.S. Constitution", "Preamble", 1787, paragraphs(parts[0]).join(" "));
  for (let i = 1; i < parts.length; i += 2) {
    const art = roman[parts[i]] || parts[i];
    const text = parts[i + 1];
    const secs = text.split(/\r?\n(?=Section\s+\d+\.)/);
    for (const s of secs) {
      const m = s.match(/^Section\s+(\d+)\./);
      const label = m
        ? `Article ${art}, Section ${m[1]}`
        : `Article ${art}`;
      const joined = paragraphs(s).join(" ");
      if (joined) add("U.S. Constitution", label, 1787, joined);
    }
  }
}

// ---------- Bill of Rights (the first ten amendments) ----------
{
  const raw = read("billofrights.txt");
  const start = raw.indexOf("The Ten Original Amendments");
  const end = raw.indexOf("*** END OF THE PROJECT");
  const body = raw.slice(start, end);
  // Amendments are delimited by Roman numeral lines: I, II, ... X
  const parts = body.split(/\r?\n(I{1,3}|IV|VI{0,3}|IX|X)\s*\r?\n/);
  for (let i = 1; i < parts.length; i += 2) {
    const text = paragraphs(parts[i + 1]).join(" ");
    if (text) add("Bill of Rights", `Amendment ${parts[i]}`, 1791, text);
  }
}

// ---------- Federalist Papers Nos. 10, 51, 78 ----------
{
  const raw = read("federalist.txt");
  const pick = [
    { no: 10, author: "Madison" },
    { no: 51, author: "Madison" },
    { no: 78, author: "Hamilton" },
  ];
  for (const { no, author } of pick) {
    const start = raw.indexOf(`FEDERALIST No. ${no}`);
    const end = raw.indexOf(`FEDERALIST No. ${no + 1}`);
    const body = raw.slice(start, end === -1 ? undefined : end);
    const paras = paragraphs(body).filter(
      (p) => p.length > 80 && !/^FEDERALIST/.test(p) && !/^To the People/.test(p)
    );
    // Group paragraphs into ~250-word chunks so each stays retrievable
    let buf = [];
    let words = 0;
    let part = 0;
    const flush = () => {
      if (!buf.length) return;
      part++;
      add(
        `Federalist No. ${no} (${author})`,
        `Passage ${part}`,
        1788,
        buf.join(" ")
      );
      buf = [];
      words = 0;
    };
    for (const p of paras) {
      buf.push(p);
      words += p.split(" ").length;
      if (words >= 220) flush();
    }
    flush();
  }
}

// Merge curated plain-language explainers, keyed by "source|section"
const explainers = JSON.parse(
  fs.readFileSync(path.join(__dirname, "corpus", "explainers.json"), "utf8")
);
let missing = 0;
for (const c of chunks) {
  const key = `${c.source}|${c.section}`;
  if (explainers[key]) c.plain = explainers[key];
  else {
    missing++;
    console.warn(`No explainer for: ${key}`);
  }
}
if (missing) console.warn(`${missing} chunks missing explainers`);

fs.writeFileSync(
  path.join(__dirname, "corpus", "chunks.json"),
  JSON.stringify(chunks, null, 1)
);

const bySource = {};
for (const c of chunks) bySource[c.source] = (bySource[c.source] || 0) + 1;
console.log(`${chunks.length} chunks total`);
console.log(bySource);
