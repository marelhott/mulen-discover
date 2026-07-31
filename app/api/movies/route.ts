import { after, NextResponse } from "next/server";
import { fetchSrrdb, fetchPredb, fetchScnsrcScene } from "@/lib/sceneSources";
import { unstable_cache } from "next/cache";
import { hasGoogleTranslateKey, translateText } from "@/lib/googleTranslate";
import { readSnapshot, writeSnapshot } from "@/lib/snapshotStore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const getKeys = () => ({
  tmdb: process.env.TMDB_API_KEY,
  omdb: process.env.OMDB_API_KEY,
});

const MOVIES_PAGE_LIMIT = 50;
const NORMALIZE_BATCH_SIZE = 8;
const NORMALIZE_TARGET_COUNT = 60;

function hasConfiguredKey(value: string | undefined) {
  return Boolean(value && !value.includes("your_") && !value.includes("here"));
}

function deterministicId(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

function getTimestamp(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

// ── Source fetchers ──────────────────────────────────────────────────────────

function tmdbEntry(m: any) {
  return {
    _source: "tmdb" as const, _imdb: null, _tmdb_id: m.id,
    _title: m.original_title ?? m.title,
    _year: m.release_date ? parseInt(m.release_date) : 0, _raw: m,
  };
}

async function fetchTMDBSection(endpoint: string, fresh = false, numPages = 2) {
  if (!hasConfiguredKey(getKeys().tmdb)) return [];
  try {
    const pages = await Promise.all(
      Array.from({ length: numPages }, (_, i) =>
        fetch(`https://api.themoviedb.org/3/${endpoint}?api_key=${getKeys().tmdb}&language=cs&region=CZ&page=${i + 1}`,
          fresh ? { cache: "no-store" } : { next: { revalidate: 3600 } }).then(r => r.json())
      )
    );
    return pages.flatMap((d: any) => d.results ?? []).map(tmdbEntry);
  } catch { return []; }
}

// Filmy vydané v určitém date range — proxy pro "dostupné ke stažení"
async function fetchTMDBDiscover(dateGte: string, dateLte: string, fresh = false, numPages = 3) {
  if (!hasConfiguredKey(getKeys().tmdb)) return [];
  try {
    const pages = await Promise.all(
      Array.from({ length: numPages }, (_, i) =>
        fetch(
          `https://api.themoviedb.org/3/discover/movie?api_key=${getKeys().tmdb}&language=cs` +
          `&sort_by=popularity.desc&vote_count.gte=30` +
          `&primary_release_date.gte=${dateGte}&primary_release_date.lte=${dateLte}&page=${i + 1}`,
          fresh ? { cache: "no-store" } : { next: { revalidate: 3600 } }
        ).then(r => r.json())
      )
    );
    return pages.flatMap((d: any) => d.results ?? []).map(tmdbEntry);
  } catch { return []; }
}

// ── TMDB enrichment ──────────────────────────────────────────────────────────

async function getTMDBDetail(tmdbId: number): Promise<any> {
  if (!hasConfiguredKey(getKeys().tmdb) || !tmdbId) return null;
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${getKeys().tmdb}&language=cs&append_to_response=credits,external_ids`,
      { next: { revalidate: 86400 } }
    );
    return res.json();
  } catch { return null; }
}

async function findTMDBByIMDB(imdbId: string): Promise<any> {
  if (!hasConfiguredKey(getKeys().tmdb) || !imdbId?.startsWith("tt")) return null;
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/find/${imdbId}?api_key=${getKeys().tmdb}&external_source=imdb_id`,
      { next: { revalidate: 86400 } }
    );
    const data = await res.json();
    const hit = data.movie_results?.[0];
    return hit ? getTMDBDetail(hit.id) : null;
  } catch { return null; }
}

async function searchTMDB(title: string, year: number): Promise<any> {
  if (!hasConfiguredKey(getKeys().tmdb) || !title) return null;
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/search/movie?api_key=${getKeys().tmdb}&query=${encodeURIComponent(title)}&year=${year || ""}&language=cs`,
      { next: { revalidate: 86400 } }
    );
    const data = await res.json();
    const hit = data.results?.[0];
    return hit ? getTMDBDetail(hit.id) : null;
  } catch { return null; }
}

// Fetch English TMDB overview as fallback
async function getTMDBDetailEN(tmdbId: number): Promise<string> {
  if (!hasConfiguredKey(getKeys().tmdb) || !tmdbId) return "";
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${getKeys().tmdb}&language=en`,
      { next: { revalidate: 86400 } }
    );
    const data = await res.json();
    return data.overview ?? "";
  } catch { return ""; }
}

