import { after, NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";
import { hasGoogleTranslateKey, translateTexts } from "@/lib/googleTranslate";
import { readSnapshot, writeSnapshot } from "@/lib/snapshotStore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ── Source definitions with weights ──────────────────────────────────────────

type FeedSource = { name: string; url: string; siteUrl: string; weight: number };

const AI_SOURCES: FeedSource[] = [
  { name: "OpenAI Blog",      url: "https://openai.com/news/rss.xml",                                            siteUrl: "https://openai.com/news",                          weight: 1.4 },
  { name: "Google DeepMind",  url: "https://deepmind.google/blog/rss.xml",                                       siteUrl: "https://deepmind.google/blog/",                    weight: 1.3 },
  { name: "Hugging Face",     url: "https://huggingface.co/blog/feed.xml",                                       siteUrl: "https://huggingface.co/blog",                      weight: 1.2 },
  { name: "The Verge AI",     url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",          siteUrl: "https://www.theverge.com/ai-artificial-intelligence",weight: 1.2 },
  { name: "MIT Tech Review",  url: "https://www.technologyreview.com/topic/artificial-intelligence/feed/",       siteUrl: "https://www.technologyreview.com/topic/artificial-intelligence/", weight: 1.2 },
  { name: "TechCrunch AI",    url: "https://techcrunch.com/category/artificial-intelligence/feed/",              siteUrl: "https://techcrunch.com/category/artificial-intelligence/", weight: 1.1 },
  { name: "The Decoder",      url: "https://the-decoder.com/feed/",                                              siteUrl: "https://the-decoder.com/",                         weight: 1.1  },
  { name: "Google AI Blog",   url: "https://blog.google/technology/ai/rss/",                                     siteUrl: "https://blog.google/technology/ai/",               weight: 1.15 },
  { name: "NVIDIA Blog",      url: "https://blogs.nvidia.com/feed/",                                             siteUrl: "https://blogs.nvidia.com/",                        weight: 1.08 },
];

const TECH_SOURCES: FeedSource[] = [
  { name: "Hacker News",      url: "https://news.ycombinator.com/rss",                                           siteUrl: "https://news.ycombinator.com/",                    weight: 1.15 },
  { name: "Ars Technica",     url: "https://feeds.arstechnica.com/arstechnica/index",                            siteUrl: "https://arstechnica.com/",                         weight: 1.1 },
  { name: "The Verge",        url: "https://www.theverge.com/rss/index.xml",                                     siteUrl: "https://www.theverge.com/",                        weight: 1.05 },
  { name: "The Register",     url: "https://www.theregister.com/headlines.atom",                                  siteUrl: "https://www.theregister.com/",                     weight: 1.05 },
  { name: "9to5Mac",          url: "https://9to5mac.com/feed/",                                                   siteUrl: "https://9to5mac.com/",                             weight: 1.0 },
  { name: "Engadget",         url: "https://www.engadget.com/rss.xml",                                           siteUrl: "https://www.engadget.com/",                        weight: 1.0 },
  { name: "MacRumors",        url: "https://www.macrumors.com/macrumors.xml",                                    siteUrl: "https://www.macrumors.com/",                       weight: 0.98 },
  { name: "BleepingComputer", url: "https://www.bleepingcomputer.com/feed/",                                     siteUrl: "https://www.bleepingcomputer.com/",                weight: 1.02 },
  { name: "Tom's Hardware",   url: "https://www.tomshardware.com/feeds/all",                                     siteUrl: "https://www.tomshardware.com/",                    weight: 0.98 },
  { name: "IEEE Spectrum",    url: "https://spectrum.ieee.org/rss/fulltext",                                     siteUrl: "https://spectrum.ieee.org/",                       weight: 1.05 },
];

// ── Types ─────────────────────────────────────────────────────────────────────

export type FeedArticle = {
  id: string;
  title: string;
  title_cs?: string;
  summary: string;
  summary_cs?: string;
  url: string;
  image: string | null;
  source: string;
  sourceWeight: number;
  publishedAt: string;
  clusterSize: number;
  score: number;
};

// ── XML parser ────────────────────────────────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
});

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&hellip;/g, "...")
    .replace(/<[^>]+>/g, "")
    .replace(/<[^>]*$/g, "")
    .trim();
}

