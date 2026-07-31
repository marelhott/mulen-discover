import { XMLParser } from "fast-xml-parser";
import { unstable_cache } from "next/cache";
import { hasGoogleTranslateKey, translateTexts } from "@/lib/googleTranslate";
import { readSnapshot, writeSnapshot } from "@/lib/snapshotStore";

const RSS_ITEMS_PER_SOURCE = 18;
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 30;
const RAW_NEWS_LIMIT = 120;
const TRANSLATION_BATCH_SIZE = 10;
const OG_IMAGE_ENRICH_LIMIT = 40;
const ALLOWED_PERSON_DEPARTMENTS = new Set(["Acting", "Directing"]);
const MAX_ARTICLE_AGE_DAYS = 21;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "...",
  lt: "<",
  nbsp: " ",
  quot: "\"",
};

const STOPWORDS = new Set([
  "a", "about", "after", "also", "an", "and", "are", "at", "awards", "box", "by", "cz", "daily", "de", "deadline",
  "europe", "european", "festival", "film", "filmu", "filmovy", "films", "for", "from", "has", "have", "her", "his",
  "hollywood", "in", "indiewire", "into", "its", "movie", "movies", "new", "novy", "on", "oscar", "reporter", "screen",
  "se", "screendaily", "that", "the", "their", "this", "to", "trailer", "variety", "with", "world",
]);

const CATEGORY_LABELS: Record<NewsCategory, string> = {
  awards: "Ocenění",
  box_office: "Tržby",
  breaking: "Mimořádná zpráva",
  casting: "Obsazení",
  development: "Vývoj projektu",
  european: "Evropský film",
  festival: "Festivaly",
  industry: "Filmový průmysl",
  interview: "Rozhovor",
  opinion: "Komentář",
  other: "Novinka",
  review: "Recenze",
  trailer: "Upoutávka",
};

const SOURCE_LOOKUP = {
  "Deadline": { url: "https://deadline.com/v/film/feed/", name: "Deadline", focus: "aktuální zprávy, obsazení a tržby", lang: "en" },
  "Variety": { url: "https://variety.com/c/film/feed/", name: "Variety", focus: "filmový průmysl", lang: "en" },
  "Hollywood Reporter": { url: "https://www.hollywoodreporter.com/c/movies/movie-news/feed/", name: "Hollywood Reporter", focus: "festivaly, rozhovory a ocenění", lang: "en" },
  "IndieWire": { url: "https://www.indiewire.com/c/film/feed/", name: "IndieWire", focus: "nezávislý a autorský film", lang: "en" },
  "MovieZone.cz": { url: "https://www.moviezone.cz/rss/", name: "MovieZone.cz", focus: "české trailery & novinky", lang: "cs" },
  "Screen Daily": { url: "https://www.screendaily.com/1366.rss", name: "Screen Daily", focus: "evropský filmový průmysl, festivaly a severské tituly", lang: "en" },
  "Film New Europe": { url: "https://www.filmneweurope.com/?format=feed&type=rss", name: "Film New Europe", focus: "nové evropské filmy & regionální produkce", lang: "en" },
} as const;

export const RSS_SOURCES = Object.values(SOURCE_LOOKUP);

export type NewsCategory =
  | "awards"
  | "box_office"
  | "breaking"
  | "casting"
  | "development"
  | "european"
  | "festival"
  | "industry"
  | "interview"
  | "opinion"
  | "other"
  | "review"
  | "trailer";

type SourceMeta = typeof RSS_SOURCES[number];

export interface ImageCandidate {
  url: string;
  width: number;
  height: number;
  origin: "rss" | "og";
}

interface RawArticle {
  title: string;
  link: string;
  pubDate: string;
  publishedAt: number;
  description: string;
  fullText: string;
  source: string;
  focus: string;
  imageCandidates: ImageCandidate[];
  lang: string;
}

interface RankedArticle extends RawArticle {
  category: NewsCategory;
  categoryLabel: string;
  interestScore: number;
  topicKey: string;
  entityHints: string[];
  isLowValue: boolean;
}

interface ClusteredArticle {
  lead: RankedArticle;
  related: RankedArticle[];
  sources: string[];
  category: NewsCategory;
  categoryLabel: string;
  interestScore: number;
  image: string | undefined;
  imageQuality: "high" | "medium" | "low" | null;
  topicKey: string;
  relatedTitles: string[];
  lang: string;
}