function buildGeneratedOverview(title: string, genres: string[], director: string | null) {
  const genrePart = genres.length > 0 ? ` ${genres.slice(0, 3).join(", ").toLowerCase()}` : "";
  const directorPart = director ? ` od režiséra ${director}` : "";
  return `Film ${title}${directorPart}${genrePart ? ` kombinuje prvky žánru ${genrePart}` : ""}. Přehled vychází z dostupných databázových informací a bude zpřesněn, jakmile se objeví plný oficiální popis.`;
}

// Translate or generate Czech overview via Google Cloud Translate
async function getCzechOverview(
  tmdbId: number, csOverview: string, title: string,
  genres: string[], director: string | null
): Promise<string> {
  // Czech overview exists and is meaningful
  if (csOverview && csOverview.length > 30) return csOverview;

  const enOverview = await getTMDBDetailEN(tmdbId);
  try {
    if (enOverview && enOverview.length > 20) {
      const translated = hasGoogleTranslateKey()
        ? await translateText(enOverview, { source: "en", target: "cs" })
        : enOverview;
      if (translated.length > 20) return translated;
    }
  } catch {}

  if (genres.length > 0 || director) {
    return buildGeneratedOverview(title, genres, director);
  }

  return enOverview || "";
}

async function fetchOMDB(imdbId: string) {
  if (!hasConfiguredKey(getKeys().omdb) || !imdbId) return null;
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${getKeys().omdb}`,
      { next: { revalidate: 86400 } });
    return res.json();
  } catch { return null; }
}

function buildReleaseEntries(entry: any, movieTitle: string, movieYear: number) {
  if (entry._source === "yts") {
    const slug = `${movieTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${movieYear}`;
    return (entry._raw?.torrents ?? []).map((torrent: any) => ({
      source: "yts",
      label: `${torrent.quality} ${torrent.type}`.trim(),
      quality: torrent.quality ?? null,
      date: entry._raw?.date_uploaded ?? null,
      url: `https://yts.mx/movies/${slug}`,
      size: torrent.size ?? null,
      seeds: typeof torrent.seeds === "number" ? torrent.seeds : null,
      group: null,
    }));
  }

  if (["srrdb", "predb", "scnsrc"].includes(entry._source)) {
    return [{
      source: entry._source,
      label: entry._raw?.releaseName ?? entry._raw?.title ?? entry._title,
      quality: entry._raw?.quality ?? null,
      date: entry._raw?.date ?? null,
      url: entry._raw?.url ?? null,
      size: entry._raw?.size ? String(entry._raw.size) : null,
      seeds: null,
      group: entry._raw?.group ?? null,
    }];
  }

  return [];
}

const getCachedTMDBDetail = unstable_cache(
  async (tmdbId: number) => getTMDBDetail(tmdbId),
  ["movie-tmdb-detail-v1"],
  { revalidate: 86400 }
);

const getCachedTMDBByIMDB = unstable_cache(
  async (imdbId: string) => findTMDBByIMDB(imdbId),
  ["movie-find-by-imdb-v1"],
  { revalidate: 86400 }
);

const getCachedTMDBSearch = unstable_cache(
  async (title: string, year: number) => searchTMDB(title, year),
  ["movie-search-v1"],
  { revalidate: 86400 }
);

const getCachedOverview = unstable_cache(
  async (
    tmdbId: number,
    csOverview: string,
    title: string,
    genres: string[],
    director: string | null
  ) => getCzechOverview(tmdbId, csOverview, title, genres, director),
  ["movie-overview-v2"],
  { revalidate: 86400 }
);

const getCachedOMDB = unstable_cache(
  async (imdbId: string) => fetchOMDB(imdbId),
  ["movie-omdb-v1"],
  { revalidate: 86400 }
);

// ── Build cast + director with photos ────────────────────────────────────────