function extractImage(item: any): string | null {
  const mc = item["media:content"] ?? item["media:thumbnail"];
  if (mc) {
    const u = mc["@_url"] ?? mc?.["$"]?.url;
    if (typeof u === "string" && u.startsWith("http")) return u;
  }
  if (item.enclosure?.["@_url"]?.startsWith("http")) return item.enclosure["@_url"];
  if (item.enclosure?.url?.startsWith("http")) return item.enclosure.url;
  const raw = String(item["content:encoded"] ?? item.content ?? item.description ?? "");
  const m = raw.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m?.[1]?.startsWith("http")) return m[1];
  return null;
}

// ── RSS fetch ─────────────────────────────────────────────────────────────────

async function fetchRss(source: FeedSource, limit = 8, fresh = false): Promise<FeedArticle[]> {
  try {
    const res = await fetch(source.url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NewsBot/1.0)" },
      ...(fresh ? { cache: "no-store" as const } : { next: { revalidate: 1800 } }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const text = await res.text();
    const parsed = xmlParser.parse(text);
    const channel = parsed?.rss?.channel ?? parsed?.feed ?? {};
    const rawItems: any[] = channel.item ?? channel.entry ?? [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];

    return items.slice(0, limit).map((item: any) => {
      const title = decodeEntities(String(item.title?.["#text"] ?? item.title ?? ""));
      const rawSummary = String(item["content:encoded"] ?? item.content?.["#text"] ?? item.content ?? item.description ?? "");
      const summary = decodeEntities(rawSummary).slice(0, 400);
      const link = item.link?.["@_href"] ?? item.link?.["#text"] ?? item.link ?? source.siteUrl;
      const pubDate = item.pubDate ?? item.updated ?? item.published ?? null;
      return {
        id: String(item.guid?.["#text"] ?? item.guid ?? item.id ?? link),
        title,
        summary,
        url: typeof link === "string" ? link.trim() : source.siteUrl,
        image: extractImage(item),
        source: source.name,
        sourceWeight: source.weight,
        publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        clusterSize: 1,
        score: 0,
      };
    }).filter(a => a.title && a.url);
  } catch {
    return [];
  }
}

// ── OG image enrichment ───────────────────────────────────────────────────────

async function fetchOgImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    // Read first 24KB — og:image is in <head>
    const reader = res.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let html = "";
    while (html.length < 24576) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
            ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
            ?? html.match(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i)
            ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i);
    const u = og?.[1];
    return u?.startsWith("http") ? u : null;
  } catch {
    return null;
  }
}

async function enrichImages(articles: FeedArticle[]): Promise<FeedArticle[]> {
  const missing = articles.filter(a => !a.image);
  // Only top 8 to stay fast — rest get source logo fallback on client
  const results = await Promise.all(
    missing.slice(0, 8).map(a => fetchOgImage(a.url).then(image => ({ url: a.url, image })))
  );
  const map = new Map(results.map(r => [r.url, r.image]));
  return articles.map(a => ({ ...a, image: a.image ?? map.get(a.url) ?? null }));
}

// ── Two-level deduplication + clustering ─────────────────────────────────────

const STOP_WORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with","by","from",
  "is","are","was","were","be","been","being","have","has","had","do","does","did",
  "will","would","could","should","may","might","can","this","that","these","those",
  "it","its","he","she","they","we","you","i","me","him","her","us","them",
  "new","says","say","said","report","reports","update","updates","gets","get",
]);