type ImageQuality = "high" | "medium" | "low" | null;

export interface PersonSnippet {
  id: number;
  name: string;
  photo: string | null;
  known_for: string;
  top_films: { title: string; year: number; poster: string | null }[];
}

export interface NewsArticle {
  title_cs: string;
  body_cs: string;
  title_en: string;
  link: string;
  pubDate: string;
  source: string;
  focus: string;
  image?: string;
  image_quality: ImageQuality;
  person?: PersonSnippet;
  category: NewsCategory;
  category_label: string;
  interest_score: number;
  cluster_size: number;
  cluster_sources: string[];
}

export interface NewsResponse {
  articles: NewsArticle[];
  hasMore: boolean;
  page: number;
  pageSize: number;
  total: number;
  refreshedAt?: number;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "__cdata",
});

function getKeys() {
  return {
    tmdb: process.env.TMDB_API_KEY,
  };
}

function decodeHtmlEntities(input: string) {
  return String(input ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (_, named) => NAMED_ENTITIES[named.toLowerCase()] ?? `&${named};`);
}

function stripHtml(html: string, maxLen = 900): string {
  return decodeHtmlEntities(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function normalizeCzechText(input: string) {
  return input
    .replace(/\bsynem své známé\b/gi, "synem partnerky")
    .replace(/\bsvé známé\b/gi, "partnerky")
    .replace(/\bsi divák vzal mikrofon\b/gi, "jeden z diváků popadl mikrofon")
    .replace(/\bdojde k odejití\b/gi, "odejde")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSpace(input: string) {
  return decodeHtmlEntities(input).replace(/\s+/g, " ").trim();
}

function extractImageCandidates(item: Record<string, unknown>): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];
  const pushCandidate = (url: string, width?: number, height?: number, origin: "rss" | "og" = "rss") => {
    const cleanUrl = decodeHtmlEntities(String(url || "").trim());
    if (!cleanUrl.startsWith("http")) return;
    if (cleanUrl.includes("pixel") || cleanUrl.includes("1x1")) return;
    candidates.push({
      url: cleanUrl,
      width: Number(width || 0),
      height: Number(height || 0),
      origin,
    });
  };

  const mediaContent = item["media:content"];
  if (Array.isArray(mediaContent)) {
    for (const entry of mediaContent) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const url = String(record["@_url"] ?? "");
      const medium = String(record["@_medium"] ?? "");
      if (url && (medium === "image" || /\.(jpe?g|png|webp)/i.test(url))) {
        pushCandidate(url, Number(record["@_width"] ?? 0), Number(record["@_height"] ?? 0));
      }
    }
  } else if (mediaContent && typeof mediaContent === "object") {
    const record = mediaContent as Record<string, unknown>;
    if (record["@_url"]) {
      pushCandidate(String(record["@_url"]), Number(record["@_width"] ?? 0), Number(record["@_height"] ?? 0));
    }
  }

  const thumbnail = item["media:thumbnail"];
  if (Array.isArray(thumbnail)) {
    for (const entry of thumbnail) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      if (record["@_url"]) {
        pushCandidate(String(record["@_url"]), Number(record["@_width"] ?? 0), Number(record["@_height"] ?? 0));
      }
    }
  } else if (thumbnail && typeof thumbnail === "object") {
    const record = thumbnail as Record<string, unknown>;
    if (record["@_url"]) {
      pushCandidate(String(record["@_url"]), Number(record["@_width"] ?? 0), Number(record["@_height"] ?? 0));
    }
  }

  const enclosure = item.enclosure;
  if (enclosure && typeof enclosure === "object") {
    const record = enclosure as Record<string, unknown>;
    if (String(record["@_type"] ?? "").startsWith("image") && record["@_url"]) {
      pushCandidate(String(record["@_url"]), Number(record["@_width"] ?? 0), Number(record["@_height"] ?? 0));
    }
  }

  const itunesImage = item["itunes:image"];
  if (itunesImage && typeof itunesImage === "object" && (itunesImage as Record<string, unknown>)["@_href"]) {
    pushCandidate(String((itunesImage as Record<string, unknown>)["@_href"]), 1200, 630);
  }

  for (const raw of [item["content:encoded"], item.description, item.summary]) {
    const source = typeof raw === "object" && raw !== null
      ? String((raw as Record<string, unknown>).__cdata ?? raw)
      : String(raw ?? "");
    if (!source) continue;
    const imageRegex = /<img[^>]+src=["']([^"']+\.(?:jpe?g|png|webp)[^"']*?)["'][^>]*>/gi;
    for (const match of source.matchAll(imageRegex)) {
      pushCandidate(match[1], 0, 0);
    }
  }

  return candidates;
}

