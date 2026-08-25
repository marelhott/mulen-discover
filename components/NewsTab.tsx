"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { lockScroll, unlockScroll } from "@/lib/scrollLock";
import Image from "next/image";
import { RefreshCw, Loader2, Film, X, ChevronRight, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cs } from "date-fns/locale";
import PersonModal from "./PersonModal";
import type { NewsArticle, NewsResponse, PersonSnippet as PersonSnippetData } from "@/types/news";
import { editorialFallbackImage } from "@/lib/editorialImages";

const PAGE_SIZE = 30;
const SOURCE_FILTERS = [
  "vse",
  "Deadline",
  "Variety",
  "Hollywood Reporter",
  "IndieWire",
  "Screen Daily",
  "Film New Europe",
  "MovieZone.cz",
] as const;

type NewsCache = {
  articles: NewsArticle[];
  page: number;
  hasMore: boolean;
  hydrated: boolean;
  fetchedAt: number;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const STORAGE_KEY = "movie-releases:news-cache:v1";

const newsCache: NewsCache = {
  articles: [],
  page: 0,
  hasMore: true,
  hydrated: false,
  fetchedAt: 0,
};

function localizeKnownFor(value: string) {
  switch (value) {
    case "Acting":
      return "Herectví";
    case "Directing":
      return "Režie";
    default:
      return value;
  }
}

function timeAgo(value: string) {
  if (!value) return "";
  try {
    return formatDistanceToNow(new Date(value), { addSuffix: true, locale: cs });
  } catch {
    return "";
  }
}

function PersonSnippet({
  person,
  onClickPerson,
}: {
  person: PersonSnippetData;
  onClickPerson: (id: number) => void;
}) {
  return (
    <button
      onClick={(event) => {
        event.stopPropagation();
        onClickPerson(person.id);
      }}
      className="group mt-3 flex w-full items-center gap-3 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:bg-[color:var(--surface-muted)] sm:gap-4 sm:px-5"
    >
      <div className="relative h-20 w-16 flex-shrink-0 overflow-hidden rounded-2xl bg-[color:var(--surface-muted)] shadow-sm">
        {person.photo ? (
          <Image src={person.photo} alt={person.name} fill className="object-cover" sizes="64px" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[color:var(--muted)]">
            <Film className="h-4 w-4" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold leading-tight text-[color:var(--foreground)] transition-colors group-hover:text-[color:var(--accent)] sm:text-[1.1rem]">
          {person.name}
        </p>
        <p className="mt-1 text-sm text-[color:var(--muted)]">{localizeKnownFor(person.known_for)}</p>
        {person.top_films.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {person.top_films.slice(0, 4).map((film, index) => (
              <div
                key={`${film.title}-${index}`}
                className="relative h-16 w-11 flex-shrink-0 overflow-hidden rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-muted)] shadow-sm"
                title={`${film.title} (${film.year})`}
              >
                {film.poster ? (
                  <Image
                    src={film.poster}
                    alt={film.title}
                    fill
                    className="object-cover"
                    sizes="44px"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-[color:var(--muted)]">
                    {film.year}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <ChevronRight className="h-5 w-5 flex-shrink-0 text-[color:var(--muted)] transition-colors group-hover:text-[color:var(--accent)]" />
    </button>
  );
}

function ArticleModal({ article, onClose }: { article: NewsArticle; onClose: () => void }) {
  const [personId, setPersonId] = useState<number | null>(null);
  const [content, setContent] = useState(article.body_cs);
  const [loadingContent, setLoadingContent] = useState(true);
  const [contentError, setContentError] = useState(false);
  const coverImage = article.image ?? editorialFallbackImage("film", article.link);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !personId) onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    lockScroll();
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unlockScroll();
    };
  }, [onClose, personId]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setContent(article.body_cs);
    setLoadingContent(true);
    setContentError(false);

    void (async () => {
      try {
        const response = await fetch(`/api/article?url=${encodeURIComponent(article.link)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Detail zdroj neposkytl");
        const data = await response.json() as { content?: string };
        if (!cancelled && data.content) setContent(data.content);
      } catch {
        if (!cancelled) setContentError(true);
      } finally {
        if (!cancelled) setLoadingContent(false);
      }
    })();

    return () => { cancelled = true; controller.abort(); };
  }, [article.link, article.body_cs]);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(29,42,36,0.28)] p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
        <div
          className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[1.75rem] border border-[color:var(--line)] bg-[color:var(--surface)] shadow-2xl sm:max-h-[90vh] sm:rounded-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            onClick={onClose}
            className="absolute right-3 top-3 z-10 rounded-full bg-white/85 p-1.5 text-[color:var(--foreground)] hover:bg-white"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="relative h-44 w-full overflow-hidden rounded-t-[1.75rem] sm:h-56 sm:rounded-t-2xl">
            <Image src={coverImage} alt="" fill className="object-cover" sizes="(max-width: 640px) 100vw, 672px" />
          </div>

          <div className="p-4 sm:p-6">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[color:var(--surface-muted)] px-2 py-0.5 text-xs font-medium text-[color:var(--foreground)]">
                {article.source}
              </span>
              <span className="text-xs text-[color:var(--muted)]">{article.focus}</span>
              {article.pubDate && <span className="text-xs text-[color:var(--muted)] sm:ml-auto">{timeAgo(article.pubDate)}</span>}
            </div>

            <h2 className="mb-3 text-lg font-bold leading-snug text-[color:var(--foreground)] sm:text-xl">{article.title_cs}</h2>
            <div className="space-y-4">
              {content.split("\n\n").slice(0, 36).map((paragraph, index) => (
                <p key={index} className="text-sm leading-[1.75] text-[color:var(--foreground)]">{paragraph}</p>
              ))}
            </div>

            {loadingContent && (
              <p className="mt-5 flex items-center gap-2 text-xs text-[color:var(--muted)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Načítám celý český překlad…
              </p>
            )}
            {contentError && (
              <p className="mt-5 text-xs leading-relaxed text-[color:var(--muted)]">
                Úplný text zdroj právě neposkytl; zobrazuji ověřený český perex.
              </p>
            )}

            {article.person && (
              <div className="mt-4">
                <p className="mb-3 text-xs uppercase tracking-[0.24em] text-[color:var(--muted)]">O kom je řeč</p>
                <PersonSnippet person={article.person} onClickPerson={setPersonId} />
              </div>
            )}

            <a
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 flex items-center gap-1.5 text-xs font-medium text-[color:var(--accent)] hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Otevřít originál na {article.source}
            </a>
          </div>
        </div>
      </div>
      {personId && <PersonModal personId={personId} onClose={() => setPersonId(null)} />}
    </>
  );
}

function NewsCard({ article, onClick }: { article: NewsArticle; onClick: () => void }) {
  const [imgError, setImgError] = useState(false);
  const [personId, setPersonId] = useState<number | null>(null);
  const fallbackImage = editorialFallbackImage("film", article.link);
  const imageSrc = !imgError && article.image ? article.image : fallbackImage;

  return (
    <>
      <article
        className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl bg-[color:var(--surface)] transition-all duration-150 hover:shadow-[0_4px_24px_rgba(39,26,0,0.10)]"
        onClick={onClick}
        style={{ contentVisibility: "auto", containIntrinsicSize: "300px 340px" }}
      >
        {/* Image — 16:9 ratio (menší) */}
        <div className="relative w-full overflow-hidden bg-[color:var(--surface-muted)]" style={{ aspectRatio: "16/9" }}>
          <Image
            src={imageSrc}
            alt=""
            fill
            className="object-cover transition-transform duration-500 ease-in-out group-hover:scale-[1.04]"
            onError={() => setImgError(true)}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        </div>

        {/* Text area */}
        <div className="flex flex-1 flex-col gap-2 px-4 py-3">
          <h3
            className="line-clamp-2 text-[0.9rem] font-medium leading-[1.35] text-[color:var(--foreground)] transition-colors duration-150 group-hover:text-[color:var(--accent)]"
            style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
          >
            {article.title_cs}
          </h3>
          <p className="line-clamp-3 flex-1 text-[0.8125rem] leading-[1.5] text-[color:var(--muted)]">
            {article.body_cs}
          </p>

          {/* Person snippet */}
          {article.person && (
            <button
              className="group/person mt-1 flex items-center gap-2.5 rounded-lg border border-[color:var(--line)] px-2.5 py-2 text-left transition-colors hover:bg-[color:var(--surface-muted)]"
              onClick={(e) => { e.stopPropagation(); setPersonId(article.person!.id); }}
            >
              {article.person.photo ? (
                <Image src={article.person.photo} alt={article.person.name}
                  width={32} height={32}
                  className="flex-shrink-0 rounded-full object-cover" />
              ) : (
                <div className="h-8 w-8 flex-shrink-0 rounded-full bg-[color:var(--surface-muted)] flex items-center justify-center">
                  <Film className="h-3.5 w-3.5 text-[color:var(--faint)]" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-semibold leading-tight text-[color:var(--foreground)] group-hover/person:text-[color:var(--accent)]">{article.person.name}</p>
                <p className="truncate text-[11px] text-[color:var(--muted)]">{article.person.known_for === "Acting" ? "Herec/herečka" : article.person.known_for === "Directing" ? "Režisér" : article.person.known_for}</p>
              </div>
              <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-[color:var(--faint)]" />
            </button>
          )}

          {/* Bottom meta row */}
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[color:var(--muted)]">
            <span className="truncate">{article.source}</span>
            {article.cluster_size > 1 && (
              <>
                <span className="opacity-40">·</span>
                <span className="flex-shrink-0">{article.cluster_size} zdrojů</span>
              </>
            )}
            {article.pubDate && (
              <>
                <span className="opacity-40">·</span>
                <span className="flex-shrink-0 tabular-nums">{timeAgo(article.pubDate)}</span>
              </>
            )}
          </div>
        </div>
      </article>

      {personId && <PersonModal personId={personId} onClose={() => setPersonId(null)} />}
    </>
  );
}

export default function NewsTab() {
  const [articles, setArticles] = useState<NewsArticle[]>(newsCache.articles);
  const [page, setPage] = useState(newsCache.page);
  const [hasMore, setHasMore] = useState(newsCache.hasMore);
  const [loadingInitial, setLoadingInitial] = useState(!newsCache.hydrated);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("vse");
  const [selected, setSelected] = useState<NewsArticle | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const pendingPagesRef = useRef(new Set<number>());

  const loadPage = useCallback(async (
    nextPage: number,
    mode: "replace" | "append",
    options?: { forceRefresh?: boolean }
  ) => {
    if (pendingPagesRef.current.has(nextPage)) return;

    pendingPagesRef.current.add(nextPage);
    if (mode === "replace") {
      setLoadingInitial(true);
    } else {
      setLoadingMore(true);
    }
    setError(null);

    try {
      const refreshSuffix = options?.forceRefresh ? `&refresh=${Date.now()}` : "";
      const res = await fetch(`/api/news?page=${nextPage}&pageSize=${PAGE_SIZE}${refreshSuffix}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Chyba načítání");
      const payload = await res.json() as NewsResponse;

      setArticles((current) => {
        if (mode === "replace") {
          newsCache.articles = payload.articles;
          return payload.articles;
        }
        const seen = new Set(current.map((article) => article.link));
        const merged = [...current, ...payload.articles.filter((article) => !seen.has(article.link))];
        newsCache.articles = merged;
        return merged;
      });
      setPage(payload.page);
      setHasMore(payload.hasMore);
      newsCache.page = payload.page;
      newsCache.hasMore = payload.hasMore;
      newsCache.hydrated = true;
      newsCache.fetchedAt = Date.now();

      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            articles: newsCache.articles.slice(0, 30),
            page: 0,
            hasMore: true,
            hydrated: newsCache.hydrated,
            fetchedAt: newsCache.fetchedAt,
          } satisfies NewsCache)
        );
      } catch {}

      if (payload.page === 1 && payload.hasMore) {
        window.setTimeout(() => {
          void fetch(`/api/news?page=2&pageSize=${PAGE_SIZE}`);
        }, 800);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chyba");
    } finally {
      pendingPagesRef.current.delete(nextPage);
      setLoadingInitial(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as NewsCache;
        if (Array.isArray(parsed.articles) && parsed.articles.length > 0) {
          newsCache.articles = parsed.articles;
          newsCache.page = parsed.page;
          newsCache.hasMore = parsed.hasMore;
          newsCache.hydrated = true;
          newsCache.fetchedAt = parsed.fetchedAt;
          setArticles(parsed.articles);
          setPage(parsed.page);
          setHasMore(parsed.hasMore);
          setLoadingInitial(false);
        }
      }
    } catch {}

    void loadPage(1, "replace");
  }, [loadPage]);

  // Refresh only when the user actually opens the app again. No background
  // polling: an idle tab must stay idle instead of paying for an LLM refresh
  // every minute around the clock.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (!newsCache.hydrated) return;
      if (Date.now() - newsCache.fetchedAt < CACHE_TTL_MS) return;
      void loadPage(1, "replace", { forceRefresh: true });
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadPage]);

  const refresh = useCallback(async () => {
    newsCache.articles = [];
    newsCache.page = 0;
    newsCache.hasMore = true;
    newsCache.hydrated = false;
    newsCache.fetchedAt = 0;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setArticles([]);
    setHasMore(true);
    setPage(0);
    void loadPage(1, "replace", { forceRefresh: true });
  }, [loadPage]);

  // Ref holds latest pagination state so loadNextPage stays stable
  const paginationRef = useRef({ hasMore, loadingInitial, loadingMore, page });
  paginationRef.current = { hasMore, loadingInitial, loadingMore, page };

  const loadNextPage = useCallback(() => {
    const { hasMore, loadingInitial, loadingMore, page } = paginationRef.current;
    if (!hasMore || loadingInitial || loadingMore) return;
    void loadPage(page + 1, "append");
  }, [loadPage]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadNextPage();
        }
      },
      { rootMargin: "800px 0px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [loadNextPage]);

  const filteredArticles = articles.filter((article) => filter === "vse" || article.source === filter);

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <h2
          className="text-[1.1rem] font-semibold text-[color:var(--foreground)]"
          style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
        >
          Filmové novinky
          {articles.length > 0 && (
            <span className="ml-2 text-[0.85rem] font-normal text-[color:var(--muted)]">{filteredArticles.length} zpráv</span>
          )}
        </h2>

        <button
          onClick={() => void refresh()}
          disabled={loadingInitial || loadingMore}
          className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1.5 text-xs text-[color:var(--muted)] transition-colors hover:bg-[color:var(--surface-muted)] disabled:opacity-50 sm:w-auto"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loadingInitial || loadingMore ? "animate-spin" : ""}`} />
          Aktualizovat
        </button>
      </div>

      {SOURCE_FILTERS.length > 1 && (
        <div className="mb-5 -mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex min-w-max gap-5 border-b border-[color:var(--line)] pb-2">
            {SOURCE_FILTERS.map((source) => (
              <button
                key={source}
                onClick={() => setFilter(source)}
                className={`whitespace-nowrap border-b-2 pb-2 text-sm transition-colors ${
                  filter === source
                    ? "border-[color:var(--foreground)] font-semibold text-[color:var(--foreground)]"
                    : "border-transparent text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
                }`}
              >
                {source === "vse" ? "vše" : source}
              </button>
            ))}
          </div>
        </div>
      )}

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

      {loadingInitial && articles.length === 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 9 }).map((_, index) => (
            <div key={index} className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)]">
              <div className="aspect-[16/10] animate-pulse bg-[color:var(--surface-muted)]" />
              <div className="space-y-3 p-4">
                <div className="h-3 w-24 animate-pulse rounded bg-[color:var(--surface-muted)]" />
                <div className="h-6 w-full animate-pulse rounded bg-[color:var(--surface-muted)]" />
                <div className="h-4 w-full animate-pulse rounded bg-[color:var(--surface-muted)]" />
                <div className="h-4 w-5/6 animate-pulse rounded bg-[color:var(--surface-muted)]" />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filteredArticles.map((article) => (
          <NewsCard key={article.link} article={article} onClick={() => setSelected(article)} />
        ))}
      </div>

      <div ref={sentinelRef} className="h-10" />

      {loadingMore && (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-[color:var(--muted)]" />
        </div>
      )}

      {!loadingInitial && !loadingMore && hasMore && (
        <div className="flex justify-center py-4">
          <button
            onClick={() => void loadNextPage()}
            className="min-h-11 rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-5 py-2 text-sm text-[color:var(--foreground)] transition-colors hover:bg-[color:var(--surface-muted)]"
          >
            Načíst dalších 30
          </button>
        </div>
      )}

      {!hasMore && articles.length > 0 && (
        <p className="py-6 text-center text-sm text-[color:var(--muted)]">Došel jsem na konec filmového feedu.</p>
      )}

      {selected && <ArticleModal article={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
