import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../dist/index.js";

// --- mocks -------------------------------------------------------------
const store = new Map();
globalThis.caches = {
  default: {
    async match(req) { const r = store.get(req.url); return r ? r.clone() : undefined; },
    async put(req, res) { store.set(req.url, res.clone()); },
  },
};
const ctx = { waitUntil() {} };
const env = {
  ALLOWED_ORIGINS: "https://skoers.github.io",
  AI: {
    async run(_model, { messages }) {
      const user = messages.at(-1).content;
      // "vertaal": prefix elke alinea met NL:
      return { response: user.replace(/<p>([\s\S]*?)<\/p>/g, (_, t) => `<p>NL: ${t}</p>`) };
    },
  },
};
const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>BBC News</title><language>en-gb</language>
<item><title><![CDATA[Rates held &amp; markets react]]></title><link>https://www.bbc.co.uk/news/articles/abc</link><description><![CDATA[<p>The Bank of England held rates.</p>]]></description><pubDate>Tue, 28 Oct 2026 10:00:00 GMT</pubDate><media:thumbnail url="https://ichef.bbci.co.uk/x.jpg" width="240"/><category>Business</category></item>
<item><title>No link item</title><description>x</description></item>
<item><title>Guid item</title><guid isPermaLink="true">https://www.bbc.co.uk/news/2</guid><enclosure url="/img/rel.jpg" type="image/jpeg"/><pubDate>garbage</pubDate></item>
</channel></rss>`;
const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xml:lang="nl"><title>Tweakers</title>
<entry><title>Nieuwe chip</title><link rel="alternate" href="https://tweakers.net/nieuws/1"/><link rel="enclosure" href="https://tweakers.net/x.png" type="image/png"/><summary type="html">&lt;b&gt;Intro&lt;/b&gt; tekst</summary><updated>2026-10-28T09:00:00Z</updated><category term="Hardware"/></entry></feed>`;
const HTML = `<!doctype html><html lang="en"><head><title>Rates held - BBC</title><meta property="og:image" content="/pic.jpg"><meta property="og:site_name" content="BBC News"></head>
<body><nav><a href="/">Home</a><a href="/sport">Sport</a></nav><article><h1>Rates held</h1><p class="byline">By Jane Doe</p>
${Array.from({length: 8}, (_, i) => `<p>Paragraph number ${i} of the article body, with enough words to count as real content for the extractor to keep it around.</p>`).join("\n")}
<h2>Markets</h2><p>Markets had priced in a cut, and traders responded quickly to the decision by selling gilts across the curve.</p></article>
<footer><p>Copyright BBC. All rights reserved and some more footer text here.</p></footer></body></html>`;
const PAYWALLED = `<!doctype html><html><head><script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script></head><body><article><p>Short teaser only. Subscribe to continue reading this article today.</p></article></body></html>`;

globalThis.fetch = async (url) => {
  const body = url.includes("rss") ? RSS : url.includes("atom") ? ATOM : url.includes("paywall") ? PAYWALLED : HTML;
  return new Response(body, { status: 200, headers: { "content-type": "text/html" }, });
};
const call = (path, init) => worker.fetch(new Request("https://api.test" + path, { headers: { Origin: "https://skoers.github.io" }, ...init }), env, ctx);

// --- tests -------------------------------------------------------------
test("RSS 2.0 feed is normalised", async () => {
  const res = await call("/feed?url=https://example.com/rss.xml");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.source, "BBC News");
  assert.equal(data.items.length, 2, "item zonder link wordt overgeslagen");
  const [a, b] = data.items;
  assert.equal(a.title, "Rates held & markets react");
  assert.equal(a.link, "https://www.bbc.co.uk/news/articles/abc");
  assert.equal(a.image, "https://ichef.bbci.co.uk/x.jpg");
  assert.equal(a.summary, "The Bank of England held rates.");
  assert.deepEqual(a.categories, ["business"]);
  assert.equal(a.lang, "en");
  assert.equal(a.published, "2026-10-28T10:00:00.000Z");
  assert.equal(b.link, "https://www.bbc.co.uk/news/2");
  assert.equal(b.image, "https://www.bbc.co.uk/img/rel.jpg");
});

test("Atom feed is normalised", async () => {
  const data = await (await call("/feed?url=https://example.com/atom.xml")).json();
  assert.equal(data.source, "Tweakers");
  assert.equal(data.items[0].link, "https://tweakers.net/nieuws/1");
  assert.equal(data.items[0].summary, "Intro tekst");
  assert.equal(data.items[0].lang, "nl");
  assert.deepEqual(data.items[0].categories, ["hardware"]);
});

test("feed response is cached", async () => {
  const res = await call("/feed?url=https://example.com/rss.xml");
  assert.equal(res.headers.get("X-Cache"), "HIT");
});

const hasRewriter = typeof globalThis.HTMLRewriter !== "undefined";
test("article is extracted and translated", { skip: !hasRewriter && "HTMLRewriter alleen in workerd; zie test/integration.mjs" }, async () => {
  const data = await (await call("/article?url=https://www.bbc.co.uk/news/articles/abc")).json();
  assert.equal(data.paywall, false);
  assert.equal(data.lang, "en");
  assert.equal(data.image, "https://www.bbc.co.uk/pic.jpg");
  assert.ok(data.paragraphs.length >= 9, `paragraphs: ${data.paragraphs.length}`);
  assert.ok(data.paragraphs.some((p) => p.startsWith("## Markets")));
  assert.ok(!data.paragraphs.some((p) => /Copyright/.test(p)), "footer verwijderd");
  assert.equal(data.translated.length, data.paragraphs.length);
  assert.ok(data.translated.every((p) => p.startsWith("NL: ")));
  assert.ok(data.titleTranslated.startsWith("NL: "));
});

test("paywall is detected and not translated", { skip: !hasRewriter && "zie integration" }, async () => {
  const data = await (await call("/article?url=https://paywall.example.com/x")).json();
  assert.equal(data.paywall, true);
  assert.equal(data.translated, null);
});

test("translate batch + per-text cache", async () => {
  const body = JSON.stringify({ texts: ["Hello world", "", "Second"], source: "en" });
  const r1 = await (await call("/translate", { method: "POST", body })).json();
  assert.deepEqual(r1.translations, ["NL: Hello world", "", "NL: Second"]);
  env.AI.run = async () => { throw new Error("should hit cache"); };
  const r2 = await (await call("/translate", { method: "POST", body })).json();
  assert.deepEqual(r2.translations, r1.translations);
});

test("CORS: unknown origin is refused", async () => {
  const res = await worker.fetch(new Request("https://api.test/health", { headers: { Origin: "https://evil.example" } }), env, ctx);
  assert.equal(res.status, 403);
});
