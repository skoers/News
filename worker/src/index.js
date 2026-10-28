/**
 * Mijn Nieuws – Cloudflare Worker backend
 *
 * Routes:
 *   GET  /feed?url=<rss|atom>          → genormaliseerde lijst artikelen (cache 10 min)
 *   GET  /article?url=<pagina>&translate=1 → leesbare tekst (Readability), optioneel vertaald (cache 24 u)
 *   POST /translate  { texts: [..], source?: 'en' } → NL vertalingen (cache per tekst)
 *   GET  /health
 *
 * Vertalen gebeurt met Workers AI (standaard Mistral Small, instelbaar via env.TRANSLATE_MODEL).
 */

const DEFAULT_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";
const FEED_TTL = 600;        // 10 min
const ARTICLE_TTL = 86400;   // 24 u
const TRANSLATE_TTL = 86400 * 7;
const UA =
  "Mozilla/5.0 (compatible; MijnNieuwsBot/1.0; +https://github.com/skoers/News)";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (!cors["Access-Control-Allow-Origin"]) {
      return json({ error: "origin not allowed" }, 403, cors);
    }

    try {
      switch (url.pathname) {
        case "/health":
          return json({ ok: true, model: env.TRANSLATE_MODEL || DEFAULT_MODEL }, 200, cors);
        case "/feed":
          return withCache(request, ctx, FEED_TTL, cors, () => handleFeed(url));
        case "/article":
          return withCache(request, ctx, ARTICLE_TTL, cors, () => handleArticle(url, env));
        case "/translate":
          if (request.method !== "POST") return json({ error: "POST required" }, 405, cors);
          return json(await handleTranslate(await request.json(), env, ctx), 200, cors);
        default:
          return json({ error: "not found" }, 404, cors);
      }
    } catch (err) {
      return json({ error: String(err?.message || err) }, 500, cors);
    }
  },
};

/* ---------------- helpers ---------------- */

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ok =
    !origin ||
    allowed.includes("*") ||
    allowed.includes(origin) ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const h = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (ok) h["Access-Control-Allow-Origin"] = origin || "*";
  return h;
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

/** Cache GET-responses in de Cloudflare edge cache, gekeyed op de volledige request-URL. */
async function withCache(request, ctx, ttl, cors, producer) {
  const cache = caches.default;
  const key = new Request(request.url, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) {
    const res = new Response(hit.body, hit);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    res.headers.set("X-Cache", "HIT");
    return res;
  }
  const data = await producer();
  const res = json(data, 200, {
    ...cors,
    "Cache-Control": `public, max-age=${ttl}`,
    "X-Cache": "MISS",
  });
  if (!data?.error) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

function requireHttpUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("ongeldige url");
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("alleen http(s)");
  return u;
}