function tokenize(title: string): Set<string> {
  return new Set(
    title.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}

function clusterAndDeduplicate(articles: FeedArticle[]): FeedArticle[] {
  // Level 1: URL dedup
  const byUrl = new Map<string, FeedArticle>();
  for (const a of articles) {
    if (!byUrl.has(a.url)) byUrl.set(a.url, a);
  }
  const unique = Array.from(byUrl.values());

  // Level 2: Title similarity clustering (Jaccard ≥ 0.38 = same story)
  const THRESHOLD = 0.38;
  const clusterId = new Array(unique.length).fill(-1);
  let nextCluster = 0;

  for (let i = 0; i < unique.length; i++) {
    if (clusterId[i] !== -1) continue;
    clusterId[i] = nextCluster;
    for (let j = i + 1; j < unique.length; j++) {
      if (clusterId[j] !== -1) continue;
      if (jaccardSimilarity(unique[i].title, unique[j].title) >= THRESHOLD) {
        clusterId[j] = nextCluster;
      }
    }
    nextCluster++;
  }

  // Group by cluster, pick best representative
  const clusters = new Map<number, FeedArticle[]>();
  for (let i = 0; i < unique.length; i++) {
    const cid = clusterId[i];
    if (!clusters.has(cid)) clusters.set(cid, []);
    clusters.get(cid)!.push(unique[i]);
  }

  return Array.from(clusters.values()).map(members => {
    // Best member = highest source weight
    const best = members.reduce((a, b) => a.sourceWeight >= b.sourceWeight ? a : b);
    return { ...best, clusterSize: members.length };
  });
}

// ── Ranking ───────────────────────────────────────────────────────────────────

function rankArticles(articles: FeedArticle[]): FeedArticle[] {
  const now = Date.now();
  return articles
    .map(a => {
      const ageHours = (now - new Date(a.publishedAt).getTime()) / 3_600_000;
      const recency = Math.exp(-ageHours / 20);           // half-life ~20h
      const clusterBonus = 1 + Math.log(a.clusterSize);   // logarithmic cluster boost
      const score = a.sourceWeight * recency * clusterBonus;
      return { ...a, score };
    })
    .sort((a, b) => b.score - a.score);
}

async function translateBatch(articles: FeedArticle[]): Promise<FeedArticle[]> {
  if (articles.length === 0) return articles;
  if (!hasGoogleTranslateKey()) throw new Error("Překladač není nakonfigurovaný");
  const titleInput = articles.map((article) => article.title);
  const summaryInput = articles.map((article) => article.summary || "");
  const [titleTranslations, summaryTranslations] = await Promise.all([
    translateTexts(titleInput),
    translateTexts(summaryInput),
  ]);

  return articles.map((article, index) => ({
    ...article,
    title_cs: titleTranslations[index]?.trim(),
    summary_cs: summaryTranslations[index]?.trim(),
  }));
}

// ── Build feed pipeline ───────────────────────────────────────────────────────

async function buildFeed(category: "ai" | "tech", fresh = false): Promise<FeedArticle[]> {
  const sources = category === "ai" ? AI_SOURCES : TECH_SOURCES;

  // 1. Fetch all RSS sources in parallel
  const rawBatches = await Promise.all(sources.map(s => fetchRss(s, 7, fresh)));
  const allRaw = rawBatches.flat();

  // 2. Two-level dedup + clustering + ranking
  const top = rankArticles(clusterAndDeduplicate(allRaw)).slice(0, 40);

  // 3. OG image enrichment + translation in PARALLEL (biggest speedup)
  const [withImages, translations] = await Promise.all([
    enrichImages(top),
    translateBatch(top),
  ]);

  // Merge: images from enrichImages, translations from translateBatch
  return withImages.map((a, i) => ({
    ...a,
    title_cs: translations[i]?.title_cs ?? a.title,
    summary_cs: translations[i]?.summary_cs ?? a.summary,
  }));
}

type FeedSnapshotData = { articles: FeedArticle[] };

async function refreshFeedSnapshot(category: "ai" | "tech") {
  const articles = await buildFeed(category, true);
  return writeSnapshot(category, { articles } satisfies FeedSnapshotData, articles.length);
}

async function getFeedSnapshot(category: "ai" | "tech") {
  return readSnapshot<FeedSnapshotData>(category);
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function warmFeedCaches() {
  const [ai, tech] = await Promise.allSettled([
    refreshFeedSnapshot("ai"), refreshFeedSnapshot("tech"),
  ]);
  return {
    ai: ai.status === "fulfilled" ? ai.value?.itemCount ?? 0 : 0,
    tech: tech.status === "fulfilled" ? tech.value?.itemCount ?? 0 : 0,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ category: string }> }
) {
  const { category } = await params;
  if (category !== "ai" && category !== "tech") {
    return NextResponse.json({ error: "Unknown category" }, { status: 400 });
  }
  let snapshot = await getFeedSnapshot(category);
  if (!snapshot) snapshot = await refreshFeedSnapshot(category);
  if (!snapshot) {
    return NextResponse.json({ error: "Český snapshot zatím není připravený" }, { status: 503 });
  }

  const ageMs = Date.now() - new Date(snapshot.sourceFetchedAt).getTime();
  if (ageMs > 5 * 60_000) {
    after(async () => { await refreshFeedSnapshot(category); });
  }

  return NextResponse.json({ ...snapshot.data, freshness: {
    version: snapshot.version,
    sourceFetchedAt: snapshot.sourceFetchedAt,
    translatedAt: snapshot.translatedAt,
  } }, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
