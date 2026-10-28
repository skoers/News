// Integratietest: draait de Worker in workerd (wrangler dev) tegen een lokale mock-nieuwssite.
import http from "node:http";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const HTML = `<!doctype html><html lang="en"><head><title>Rates held - BBC</title>
<meta property="og:image" content="/pic.jpg"><meta property="og:site_name" content="BBC News"><meta property="og:title" content="Rates held: what it means"></head>
<body><header><nav><ul><li><a href="/">Home</a></li><li><a href="/sport">Sport and more words here</a></li></ul></nav></header>
<main><article><h1>Rates held</h1><p class="byline">By Jane Doe</p>
${Array.from({ length: 8 }, (_, i) => `<p>Paragraph number ${i} of the article body, with <a href="/x">one link</a> and enough words to count as real content for the extractor to keep it.</p>`).join("\n")}
<figure><img src="x.jpg"><figcaption>A caption that is long enough to be kept by the extractor</figcaption></figure>
<h2>Markets</h2><p>Markets had priced in a cut, and traders responded quickly to the decision by selling gilts across the curve.</p>
<ul><li><a href="/a">Related story one with a long title</a></li><li><a href="/b">Related story two with a long title</a></li></ul>
<h2>Related</h2></article></main>
<aside><p>Sidebar promo text that should definitely not be part of the article body at all.</p></aside>
<footer><p>Copyright BBC. All rights reserved and some more footer text here.</p></footer></body></html>`;
const PAYWALLED = `<!doctype html><html><head><script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script></head><body><article><p>Short teaser only. Subscribe to continue reading this article today.</p></article></body></html>`;
const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Mock</title><item><title>A</title><link>http://127.0.0.1:8899/article</link><media:thumbnail url="http://127.0.0.1:8899/t.jpg"/><pubDate>Tue, 28 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`;

const mock = http.createServer((req, res) => {
  const body = req.url.startsWith("/rss") ? RSS : req.url.startsWith("/paywall") ? PAYWALLED : HTML;
  res.writeHead(200, { "content-type": req.url.startsWith("/rss") ? "application/rss+xml" : "text/html" });
  res.end(body);
});
await new Promise((r) => mock.listen(8899, "127.0.0.1", r));

const wr = spawn("npx", ["wrangler", "dev", "--config", "test/wrangler.test.toml", "--port", "8787", "--ip", "127.0.0.1"], {
  stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
});
let log = "";
wr.stdout.on("data", (d) => (log += d));
wr.stderr.on("data", (d) => (log += d));

const api = "http://127.0.0.1:8787";
const deadline = Date.now() + 90000;
while (Date.now() < deadline) {
  try { const r = await fetch(api + "/health"); if (r.ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}
let failed = false;
try {
  const feed = await (await fetch(`${api}/feed?url=${encodeURIComponent("http://127.0.0.1:8899/rss")}`)).json();
  assert.equal(feed.items[0].image, "http://127.0.0.1:8899/t.jpg");
  console.log("ok feed");

  const art = await (await fetch(`${api}/article?translate=0&url=${encodeURIComponent("http://127.0.0.1:8899/article")}`)).json();
  console.log(JSON.stringify(art, null, 1));
  assert.equal(art.paywall, false);
  assert.equal(art.title, "Rates held: what it means");
  assert.equal(art.image, "http://127.0.0.1:8899/pic.jpg");
  assert.equal(art.lang, "en");
  assert.ok(art.paragraphs.filter((p) => p.startsWith("Paragraph number")).length === 8, "8 alinea's");
  assert.ok(art.paragraphs.includes("## Markets"));
  assert.ok(!art.paragraphs.some((p) => /Copyright|Sidebar|Related story|Home/.test(p)), "ruis verwijderd");
  assert.ok(!art.paragraphs.at(-1).startsWith("## "), "geen kop als laatste");
  console.log("ok article");

  const pw = await (await fetch(`${api}/article?translate=0&url=${encodeURIComponent("http://127.0.0.1:8899/paywall")}`)).json();
  assert.equal(pw.paywall, true);
  console.log("ok paywall");
} catch (e) {
  failed = true;
  console.error("FAIL", e.message);
  console.error(log.slice(-3000));
} finally {
  wr.kill("SIGTERM");
  mock.close();
}
process.exit(failed ? 1 : 0);