function imageScore(candidate: ImageCandidate) {
  let score = candidate.origin === "rss" ? 15 : 8;
  const width = candidate.width || 0;
  const height = candidate.height || 0;
  if (width >= 1200 && height >= 675) score += 35;
  else if (width >= 800 && height >= 450) score += 24;
  else if (width >= 640 && height >= 360) score += 12;
  else if (width > 0 && height > 0) score -= 14;

  if (width > 0 && height > 0) {
    const ratio = width / Math.max(1, height);
    const distance169 = Math.abs(ratio - 16 / 9);
    const distance32 = Math.abs(ratio - 3 / 2);
    score += Math.max(0, 16 - Math.min(distance169, distance32) * 20);
  }

  if (/logo|icon|avatar|headshot|thumb|thumbnail/i.test(candidate.url)) score -= 12;
  if (/poster/i.test(candidate.url)) score -= 6;
  if (/wp-content\/uploads/i.test(candidate.url)) score += 4;
  return score;
}

function pickBestImage(candidates: ImageCandidate[]): {
  image: string | undefined;
  imageQuality: ImageQuality;
} {
  if (candidates.length === 0) {
    return { image: undefined, imageQuality: null };
  }

  const best = [...candidates].sort((left, right) => imageScore(right) - imageScore(left))[0];
  const score = imageScore(best);
  const imageQuality =
    score >= 45 ? "high"
    : score >= 24 ? "medium"
    : "low";

  return { image: best.url, imageQuality };
}

function articleAgeIsFresh(timestamp: number) {
  if (!timestamp) return true;
  return Date.now() - timestamp <= MAX_ARTICLE_AGE_DAYS * 24 * 60 * 60 * 1000;
}

async function fetchRSS(source: SourceMeta): Promise<RawArticle[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const res = await fetch(source.url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FilmBot/2.0)" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return [];

    const xml = await res.text();
    const parsed = parser.parse(xml) as {
      rss?: { channel?: { item?: Record<string, unknown>[] | Record<string, unknown> } };
      feed?: { entry?: Record<string, unknown>[] | Record<string, unknown> };
    };

    const items = parsed?.rss?.channel?.item ?? parsed?.feed?.entry ?? [];
    const entries = Array.isArray(items) ? items : [items];

    return entries.slice(0, RSS_ITEMS_PER_SOURCE).map((item) => {
      const titleRaw = typeof item.title === "object" && item.title !== null
        ? String((item.title as Record<string, unknown>).__cdata ?? item.title)
        : String(item.title ?? "");
      const descriptionRaw = typeof item.description === "object" && item.description !== null
        ? String((item.description as Record<string, unknown>).__cdata ?? item.description)
        : String(item.description ?? item.summary ?? "");
      const fullTextRaw = typeof item["content:encoded"] === "object" && item["content:encoded"] !== null
        ? String((item["content:encoded"] as Record<string, unknown>).__cdata ?? item["content:encoded"])
        : String(item["content:encoded"] ?? descriptionRaw);
      const linkValue = item.link;
      const link = typeof linkValue === "string"
        ? linkValue
        : typeof linkValue === "object" && linkValue !== null
          ? String((linkValue as Record<string, unknown>)["@_href"] ?? (linkValue as Record<string, unknown>)["#text"] ?? "")
          : "";
      const pubDate = String(item.pubDate ?? item.updated ?? item.published ?? "");
      const publishedAt = pubDate ? new Date(pubDate).getTime() : 0;

      return {
        title: stripHtml(titleRaw, 220),
        link,
        pubDate,
        publishedAt: Number.isFinite(publishedAt) ? publishedAt : 0,
        description: stripHtml(descriptionRaw, 450),
        fullText: stripHtml(fullTextRaw, 1200),
        source: source.name,
        focus: source.focus,
        lang: source.lang,
        imageCandidates: extractImageCandidates(item),
      };
    }).filter((article) => article.title && article.link && articleAgeIsFresh(article.publishedAt));
  } catch {
    clearTimeout(timeout);
    return [];
  }
}

