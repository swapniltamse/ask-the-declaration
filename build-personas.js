// Generates persona pages ("Your rights, by who you are") from corpus/personas.json:
// public/rights/<slug>.html + public/rights/index.html. Validates every cite against the
// corpus (fails the build on a bad cite), and writes public/sitemap.xml + public/robots.txt.
const fs = require("fs");
const path = require("path");

const SITE = "https://askthedeclaration.com";
const personas = JSON.parse(fs.readFileSync(path.join(__dirname, "corpus", "personas.json"), "utf8"));
const lenses = JSON.parse(fs.readFileSync(path.join(__dirname, "corpus", "lenses.json"), "utf8"));
const chunks = JSON.parse(fs.readFileSync(path.join(__dirname, "corpus", "chunks.json"), "utf8"));

const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const resolves = (cite) => chunks.some((c) => c.section === cite || c.section.startsWith(cite + " ") || c.section.startsWith(cite + ","));

// Validate every persona cite against the corpus before writing anything.
let missing = 0;
for (const p of personas)
  for (const it of p.items)
    if (!resolves(it.cite)) { console.error(`MISSING cite: ${p.slug} -> ${it.cite}`); missing++; }
if (missing) process.exit(1);

const CSS = `
:root{--paper:#f6efd8;--paper-deep:#ecdfc3;--ink:#002868;--ink-soft:#2a4a8a;--crimson:#b22234;--gold:#9a6e14;--rule:#b8a882}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--paper);color:var(--ink);font-family:'Newsreader',Georgia,serif;font-size:19px;line-height:1.6;background-image:radial-gradient(ellipse 90% 60% at 50% -10%, rgba(154,110,20,.07), transparent 60%)}
.bunting{height:6px;background:linear-gradient(90deg,var(--ink) 0 33.3%,var(--paper-deep) 33.3% 66.6%,var(--crimson) 66.6% 100%)}
.sheet{max-width:760px;margin:0 auto;padding:28px 24px 72px}
.crumb{font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.18em;text-transform:uppercase}
.crumb a{color:var(--crimson);text-decoration:none}
h1{font-family:'Fraunces',serif;font-weight:900;font-size:clamp(30px,6vw,50px);margin:14px 0 10px}
.intro{color:var(--ink-soft);font-style:italic;margin-bottom:8px}
.disclaim{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--crimson);margin:10px 0 22px}
.item{border-top:1px solid var(--rule);padding:16px 0}
.item .cite{font-family:'IBM Plex Mono',monospace;font-size:13px;letter-spacing:.1em;text-transform:uppercase}
.item .cite a{color:var(--crimson);text-decoration:none;border-bottom:1px dotted var(--crimson)}
.item .note{color:var(--ink-soft);font-size:17px;margin-top:5px}
.caveat{background:#fffdf6;border-left:4px solid var(--gold);padding:12px 16px;margin-top:24px;font-size:17px;color:var(--ink-soft)}
.caveat span{display:block;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);margin-bottom:4px}
.askcta{display:inline-block;margin-top:26px;background:var(--crimson);color:#fffdf6;text-decoration:none;font-family:'IBM Plex Mono',monospace;font-size:13px;letter-spacing:.12em;text-transform:uppercase;padding:12px 22px}
footer{margin-top:38px;border-top:4px double var(--rule);padding-top:14px;font-size:15px;color:var(--ink-soft)}
footer a{color:var(--crimson)}
.plist{list-style:none;margin-top:8px}
.plist li{margin:10px 0}
.plist a{color:var(--ink);text-decoration:none;border-bottom:1px dotted var(--rule);font-size:20px}
.pgroup{margin:28px 0 0}
.pgroup-label{font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);margin-bottom:14px}
.pgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.pcard{border:1px solid var(--rule);background:#fffdf6;padding:14px 16px;transition:border-color .15s}
.pcard:hover{border-color:var(--crimson)}
.pcard a{color:var(--crimson);text-decoration:none;font-size:19px;display:block}
.pcard .teaser{color:var(--ink-soft);font-size:15px;margin-top:5px;line-height:1.45}
@media(max-width:600px){.pgrid{grid-template-columns:1fr}}
`.trim();

const head = (title, desc, canonical) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} &middot; Ask the Declaration</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${SITE}/og.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,900&family=Newsreader:ital,opsz,wght@0,6..72,400;1,6..72,400&family=IBM+Plex+Mono:wght@400&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<div class="bunting"></div>
<div class="sheet">
<p class="crumb"><a href="/">Ask the Declaration</a> &rarr; <a href="/rights/">Your rights, by who you are</a></p>`;

const foot = `
<footer>The founding documents' own provisions, gathered for one life. This page describes, it does not advise. Not legal advice.
<br><a href="/">Ask a question</a> &#10022; <a href="/how.html">Under the Hood</a> &#10022; <a href="/about.html">About</a></footer>
</div>
</body>
</html>`;

fs.mkdirSync(path.join(__dirname, "public", "rights"), { recursive: true });
const urls = [];

for (const p of personas) {
  const canonical = `${SITE}/rights/${p.slug}.html`;
  const title = `My Rights as ${p.title.replace(/^(A|An|Someone) /, "")}`;
  let html = head(title, p.intro.slice(0, 155), canonical);
  html += `\n<h1>${esc(p.title)}</h1>\n<p class="intro">${esc(p.intro)}</p>\n<p class="disclaim">Descriptive, not legal advice &middot; the founding documents' own words</p>`;
  for (const it of p.items) {
    html += `\n<div class="item"><div class="cite"><a href="/?q=${encodeURIComponent(it.cite)}">${esc(it.cite)}</a></div><p class="note">${esc(it.note)}</p></div>`;
  }
  html += `\n<div class="caveat"><span>The honest caveat</span>${esc(p.caveat)}</div>`;
  html += `\n<a class="askcta" href="/?q=${encodeURIComponent("my rights as " + p.title.replace(/^(A|An|Someone) /, "").toLowerCase())}">Ask your own question &rarr;</a>`;
  html += foot;
  fs.writeFileSync(path.join(__dirname, "public", "rights", `${p.slug}.html`), html);
  urls.push(canonical);
}