function buildCast(tmdb: any) {
  const cast = (tmdb?.credits?.cast ?? []).slice(0, 8).map((c: any) => ({
    id: c.id,
    name: c.name,
    character: c.character ?? "",
    photo: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null,
  }));

  const directorRaw = (tmdb?.credits?.crew ?? []).find((c: any) => c.job === "Director");
  const director = directorRaw ? {
    id: directorRaw.id,
    name: directorRaw.name,
    photo: directorRaw.profile_path ? `https://image.tmdb.org/t/p/w185${directorRaw.profile_path}` : null,
  } : null;

  return { cast, director };
}

// ── Normalise raw source entry → unified Movie ───────────────────────────────

async function normalise(entry: any): Promise<any | null> {
  try {
    let tmdb: any = null;
    let ytsRaw: any = null;
    let imdbCode: string = entry._imdb ?? "";

    if (entry._source === "yts") {
      ytsRaw = entry._raw;
      tmdb = imdbCode ? await getCachedTMDBByIMDB(imdbCode) : await getCachedTMDBSearch(entry._title, entry._year);
    } else if (entry._source === "tmdb") {
      tmdb = await getCachedTMDBDetail(entry._tmdb_id ?? entry._raw.id);
      imdbCode = tmdb?.external_ids?.imdb_id ?? "";
    } else {
      // scene / letterboxd
      tmdb = await getCachedTMDBSearch(entry._title, entry._year);
      imdbCode = tmdb?.external_ids?.imdb_id ?? "";
    }

    const omdb = imdbCode ? await getCachedOMDB(imdbCode) : null;

    const poster = tmdb?.poster_path
      ? `https://image.tmdb.org/t/p/w342${tmdb.poster_path}`
      : ytsRaw?.medium_cover_image ?? ytsRaw?.large_cover_image ?? null;

    const backdrop = tmdb?.backdrop_path
      ? `https://image.tmdb.org/t/p/w1280${tmdb.backdrop_path}` : null;

    const { cast, director } = buildCast(tmdb);
    const genres = tmdb?.genres?.map((g: any) => g.name) ?? ytsRaw?.genres ?? [];

    // Always get a Czech overview — fallback EN→CS translation or Claude generation
    const overview = tmdb?.id
      ? await getCachedOverview(
          tmdb.id,
          tmdb?.overview ?? "",
          ytsRaw?.title ?? tmdb?.original_title ?? entry._title,
          genres,
          director?.name ?? null
        )
      : (tmdb?.overview ?? null);

    const ytsRating = ytsRaw?.rating ?? 0;
    const imdbRating = ytsRating > 0 ? ytsRating : parseFloat(omdb?.imdbRating ?? "0") || null;

    const sceneSource = ["srrdb", "predb", "scnsrc"].includes(entry._source) ? entry._source : null;

    const sourceDate = ytsRaw?.date_uploaded ?? entry._raw?.date ?? entry._raw?.pubDate ?? null;
    const releases = buildReleaseEntries(
      entry,
      ytsRaw?.title ?? tmdb?.original_title ?? entry._raw?.title ?? entry._title,
      ytsRaw?.year ?? entry._year ?? (tmdb?.release_date ? parseInt(tmdb.release_date) : 0)
    );

    return {
      id: tmdb?.id ?? deterministicId(imdbCode || `${entry._title}:${entry._year}`),
      imdb_code: imdbCode,
      title: ytsRaw?.title ?? tmdb?.original_title ?? entry._raw?.title ?? entry._title,
      czech_title: (tmdb?.title && tmdb.title !== (ytsRaw?.title ?? entry._title)) ? tmdb.title : null,
      year: ytsRaw?.year ?? entry._year ?? (tmdb?.release_date ? parseInt(tmdb.release_date) : 0),
      runtime: tmdb?.runtime ?? ytsRaw?.runtime ?? 0,
      genres,
      overview,
      poster,
      backdrop,
      ratings: {
        imdb: imdbRating,
        tmdb: tmdb?.vote_average ? Math.round(tmdb.vote_average * 10) / 10 : null,
        rt: omdb?.Ratings?.find((r: any) => r.Source === "Rotten Tomatoes")?.Value ?? null,
        metacritic: omdb?.Ratings?.find((r: any) => r.Source === "Metacritic")?.Value ?? null,
      },
      cast,
      director,
      date_added: sourceDate ?? tmdb?.release_date ?? new Date().toISOString(),
      sources: entry._sources ?? [entry._source, ...(sceneSource ? [sceneSource] : [])],
      torrents: ytsRaw?.torrents?.map((t: any) => ({
        quality: t.quality, type: t.type, size: t.size, seeds: t.seeds,
      })) ?? [],
      releases,
    };
  } catch { return null; }
}

