type FeedArticle = { title: string; title_cs?: string; summary?: string; summary_cs?: string };
type NewsArticle = { title_en: string; title_cs: string; body_cs: string; category_label: string };
type Freshness = { sourceFetchedAt?: string };

const baseUrl = (process.env.BASE_URL || "https://news-movie-release.vercel.app").replace(/\/$/, "");
const englishLabels = new Set(["Awards", "Box office", "Breaking", "Casting", "Business", "Trailer"]);
const englishSignal = /\b(the|and|with|from|into|that|this|for|about|new|will|has|have|are|was|were|after|before|their|its|your|you)\b/i;

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function assertFresh(label: string, freshness: Freshness | undefined) {
  const timestamp = freshness?.sourceFetchedAt ? new Date(freshness.sourceFetchedAt).getTime() : 0;
  if (!timestamp || Date.now() - timestamp > 10 * 60_000) throw new Error(`${label}: snapshot je starší než 10 minut`);
}

async function verifyFeed(path: "/api/feed/ai" | "/api/feed/tech") {
  const payload = await getJson<{ articles: FeedArticle[]; freshness?: Freshness }>(path);
  if (payload.articles.length === 0) throw new Error(`${path}: prázdný feed`);
  const untranslated = payload.articles.filter((article) =>
    (article.title_cs === article.title && englishSignal.test(article.title)) ||
    (article.summary_cs === article.summary && englishSignal.test(article.summary ?? ""))
  );
  if (untranslated.length > 0) throw new Error(`${path}: ${untranslated.length} nepřeložených položek`);
  assertFresh(path, payload.freshness);
  return payload.articles.length;
}

async function main() {
  const [ai, tech, news, movies] = await Promise.all([
    verifyFeed("/api/feed/ai"),
    verifyFeed("/api/feed/tech"),
    getJson<{ articles: NewsArticle[]; freshness?: Freshness }>("/api/news?page=1&pageSize=30"),
    getJson<{ vod: Array<{ releases?: unknown[]; torrents?: unknown[] }>; recent: unknown[]; freshness?: Freshness }>("/api/movies?page=1"),
  ]);
  if (news.articles.length === 0) throw new Error("/api/news: prázdný feed");
  if (news.articles.some((article) => (article.title_cs === article.title_en && englishSignal.test(article.title_en)) || !article.body_cs || englishLabels.has(article.category_label))) {
    throw new Error("/api/news: česká data nejsou kompletní");
  }
  if (movies.vod.some((movie) => (movie.releases?.length ?? 0) === 0 && (movie.torrents?.length ?? 0) === 0)) {
    throw new Error("/api/movies: nepotvrzený film je označený jako dostupný");
  }
  assertFresh("/api/news", news.freshness);
  assertFresh("/api/movies", movies.freshness);
  console.log(`OK — AI ${ai}, Technologie ${tech}, Film ${news.articles.length}, potvrzené releasy ${movies.vod.length}, nedávné tituly ${movies.recent.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