// Persona grouping for the index: lead with everyday, civic identities, then the harder cases.
const bySlug = Object.fromEntries(personas.map((p) => [p.slug, p]));
const teaser = (o) => { const s = o.intro.split(/\.(\s|$)/)[0].trim(); return s.length > 135 ? s.slice(0, 132).trim() + "…" : s + "."; };
const personaGroups = [
  { label: "In everyday civic life", slugs: ["voter", "student", "homeowner", "taxpayer", "juror", "woman", "journalist", "business-owner"] },
  { label: "When your rights are tested", slugs: ["protester", "under-arrest", "gun-owner", "immigrant", "criminal-defendant"] },
];
const personaCard = (p) => `\n<div class="pcard"><a href="/rights/${p.slug}.html">My rights as ${esc(p.title.replace(/^(A|An|Someone) /, "").toLowerCase())}</a><div class="teaser">${esc(teaser(p))}</div></div>`;

// rights index
{
  let html = head("Your Rights, By Who You Are", "America's founding documents mapped to real lives: voters, students, homeowners, taxpayers, jurors, journalists, business owners, and more.", `${SITE}/rights/`);
  html += `\n<h1>Your Rights, By Who You Are</h1>\n<p class="intro">Nobody thinks in amendment numbers. Pick who you are, and see where the founding documents touch your life, in their own words.</p>`;
  for (const g of personaGroups) {
    const cards = g.slugs.map((s) => bySlug[s]).filter(Boolean).map(personaCard).join("");
    html += `\n<div class="pgroup"><div class="pgroup-label">${g.label}</div><div class="pgrid">${cards}</div></div>`;
  }
  html += foot;
  fs.writeFileSync(path.join(__dirname, "public", "rights", "index.html"), html);
}

// reader-lens pages: /lenses/<slug>.html + /lenses/index.html. Same corpus, different frame.
fs.mkdirSync(path.join(__dirname, "public", "lenses"), { recursive: true });
const lensCrumb = (h) => h.replace('/rights/">Your rights, by who you are', '/lenses/">Ways to read the founding documents');
const lensUrls = [];
for (const l of lenses) {
  const canonical = `${SITE}/lenses/${l.slug}.html`;
  let html = lensCrumb(head(`Reading as ${l.title}`, l.intro.slice(0, 155), canonical));
  html += `\n<h1>${esc(l.title)}</h1>\n<p class="intro">${esc(l.intro)}</p>\n<p class="disclaim">A way of reading, not a verdict &middot; the founding documents' own words</p>`;
  html += `\n<p style="margin:20px 0 6px;font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--gold)">Try these, in this frame of mind</p>\n<ul class="plist">`;
  for (const q of l.questions) html += `\n<li><a href="/?q=${encodeURIComponent(q)}">${esc(q)}</a></li>`;
  html += `\n</ul>\n<a class="askcta" href="/">Ask your own question &rarr;</a>` + foot;
  fs.writeFileSync(path.join(__dirname, "public", "lenses", `${l.slug}.html`), html);
  lensUrls.push(canonical);
}
{
  let html = lensCrumb(head("Ways to Read the Founding Documents", "Four lenses on the same text: the Originalist, the Plain-English Reader, the Skeptic, and the New Citizen.", `${SITE}/lenses/`));
  html += `\n<h1>Ways to Read the Founding Documents</h1>\n<p class="intro">The same sentence reads differently depending on who is reading it. Pick a frame of mind and see where it takes you.</p>`;
  html += `\n<div class="pgroup"><div class="pgrid">` + lenses.map((l) => `\n<div class="pcard"><a href="/lenses/${l.slug}.html">${esc(l.title)}</a><div class="teaser">${esc(teaser(l))}</div></div>`).join("") + `</div></div>` + foot;
  fs.writeFileSync(path.join(__dirname, "public", "lenses", "index.html"), html);
}

// sitemap.xml (top pages + rights + lenses)
const staticUrls = ["/", "/how.html", "/about.html", "/review.html", "/rights/", "/lenses/"];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticUrls.map((u) => SITE + u), ...urls, ...lensUrls].map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}
</urlset>
`;
fs.writeFileSync(path.join(__dirname, "public", "sitemap.xml"), sitemap);

// robots.txt
fs.writeFileSync(path.join(__dirname, "public", "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(`${personas.length} persona pages + ${lenses.length} lens pages + indexes written, sitemap.xml (${staticUrls.length + urls.length + lensUrls.length} urls) and robots.txt updated`);
