"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Sparkles, RefreshCw } from "lucide-react";
import { Movie } from "@/types/movie";
import MovieCard from "./MovieCard";

type MovieCache = {
  vod: Movie[];
  recent: Movie[];
  upcoming: Movie[];
  page: number;
  hasMore: boolean;
  hydrated: boolean;
  fetchedAt: number;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const STORAGE_KEY = "movie-releases:movies-cache:v3";

const movieCache: MovieCache = {
  vod: [],
  recent: [],
  upcoming: [],
  page: 1,
  hasMore: true,
  hydrated: false,
  fetchedAt: 0,
};

export default function MovieGrid() {
  const [vod, setVod] = useState<Movie[]>(movieCache.vod);
  const [recent, setRecent] = useState<Movie[]>(movieCache.recent);
  const [upcoming, setUpcoming] = useState<Movie[]>(movieCache.upcoming);
  const [page, setPage] = useState(movieCache.page);
  const [loading, setLoading] = useState(!movieCache.hydrated);
  const [hasMore, setHasMore] = useState(movieCache.hasMore);
  const [error, setError] = useState<string | null>(null);

  const loadMovies = useCallback(async (
    p: number,
    mode: "replace" | "append" = "replace",
    options?: { forceRefresh?: boolean }
  ) => {
    setLoading(true);
    setError(null);
    try {
      const refreshSuffix = options?.forceRefresh ? `&refresh=${Date.now()}` : "";
      const res = await fetch(`/api/movies?page=${p}${refreshSuffix}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Chyba při načítání filmů");
      const data = await res.json();
      setVod((prev) => {
        const next = mode === "replace" ? (data.vod ?? []) : [...prev, ...(data.vod ?? [])];
        movieCache.vod = next;
        return next;
      });
      if (p === 1) {
        setRecent(data.recent ?? []);
        movieCache.recent = data.recent ?? [];
        setUpcoming(data.upcoming ?? []);
        movieCache.upcoming = data.upcoming ?? [];
      }
      setPage(p);
      setHasMore(data.hasMore ?? false);
      movieCache.page = p;
      movieCache.hasMore = data.hasMore ?? false;
      movieCache.hydrated = true;
      movieCache.fetchedAt = Date.now();
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            vod: movieCache.vod.slice(0, 30),
            recent: movieCache.recent.slice(0, 30),
            upcoming: movieCache.upcoming,
            page: Math.min(movieCache.page, 1),
            hasMore: true,
            hydrated: movieCache.hydrated,
            fetchedAt: movieCache.fetchedAt,
          } satisfies MovieCache)
        );
      } catch {}
    } catch (e) {
      setError(e instanceof Error ? e.message : "Neznámá chyba");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as MovieCache;
        if (
          (Array.isArray(parsed.vod) && parsed.vod.length > 0)
          || (Array.isArray(parsed.recent) && parsed.recent.length > 0)
          || (Array.isArray(parsed.upcoming) && parsed.upcoming.length > 0)
        ) {
          movieCache.vod = parsed.vod;
          movieCache.recent = parsed.recent ?? [];
          movieCache.upcoming = parsed.upcoming ?? [];
          movieCache.page = parsed.page;
          movieCache.hasMore = parsed.hasMore;
          movieCache.hydrated = true;
          movieCache.fetchedAt = parsed.fetchedAt;
          setVod(parsed.vod);
          setRecent(parsed.recent ?? []);
          setUpcoming(parsed.upcoming ?? []);
          setPage(parsed.page);
          setHasMore(parsed.hasMore);
          setLoading(false);
        }
      }
    } catch {}

    void loadMovies(1, "replace");
  }, [loadMovies]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!movieCache.hydrated) return;
      if (Date.now() - movieCache.fetchedAt < CACHE_TTL_MS) return;
      void loadMovies(1, "replace");
    }, 60_000);

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (!movieCache.hydrated) return;
      if (Date.now() - movieCache.fetchedAt < CACHE_TTL_MS) return;
      void loadMovies(1, "replace", { forceRefresh: true });
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadMovies]);

  const refresh = useCallback(async () => {
    movieCache.hydrated = false;
    movieCache.page = 1;
    movieCache.hasMore = true;
    movieCache.vod = [];
    movieCache.recent = [];
    movieCache.upcoming = [];
    movieCache.fetchedAt = 0;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setVod([]);
    setRecent([]);
    setUpcoming([]);
    setPage(1);
    setHasMore(true);
    void loadMovies(1, "replace", { forceRefresh: true });
  }, [loadMovies]);

  return (
    <div>
      {/* Latest titles lead the experience; verified releases are supplementary. */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2
          className="text-[1.1rem] font-semibold text-[color:var(--foreground)]"
          style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
        >
          Nejnovější filmy
          {recent.length > 0 && (
            <span className="ml-2 text-[0.85rem] font-normal text-[color:var(--muted)]">{recent.length} titulů</span>
          )}
        </h2>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1.5 text-[11px] font-medium text-[color:var(--muted)] transition-colors hover:bg-[color:var(--surface-muted)] disabled:opacity-50"
        >
          <Sparkles className="h-3 w-3 text-[color:var(--accent)]" />
          Aktualizovat
        </button>
      </div>

      {error && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-[color:var(--muted)]">{error}</p>
          <button
            onClick={() => void refresh()}
            className="flex items-center gap-1.5 rounded-lg border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm text-[color:var(--foreground)] hover:bg-[color:var(--surface-muted)]"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Zkusit znovu
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {recent.map(movie => <MovieCard key={`${movie.id}-${movie.imdb_code}`} movie={movie} />)}
        {loading && Array.from({ length: 14 }).map((_, i) => (
          <div key={`sk-${i}`} className="aspect-[2/3] animate-pulse overflow-hidden rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)]" />
        ))}
      </div>

      {!loading && hasMore && recent.length > 0 && (
        <div className="flex justify-center mt-10">
          <button onClick={() => { const n = page + 1; void loadMovies(n, "append"); }}
            className="min-h-11 rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-8 py-3 font-medium text-[color:var(--foreground)] transition-colors hover:bg-[color:var(--surface-muted)]">
            Načíst další
          </button>
        </div>
      )}

      {loading && recent.length > 0 && (
        <div className="flex justify-center mt-8">
          <Loader2 className="w-6 h-6 animate-spin text-[color:var(--muted)]" />
        </div>
      )}

      {vod.length > 0 && (
        <div className="mt-12">
          <h2
            className="mb-4 text-[1.1rem] font-semibold text-[color:var(--foreground)]"
            style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
          >
            Potvrzeně dostupné
          </h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {vod.map(movie => <MovieCard key={`${movie.id}-${movie.imdb_code}`} movie={movie} />)}
          </div>
        </div>
      )}

      {/* Připravuje se section */}
      {upcoming.length > 0 && (
        <div className="mt-12">
          <h2
            className="mb-4 text-[1.1rem] font-semibold text-[color:var(--foreground)]"
            style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
          >
            Připravuje se
          </h2>
          <div className="-mx-4 overflow-x-auto px-4 sm:-mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex gap-4 pb-2">
              {upcoming.map(movie => (
                <div key={`${movie.id}-${movie.imdb_code}`} className="w-36 flex-shrink-0">
                  <MovieCard movie={movie} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