function deduplicate(articles: RawArticle[]) {
  const seen = new Set<string>();
  return articles.filter((article) => {
    const key = normalizeSpace(article.title)
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .split(" ")
      .filter((word) => word.length > 3)
      .slice(0, 7)
      .join(" ");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractEntityHints(title: string) {
  const matches = title.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g) ?? [];
  return Array.from(new Set(matches))
    .filter((value) => !/MovieZone|Variety|Deadline|Reporter|Europe|Daily|Box Office/i.test(value));
}

function categoryFromArticle(article: RawArticle): NewsCategory {
  const text = `${article.title} ${article.description} ${article.fullText}`.toLowerCase();
  const link = article.link.toLowerCase();
  if (/(trailer|teaser|exclusive clip|first look)/.test(text) || /\/trailery?\//.test(link)) return "trailer";
  if (/(review|recenze|critics pick|spoiler review)/.test(text) || /\/recenze\//.test(link)) return "review";
  if (/(interview|q&a|talks|speaks|conversation with)/.test(text)) return "interview";
  if (/(opinion|analysis|essay|column|commentary)/.test(text)) return "opinion";
  if (/(casting|casts|joins|set to star|to star|boards|adds|reunites with)/.test(text)) return "casting";
  if (/(box office|opens to|opening weekend|grosses|ticket sales)/.test(text)) return "box_office";
  if (/(oscar|academy awards|golden globes|bafta|cannes award|palme d'or|award season)/.test(text)) return "awards";
  if (/(cannes|venice|berlin|locarno|san sebastian|sundance|toronto|karlovy vary|festival)/.test(text)) return "festival";
  if (/(europe|nordic|scandinav|czech|slovak|polish|romanian|hungarian|serbian|croatian|baltic)/.test(text)
    || article.source === "Screen Daily"
    || article.source === "Film New Europe") return "european";
  if (/(deal|acquisition|distribution|rights|greenlight|financing|production|studio|streaming|business)/.test(text)) return "industry";
  if (/(set to direct|developing|in the works|adaptation|development|writing|writer)/.test(text)) return "development";
  if (/(dies|killed|lawsuit|arrested|removed|fired|exits|delayed|shuts down|bankruptcy)/.test(text)) return "breaking";
  return "other";
}

function recencyBonus(timestamp: number) {
  if (!timestamp) return 0;
  const hours = (Date.now() - timestamp) / 36e5;
  if (hours <= 6) return 24;
  if (hours <= 18) return 18;
  if (hours <= 36) return 12;
  if (hours <= 72) return 6;
  return 0;
}

function baseCategoryScore(category: NewsCategory) {
  switch (category) {
    case "breaking":
      return 96;
    case "casting":
      return 90;
    case "box_office":
      return 88;
    case "awards":
      return 86;
    case "festival":
      return 82;
    case "industry":
      return 74;
    case "european":
      return 72;
    case "development":
      return 66;
    case "interview":
      return 58;
    case "opinion":
      return 32;
    case "review":
      return 20;
    case "trailer":
      return 16;
    default:
      return 52;
  }
}

function buildTopicKey(article: RawArticle, entityHints: string[], category: NewsCategory) {
  if (entityHints.length > 0) {
    return `${category}:${entityHints[0].toLowerCase()}`;
  }

  const tokens = normalizeSpace(article.title)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
    .slice(0, 6);

  return `${category}:${tokens.join("-")}`;
}

function topicTokens(article: RankedArticle) {
  return normalizeSpace(article.title)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
    .slice(0, 10);
}

function overlapScore(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  const shared = left.filter((token) => rightSet.has(token)).length;
  return shared / Math.min(left.length, right.length);
}

function rankArticles(articles: RawArticle[]) {
  return articles.map((article): RankedArticle => {
    const category = categoryFromArticle(article);
    const entityHints = extractEntityHints(article.title);
    const bestImage = pickBestImage(article.imageCandidates);
    const interestScore =
      baseCategoryScore(category)
      + recencyBonus(article.publishedAt)
      + Math.min(entityHints.length, 2) * 5
      + (article.fullText.length > 220 ? 4 : 0)
      + (bestImage.imageQuality === "high" ? 8 : bestImage.imageQuality === "medium" ? 3 : 0);

    return {
      ...article,
      category,
      categoryLabel: CATEGORY_LABELS[category],
      interestScore,
      topicKey: buildTopicKey(article, entityHints, category),
      entityHints,
      isLowValue: category === "trailer" || category === "review" || category === "opinion",
    };
  });
}

function clusterArticles(articles: RankedArticle[]) {
  const groups = new Map<string, RankedArticle[]>();
  for (const article of articles) {
    const group = groups.get(article.topicKey);
    if (group) group.push(article);
    else groups.set(article.topicKey, [article]);
  }

  return [...groups.values()].map((group): ClusteredArticle | null => {
    const sorted = [...group].sort((left, right) => {
      if (right.interestScore !== left.interestScore) return right.interestScore - left.interestScore;
      return right.publishedAt - left.publishedAt;
    });
    const lead = sorted[0];
    const images = group.flatMap((article) => article.imageCandidates);
    const bestImage = pickBestImage(images);
    const sources = Array.from(new Set(group.map((article) => article.source)));
    const interestScore = Math.max(...group.map((article) => article.interestScore)) + Math.min(group.length - 1, 3) * 4;

    if (lead.isLowValue && sources.length < 2 && interestScore < 60) {
      return null;
    }

    return {
      lead,
      related: sorted.slice(1),
      sources,
      category: lead.category,
      categoryLabel: lead.categoryLabel,
      interestScore,
      image: bestImage.image,
      imageQuality: bestImage.imageQuality,
      topicKey: lead.topicKey,
      relatedTitles: sorted.slice(1, 4).map((article) => article.title),
      lang: lead.lang,
    };
  }).filter((value): value is ClusteredArticle => Boolean(value))
    .sort((left, right) => {
      if (right.interestScore !== left.interestScore) return right.interestScore - left.interestScore;
      return right.lead.publishedAt - left.lead.publishedAt;
    });
}

function mergeSimilarClusters(clusters: ClusteredArticle[]) {
  const merged: ClusteredArticle[] = [];

  for (const cluster of clusters) {
    const currentTokens = topicTokens(cluster.lead);
    const currentEntities = new Set(cluster.lead.entityHints.map((value) => value.toLowerCase()));
    const targetIndex = merged.findIndex((candidate) => {
      if (candidate.category !== cluster.category) return false;
      const candidateTokens = topicTokens(candidate.lead);
      const candidateEntities = new Set(candidate.lead.entityHints.map((value) => value.toLowerCase()));
      const entityOverlap = [...currentEntities].some((value) => candidateEntities.has(value));
      const tokenOverlap = overlapScore(currentTokens, candidateTokens);
      return entityOverlap || tokenOverlap >= 0.62;
    });

    if (targetIndex === -1) {
      merged.push(cluster);
      continue;
    }

    const target = merged[targetIndex];
    const combinedStories = [target.lead, ...target.related, cluster.lead, ...cluster.related]
      .sort((left, right) => {
        if (right.interestScore !== left.interestScore) return right.interestScore - left.interestScore;
        return right.publishedAt - left.publishedAt;
      });
    const lead = combinedStories[0];
    const related = combinedStories.slice(1);
    const sources = Array.from(new Set([...target.sources, ...cluster.sources]));
    const images = combinedStories.flatMap((story) => story.imageCandidates);
    const bestImage = pickBestImage(images);

    merged[targetIndex] = {
      lead,
      related,
      sources,
      category: lead.category,
      categoryLabel: lead.categoryLabel,
      interestScore: Math.max(target.interestScore, cluster.interestScore) + Math.min(sources.length - 1, 4) * 3,
      image: bestImage.image,
      imageQuality: bestImage.imageQuality,
      topicKey: lead.topicKey,
      relatedTitles: related.slice(0, 4).map((story) => story.title),
      lang: lead.lang,
    };
  }

  return merged.sort((left, right) => {
    if (right.interestScore !== left.interestScore) return right.interestScore - left.interestScore;
    return right.lead.publishedAt - left.lead.publishedAt;
  });
}

async function fetchOGImage(url: string): Promise<ImageCandidate | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Googlebot/2.1" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();
    const imageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i)
      || html.match(/<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i);
    if (!imageMatch?.[1]?.startsWith("http")) return null;
    const widthMatch = html.match(/<meta[^>]+property=["']og:image:width["'][^>]*content=["']([^"']+)["']/i);
    const heightMatch = html.match(/<meta[^>]+property=["']og:image:height["'][^>]*content=["']([^"']+)["']/i);
    return {
      url: decodeHtmlEntities(imageMatch[1]),
      width: Number(widthMatch?.[1] ?? 0),
      height: Number(heightMatch?.[1] ?? 0),
      origin: "og",
    };
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

const getCachedOgImage = unstable_cache(
  async (link: string) => fetchOGImage(link),
  ["news-og-image-v2"],
  { revalidate: 86400 }
);

async function enrichClusterImages(clusters: ClusteredArticle[]) {
  return Promise.all(
    clusters.map(async (cluster, index) => {
      if (index >= OG_IMAGE_ENRICH_LIMIT) return cluster;
      if (cluster.imageQuality === "high") return cluster;
      const fallback = await getCachedOgImage(cluster.lead.link);
      if (!fallback) return cluster;
      const picked = pickBestImage([
        ...(cluster.lead.imageCandidates ?? []),
        fallback,
      ]);
      if (!picked.image) return cluster;
      return {
        ...cluster,
        image: picked.image,
        imageQuality: picked.imageQuality,
      };
    })
  );
}

function buildFallbackBody(cluster: ClusteredArticle) {
  const lead = cluster.lead;
  if (lead.description) return lead.description;
  if (cluster.category === "trailer") {
    return `${lead.source} zveřejnil nový trailer k titulu ${lead.title}.`;
  }
  if (cluster.category === "review") {
    return `${lead.source} publikoval recenzi k titulu ${lead.title}.`;
  }
  return `${lead.source} přinesl novou zprávu ze světa filmu k tématu ${lead.title}.`;
}

function decorateBodyWithClusterContext(body: string, cluster: ClusteredArticle) {
  const clean = normalizeCzechText(body);
  if (cluster.sources.length < 2) return clean;
  const extras = cluster.sources.filter((source) => source !== cluster.lead.source).slice(0, 2);
  if (extras.length === 0) return clean;
  if (/píší|uvádějí|informují/i.test(clean)) return clean;
  const suffix = extras.length === 1
    ? ` Téma sleduje také ${extras[0]}.`
    : ` Téma sledují také ${extras.join(" a ")}.`;
  return `${clean}${suffix}`;
}

function buildLocalArticle(cluster: ClusteredArticle): NewsArticle {
  return {
    title_cs: normalizeCzechText(decodeHtmlEntities(cluster.lead.title.trim())),
    body_cs: decorateBodyWithClusterContext(
      normalizeCzechText(decodeHtmlEntities(buildFallbackBody(cluster).trim())),
      cluster
    ),
    title_en: cluster.lead.title,
    link: cluster.lead.link,
    pubDate: cluster.lead.pubDate,
    source: cluster.lead.source,
    focus: cluster.lead.focus,
    image: cluster.image,
    image_quality: cluster.imageQuality,
    category: cluster.category,
    category_label: cluster.categoryLabel,
    interest_score: cluster.interestScore,
    cluster_size: cluster.sources.length,
    cluster_sources: cluster.sources,
  };
}

function pickPersonHint(cluster: ClusteredArticle) {
  const hints = [
    ...cluster.lead.entityHints,
    ...cluster.related.flatMap((story) => story.entityHints),
  ];

  return Array.from(new Set(hints))
    .filter((hint) => hint.split(/\s+/).length >= 2)
    .find((hint) => !/Toy Story|Box Office|Karlovy Vary|MovieZone|Screen Daily/i.test(hint)) ?? null;
}

async function findPersonByName(name: string, tmdbKey: string): Promise<PersonSnippet | null> {
  try {
    const searchRes = await fetch(
      `https://api.themoviedb.org/3/search/person?api_key=${tmdbKey}&query=${encodeURIComponent(name)}&language=cs`,
      { next: { revalidate: 86400 } }
    );
    const searchData = await searchRes.json() as { results?: Array<Record<string, unknown>> };
    const person = searchData.results?.[0];
    if (!person) return null;
    if (!ALLOWED_PERSON_DEPARTMENTS.has(String(person.known_for_department ?? ""))) return null;

    const creditsRes = await fetch(
      `https://api.themoviedb.org/3/person/${person.id}/movie_credits?api_key=${tmdbKey}&language=cs`,
      { next: { revalidate: 86400 } }
    );
    const credits = await creditsRes.json() as {
      crew?: Array<Record<string, unknown>>;
      cast?: Array<Record<string, unknown>>;
    };

    const seenFilmIds = new Set<number>();
    const topFilms = [...(credits.crew ?? []).filter((entry) => entry.job === "Director"), ...(credits.cast ?? [])]
      .sort((a, b) => Number(b.vote_count ?? 0) - Number(a.vote_count ?? 0))
      .filter((film) => {
        const id = Number(film.id ?? 0);
        if (!id || seenFilmIds.has(id)) return false;
        seenFilmIds.add(id);
        return true;
      })
      .slice(0, 5)
      .map((film) => ({
        title: String(film.title ?? film.original_title ?? ""),
        year: film.release_date ? parseInt(String(film.release_date), 10) : 0,
        poster: film.poster_path ? `https://image.tmdb.org/t/p/w185${String(film.poster_path)}` : null,
      }));

    return {
      id: Number(person.id),
      name: String(person.name ?? ""),
      photo: person.profile_path ? `https://image.tmdb.org/t/p/w185${String(person.profile_path)}` : null,
      known_for: String(person.known_for_department ?? ""),
      top_films: topFilms,
    };
  } catch {
    return null;
  }
}

const getCachedPersonByName = unstable_cache(
  async (name: string, tmdbKey: string) => findPersonByName(name, tmdbKey),
  ["news-person-by-name-v3"],
  { revalidate: 86400 }
);

async function translateClusterBatch(clusters: ClusteredArticle[], tmdbKey?: string) {
  const titleInput = clusters.map((cluster) => cluster.lead.title);
  const bodyInput = clusters.map((cluster) => {
    const sourceText = cluster.lead.fullText || cluster.lead.description || buildFallbackBody(cluster);
    return sourceText.slice(0, 900);
  });

  const [translatedTitles, translatedBodies, personResults] = await Promise.all([
    translateTexts(titleInput),
    translateTexts(bodyInput),
    tmdbKey
      ? Promise.all(
          clusters.map((cluster) => {
            const personName = pickPersonHint(cluster);
            return personName ? getCachedPersonByName(personName, tmdbKey) : Promise.resolve(null);
          })
        )
      : Promise.resolve(clusters.map(() => null)),
  ]);

  return clusters.map((cluster, index): NewsArticle => {
    return {
      title_cs: normalizeCzechText(decodeHtmlEntities(translatedTitles[index]?.trim() || cluster.lead.title)),
      body_cs: decorateBodyWithClusterContext(
        normalizeCzechText(decodeHtmlEntities(translatedBodies[index]?.trim() || buildFallbackBody(cluster))),
        cluster
      ),
      title_en: cluster.lead.title,
      link: cluster.lead.link,
      pubDate: cluster.lead.pubDate,
      source: cluster.lead.source,
      focus: cluster.lead.focus,
      image: cluster.image,
      image_quality: cluster.imageQuality,
      person: personResults[index] ?? undefined,
      category: cluster.category,
      category_label: cluster.categoryLabel,
      interest_score: cluster.interestScore,
      cluster_size: cluster.sources.length,
      cluster_sources: cluster.sources,
    };
  });
}

async function generateClusterBatch(clusters: ClusteredArticle[]) {
  const { tmdb } = getKeys();
  if (!hasGoogleTranslateKey()) {
    throw new Error("Překladač není nakonfigurovaný");
  }

  const englishClusters = clusters.filter((cluster) => cluster.lang !== "cs");

  if (englishClusters.length === 0) {
    return clusters.map((cluster) => buildLocalArticle(cluster));
  }

  const translated = await translateClusterBatch(englishClusters, tmdb);
  const translatedByLink = new Map(translated.map((article) => [article.link, article]));

  return clusters.map((cluster) =>
    cluster.lang === "cs"
      ? buildLocalArticle(cluster)
      : translatedByLink.get(cluster.lead.link) ?? (() => { throw new Error("Chybí překlad článku"); })()
  );
}

const getCachedClusterBatch = unstable_cache(
  async (payload: string) => {
    const clusters = JSON.parse(payload) as ClusteredArticle[];
    return generateClusterBatch(clusters);
  },
  ["news-cluster-batch-v3"],
  { revalidate: 604800 }
);

async function buildRawNewsFeed() {
  const rssResults = await Promise.all(RSS_SOURCES.map(fetchRSS));
  return deduplicate(
    rssResults.flat()
      .filter((article) => article.title && article.link)
      .sort((a, b) => b.publishedAt - a.publishedAt)
  ).slice(0, RAW_NEWS_LIMIT);
}

export const getRawNewsFeed = unstable_cache(
  async () => buildRawNewsFeed(),
  ["raw-news-feed-v4"],
  { revalidate: 900 }
);

const getClusteredNewsFeed = unstable_cache(
  async () => {
    const rawArticles = await getRawNewsFeed();
    const ranked = rankArticles(rawArticles);
    const clusters = mergeSimilarClusters(clusterArticles(ranked));
    return enrichClusterImages(clusters);
  },
  ["clustered-news-feed-v1"],
  { revalidate: 900 }
);

async function buildNewsPage(page: number, pageSize: number, forceRefresh: boolean): Promise<NewsResponse> {
  const clustered = forceRefresh
    ? await enrichClusterImages(mergeSimilarClusters(clusterArticles(rankArticles(await buildRawNewsFeed()))))
    : await getClusteredNewsFeed();
  const start = Math.max(0, (page - 1) * pageSize);
  const pageItems = clustered.slice(start, start + pageSize);
  const hasMore = start + pageSize < clustered.length;

  const batches: ClusteredArticle[][] = [];
  for (let index = 0; index < pageItems.length; index += TRANSLATION_BATCH_SIZE) {
    batches.push(pageItems.slice(index, index + TRANSLATION_BATCH_SIZE));
  }

  const translated = await Promise.all(
    batches.map((batch) => getCachedClusterBatch(JSON.stringify(batch)))
  );

  return {
    articles: translated.flat(),
    hasMore,
    page,
    pageSize,
    total: clustered.length,
    refreshedAt: forceRefresh ? Date.now() : undefined,
  };
}

export const getCachedNewsPage = unstable_cache(
  async (page: number, pageSize: number) => buildNewsPage(page, pageSize, false),
  ["news-page-v9"],
  { revalidate: 900 }
);

export async function getNewsPage(page: number, pageSize: number, forceRefresh: boolean) {
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize || DEFAULT_PAGE_SIZE));
  return forceRefresh
    ? buildNewsPage(safePage, safePageSize, true)
    : getCachedNewsPage(safePage, safePageSize);
}

export type NewsSnapshotData = {
  articles: NewsArticle[];
  total: number;
};

async function buildAllNews(forceRefresh: boolean): Promise<NewsSnapshotData> {
  const clustered = forceRefresh
    ? await enrichClusterImages(mergeSimilarClusters(clusterArticles(rankArticles(await buildRawNewsFeed()))))
    : await getClusteredNewsFeed();
  const batches: ClusteredArticle[][] = [];
  for (let index = 0; index < clustered.length; index += TRANSLATION_BATCH_SIZE) {
    batches.push(clustered.slice(index, index + TRANSLATION_BATCH_SIZE));
  }
  const translated = await Promise.all(batches.map((batch) => getCachedClusterBatch(JSON.stringify(batch))));
  return { articles: translated.flat(), total: clustered.length };
}

export async function readNewsSnapshot() {
  return readSnapshot<NewsSnapshotData>("news");
}

export async function refreshNewsSnapshot() {
  const data = await buildAllNews(true);
  return writeSnapshot("news", data, data.articles.length);
}

export async function warmNewsCaches() {
  const snapshot = await refreshNewsSnapshot();
  return { warmedPages: [1, 2, 3], items: snapshot?.itemCount ?? 0 };
}
