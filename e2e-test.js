// End-to-end test: loads the page in real Chrome, waits for the model,
// then verifies (1) curated short answers, (2) plain-words explainers,
// (3) passage-only fallback, and (4) the world flags accordion.
const puppeteer = require("puppeteer-core");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = process.argv[2] || "http://localhost:8317/index.html";
let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
  const page = await browser.newPage();
  page.on("pageerror", (e) => check("no page errors", false, e.message));
  const consoleLogs = [];
  page.on("console", (m) => consoleLogs.push(m.text()));
  await page.goto(URL, { waitUntil: "domcontentloaded" });

  await page.waitForSelector(".status.ready", { timeout: 180000 });
  console.log("MODEL READY:", await page.$eval("#statusText", (e) => e.textContent));

  // 1. Chip question triggers a curated short answer with pinned citations
  // DOM click: flag images lazy-loading above cause layout shift that makes
  // coordinate-based clicks land on the wrong chip
  await page.$eval(".chip", (el) => el.click()); // first chip: colonies question
  await page.waitForSelector(".result", { timeout: 30000 });
  const hasShortAnswer = (await page.$(".shortanswer")) !== null;
  check("chip shows The Short Answer box", hasShortAnswer);
  const firstCite = await page.$eval(".result .cite", (e) => e.textContent.trim());
  check("pinned passage first (Preamble)", /Preamble/.test(firstCite), firstCite);

  // 2. Results carry plain-words explainers
  const plainCount = await page.$$eval(".result .plain", (els) => els.length);
  check("plain-words explainers render", plainCount >= 3, `${plainCount} of 5`);

  // Helper: clear stale results, run a fresh query, wait for new results
  const runQuery = async (text) => {
    await page.evaluate(() => {
      document.getElementById("results").innerHTML = "";
      document.getElementById("q").value = "";
    });
    await page.type("#q", text);
    await page.click("#go");
    await page.waitForSelector("#results .result", { timeout: 30000 });
  };

  // 3. Paraphrase (not exact chip text) still gets curated answer
  await runQuery("is free speech protected");
  const saText = await page
    .$eval(".shortanswer p", (e) => e.textContent)
    .catch(() => "");
  check("paraphrase triggers curated answer", /First Amendment/.test(saText), saText.slice(0, 60));

  // 4. Off-corpus-question query: passages only, no curated box
  await runQuery("letters of marque and reprisal");
  const hasBox = (await page.$("#results .shortanswer")) !== null;
  check("niche query falls back to passages only", !hasBox);

  // 5. Flags accordion
  const flagCount = await page.$$eval(".flagbtn", (els) => els.length);
  check("12 flags render", flagCount === 12, `${flagCount}`);
  // DOM click: coordinate clicks go stale mid smooth-scroll animation
  await page.$$eval(".flagbtn", (els) => els[els.length - 1].click()); // India last
  await page.waitForSelector(".flagcard.open", { timeout: 5000 });
  const cardText = await page.$eval(".flagcard", (e) => e.textContent);
  check("India card opens with content", /Ambedkar/.test(cardText));
  const srcLink = await page
    .$eval(".flagcard .fc-src a", (e) => e.href)
    .catch(() => "");
  check("flag card shows Source citation link", /legislative\.gov\.in/.test(srcLink), srcLink);

  // 6. Home page is clean: no arch section; trust strip links to how.html
  check("arch section moved off home page", (await page.$("#how")) === null);
  check("trust strip links to how.html", (await page.$('.trust a[href="how.html"]')) !== null);

  // 6b. World section sits above the search box
  const worldFirst = await page.evaluate(() => {
    const world = document.getElementById("world");
    const ask = document.querySelector(".ask");
    return !!(world && ask && world.compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  check("world flags section precedes the search box", worldFirst);

  // 7b. Share + guardrails
  await runQuery("What protects free speech?");
  check("share button after results", (await page.$("#results .sharebtn")) !== null);
  check("non-endorsement note after results", (await page.$("#results .resnote")) !== null);

  // 7c. Deep link ?q= auto-runs the query
  await page.goto(URL + "?q=" + encodeURIComponent("How do you amend the Constitution?"), { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status.ready", { timeout: 120000 });
  await page.waitForSelector("#results .result", { timeout: 30000 });
  const deepCite = await page.$eval("#results .cite", (e) => e.textContent);
  check("deep link auto-runs shared query", /Article V/.test(deepCite), deepCite.trim());

  // 8. Easter eggs
  check("console declaration egg", consoleLogs.some((t) => /self-evident/.test(t)));
  await runQuery("is a hot dog a sandwich");
  const hotdog = await page.$eval(".shortanswer p", (e) => e.textContent).catch(() => "");
  check("hot dog joke answer", /kitchen, your call/.test(hotdog), hotdog.slice(0, 50));
  await page.$eval("#q", (e) => e.blur());
  for (const k of ["ArrowUp","ArrowUp","ArrowDown","ArrowDown","ArrowLeft","ArrowRight","ArrowLeft","ArrowRight","KeyB","KeyA"]) {
    await page.keyboard.press(k);
  }
  await page.waitForSelector("canvas.fx", { timeout: 3000 })
    .then(() => check("konami fireworks", true))
    .catch(() => check("konami fireworks", false));

  // 9. 404 page (Vercel serves 404.html; python http.server does not)
  if (/vercel\.app/.test(URL)) {
    const resp = await page.goto(URL.replace(/index\.html$/, "no-such-page"), { waitUntil: "domcontentloaded" });
    const notFoundText = await page.evaluate(() => document.body.textContent);
    check("404 page styled", resp.status() === 404 && /Grievance 28/.test(notFoundText), `status ${resp.status()}`);
    await page.goBack({ waitUntil: "domcontentloaded" });
  }

  // 7. Under the Hood page loads with the pipeline and economics sections
  const howUrl = URL.replace(/index\.html$/, "how.html").replace(/\/$/, "/how.html");
  await page.goto(howUrl, { waitUntil: "domcontentloaded" });
  const howText = await page.$eval("article", (e) => e.textContent);
  check("how.html has pipeline + economics", /91 citation-ready passages/.test(howText) && /Economics of Zero/i.test(howText));

  await page.screenshot({ path: "shots/v2-results.png", fullPage: false });
  await browser.close();
  console.log(failures ? `${failures} FAILURES` : "ALL CHECKS PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error("E2E FAILED:", e.message);
  process.exit(1);
});
