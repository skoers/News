/* Mijn Nieuws – frontend
 * - haalt feeds op via de Worker, voegt samen en rangschikt op basis van jouw klikgedrag
 * - leert: bron-affiniteit, onderwerp-affiniteit (trefwoorden + categorieën), met verval in de tijd
 * - leesvenster met volledig vertaald artikel (Workers AI), paywall → originele link
 */
(() => {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* Configuratie & standaardbronnen                                      */
  /* ------------------------------------------------------------------ */
  const CATEGORIES = {
    nl: "Nederland",
    wereld: "Wereld",
    ai: "AI",
    tech: "Tech",
    wetenschap: "Wetenschap",
    economie: "Economie",
    wonen: "Wonen & energie",
    mobiliteit: "Auto & e-bike",
    overig: "Overig",
  };

  const DEFAULT_FEEDS = [
    // Algemeen NL
    { url: "https://feeds.nos.nl/nosnieuwsalgemeen", name: "NOS", cat: "nl", lang: "nl" },
    { url: "https://www.nu.nl/rss/Algemeen", name: "NU.nl", cat: "nl", lang: "nl" },
    { url: "https://feeds.nos.nl/nosnieuwsbuitenland", name: "NOS Buitenland", cat: "wereld", lang: "nl" },
    // Algemeen EN
    { url: "https://feeds.bbci.co.uk/news/world/rss.xml", name: "BBC World", cat: "wereld", lang: "en" },
    { url: "https://www.theguardian.com/world/rss", name: "The Guardian", cat: "wereld", lang: "en" },
    { url: "https://www.aljazeera.com/xml/rss/all.xml", name: "Al Jazeera", cat: "wereld", lang: "en" },
    { url: "https://feeds.npr.org/1004/rss.xml", name: "NPR World", cat: "wereld", lang: "en" },
    // Tech & wetenschap
    { url: "https://tweakers.net/feeds/mixed.xml", name: "Tweakers", cat: "tech", lang: "nl" },
    { url: "https://feeds.nos.nl/nosnieuwstech", name: "NOS Tech", cat: "tech", lang: "nl" },
    { url: "https://www.theverge.com/rss/index.xml", name: "The Verge", cat: "tech", lang: "en" },
    { url: "https://feeds.arstechnica.com/arstechnica/index", name: "Ars Technica", cat: "tech", lang: "en" },
    { url: "https://hnrss.org/frontpage", name: "Hacker News", cat: "tech", lang: "en" },
    { url: "https://www.technologyreview.com/feed/", name: "MIT Technology Review", cat: "tech", lang: "en" },
    { url: "https://www.wired.com/feed/rss", name: "Wired", cat: "tech", lang: "en" },
    { url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", name: "BBC Science", cat: "wetenschap", lang: "en" },
    { url: "https://www.theguardian.com/science/rss", name: "Guardian Science", cat: "wetenschap", lang: "en" },
    // Economie
    { url: "https://feeds.nos.nl/nosnieuwseconomie", name: "NOS Economie", cat: "economie", lang: "nl" },
    { url: "https://www.nu.nl/rss/Economie", name: "NU.nl Economie", cat: "economie", lang: "nl" },
    { url: "https://feeds.bbci.co.uk/news/business/rss.xml", name: "BBC Business", cat: "economie", lang: "en" },
    { url: "https://www.theguardian.com/uk/business/rss", name: "Guardian Business", cat: "economie", lang: "en" },
    { url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", name: "CNBC", cat: "economie", lang: "en" },
    // FD en FT: deels betaalmuur. De app probeert eerst het artikel; zit het dicht, dan omwegen (archive.ph / archive.org)
    // FD: tonen zodra er een archiefkopie is, anders pas na 8 uur
    { url: "https://fd.nl/?rss", name: "FD", cat: "economie", lang: "nl", paywall: "archivecheck", delayHours: 8 },
    { url: "https://www.ft.com/rss/home", name: "Financial Times", cat: "economie", lang: "en", paywall: "check" },
    { url: "https://www.ft.com/technology?format=rss", name: "FT Technology", cat: "tech", lang: "en", paywall: "check" },
    { url: "https://www.ft.com/artificial-intelligence?format=rss", name: "FT Artificial Intelligence", cat: "ai", lang: "en", paywall: "check" },
    { url: "https://www.ft.com/climate-capital?format=rss", name: "FT Climate Capital", cat: "wonen", lang: "en", paywall: "check" },
    { url: "https://www.ft.com/companies/automobiles?format=rss", name: "FT Automobiles", cat: "mobiliteit", lang: "en", paywall: "check" },
    // AI
    { url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", name: "The Verge AI", cat: "ai", lang: "en" },
    { url: "https://techcrunch.com/category/artificial-intelligence/feed/", name: "TechCrunch AI", cat: "ai", lang: "en" },
    { url: "https://arstechnica.com/ai/feed/", name: "Ars Technica AI", cat: "ai", lang: "en" },
    { url: "https://www.technologyreview.com/topic/artificial-intelligence/feed", name: "MIT TR AI", cat: "ai", lang: "en" },
    { url: "https://blog.google/technology/ai/rss/", name: "Google AI Blog", cat: "ai", lang: "en" },
    { url: "https://www.bright.nl/rss", name: "Bright", cat: "tech", lang: "nl" },
    // Wonen, huizenprijzen & warmtepompen
    { url: "https://www.nu.nl/rss/Wonen", name: "NU.nl Wonen", cat: "wonen", lang: "nl" },
    { url: "https://www.vastgoedmarkt.nl/rss", name: "Vastgoedmarkt", cat: "wonen", lang: "nl" },
    { url: "https://www.warmtepompmagazine.nl/feed/", name: "Warmtepomp Magazine", cat: "wonen", lang: "nl" },
    { url: "https://www.canarymedia.com/rss", name: "Canary Media", cat: "wonen", lang: "en" },
    // Auto & e-bike
    { url: "https://www.autoblog.nl/feed", name: "Autoblog", cat: "mobiliteit", lang: "nl" },
    { url: "https://www.autoweek.nl/rss/", name: "AutoWeek", cat: "mobiliteit", lang: "nl" },
    { url: "https://insideevs.com/rss/articles/all/", name: "InsideEVs", cat: "mobiliteit", lang: "en" },
    { url: "https://electrek.co/feed/", name: "Electrek", cat: "mobiliteit", lang: "en" },
    { url: "https://electrek.co/guides/electric-bicycle/feed/", name: "Electrek E-bikes", cat: "mobiliteit", lang: "en" },
    { url: "https://ebiketips.road.cc/rss", name: "ebiketips", cat: "mobiliteit", lang: "en" },
    // Elektrische motoren & scooters (Europa / NL)
    { url: "https://thepack.news/feed/", name: "The Pack (e-moto)", cat: "mobiliteit", lang: "en" },
    { url: "https://electrek.co/guides/electric-motorcycles/feed/", name: "Electrek E-motorcycles", cat: "mobiliteit", lang: "en" },
    { url: "https://www.rideapart.com/rss/category/electric/", name: "RideApart Electric", cat: "mobiliteit", lang: "en" },
    { url: "https://www.nieuwsmotor.nl/feed/", name: "Nieuwsmotor", cat: "mobiliteit", lang: "nl" },
    { url: "https://www.motor.nl/feed/", name: "MOTOR.nl", cat: "mobiliteit", lang: "nl" },
    { url: "https://www.scooterxpress.nl/feed/", name: "ScooterXpress", cat: "mobiliteit", lang: "nl" },
    // Algemeen NL extra
    { url: "https://www.ad.nl/rss.xml", name: "AD", cat: "nl", lang: "nl" },
    // Podcasts (feed wordt automatisch opgezocht in de Apple Podcasts-catalogus)
    { url: "", podcast: true, lookup: "AI Report", match: "kl[öo]pping|dag en nacht|hage", country: "nl", name: "AI Report (Klöpping & Hage)", cat: "ai", lang: "nl" },
    { url: "", podcast: true, lookup: "AI, je nieuwe collega", country: "nl", name: "AI, je nieuwe collega", cat: "ai", lang: "nl" },
    { url: "https://feeds.simplecast.com/l2i9YnTd", podcast: true, appleId: "1528594034", name: "Hard Fork (NYT)", cat: "ai", lang: "en" },
    { url: "", podcast: true, appleId: "1680633614", lookup: "The AI Daily Brief", country: "us", name: "The AI Daily Brief", cat: "ai", lang: "en" },
  ];
  const spotifySearchUrl = (q) => "https://open.spotify.com/search/" + encodeURIComponent(q) + "/podcastAndEpisodes";
  // Onderwerpen die je expliciet volgt (aanpasbaar in Instellingen). Tellen zwaar mee in de rangschikking.
  const DEFAULT_INTERESTS = ["livewire", "elektrische motor", "electric motorcycle", "elektrische scooter", "e-scooter", "typegoedkeuring", "rdw", "e-bike", "warmtepomp", "huizenprijzen", "woningmarkt"];
  const archiveUrl = (u) => "https://archive.ph/newest/" + u;
  const waybackUrl = (u) => "https://web.archive.org/web/2/" + u;
  const googleTranslateUrl = (u) => "https://translate.google.com/translate?sl=auto&tl=nl&u=" + encodeURIComponent(u);

  // Woorden die nooit een onderwerp of tab mogen worden (te generiek, komen uit feed-categorieën)
  const GENERIC = new Set("nieuws news procent percent nieuwsbrief newsletter artikel artikelen article articles video videos foto fotos podcast aflevering episode update updates liveblog live blog opinie column analyse achtergrond binnenland buitenland algemeen overig home front page world europe nederland netherlands dutch uncategorized featured breaking laatste latest vandaag today week maand jaar miljoen miljard euro dollar mensen people".split(/\s+/));
  const STOP = new Set(("de het een en van in op voor met is zijn dat die niet ook aan er bij om door naar uit over nog maar wordt worden tot als dan heeft hebben was waren zijn hun hem haar ze zij wij jullie je ik u dit deze zo wat wie waar hoe wel geen meer veel al na onder tegen zonder tussen omdat terwijl want of dus toch kan kunnen moet moeten zal zullen zou zouden gaat gaan komt komen jaar jaren week dag dagen nieuwe nieuw grote groot eerste twee drie " +
    "the a an and of to in on for with is are was were be been being that this these those it its as at by from or but not no so if than then there their they them he she his her we you your our us who whom which what when where why how all any some more most other such only own same into over after before under again further once here out up down off about against between through during above below off has have had having do does did will would shall should can could may might must new says said say also one two three year years week day days first last like just get got make made").split(/\s+/));

  /* ------------------------------------------------------------------ */
  /* Opslag                                                               */
  /* ------------------------------------------------------------------ */
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem("mn." + k);
        return v == null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem("mn." + k, JSON.stringify(v));
      } catch {}
    },
  };

  const settings = Object.assign(
    { translateTitles: true, titlesWhen: "interact", autoload: true, hideRead: false, translateMode: "ai", apiBase: window.MN_CONFIG?.apiBase || "" },
    store.get("settings", {})
  );
  let feeds = store.get("feeds", null) || DEFAULT_FEEDS.map((f) => ({ ...f, enabled: true }));
  // Migraties van eerder opgeslagen bronlijsten
  for (const f of feeds) if (/fd\.nl/.test(f.url || "") && f.paywall !== "archivecheck") { f.paywall = "archivecheck"; f.delayHours = 8; store.set("feeds", feeds); }
  for (const d of DEFAULT_FEEDS.filter((f) => /ft\.com/.test(f.url))) {
    if (!feeds.some((f) => f.url === d.url)) { feeds.push({ ...d, enabled: true }); store.set("feeds", feeds); }
  }
  feeds = feeds.filter((f) => !/livewire\.com\/blogs\/news\.atom/.test(f.url || ""));
  for (const d of DEFAULT_FEEDS.filter((f) => f.podcast)) {
    if (!feeds.some((f) => f.podcast && f.name === d.name)) { feeds.push({ ...d, enabled: true }); store.set("feeds", feeds); }
  }
  for (const f of feeds) if (/ad\.nl/.test(f.url) && f.paywall) { delete f.paywall; store.set("feeds", feeds); }
  let profile = store.get("profile", { sources: {}, topics: {}, cats: {}, updated: Date.now(), clicks: 0 });
  let readSet = new Set(store.get("read", []));
  let interests = store.get("interests", null) || DEFAULT_INTERESTS.slice();
  let votes = store.get("votes", {});
  let ignored = new Set(store.get("ignored", []));
  let saved = store.get("saved", {}); // id -> item (bewaard voor later / wachten op archiefkopie)
  let archiveInfo = store.get("archive", {}); // id -> { wayback, archiveph, checked } // id -> 1 (interessant) | -1 (niet interessant)
  let items = store.get("cache.items", []);
  let feedStatus = {};
  let activeTab = store.get("tab", "voorjou");
  let titleCache = store.get("cache.titles", {});

  const save = {
    settings: () => store.set("settings", settings),
    feeds: () => store.set("feeds", feeds),
    profile: () => store.set("profile", profile),
    read: () => store.set("read", [...readSet].slice(-2000)),
    interests: () => store.set("interests", interests),
    ignored: () => store.set("ignored", [...ignored]),
    saved: () => store.set("saved", saved),
    archive: () => {
      const keys = Object.keys(archiveInfo);
      if (keys.length > 800) for (const k of keys.slice(0, keys.length - 800)) delete archiveInfo[k];
      store.set("archive", archiveInfo);
    },
    votes: () => {
      const keys = Object.keys(votes);
      if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete votes[k];
      store.set("votes", votes);
    },
    items: () => store.set("cache.items", items.slice(0, 400)),
    titles: () => {
      const keys = Object.keys(titleCache);
      if (keys.length > 1500) for (const k of keys.slice(0, keys.length - 1500)) delete titleCache[k];
      store.set("cache.titles", titleCache);
    },
  };

  /* ------------------------------------------------------------------ */
  /* DOM                                                                  */
  /* ------------------------------------------------------------------ */
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };
  const feedEl = $("#feed");
  const tabsEl = $("#tabs");
  const statusEl = $("#status");

  let statusTimer;
  function toast(msg, ms = 2500) {
    statusEl.textContent = msg;
    statusEl.hidden = false;
    clearTimeout(statusTimer);
    if (ms) statusTimer = setTimeout(() => (statusEl.hidden = true), ms);
  }

  /* ------------------------------------------------------------------ */
  /* Hulpfuncties                                                         */
  /* ------------------------------------------------------------------ */
  function hashLite(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16);
  }
  const host = (u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  };
  const favicon = (u) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host(u))}&sz=64`;
  const fmtDate = (iso) => new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  function timeAgo(iso) {
    const diff = (Date.now() - new Date(iso).getTime()) / 60000;
    if (diff < 1) return "nu";
    if (diff < 60) return `${Math.round(diff)} min`;
    if (diff < 60 * 24) return `${Math.round(diff / 60)} u`;
    const d = Math.round(diff / 1440);
    return d === 1 ? "gisteren" : `${d} d`;
  }
  function keywords(text) {
    return [...new Set(
      String(text || "")
        .toLowerCase()
        .replace(/[’']/g, "")
        .split(/[^a-zà-ÿ0-9]+/i)
        .filter((w) => w.length >= 4 && !STOP.has(w) && !GENERIC.has(w) && !/^\d+$/.test(w))
    )].slice(0, 14);
  }
  const api = (path) => settings.apiBase.replace(/\/$/, "") + path;
  /** Link zonder tracking-parameters, voor ontdubbeling. */
  function canonical(u) {
    try {
      const x = new URL(u);
      x.hash = "";
      for (const k of [...x.searchParams.keys()]) if (/^(utm_|at_|fbclid|gclid|ref$|source$|cmpid|ns_)/i.test(k)) x.searchParams.delete(k);
      return x.toString().replace(/\/$/, "").replace(/^https?:\/\/(www\.)?/, "");
    } catch {
      return u;
    }
  }
  const titleKey = (t) => keywords(t).sort().join(" ");
  function similar(a, b) {
    const A = new Set(a), B = new Set(b);
    if (!A.size || !B.size) return 0;
    let n = 0;
    for (const w of A) if (B.has(w)) n++;
    return n / Math.min(A.size, B.size);
  }
  /** Verwijdert dubbele berichten: zelfde link, of (bijna) dezelfde kop binnen 36 uur. */
  function dedupe(list) {
    const byLink = new Map();
    for (const it of list) {
      const k = canonical(it.link);
      const cur = byLink.get(k);
      if (!cur) byLink.set(k, it);
      else if (!cur.image && it.image) byLink.set(k, { ...it, dupes: cur.dupes || 0 });
    }
    const out = [];
    for (const it of byLink.values()) {
      const t = new Date(it.published).getTime();
      const twin = it.podcast ? null : out.find((o) => !o.podcast && Math.abs(new Date(o.published).getTime() - t) < 36 * 3600000 && similar(o.kw, it.kw) >= 0.75 && o.kw.length >= 3);
      if (twin) {
        twin.dupes = (twin.dupes || 0) + 1;
        if (!twin.image && it.image) twin.image = it.image;
        twin.sources = (twin.sources || [twin.source]).concat(it.source);
      } else out.push({ ...it, dupes: 0 });
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Profiel / leren                                                      */
  /* ------------------------------------------------------------------ */
  const HALF_LIFE_DAYS = 21;
  function decayProfile() {
    const days = (Date.now() - (profile.updated || Date.now())) / 86400000;
    if (days < 0.5) return;
    const f = Math.pow(0.5, days / HALF_LIFE_DAYS);
    for (const k of ["sources", "topics", "cats"]) {
      for (const key of Object.keys(profile[k])) {
        profile[k][key] *= f;
        if (Math.abs(profile[k][key]) < 0.05) delete profile[k][key];
      }
    }
    profile.updated = Date.now();
    save.profile();
  }

  function vote(item, v, btn) {
    markInteracted();
    const prev = votes[item.id] || 0;
    if (prev === v) {
      delete votes[item.id];
      learn(item, -v * 2); // ongedaan maken
    } else {
      votes[item.id] = v;
      learn(item, v * 2 - prev * 2);
    }
    save.votes();
    toast(votes[item.id] === 1 ? "Meer hiervan" : votes[item.id] === -1 ? "Minder hiervan" : "Stem ingetrokken", 1200);
    render(true);
  }

  function learn(item, weight) {
    const bump = (obj, key, w) => {
      if (!key || (obj === profile.topics && ignored.has(key))) return;
      obj[key] = Math.max(-8, (obj[key] || 0) + w);
    };
    bump(profile.sources, item.sourceHost, weight);
    bump(profile.cats, item.cat, weight * 0.6);
    for (const w of keywords(item.title + " " + (item.summary || "").slice(0, 160))) bump(profile.topics, w, weight * 0.5);
    for (const c of item.categories || []) if (!GENERIC.has(c) && !STOP.has(c) && c.length >= 4) bump(profile.topics, c, weight * 0.7);
    profile.clicks = (profile.clicks || 0) + (weight >= 1 ? 1 : 0);
    // Begrens: niets mag onbeperkt groeien
    for (const k of ["sources", "topics", "cats"]) {
      const entries = Object.entries(profile[k]).sort((a, b) => b[1] - a[1]);
      if (entries.length > 400) profile[k] = Object.fromEntries(entries.slice(0, 400));
    }
    save.profile();
  }

  const slog = (x) => Math.sign(x) * Math.log1p(Math.abs(x)); // log-schaal, ook voor negatieve scores
  function interestHits(item) {
    const text = (item.title + " " + (item.summary || "")).toLowerCase();
    return interests.filter((w) => w && text.includes(w.toLowerCase()));
  }
  function affinity(item) {
    const src = slog(profile.sources[item.sourceHost] || 0);
    const cat = slog(profile.cats[item.cat] || 0);
    let topic = 0;
    for (const w of item.kw) topic += profile.topics[w] || 0;
    for (const c of item.categories || []) topic += (profile.topics[c] || 0) * 0.5;
    topic = slog(topic);
    const explicit = interestHits(item).length ? 1.5 : 0;
    const vote = votes[item.id] || 0;
    return { src, cat, topic, explicit, total: 0.8 * src + 0.4 * cat + 1.2 * topic + explicit + vote * 1.5 };
  }

  function rank(list) {
    const now = Date.now();
    const scored = list.map((it) => {
      const ageH = Math.max(0, (now - new Date(it.published).getTime()) / 3600000);
      const fresh = Math.exp(-ageH / 30); // na ~30 u is versheid ~1/e
      const aff = affinity(it);
      const img = it.image ? 0.15 : 0;
      const readPenalty = readSet.has(it.id) ? -2 : 0;
      const downvote = votes[it.id] === -1 ? -5 : 0;
      const podcastBoost = it.podcast && ageH < 7 * 24 && !readSet.has(it.id) ? 1.2 : 0;
      const savedBoost = saved[it.id] && hasArchive(it) && !readSet.has(it.id) ? 3 : 0;
      it.why = whyLabel(it, aff);
      return { it, score: fresh * (1 + Math.max(-0.9, aff.total)) + 0.3 * fresh + img + readPenalty + downvote + podcastBoost + savedBoost + (Math.random() - 0.5) * 0.05 };
    });
    scored.sort((a, b) => b.score - a.score);
    // Diversiteit: maximaal 2 artikelen van dezelfde bron per 6 posities bovenaan
    const out = [];
    const recent = [];
    const deferred = [];
    for (const s of scored) {
      const h = s.it.sourceHost;
      const cnt = recent.slice(-6).filter((x) => x === h).length;
      if (cnt >= 2 && out.length < 40) deferred.push(s);
      else {
        out.push(s.it);
        recent.push(h);
      }
    }
    return out.concat(deferred.map((d) => d.it));
  }

  function whyLabel(it, aff) {
    const hit = interestHits(it)[0];
    if (hit) return `Interesse: ${hit}`;
    if ((profile.clicks || 0) < 3) return "";
    if (aff.topic > 1.1) {
      const top = it.kw.concat(it.categories || []).map((w) => [w, profile.topics[w] || 0]).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] > 0.8) return `Omdat je ${top[0]} volgt`;
    }
    if (aff.src > 1.2) return `Omdat je ${it.source} vaak leest`;
    return "";
  }

  /* ------------------------------------------------------------------ */
  /* Feeds ophalen                                                        */
  /* ------------------------------------------------------------------ */
  let refreshing = false;
  let lastRefresh = 0;
  async function refresh(force = false) {
    if (refreshing) return;
    lastRefresh = Date.now();
    if (!settings.apiBase) {
      toast("Stel eerst het API-adres in bij Instellingen", 5000);
      return;
    }
    refreshing = true;
    $("#btn-refresh").classList.add("spin");
    if (!items.length) renderSkeleton();
    const enabled = feeds.filter((f) => f.enabled !== false);
    await Promise.all(enabled.filter((f) => f.podcast && !f.url).map(resolvePodcast));
    const results = await Promise.all(
      enabled.map(async (f) => {
        if (!f.url) return [];
        try {
          const r = await fetch(api(`/feed?url=${encodeURIComponent(f.url)}`), { cache: force ? "reload" : "default" });
          const data = await r.json();
          if (data.error) throw new Error(data.error);
          feedStatus[f.url] = { ok: true, n: data.items.length, t: Date.now() };
          return data.items.map((it) => ({
            ...it,
            source: f.name || data.source,
            sourceHost: host(it.link) || host(f.url),
            feedUrl: f.url,
            cat: f.cat || "overig",
            podcast: !!f.podcast,
            apple: f.apple || "",
            image: it.image || f.image || data.image || "",
            paywall: f.paywall || "",
            delayHours: f.delayHours || 0,
            lang: f.lang || it.lang || "en",
            kw: keywords(it.title + " " + (it.summary || "").slice(0, 160)),
          }));
        } catch (e) {
          feedStatus[f.url] = { ok: false, err: e.message, t: Date.now() };
          return [];
        }
      })
    );
    const merged = new Map();
    for (const it of results.flat()) {
      it.id = hashLite(canonical(it.link));
      if (!merged.has(it.id)) merged.set(it.id, it);
    }
    // bewaar ook oudere items (max 48 u) die uit de feed verdwenen zijn
    const cutoff = Date.now() - 48 * 3600000;
    for (const old of items) if (!merged.has(old.id) && new Date(old.published).getTime() > cutoff && feeds.some((f) => f.url === old.feedUrl && f.enabled !== false)) merged.set(old.id, old);
    for (const sv of Object.values(saved)) if (!merged.has(sv.id)) merged.set(sv.id, sv);
    items = dedupe([...merged.values()].filter((it) => saved[it.id] || new Date(it.published).getTime() > Date.now() - (it.podcast ? 14 * 24 : 72) * 3600000 || !it.published));
    checkArchives();
    save.items();
    const failed = Object.values(feedStatus).filter((s) => !s.ok).length;
    if (failed && !items.length) toast("Kon geen feeds laden. Controleer het API-adres in Instellingen.", 6000);
    else if (failed) toast(`${failed} bron${failed > 1 ? "nen" : ""} niet bereikbaar (zie Instellingen)`, 3000);
    refreshing = false;
    $("#btn-refresh").classList.remove("spin");
    render();
    translateTitles();
  }

  /** Zoekt de RSS-feed van een podcast op via de Worker (Apple Podcasts-catalogus). */
  async function podcastLookup({ appleId, lookup, country }) {
    const direct = appleId
      ? `https://itunes.apple.com/lookup?id=${appleId}&entity=podcast`
      : `https://itunes.apple.com/search?term=${encodeURIComponent(lookup)}&media=podcast&country=${country || "nl"}&limit=8`;
    try {
      const r = await fetch(direct);
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      return { results: (d.results || []).filter((x) => x.feedUrl).map((x) => ({ id: x.collectionId, name: x.collectionName, by: x.artistName, feed: x.feedUrl, image: x.artworkUrl600 || x.artworkUrl100 || "", apple: x.collectionViewUrl || "" })) };
    } catch {
      const q = appleId ? `id=${appleId}` : `q=${encodeURIComponent(lookup)}&country=${country || "nl"}`;
      const r = await fetch(api(`/podcast?${q}`));
      return r.json();
    }
  }
  async function resolvePodcast(f) {
    try {
      const d = await podcastLookup(f);
      let hit = (d.results || [])[0];
      if (f.match) hit = (d.results || []).find((x) => new RegExp(f.match, "i").test(x.by + " " + x.name)) || hit;
      if (!hit) throw new Error("niet gevonden");
      Object.assign(f, { url: hit.feed, image: hit.image, apple: hit.apple, by: hit.by });
      save.feeds();
    } catch (e) {
      feedStatus[f.lookup || f.name] = { ok: false, err: "podcast niet gevonden: " + e.message, t: Date.now() };
    }
  }

  /* ------------------------------------------------------------------ */
  /* Archiefkopieën (betaalmuur-omweg)                                    */
  /* ------------------------------------------------------------------ */
  const hasArchive = (it) => { const a = archiveInfo[it.id]; return !!(a && (a.wayback || (a.archiveph && a.archiveph !== "unknown"))); };
  const archiveLink = (it) => { const a = archiveInfo[it.id] || {}; return a.wayback || (a.archiveph !== "unknown" ? a.archiveph : "") || ""; };
  /** Zichtbaar? Betaalmuur-bronnen met wachttijd pas tonen bij archiefkopie of na de wachttijd. */
  function visibleNow(it) {
    if (!it.delayHours) return true;
    if (saved[it.id] || hasArchive(it)) return true;
    return Date.now() - new Date(it.published).getTime() > it.delayHours * 3600000;
  }
  let checkingArchives = false;
  async function checkArchives() {
    if (checkingArchives || !settings.apiBase) return;
    const now = Date.now();
    const due = items.filter((it) => {
      if (!(it.delayHours || saved[it.id])) return false;
      if (hasArchive(it)) return false;
      const a = archiveInfo[it.id];
      const age = now - new Date(it.published).getTime();
      if (age < 45 * 60000) return false; // jonger dan drie kwartier: nog geen kopie te verwachten
      const interval = age < 6 * 3600000 ? 30 * 60000 : age < 48 * 3600000 ? 2 * 3600000 : 12 * 3600000;
      return !a || now - (a.checked || 0) > interval;
    }).slice(0, 15);
    if (!due.length) return;
    checkingArchives = true;
    let found = 0;
    try {
      await Promise.all(due.map(async (it) => {
        try {
          const r = await fetch(api(`/archive?url=${encodeURIComponent(it.link)}`));
          const d = await r.json();
          const was = hasArchive(it);
          archiveInfo[it.id] = { wayback: d.wayback || null, archiveph: d.archiveph || null, checked: now };
          if (!was && hasArchive(it)) found++;
        } catch {
          archiveInfo[it.id] = { ...(archiveInfo[it.id] || {}), checked: now };
        }
      }));
      save.archive();
      if (found) {
        toast(`${found} bewaard artikel${found > 1 ? "en" : ""} nu leesbaar via archiefkopie`, 4000);
        render(true);
      }
    } finally {
      checkingArchives = false;
    }
  }
  function toggleSave(it) {
    markInteracted();
    if (saved[it.id]) {
      delete saved[it.id];
      toast("Niet meer bewaard", 1200);
    } else {
      saved[it.id] = { ...it, savedAt: Date.now() };
      learn(it, 1);
      toast(hasArchive(it) ? "Bewaard" : "Bewaard · je ziet hem bovenaan zodra er een archiefkopie is", 3000);
      checkArchives();
    }
    save.saved();
    render(true);
  }

  /* ------------------------------------------------------------------ */
  /* Koppen vertalen                                                      */
  /* ------------------------------------------------------------------ */
  let translating = false;
  let interacted = false; // wordt true na het openen van een artikel of een stem; pas dan kosten we AI-tokens
  function markInteracted() {
    if (interacted) return;
    interacted = true;
    translateTitles();
  }
  async function translateTitles() {
    if (!settings.translateTitles || translating) return;
    if (settings.titlesWhen === "interact" && !interacted) return;
    const visible = currentList().slice(0, 40).filter((it) => it.lang !== "nl" && !titleCache[it.id]);
    if (!visible.length) return;
    translating = true;
    try {
      for (let i = 0; i < visible.length; i += 25) {
        const batch = visible.slice(i, i + 25);
        const r = await fetch(api("/translate"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts: batch.map((b) => b.title), source: batch[0].lang }),
        });
        const data = await r.json();
        (data.translations || []).forEach((t, k) => {
          if (t) titleCache[batch[k].id] = t;
        });
        save.titles();
        render(true);
      }
    } catch {
      /* stil: koppen blijven in het Engels */
    } finally {
      translating = false;
    }
  }
  const displayTitle = (it) => (settings.translateTitles && titleCache[it.id]) || it.title;

  /* ------------------------------------------------------------------ */
  /* Weergave                                                             */
  /* ------------------------------------------------------------------ */
  function learnedTabs() {
    const n = Math.max(1, items.length);
    const freq = (w) => items.filter((it) => it.kw.includes(w) || (it.categories || []).includes(w)).length / n;
    const top = Object.entries(profile.topics)
      .filter(([w, s]) => s >= 2.5 && w.length >= 4 && !interests.includes(w) && !GENERIC.has(w) && freq(w) < 0.12)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([w]) => w);
    return top;
  }

  function renderTabs() {
    tabsEl.replaceChildren();
    const usedCats = new Set(feeds.filter((f) => f.enabled !== false).map((f) => f.cat));
    const tabs = [["voorjou", "Voor jou"], ["laatste", "Laatste"]];
    for (const [k, label] of Object.entries(CATEGORIES)) if (usedCats.has(k)) tabs.push([k, label]);
    if (feeds.some((f) => f.podcast && f.enabled !== false)) tabs.push(["podcasts", "🎧 Podcasts"]);
    if (Object.keys(saved).length) tabs.push(["bewaard", "🔖 Bewaard"]);
    for (const w of learnedTabs()) tabs.push(["kw:" + w, w[0].toUpperCase() + w.slice(1), true]);
    for (const [key, label, learned] of tabs) {
      tabsEl.append(
        el("button", {
          class: "tab" + (key === activeTab ? " active" : "") + (learned ? " learned" : ""),
          onclick: () => {
            activeTab = key;
            store.set("tab", key);
            render();
            translateTitles();
            window.scrollTo({ top: 0 });
          },
        }, label)
      );
    }
    if (!tabs.some(([k]) => k === activeTab)) activeTab = "voorjou";
  }

  function currentList() {
    let list = items.filter(visibleNow);
    if (activeTab === "bewaard") return list.filter((it) => saved[it.id]).sort((a, b) => (saved[b.id].savedAt || 0) - (saved[a.id].savedAt || 0));
    if (settings.hideRead) list = list.filter((it) => !readSet.has(it.id));
    if (activeTab === "laatste") return [...list].sort((a, b) => new Date(b.published) - new Date(a.published));
    if (activeTab === "podcasts") return list.filter((it) => it.podcast).sort((a, b) => new Date(b.published) - new Date(a.published));
    if (activeTab.startsWith("kw:")) {
      const w = activeTab.slice(3);
      list = list.filter((it) => it.kw.includes(w) || (it.categories || []).includes(w) || it.title.toLowerCase().includes(w));
    } else if (activeTab !== "voorjou") list = list.filter((it) => it.cat === activeTab);
    return rank(list);
  }

  function renderSkeleton() {
    feedEl.replaceChildren(...Array.from({ length: 6 }, () => el("div", { class: "card sk" }, el("div", {}, el("div", { class: "meta skeleton" }), el("div", { class: "title skeleton" })), el("div", { class: "thumb skeleton" }))));
  }

  function card(it, hero) {
    const img = it.image ? el("img", { class: "thumb", src: it.image, alt: "", loading: "lazy", referrerpolicy: "no-referrer", onerror: (e) => { e.target.remove(); e.target.closest(".card")?.classList.add("no-image"); } }) : null;
    const body = el("div", { class: "body" },
      el("div", { class: "meta" },
        el("span", { class: "src" }, el("img", { src: favicon(it.link), alt: "", loading: "lazy" }), it.source),
        el("span", {}, "· " + (it.podcast ? "uitgebracht " + fmtDate(it.published) : timeAgo(it.published)))
      ),
      it.podcast ? el("div", { class: "pod-label" }, "🎧 Nieuwe aflevering" + (it.duration ? " · " + it.duration.replace(/^00?:/, "") : "")) : null,
      el("div", { class: "title" }, displayTitle(it)),
      hero && it.summary ? el("div", { class: "summary" }, it.summary) : null,
      el("div", { class: "foot" },
        it.lang !== "nl" ? el("span", { class: "badge lang" }, it.lang) : null,
        it.why ? el("span", { class: "badge why" }, it.why) : null,
        it.dupes ? el("span", { class: "badge" }, `+${it.dupes} bron${it.dupes > 1 ? "nen" : ""}`) : null,
        hasArchive(it) ? el("span", { class: "badge ok" }, "Archiefkopie") : it.delayHours && saved[it.id] ? el("span", { class: "badge" }, "Wacht op archief") : null,
        el("span", { class: "votes" },
          el("button", { class: "vote" + (saved[it.id] ? " on" : ""), "aria-label": "Bewaren", title: "Bewaren voor later", onclick: (e) => { e.stopPropagation(); toggleSave(it); } }, "🔖"),
          el("button", { class: "vote" + (votes[it.id] === 1 ? " on" : ""), "aria-label": "Interessant", title: "Meer hiervan", onclick: (e) => { e.stopPropagation(); vote(it, 1); } }, "👍"),
          el("button", { class: "vote" + (votes[it.id] === -1 ? " on" : ""), "aria-label": "Niet interessant", title: "Minder hiervan", onclick: (e) => { e.stopPropagation(); vote(it, -1); } }, "👎")
        )
      )
    );
    const c = el("div", { class: "card" + (hero ? " hero" : "") + (readSet.has(it.id) ? " read" : "") + (!img ? " no-image" : ""), role: "button", tabindex: "0", onclick: () => openReader(it), onkeydown: (e) => { if (e.key === "Enter") openReader(it); } });
    if (hero) c.append(img, body);
    else c.append(body, img);
    return c;
  }

  function render(soft = false) {
    renderTabs();
    const list = currentList();
    const scrollY = window.scrollY;
    feedEl.replaceChildren();
    if (!list.length) {
      feedEl.append(el("div", { class: "empty" }, items.length ? "Niets gevonden in deze rubriek." : "Nog geen nieuws geladen. Tik op vernieuwen."));
      return;
    }
    if (activeTab === "voorjou") {
      const fresh = items.filter((it) => it.podcast && Date.now() - new Date(it.published).getTime() < 7 * 86400000).sort((a, b) => new Date(b.published) - new Date(a.published)).slice(0, 8);
      if (fresh.length) {
        feedEl.append(el("div", { class: "section-title" }, "🎧 Nieuwe podcastafleveringen"));
        feedEl.append(el("div", { class: "pod-strip" }, ...fresh.map((it) => el("div", { class: "pod-tile" + (readSet.has(it.id) ? " read" : ""), role: "button", tabindex: "0", onclick: () => openReader(it) },
          it.image ? el("img", { src: it.image, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : el("div", { class: "pod-ph" }, "🎧"),
          el("div", { class: "pod-src" }, it.source),
          el("div", { class: "pod-title" }, it.title),
          el("div", { class: "pod-date" }, fmtDate(it.published) + (it.duration ? " · " + it.duration.replace(/^00?:/, "") : ""))
        ))));
        feedEl.append(el("div", { class: "section-title" }, "Voor jou"));
      }
    }
    list.slice(0, 120).forEach((it, i) => feedEl.append(card(it, i === 0 && activeTab !== "laatste" && !!it.image)));
    if (soft) window.scrollTo({ top: scrollY });
  }

  /* ------------------------------------------------------------------ */
  /* Leesvenster                                                          */
  /* ------------------------------------------------------------------ */
  const reader = $("#reader");
  const readerBody = $("#reader-body");
  let readerAbort = null;

  function openReader(it) {
    markInteracted();
    readSet.add(it.id);
    save.read();
    learn(it, 1);
    history.pushState({ reader: it.id }, "");
    reader.hidden = false;
    document.body.style.overflow = "hidden";
    $("#reader-source").textContent = it.source;
    $("#reader-open").href = it.link;
    readerBody.replaceChildren(
      it.image ? el("img", { class: "hero-img", src: it.image, alt: "", referrerpolicy: "no-referrer", onerror: (e) => e.target.remove() }) : null,
      el("h1", { id: "reader-title" }, displayTitle(it)),
      el("div", { class: "meta" }, el("span", {}, it.source), el("span", {}, "· " + timeAgo(it.published)), it.lang !== "nl" ? el("span", { class: "badge lang" }, it.lang) : null,
        el("span", { class: "votes" },
          el("button", { class: "vote" + (saved[it.id] ? " on" : ""), onclick: (e) => { toggleSave(it); e.target.classList.toggle("on", !!saved[it.id]); } }, "🔖 Bewaar"),
          el("button", { class: "vote" + (votes[it.id] === 1 ? " on" : ""), onclick: (e) => { vote(it, 1); e.target.classList.toggle("on", votes[it.id] === 1); e.target.nextSibling.classList.remove("on"); } }, "👍 Meer"),
          el("button", { class: "vote" + (votes[it.id] === -1 ? " on" : ""), onclick: (e) => { vote(it, -1); e.target.classList.toggle("on", votes[it.id] === -1); e.target.previousSibling.classList.remove("on"); } }, "👎 Minder")
        )),
      it.summary ? el("p", { class: "intro" }, it.summary) : null,
      el("div", { id: "reader-article" }, ...readButtons(it))
    );
    reader.scrollTop = 0;
    if (it.delayHours && archiveInfo[it.id]?.wayback) loadArticle(it, archiveInfo[it.id].wayback);
    else if (settings.autoload && !it.paywall && !it.podcast && settings.translateMode === "ai") loadArticle(it);
  }

  /** Knoppen onder de intro: afhankelijk van betaalmuur en vertaalmodus. */
  function readButtons(it) {
    const out = [];
    if (it.delayHours || it.paywall === "archivecheck") {
      const a = archiveInfo[it.id] || {};
      if (a.wayback) {
        out.push(
          el("button", { class: "btn block", onclick: () => loadArticle(it, a.wayback) }, "Lees via archiefkopie (archive.org)"),
          a.archiveph && a.archiveph !== "unknown" ? el("a", { class: "btn ghost block", href: a.archiveph, target: "_blank", rel: "noopener", style: "margin-top:8px" }, "Open op archive.ph") : null
        );
      } else if (a.archiveph && a.archiveph !== "unknown") {
        out.push(el("a", { class: "btn block", href: a.archiveph, target: "_blank", rel: "noopener", onclick: () => learn(it, 1.5) }, "Open archiefkopie op archive.ph"));
      } else {
        out.push(
          el("div", { class: "notice" }, saved[it.id] ? "Bewaard. Zodra er een archiefkopie van dit artikel bestaat, zie je het bovenaan 'Voor jou'." : "Nog geen archiefkopie gevonden. Bewaar het artikel; de app controleert het op de achtergrond en zet het bovenaan zodra het leesbaar is."),
          saved[it.id] ? null : el("button", { class: "btn block", onclick: () => { toggleSave(it); closeReader(false); } }, "🔖 Bewaren en later lezen"),
          el("button", { class: "btn ghost block", style: "margin-top:8px", onclick: () => loadArticle(it) }, "Toch proberen (mogelijk betaalmuur)")
        );
      }
      out.push(el("p", { class: "muted", style: "text-align:center;margin-top:10px" },
        el("a", { href: archiveUrl(it.link), target: "_blank", rel: "noopener" }, "archive.ph"), " · ",
        el("a", { href: waybackUrl(it.link), target: "_blank", rel: "noopener" }, "archive.org"), " · ",
        el("a", { href: it.link, target: "_blank", rel: "noopener" }, "origineel")));
      return out;
    }
    if (it.podcast) {
      out.push(
        el("p", { class: "muted" }, "Uitgebracht op " + new Date(it.published).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + (it.duration ? " · " + it.duration : "")),
        it.audio ? el("audio", { controls: true, preload: "none", src: it.audio, style: "width:100%;margin:8px 0 14px" }) : null,
        el("a", { class: "btn block", href: spotifySearchUrl(it.source.replace(/\s*\(.*\)$/, "") + " " + it.title.slice(0, 60)), target: "_blank", rel: "noopener", onclick: () => learn(it, 1.5) }, "Open in Spotify"),
        it.apple ? el("a", { class: "btn ghost block", href: it.apple, target: "_blank", rel: "noopener", style: "margin-top:8px" }, "Open in Apple Podcasts") : null,
        el("p", { class: "muted", style: "text-align:center;margin-top:10px" }, el("a", { href: it.link, target: "_blank", rel: "noopener" }, "Pagina van de aflevering"))
      );
      return out;
    }
    if (it.paywall === "archive") {
      out.push(
        el("div", { class: "notice" }, "Deze bron zit achter een betaalmuur. Via een archiefkopie lees je vaak de volledige tekst."),
        el("a", { class: "btn block", href: archiveUrl(it.link), target: "_blank", rel: "noopener", onclick: () => learn(it, 1.5) }, "Open via archive.ph"),
        el("a", { class: "btn ghost block", href: waybackUrl(it.link), target: "_blank", rel: "noopener", style: "margin-top:8px" }, "Open via archive.org (Wayback)"),
        el("a", { class: "btn ghost block", href: it.link, target: "_blank", rel: "noopener", style: "margin-top:8px" }, "Open origineel op " + it.sourceHost)
      );
      return out;
    }
    if (settings.translateMode === "google" && it.lang !== "nl") {
      out.push(
        el("a", { class: "btn block", href: googleTranslateUrl(it.link), target: "_blank", rel: "noopener", onclick: () => learn(it, 1.5) }, "Lees vertaald via Google Translate (gratis)"),
        el("button", { class: "btn ghost block", style: "margin-top:8px", onclick: () => loadArticle(it) }, "Of vertaal in de app (Workers AI)")
      );
    } else {
      out.push(
        el("button", { class: "btn block", id: "btn-full", onclick: () => loadArticle(it) },
          it.lang === "nl" ? "Lees volledig artikel" : "Lees volledig artikel (vertaald)")
      );
      if (it.lang !== "nl") out.push(el("a", { class: "btn ghost block", href: googleTranslateUrl(it.link), target: "_blank", rel: "noopener", style: "margin-top:8px" }, "Of open via Google Translate"));
    }
    out.push(el("p", { class: "muted", style: "text-align:center;margin-top:10px" }, el("a", { href: it.link, target: "_blank", rel: "noopener" }, "Open het origineel op " + it.sourceHost)));
    return out;
  }

  async function loadArticle(it, viaUrl) {
    const box = $("#reader-article");
    box.replaceChildren(el("div", { class: "notice" }, it.lang === "nl" ? "Artikel laden…" : "Artikel ophalen en vertalen… (10–20 s)"));
    readerAbort?.abort();
    const ctrl = (readerAbort = new AbortController());
    try {
      const r = await fetch(api(`/article?url=${encodeURIComponent(viaUrl || it.link)}`), { signal: ctrl.signal });
      const a = await r.json();
      if (ctrl.signal.aborted) return;
      if (a.error) throw new Error(a.error);
      if (a.paywall || !a.paragraphs?.length) {
        box.replaceChildren(
          el("div", { class: "notice" }, a.paywall ? "Dit artikel zit achter een betaalmuur of login. Probeer een archiefkopie of open het origineel." : "De tekst van dit artikel kon niet worden uitgelezen."),
          el("a", { class: "btn block", href: archiveUrl(it.link), target: "_blank", rel: "noopener" }, "Open via archive.ph"),
          el("a", { class: "btn ghost block", href: waybackUrl(it.link), target: "_blank", rel: "noopener", style: "margin-top:8px" }, "Open via archive.org (Wayback)"),
          it.lang !== "nl" ? el("a", { class: "btn ghost block", href: googleTranslateUrl(it.link), target: "_blank", rel: "noopener", style: "margin-top:8px" }, "Open vertaald via Google Translate") : null,
          el("a", { class: "btn ghost block", href: it.link, target: "_blank", rel: "noopener", style: "margin-top:8px" }, "Open origineel op " + it.sourceHost)
        );
        return;
      }
      learn(it, 1.5); // volledig lezen = sterker signaal
      if (a.titleTranslated) $("#reader-title").textContent = a.titleTranslated;
      let showOrig = false;
      const renderBody = () => {
        const paras = showOrig || !a.translated ? a.paragraphs : a.translated;
        const art = el("div", { class: "article" });
        for (const p of paras) {
          if (p.startsWith("## ")) art.append(el("h2", {}, p.slice(3)));
          else if (p.startsWith("> ")) art.append(el("blockquote", {}, p.slice(2)));
          else if (p.startsWith("• ")) art.append(el("li", {}, p.slice(2)));
          else art.append(el("p", {}, p));
        }
        box.replaceChildren(
          a.translated ? el("button", { class: "toggle-orig", onclick: () => { showOrig = !showOrig; renderBody(); } }, showOrig ? "Toon Nederlandse vertaling" : "Toon originele tekst") : null,
          a.byline ? el("p", { class: "muted" }, a.byline) : null,
          art,
          a.translated ? el("p", { class: "muted" }, "Automatisch vertaald uit het " + (a.lang === "en" ? "Engels" : a.lang) + ". Bij twijfel: lees het origineel.") : null,
          el("a", { class: "btn ghost block", href: it.link, target: "_blank", rel: "noopener" }, "Open origineel op " + it.sourceHost)
        );
      };
      renderBody();
    } catch (e) {
      if (ctrl.signal.aborted) return;
      box.replaceChildren(
        el("div", { class: "notice" }, "Laden mislukt: " + e.message),
        el("button", { class: "btn ghost block", onclick: () => loadArticle(it) }, "Opnieuw proberen"),
        el("a", { class: "btn block", href: it.link, target: "_blank", rel: "noopener", style: "margin-top:8px" }, "Open origineel")
      );
    }
  }

  function closeReader(fromPop) {
    if (reader.hidden) return;
    readerAbort?.abort();
    reader.hidden = true;
    document.body.style.overflow = "";
    if (!fromPop && history.state?.reader) history.back();
    render(true);
  }
  $("#reader-close").onclick = () => closeReader(false);

  /* ------------------------------------------------------------------ */
  /* Instellingen                                                         */
  /* ------------------------------------------------------------------ */
  const sheet = $("#settings");
  function openSettings() {
    history.pushState({ settings: true }, "");
    sheet.hidden = false;
    document.body.style.overflow = "hidden";
    $("#opt-translate-titles").checked = settings.translateTitles;
    $("#opt-autoload").checked = settings.autoload;
    $("#opt-hide-read").checked = settings.hideRead;
    $("#opt-api").value = settings.apiBase;
    $("#opt-translate-mode").value = settings.translateMode;
    $("#opt-titles-when").value = settings.titlesWhen;
    renderFeedList();
    renderInterests();
    renderProfile();
    checkApi();
  }
  function renderInterests() {
    const box = $("#interest-list");
    box.replaceChildren(...interests.map((w) =>
      el("span", { class: "chip" }, w, el("button", { "aria-label": "Verwijderen", onclick: () => { interests = interests.filter((x) => x !== w); save.interests(); renderInterests(); } }, "✕"))
    ));
  }
  $("#add-interest-form").onsubmit = (e) => {
    e.preventDefault();
    const w = $("#ni-word").value.trim().toLowerCase();
    if (w && !interests.includes(w)) { interests.push(w); save.interests(); renderInterests(); }
    e.target.reset();
  };
  function closeSettings(fromPop) {
    if (sheet.hidden) return;
    sheet.hidden = true;
    document.body.style.overflow = "";
    if (!fromPop && history.state?.settings) history.back();
    save.settings();
    save.feeds();
    render();
  }
  $("#btn-menu").onclick = openSettings;
  $("#settings-close").onclick = () => closeSettings(false);
  $("#opt-translate-titles").onchange = (e) => { settings.translateTitles = e.target.checked; save.settings(); if (settings.translateTitles) translateTitles(); };
  $("#opt-autoload").onchange = (e) => { settings.autoload = e.target.checked; save.settings(); };
  $("#opt-hide-read").onchange = (e) => { settings.hideRead = e.target.checked; save.settings(); };
  $("#opt-titles-when").onchange = (e) => { settings.titlesWhen = e.target.value; save.settings(); if (settings.titlesWhen === "always") translateTitles(); };
  $("#opt-translate-mode").onchange = (e) => { settings.translateMode = e.target.value; save.settings(); };
  $("#opt-api").onchange = (e) => { settings.apiBase = e.target.value.trim().replace(/\/$/, ""); save.settings(); checkApi(); };

  async function checkApi() {
    const s = $("#api-status");
    s.textContent = "Verbinding testen…";
    try {
      const r = await fetch(api("/health"));
      const d = await r.json();
      s.textContent = d.ok ? `Verbonden ✓ (vertaalmodel: ${d.model})` : "Onverwacht antwoord van API";
    } catch (e) {
      s.textContent = "Geen verbinding met de API: " + e.message;
    }
  }

  function renderFeedList() {
    const list = $("#feed-list");
    list.replaceChildren();
    for (const sel of [$("#nf-cat"), $("#np-cat")]) {
      sel.replaceChildren(...Object.entries(CATEGORIES).map(([k, v]) => el("option", { value: k, selected: k === "ai" && sel.id === "np-cat" }, v)));
    }
    for (const f of feeds) {
      const st = feedStatus[f.url] || feedStatus[f.lookup || f.name];
      list.append(
        el("div", { class: "row" },
          el("div", { class: "info" },
            el("div", { class: "name" }, el("img", { src: favicon(f.url), alt: "" }), f.name || host(f.url), el("span", { class: "badge" }, CATEGORIES[f.cat] || f.cat), el("span", { class: "badge lang" }, f.lang), f.paywall === "archive" ? el("span", { class: "badge" }, "via archief") : f.paywall === "check" ? el("span", { class: "badge" }, "deels betaalmuur") : f.paywall === "archivecheck" ? el("span", { class: "badge" }, `via archief, anders na ${f.delayHours || 8} u`) : null, f.podcast ? el("span", { class: "badge" }, "🎧 podcast") : null),
            el("div", { class: "sub" + (st && !st.ok ? " err" : "") }, st ? (st.ok ? `${st.n} ${f.podcast ? "afleveringen" : "artikelen"}` : "Fout: " + st.err) : f.url ? host(f.url) : "wordt opgezocht…")
          ),
          el("input", { type: "checkbox", checked: f.enabled !== false, onchange: (e) => { f.enabled = e.target.checked; save.feeds(); } }),
          el("button", { class: "del", "aria-label": "Verwijderen", onclick: () => { if (confirm(`Bron "${f.name}" verwijderen?`)) { feeds = feeds.filter((x) => x !== f); save.feeds(); renderFeedList(); } } }, "✕")
        )
      );
    }
  }
  $("#add-podcast-form").onsubmit = async (e) => {
    e.preventDefault();
    const q = $("#np-name").value.trim();
    toast("Podcast zoeken…", 0);
    try {
      const d = await podcastLookup({ lookup: q, country: "nl" });
      const hit = (d.results || [])[0];
      if (!hit) throw new Error("niets gevonden");
      if (feeds.some((f) => f.url === hit.feed)) return toast("Deze podcast staat er al in");
      feeds.push({ url: hit.feed, podcast: true, name: hit.name, by: hit.by, image: hit.image, apple: hit.apple, cat: $("#np-cat").value, lang: /nl|dutch|nederland/i.test(hit.by + hit.name) ? "nl" : "en", enabled: true });
      save.feeds();
      renderFeedList();
      e.target.reset();
      toast(`"${hit.name}" (${hit.by}) toegevoegd`);
    } catch (err) {
      toast("Podcast niet gevonden: " + err.message, 5000);
    }
  };
  $("#add-feed-form").onsubmit = async (e) => {
    e.preventDefault();
    const url = $("#nf-url").value.trim();
    const name = $("#nf-name").value.trim();
    const cat = $("#nf-cat").value;
    const paywall = $("#nf-paywall").checked ? "archive" : "";
    if (feeds.some((f) => f.url === url)) return toast("Deze bron staat er al in");
    toast("Feed controleren…", 0);
    try {
      const r = await fetch(api(`/feed?url=${encodeURIComponent(url)}`));
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      const lang = d.items[0]?.lang || "en";
      const feedUrl = d.discovered || url;
      feeds.push({ url: feedUrl, name: name || d.source || host(url), cat, lang, paywall, enabled: true });
      save.feeds();
      feedStatus[url] = { ok: true, n: d.items.length, t: Date.now() };
      renderFeedList();
      e.target.reset();
      toast(`"${name || d.source}" toegevoegd (${d.items.length} artikelen${d.discovered ? ", feed gevonden op de pagina" : ""})`);
    } catch (err) {
      toast("Feed niet geldig: " + err.message, 5000);
    }
  };

  function renderProfile() {
    const view = $("#profile-view");
    const box = (title, obj, labelFn = (k) => k) => {
      const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 8);
      const max = entries[0]?.[1] || 1;
      return el("div", { class: "box" }, el("h4", {}, title),
        entries.length ? entries.map(([k, v]) => el("div", { class: "bar" }, el("i", { style: `width:${Math.max(4, Math.round((v / max) * 60))}px` }), el("span", {}, labelFn(k)), el("small", { class: "muted" }, v.toFixed(1)),
          el("button", { class: "del", "aria-label": "Verwijderen", title: "Niet meer als onderwerp gebruiken", onclick: () => { delete obj[k]; if (obj === profile.topics) { ignored.add(k); save.ignored(); } save.profile(); renderProfile(); renderTabs(); } }, "✕"))) : el("div", { class: "muted" }, "Nog niets geleerd")
      );
    };
    view.replaceChildren(
      box("Bronnen", profile.sources),
      box("Onderwerpen", profile.topics),
      box("Rubrieken", profile.cats, (k) => CATEGORIES[k] || k),
      el("div", { class: "box" }, el("h4", {}, "Statistiek"), el("div", {}, `${profile.clicks || 0} artikelen geopend`), el("div", { class: "muted" }, `${readSet.size} gelezen · ${Object.values(votes).filter((v) => v === 1).length}× 👍 · ${Object.values(votes).filter((v) => v === -1).length}× 👎`))
    );
  }
  $("#btn-reset").onclick = () => {
    if (!confirm("Je interesseprofiel wissen? Bronnen blijven staan.")) return;
    profile = { sources: {}, topics: {}, cats: {}, updated: Date.now(), clicks: 0 };
    votes = {};
    save.profile(); save.votes();
    renderProfile();
    toast("Profiel gewist");
  };
  $("#btn-export").onclick = () => {
    const blob = new Blob([JSON.stringify({ version: 3, settings, feeds, profile, interests, votes, saved, read: [...readSet] }, null, 2)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `mijn-nieuws-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
  };
  $("#file-import").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.feeds) feeds = d.feeds;
      if (d.profile) profile = d.profile;
      if (d.settings) Object.assign(settings, d.settings);
      if (d.read) readSet = new Set(d.read);
      if (d.interests) interests = d.interests;
      if (d.votes) votes = d.votes;
      if (d.saved) { saved = d.saved; save.saved(); }
      save.feeds(); save.profile(); save.settings(); save.read(); save.interests(); save.votes();
      openSettings();
      toast("Geïmporteerd");
    } catch {
      toast("Bestand niet herkend");
    }
  };

  /* ------------------------------------------------------------------ */
  /* Navigatie, SW, start                                                 */
  /* ------------------------------------------------------------------ */
  window.addEventListener("popstate", () => {
    if (!reader.hidden) closeReader(true);
    else if (!sheet.hidden) closeSettings(true);
  });
  $("#btn-refresh").onclick = () => { interacted = true; refresh(true); };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastRefresh > 10 * 60000) refresh();
    else if (document.visibilityState === "visible") checkArchives();
  });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  for (const k of Object.keys(profile.topics)) if (GENERIC.has(k) || STOP.has(k) || k.length < 4) delete profile.topics[k];
  save.profile();
  decayProfile();
  render(); // eerst de bewaarde vorige versie, direct leesbaar
  if (items.length) setTimeout(() => refresh(), 400); // feeds verversen op de achtergrond (kost geen AI-tokens)
  else refresh();
})();
