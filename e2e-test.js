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
  await page.goto(URL, { waitUntil: "domcontentloaded" });

  await page.waitForSelector(".status.ready", { timeout: 180000 });
  console.log("MODEL READY:", await page.$eval("#statusText", (e) => e.textContent));

  // 1. Chip question triggers a curated short answer with pinned citations
  await page.click(".chip"); // first chip: "Why did the colonies separate from Britain?"
  await page.waitForSelector(".result", { timeout: 30000 });
  const hasShortAnswer = (await page.$(".shortanswer")) !== null;
  check("chip shows The Short Answer box", hasShortAnswer);
  const firstCite = await page.$eval(".result .cite", (e) => e.textContent.trim());
  check("pinned passage first (Preamble)", /Preamble/.test(firstCite), firstCite);

  // 2. Results carry plain-words explainers + the lineage nudge
  const plainCount = await page.$$eval(".result .plain", (els) => els.length);
  check("plain-words explainers render", plainCount >= 3, `${plainCount} of 5`);
  check("lineage nudge after results", (await page.$("#results .worldnudge")) !== null);

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

  // 6b. Responsive: ribbon on narrow screens, sticky rail on wide screens
  const ribbonCount = await page.$$eval(".ribbon button", (els) => els.length);
  check("mobile flag ribbon has 12 flags", ribbonCount === 12, `${ribbonCount}`);
  const ribbonVisibleNarrow = await page.$eval(".ribbon", (e) => getComputedStyle(e).display !== "none");
  check("ribbon visible on narrow viewport", ribbonVisibleNarrow);
  await page.setViewport({ width: 1280, height: 900 });
  const wide = await page.evaluate(() => ({
    grid: getComputedStyle(document.querySelector(".layout")).display,
    ribbon: getComputedStyle(document.querySelector(".ribbon")).display,
    railHasWorld: !!document.querySelector(".rail #world"),
  }));
  check("desktop two-column grid active", wide.grid === "grid", wide.grid);
  check("ribbon hidden on desktop", wide.ribbon === "none");
  check("world section lives in the rail", wide.railHasWorld);
  await page.setViewport({ width: 800, height: 600 });

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