async function fetchText(u, accept) {
  const res = await fetch(u.toString(), {
    headers: {
      "User-Agent": UA,
      Accept: accept,
      "Accept-Language": "nl,en;q=0.8",
    },
    redirect: "follow",
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`bron gaf ${res.status}`);
  return { text: await res.text(), finalUrl: res.url || u.toString(), contentType: res.headers.get("content-type") || "" };
}

/* ---------------- /feed ---------------- */

async function handleFeed(url) {
  const src = requireHttpUrl(url.searchParams.get("url"));
  const { text, finalUrl } = await fetchText(
    src,
    "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5"
  );
  const feed = parseFeed(text, finalUrl);
  return {
    source: feed.title || new URL(finalUrl).hostname,
    url: finalUrl,
    fetched: new Date().toISOString(),
    items: feed.items,
  };
}

/* ---- compacte RSS 2.0 / Atom / RDF parser (geen externe dependency) ---- */

function parseFeed(xml, feedUrl) {
  xml = String(xml).replace(/^\uFEFF/, "").replace(/<!--[\s\S]*?-->/g, "");
  const itemRe = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/g;
  const blocks = [];
  let m;
  while ((m = itemRe.exec(xml))) blocks.push(m[2]);
  if (!blocks.length && !/<(rss|feed|rdf:RDF)[\s>]/.test(xml)) throw new Error("geen RSS/Atom-feed gevonden");
  const head = xml.slice(0, blocks.length ? xml.search(/<(item|entry)(?:\s[^>]*)?>/) : xml.length);
  const isAtom = /<feed[\s>]/.test(head) && !/<rss[\s>]/.test(head);
  const title = clean(stripHtml(tagText(head, "title")));
  let lang = isAtom ? attrOf(firstTag(head, "feed"), "xml:lang") : tagText(head, "language");
  lang = (lang || "").slice(0, 2).toLowerCase() || guessLang(feedUrl);

  const items = blocks
    .map((b) => {
      const link = blockLink(b, feedUrl);
      if (!link) return null;
      const titleRaw = tagText(b, "title");
      const descHtml = tagText(b, "content:encoded") || tagText(b, "description") || tagText(b, "summary") || tagText(b, "content") || "";
      const published = parseDate(tagText(b, "pubDate") || tagText(b, "published") || tagText(b, "updated") || tagText(b, "dc:date") || "");
      const categories = [...new Set(
        allTags(b, "category").map((t) => clean(stripHtml(t.text || attrOf(t.open, "term") || "")).toLowerCase()).filter(Boolean)
      )].slice(0, 8);
      return {
        id: hashString(link),
        title: clean(stripHtml(titleRaw)),
        link,
        summary: clean(stripHtml(descHtml)).slice(0, 400),
        image: blockImage(b, descHtml, link),
        published,
        categories,
        lang,
      };
    })
    .filter((x) => x && x.title)
    .slice(0, 60);
  return { title, items };
}

/** Eerste <name ...>...</name> (geen self-closing); CDATA uitgepakt, entities nog niet gedecodeerd. */
function tagText(block, name) {
  const re = new RegExp(`<${escapeRe(name)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRe(name)}\\s*>`, "i");
  const m = re.exec(block);
  return m ? unCdata(m[1]) : "";
}
function allTags(block, name) {
  const re = new RegExp(`<${escapeRe(name)}(\\s[^>]*)?(?:/>|>([\\s\\S]*?)<\\/${escapeRe(name)}\\s*>)`, "gi");
  const out = [];
  let m;
  while ((m = re.exec(block))) out.push({ open: m[1] || "", text: unCdata(m[2] || "") });
  return out;
}
function firstTag(block, name) {
  const m = new RegExp(`<${escapeRe(name)}(\\s[^>]*)?>`, "i").exec(block);
  return m ? m[1] || "" : "";
}
function attrOf(attrs, name) {
  const m = new RegExp(`(?:^|\\s)${escapeRe(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attrs || "");
  return m ? decodeXml(m[1] ?? m[2] ?? "") : "";
}
function unCdata(s) {
  return /<!\[CDATA\[/.test(s) ? s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1") : decodeXml(s);
}
function decodeXml(s) {
  return String(s).replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (all, e) => {
    const l = e.toLowerCase();
    if (l === "amp") return "&";
    if (l === "lt") return "<";
    if (l === "gt") return ">";
    if (l === "quot") return '"';
    if (l === "apos") return "'";
    try {
      return String.fromCodePoint(l[1] === "x" ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10));
    } catch {
      return all;
    }
  });
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function blockLink(b, feedUrl) {
  let link = "";
  // Atom: <link rel="alternate" href="..."/> (of zonder rel)
  const links = allTags(b, "link");
  const atom = links.filter((l) => attrOf(l.open, "href"));
  if (atom.length) {
    const alt = atom.find((l) => !attrOf(l.open, "rel") || attrOf(l.open, "rel") === "alternate") || atom[0];
    link = attrOf(alt.open, "href");
  } else {
    // RSS: <link>https://...</link>
    link = (links.find((l) => /^\s*https?:/i.test(l.text))?.text || "").trim();
  }
  if (!link) {
    const guid = tagText(b, "guid").trim();
    if (/^https?:/i.test(guid)) link = guid;
  }
  if (!link) {
    const about = attrOf(firstTag(b, "item"), "rdf:about");
    if (/^https?:/i.test(about)) link = about;
  }
  link = String(link || "").trim();
  if (!link) return "";
  try {
    return new URL(link, feedUrl).toString();
  } catch {
    return "";
  }
}

function blockImage(b, descHtml, link) {
  const cands = [...allTags(b, "media:content"), ...allTags(b, "media:thumbnail"), ...allTags(b, "enclosure"), ...allTags(b, "image"), ...allTags(b, "itunes:image")];
  for (const c of cands) {
    const u = attrOf(c.open, "url") || attrOf(c.open, "href") || (c.text && /^\s*https?:/.test(c.text) ? c.text.trim() : "");
    const type = attrOf(c.open, "type");
    const medium = attrOf(c.open, "medium");
    if (!u) continue;
    if (type.startsWith("image") || medium === "image" || /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(u) || (!type && !medium)) {
      try {
        return new URL(u, link).toString();
      } catch {}
    }
  }
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(descHtml || "");
  if (m) {
    try {
      return new URL(decodeXml(m[1]), link).toString();
    } catch {}
  }
  return "";
}

/* ---------------- /article ---------------- */

const PAYWALL_MARKERS = [
  /"isAccessibleForFree"\s*:\s*(false|"false")/i,
  /subscribe to (continue|read)/i,
  /already a subscriber/i,
  /this article is for subscribers/i,
  /sign in to (continue|read)/i,
  /word abonnee/i,
  /alleen voor abonnees/i,
  /lees verder met/i,
  /premium[- ]artikel/i,
];

async function handleArticle(url, env) {
  const target = requireHttpUrl(url.searchParams.get("url"));
  const translate = url.searchParams.get("translate") !== "0";
  const { text: html, finalUrl } = await fetchText(target, "text/html,application/xhtml+xml");

  const page = await extractPage(html);
  const paragraphs = page.paragraphs;
  const plainLen = paragraphs.join(" ").length;
  const lang =
    (page.lang || "").slice(0, 2).toLowerCase() || guessLangFromText(paragraphs.join(" ")) || guessLang(finalUrl);
  const markerHit = PAYWALL_MARKERS.some((re) => re.test(html));
  const paywall = markerHit && plainLen < 2500 ? true : plainLen < 500;

  const ogImage = page.meta["og:image"] || page.meta["twitter:image"] || "";
  const result = {
    url: finalUrl,
    title: clean(page.meta["og:title"] || page.h1 || page.title || ""),
    byline: clean(page.meta["author"] || page.meta["article:author"] || ""),
    siteName: clean(page.meta["og:site_name"] || new URL(finalUrl).hostname),
    image: ogImage ? safeAbs(ogImage, finalUrl) : "",
    lang,
    paywall,
    paragraphs,
    translated: null,
    titleTranslated: null,
  };

  if (translate && !paywall && lang !== "nl" && paragraphs.length) {
    const [body, title] = await Promise.all([
      translateParagraphs(paragraphs, lang, env),
      result.title ? translateBatch([result.title], lang, env).then((r) => r[0]) : "",
    ]);
    result.translated = body;
    result.titleTranslated = title || null;
  }
  return result;
}

/**
 * Readability-light op basis van de ingebouwde (streaming) HTMLRewriter:
 *  - negeert nav/footer/aside/header/forms/scripts etc.
 *  - verzamelt p/h2/h3/li/blockquote/figcaption, met voorkeur voor tekst binnen <article>/<main>
 *  - laat alinea's weg die vooral uit links bestaan (menu's, "lees ook"-lijstjes)
 */
const EXCLUDE_TAGS = ["nav", "footer", "aside", "header", "form", "script", "style", "noscript", "button", "svg", "iframe", "figure", "template", "select"];
const BLOCK_TAGS = ["p", "h2", "h3", "li", "blockquote", "figcaption"];
const MAIN_SEL = "article, main, [role=main], [itemprop=articleBody], .article-body, .article__body, .story-body";

async function extractPage(html) {
  const st = { excl: 0, main: 0, cur: null, blocks: [], title: "", h1: "", meta: {}, lang: "", inH1: false };
  let rw = new HTMLRewriter()
    .on("html", { element(e) { st.lang = e.getAttribute("lang") || ""; } })
    .on("meta", {
      element(e) {
        const k = e.getAttribute("property") || e.getAttribute("name");
        if (k && !(k in st.meta)) st.meta[k] = e.getAttribute("content") || "";
      },
    })
    .on("head > title", { text(t) { st.title += t.text; } })
    .on("h1", {
      element(e) { st.inH1 = true; e.onEndTag(() => { st.inH1 = false; }); },
      text(t) { if (st.inH1 && st.h1.length < 300) st.h1 += t.text; },
    })
    .on(EXCLUDE_TAGS.join(","), {
      element(e) { st.excl++; e.onEndTag(() => { st.excl--; }); },
    })
    .on(MAIN_SEL, {
      element(e) { st.main++; e.onEndTag(() => { st.main--; }); },
    });
  for (const tag of BLOCK_TAGS) {
    rw = rw.on(tag, {
      element(e) {
        const b = { tag, text: "", link: 0, excl: st.excl > 0, main: st.main > 0 };
        st.cur = b;
        st.blocks.push(b);
        e.onEndTag(() => { if (st.cur === b) st.cur = null; });
      },
      text(t) { if (st.cur && st.cur.tag === tag) st.cur.text += t.text; },
    });
  }
  rw = rw.on("a", { text(t) { if (st.cur) st.cur.link += t.text.length; } });
  await rw.transform(new Response(html)).arrayBuffer();

  const usable = st.blocks.filter((b) => {
    if (b.excl) return false;
    const t = clean(decodeEntities(b.text));
    b.clean = t;
    if (!t) return false;
    const heading = b.tag === "h2" || b.tag === "h3";
    if (!heading && t.length < 25) return false;
    if (t.length && b.link / t.length > 0.5) return false;
    return true;
  });
  const inMain = usable.filter((b) => b.main);
  const chosen = inMain.length >= 2 ? inMain : usable;
  const out = chosen.map((b) => {
    if (b.tag === "h2" || b.tag === "h3") return "## " + b.clean;
    if (b.tag === "blockquote") return "> " + b.clean;
    if (b.tag === "li") return "• " + b.clean;
    return b.clean;
  });
  // Trailing headings (bijv. "Gerelateerd") weghalen en opeenvolgende duplicaten verwijderen
  while (out.length && out[out.length - 1].startsWith("## ")) out.pop();
  return {
    paragraphs: out.filter((p, i) => p !== out[i - 1]).slice(0, 150),
    title: decodeEntities(st.title),
    h1: decodeEntities(st.h1),
    meta: st.meta,
    lang: st.lang,
  };
}

function decodeEntities(s) {
  return stripHtml(String(s ?? ""));
}

function safeAbs(u, base) {
  try {
    return new URL(u, base).toString();
  } catch {
    return "";
  }
}

/* ---------------- vertalen ---------------- */

const SYSTEM_PROMPT =
  "Je bent een professionele nieuwsvertaler. Vertaal de tekst van de gebruiker naar natuurlijk, vlot Nederlands. " +
  "Behoud de alinea-indeling exact: elke alinea staat tussen de markeringen <p> en </p>; geef evenveel <p>-blokken terug, in dezelfde volgorde. " +
  "Behoud namen, cijfers, citaten en markeringen zoals '## ', '> ' en '• ' aan het begin van een alinea. " +
  "Geef uitsluitend de vertaling, zonder uitleg, inleiding of commentaar.";

async function handleTranslate(body, env) {
  const texts = (Array.isArray(body?.texts) ? body.texts : []).map((t) => String(t || "").slice(0, 600)).slice(0, 80);
  const source = (body?.source || "en").slice(0, 2);
  if (!texts.length) return { translations: [] };
  const translations = await translateBatch(texts, source, env);
  return { translations };
}

/** Vertaal korte teksten (koppen) in één LLM-call, met cache per tekst. */
async function translateBatch(texts, source, env) {
  const cache = caches.default;
  const out = new Array(texts.length).fill(null);
  const todo = [];
  await Promise.all(
    texts.map(async (t, i) => {
      if (!t.trim()) {
        out[i] = t;
        return;
      }
      const key = cacheKey("t", source, t);
      const hit = await cache.match(key);
      if (hit) out[i] = await hit.text();
      else todo.push(i);
    })
  );
  for (let s = 0; s < todo.length; s += 25) {
    const idx = todo.slice(s, s + 25);
    const chunk = idx.map((i) => texts[i]);
    const res = await runLLM(wrapP(chunk), env);
    const parts = unwrapP(res, chunk.length);
    await Promise.all(
      idx.map((i, k) => {
        const v = parts[k] || texts[i];
        out[i] = v;
        return cache.put(
          cacheKey("t", source, texts[i]),
          new Response(v, { headers: { "Cache-Control": `public, max-age=${TRANSLATE_TTL}` } })
        );
      })
    );
  }
  return out;
}

/** Vertaal een heel artikel: alinea's gebundeld in blokken van ±2500 tekens, parallel. */
async function translateParagraphs(paragraphs, source, env) {
  const chunks = [];
  let cur = [];
  let len = 0;
  for (const p of paragraphs) {
    if (len + p.length > 2500 && cur.length) {
      chunks.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(p);
    len += p.length;
  }
  if (cur.length) chunks.push(cur);

  const results = await mapLimit(chunks, 4, async (chunk) => {
    const res = await runLLM(wrapP(chunk), env);
    return unwrapP(res, chunk.length).map((t, i) => t || chunk[i]);
  });
  return results.flat();
}

function wrapP(items) {
  return items.map((t) => `<p>${t}</p>`).join("\n");
}

function unwrapP(text, expected) {
  const parts = [...String(text).matchAll(/<p>([\s\S]*?)<\/p>/gi)].map((m) => clean(m[1]));
  if (parts.length === expected) return parts;
  // Fallback: splits op lege regels
  const alt = String(text)
    .replace(/<\/?p>/gi, "\n")
    .split(/\n\s*\n|\n/)
    .map(clean)
    .filter(Boolean);
  if (alt.length === expected) return alt;
  // Laatste redmiddel: vul aan / knip af zodat de indexen kloppen
  const base = parts.length ? parts : alt;
  return Array.from({ length: expected }, (_, i) => base[i] || "");
}

async function runLLM(userText, env) {
  const model = env.TRANSLATE_MODEL || DEFAULT_MODEL;
  const res = await env.AI.run(model, {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userText },
    ],
    max_tokens: 2500,
    temperature: 0.2,
  });
  return res?.response ?? res?.choices?.[0]?.message?.content ?? "";
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    })
  );
  return out;
}

function cacheKey(kind, source, text) {
  return new Request(`https://cache.mijn-nieuws.internal/${kind}/${source}/${hashString(text)}`);
}

/* ---------------- utils ---------------- */

function arr(x) {
  return x == null ? [] : Array.isArray(x) ? x : [x];
}
function textOf(v) {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object") return String(v["#text"] ?? v["@_href"] ?? "");
  return "";
}
function stripHtml(s) {
  return String(s)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
}
function clean(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}
function parseDate(s) {
  const d = new Date(s);
  return isNaN(d) ? new Date().toISOString() : d.toISOString();
}
function hashString(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}
function guessLang(u) {
  try {
    const h = new URL(u).hostname;
    if (/\.nl$|\.be$|nos\.nl|nu\.nl|tweakers|fd\.nl|rtl\.nl/.test(h)) return "nl";
  } catch {}
  return "en";
}
const NL_WORDS = /\b(de|het|een|en|van|niet|dat|is|zijn|op|voor|met|wordt|ook|maar|bij|naar|heeft|wij|je)\b/gi;
const EN_WORDS = /\b(the|and|of|to|is|in|that|it|for|with|was|on|are|as|be|this|have|from|by|but)\b/gi;
function guessLangFromText(t) {
  const sample = t.slice(0, 3000);
  const nl = (sample.match(NL_WORDS) || []).length;
  const en = (sample.match(EN_WORDS) || []).length;
  if (nl === 0 && en === 0) return "";
  return nl > en ? "nl" : "en";
}