// ── Deduplication ────────────────────────────────────────────────────────────

function deduplicate(entries: any[]): any[] {
  const byImdb = new Map<string, any>();
  const byTitleYear = new Map<string, any>();
  const result: any[] = [];

  for (const e of entries) {
    if (!e) continue;
    const imdbKey = e.imdb_code?.startsWith("tt") ? e.imdb_code : null;
    const tyKey = `${(e.title ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")}:${e.year}`;

    if (imdbKey && byImdb.has(imdbKey)) {
      const ex = byImdb.get(imdbKey)!;
      ex.sources = [...new Set([...ex.sources, ...e.sources])];
      if (e.torrents?.length) ex.torrents = [...ex.torrents, ...e.torrents];
      if (e.releases?.length) {
        const seen = new Set((ex.releases ?? []).map((release: any) => `${release.source}:${release.label}:${release.quality ?? ""}`));
        ex.releases = [
          ...(ex.releases ?? []),
          ...e.releases.filter((release: any) => {
            const key = `${release.source}:${release.label}:${release.quality ?? ""}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }),
        ];
      }
      continue;
    }
    if (!imdbKey && byTitleYear.has(tyKey)) continue;

    if (imdbKey) byImdb.set(imdbKey, e);
    byTitleYear.set(tyKey, e);
    result.push(e);
  }
  return result;
}

function getRawEntryKey(entry: any) {
  if (entry?._imdb?.startsWith("tt")) return `imdb:${entry._imdb}`;
  return `title:${String(entry?._title ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")}:${entry?._year ?? 0}`;
}

function deduplicateRawEntries(entries: any[]) {
  const map = new Map<string, any>();

  for (const entry of entries) {
    const key = getRawEntryKey(entry);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        ...entry,
        _sources: [entry._source],
      });
      continue;
    }

    const mergedSources = Array.from(new Set([...(existing._sources ?? [existing._source]), entry._source]));
    map.set(key, {
      ...existing,
      _sources: mergedSources,
    });
  }

  return Array.from(map.values());
}

const DOWNLOAD_SOURCES = new Set(["yts", "srrdb", "predb", "scnsrc"]);

function hasDownloadRelease(movie: any): boolean {
  return (movie.sources ?? []).some((s: string) => DOWNLOAD_SOURCES.has(s));
}

function sceneReleaseTimestamp(movie: any): number {
  const dates = (movie.releases ?? [])
    .filter((r: any) => DOWNLOAD_SOURCES.has(r.source))
    .map((r: any) => getTimestamp(r.date))
    .filter((t: number) => t > 0);
  return dates.length > 0 ? Math.max(...dates) : 0;
}

// Good-quality verified release: WEB-DL, WEBRip, BluRay, Remux
const VOD_QUALITY_RE = /web[-.]?dl|webrip|blu[-.]?ray|bdrip|remux/i;

function isGoodQualityRelease(raw: any): boolean {
  const label = raw?.releaseName ?? raw?.label ?? "";
  const quality = raw?.quality ?? "";
  return VOD_QUALITY_RE.test(label) || VOD_QUALITY_RE.test(quality);
}

// Scene release date within last N days
function isRecentSceneRelease(raw: any, days = 120): boolean {
  const date = raw?.date;
  if (!date) return true;
  return Date.now() - new Date(date).getTime() < days * 24 * 60 * 60 * 1000;
}

async function buildMoviesPage(page: number, forceFresh: boolean) {
    const TODAY = new Date().toISOString().slice(0, 10);

    // VOD window: movies released 45-365 days ago (post-theaters, likely on streaming)
    const now = new Date();
    const dateVodTo = new Date(now); dateVodTo.setDate(now.getDate() - 45);
    const dateVodFrom = new Date(now); dateVodFrom.setDate(now.getDate() - 365);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    // YTS blocked on Vercel — use TMDB discover for VOD + scene as enrichment signal
    const [tmdbVod, tmdbUpcoming, srrdb, predb, scnsrc] =
      await Promise.all([
        fetchTMDBDiscover(fmt(dateVodFrom), fmt(dateVodTo), forceFresh, 3),
        fetchTMDBSection("movie/upcoming", forceFresh, 3),
        fetchSrrdb(),
        fetchPredb(),
        fetchScnsrcScene(),
      ]);

    const toEntry = (s: any, src: string) => ({
      _source: src, _imdb: s.imdbId ? `tt${s.imdbId}` : null,
      _title: s.title, _year: s.year, _raw: s,
    });

    // Scene enrichment: any good-quality recent release boosts matching movies
    const vodScene = [...srrdb, ...predb, ...scnsrc].filter(
      (s: any) => isGoodQualityRelease(s) && isRecentSceneRelease(s)
    );
    const sceneEntries = vodScene.map((s: any) => toEntry(s, s.source));

    const dedupedRaw = deduplicateRawEntries([
      ...sceneEntries,  // scene first so source="srrdb/predb" is preferred
      ...tmdbVod,       // TMDB recent releases for VOD
      ...tmdbUpcoming,  // TMDB upcoming for upcoming section
    ]);

    const normalised: any[] = [];
    for (let i = 0; i < dedupedRaw.length; i += NORMALIZE_BATCH_SIZE) {
      const batch = await Promise.all(dedupedRaw.slice(i, i + NORMALIZE_BATCH_SIZE).map(normalise));
      normalised.push(...batch.filter(Boolean));
      if (normalised.length >= NORMALIZE_TARGET_COUNT) break;
    }

    const deduped = deduplicate(normalised).filter(m => m.poster);

    // Track which TMDB IDs came from discover (VOD date window)
    const vodDiscoverIds = new Set(tmdbVod.map((e: any) => e._tmdb_id));

    // Only explicitly observed releases belong to "Potvrzeně dostupné".
    const vod = deduped
      .filter(m => hasDownloadRelease(m))
      .sort((a, b) => {
        // Scene releases first (verified download), then by popularity/date
        const aHasScene = hasDownloadRelease(a) ? 1 : 0;
        const bHasScene = hasDownloadRelease(b) ? 1 : 0;
        if (bHasScene !== aHasScene) return bHasScene - aHasScene;
        const bySceneDate = sceneReleaseTimestamp(b) - sceneReleaseTimestamp(a);
        if (bySceneDate !== 0) return bySceneDate;
        return getTimestamp(b.date_added) - getTimestamp(a.date_added);
      })
      .slice(0, MOVIES_PAGE_LIMIT);

    const vodIds = new Set(vod.map((m: any) => m.id));

    // TMDB's release date is useful, but is not evidence of online availability.
    const recent = deduped
      .filter(m => !vodIds.has(m.id) && vodDiscoverIds.has(m.id))
      .sort((a, b) => getTimestamp(b.date_added) - getTimestamp(a.date_added))
      .slice(0, MOVIES_PAGE_LIMIT);

    // Upcoming: future release date, not already in VOD
    const upcomingMovies = deduped
      .filter(m => {
        if (vodIds.has(m.id)) return false;
        const releaseDate = (m.date_added ?? "").slice(0, 10);
        return releaseDate > TODAY;
      })
      .sort((a, b) => getTimestamp(a.date_added) - getTimestamp(b.date_added))
      .slice(0, 30);

    return {
      vod,
      recent,
      upcoming: upcomingMovies,
      page,
      hasMore: false,
      refreshedAt: forceFresh ? Date.now() : undefined,
    };
}

type MoviesSnapshotData = Awaited<ReturnType<typeof buildMoviesPage>>;

async function readMoviesSnapshot() {
  return readSnapshot<MoviesSnapshotData>("movies");
}

export async function refreshMoviesSnapshot() {
  const data = await buildMoviesPage(1, true);
  return writeSnapshot("movies", data, data.vod.length + data.recent.length + data.upcoming.length);
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") ?? "1");
  let snapshot = await readMoviesSnapshot();
  if (!snapshot) snapshot = await refreshMoviesSnapshot();
  if (!snapshot) {
    return NextResponse.json({ error: "Český snapshot filmů zatím není připravený" }, { status: 503 });
  }
  if (Date.now() - new Date(snapshot.sourceFetchedAt).getTime() > 5 * 60_000) {
    after(async () => { await refreshMoviesSnapshot(); });
  }
  const data = { ...snapshot.data, page, freshness: {
    version: snapshot.version,
    sourceFetchedAt: snapshot.sourceFetchedAt,
    translatedAt: snapshot.translatedAt,
  } };
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
