"use client";

import { useEffect, useCallback, useState } from "react";
import { lockScroll, unlockScroll } from "@/lib/scrollLock";
import Image from "next/image";
import { Loader2, RefreshCw, X, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cs } from "date-fns/locale";
import { editorialFallbackImage } from "@/lib/editorialImages";

export type FeedCategory = "ai" | "tech";

type FeedArticle = {
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

type FeedCache = { articles: FeedArticle[]; hydrated: boolean; fetchedAt: number };
const CACHE_TTL_MS = 5 * 60 * 1000;

function makeCache(): FeedCache { return { articles: [], hydrated: false, fetchedAt: 0 }; }
const caches: Record<FeedCategory, FeedCache> = { ai: makeCache(), tech: makeCache() };
function storageKey(c: FeedCategory) { return `movie-releases:feed-${c}:v2`; }

function timeAgo(value: string) {
  try { return formatDistanceToNow(new Date(value), { addSuffix: true, locale: cs }); }
  catch { return ""; }
}

// ── Article reader modal ──────────────────────────────────────────────────────

function ArticleModal({ article, onClose }: { article: FeedArticle; onClose: () => void }) {
  const fallbackBody = article.summary_cs ?? article.summary;
  const [content, setContent] = useState(fallbackBody);
  const [image, setImage] = useState<string | null>(article.image);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    lockScroll();
    return () => { window.removeEventListener("keydown", onKey); unlockScroll(); };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/article?url=${encodeURIComponent(article.url)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (cancelled) return;
        if (data.content) setContent(data.content);
        if (data.image && !article.image) setImage(data.image);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [article.url, article.image]);

  const title = article.title_cs ?? article.title;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(27,24,18,0.32)] p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[1.75rem] border border-[color:var(--line)] bg-[color:var(--surface)] shadow-2xl sm:max-h-[88vh] sm:rounded-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-full bg-[color:var(--surface)]/90 p-1.5 text-[color:var(--muted)] backdrop-blur-sm hover:text-[color:var(--foreground)]"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Hero image */}
        {image && (
          <div className="relative h-48 w-full flex-shrink-0 overflow-hidden sm:h-56">
            <Image src={image} alt="" fill className="object-cover" sizes="(max-width: 640px) 100vw, 672px" />
          </div>
        )}

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 pb-8 pt-5 sm:px-7">
            {/* Meta */}
            <div className="mb-3 flex items-center gap-2 text-[11px] font-medium text-[color:var(--muted)]">
              <span>{article.source}</span>
              <span className="opacity-40">·</span>
              <span>{timeAgo(article.publishedAt)}</span>
              {article.clusterSize > 1 && (
                <><span className="opacity-40">·</span><span>{article.clusterSize} zdroje</span></>
              )}
            </div>

            {/* Title */}
            <h2
              className="mb-4 text-[1.25rem] font-semibold leading-snug text-[color:var(--foreground)] sm:text-[1.4rem]"
              style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
            >
              {title}
            </h2>

            {/* Body */}
            {!content ? (
              <div className="flex items-center gap-2 text-sm text-[color:var(--muted)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Načítám článek…
              </div>
            ) : (
              <div className="space-y-4">
                {content.split("\n\n").slice(0, 36).map((para, i) => (
                  <p key={i} className="text-[0.9rem] leading-[1.7] text-[color:var(--foreground)]">{para}</p>
                ))}
              </div>
            )}

            {loading && content && (
              <p className="mt-5 flex items-center gap-2 text-xs text-[color:var(--muted)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Načítám celý český překlad…
              </p>
            )}
            {error && (
              <p className="mt-5 text-xs leading-relaxed text-[color:var(--muted)]">
                Úplný text zdroj právě neposkytl; zobrazuji ověřený český perex.
              </p>
            )}

            {/* Open original */}
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 flex items-center gap-1.5 text-[0.8125rem] font-medium text-[color:var(--accent)] hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Otevřít originál na {article.source}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Feed card ─────────────────────────────────────────────────────────────────

function FeedCard({ article, onClick }: { article: FeedArticle; onClick: () => void }) {
  const [imgError, setImgError] = useState(false);

  const title = article.title_cs ?? article.title;
  const body = article.summary_cs ?? article.summary;
  const topic = article.source.includes("AI") || article.source === "OpenAI Blog" || article.source === "Google DeepMind"
    ? "ai"
    : "technology";
  const fallbackImage = editorialFallbackImage(topic, article.id);
  const imgSrc = !imgError && article.image ? article.image : fallbackImage;

  return (
    <article
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl bg-[color:var(--surface)] transition-all duration-150 hover:shadow-[0_4px_24px_rgba(39,26,0,0.10)]"
      onClick={onClick}
    >
      {/* 16:9 image */}
      <div className="relative w-full overflow-hidden bg-[color:var(--surface-muted)]" style={{ aspectRatio: "16/9" }}>
        <Image
          src={imgSrc}
          alt={title}
          fill
          className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          onError={() => setImgError(true)}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
        />
        {/* Cluster badge */}
        {article.clusterSize > 1 && (
          <span className="absolute bottom-2 right-2 rounded-full bg-[rgba(27,24,18,0.6)] px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
            {article.clusterSize} zdrojů
          </span>
        )}
      </div>

      {/* Text */}
      <div className="flex flex-1 flex-col gap-2 px-4 py-3">
        <h3
          className="line-clamp-2 text-[0.9rem] font-medium leading-[1.35] text-[color:var(--foreground)] transition-colors group-hover:text-[color:var(--accent)]"
          style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
        >
          {title}
        </h3>
        {body && (
          <p className="line-clamp-3 flex-1 text-[0.8125rem] leading-[1.5] text-[color:var(--muted)]">{body}</p>
        )}
        <div className="mt-auto flex items-center gap-1.5 pt-1 text-[11px] font-medium text-[color:var(--muted)]">
          <span className="truncate">{article.source}</span>
          <span className="opacity-40">·</span>
          <span className="flex-shrink-0">{timeAgo(article.publishedAt)}</span>
        </div>
      </div>
    </article>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FeedTab({ category }: { category: FeedCategory }) {
  const cache = caches[category];
  const [articles, setArticles] = useState<FeedArticle[]>(cache.articles);
  const [loading, setLoading] = useState(!cache.hydrated);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeedArticle | null>(null);

  const load = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/feed/${category}${forceRefresh ? "?refresh=1" : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("Chyba při načítání");
      const data = await res.json();
      const items: FeedArticle[] = data.articles ?? [];
      setArticles(items);
      cache.articles = items;
      cache.hydrated = true;
      cache.fetchedAt = Date.now();
      try { localStorage.setItem(storageKey(category), JSON.stringify({ articles: items, hydrated: true, fetchedAt: cache.fetchedAt })); } catch {}
    } catch (e) {
      setError(e instanceof Error ? e.message : "Neznámá chyba");
    } finally {
      setLoading(false);
    }
  }, [category, cache]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey(category));
      if (stored) {
        const parsed = JSON.parse(stored) as FeedCache;
        if (parsed.articles?.length) {
          cache.articles = parsed.articles;
          cache.hydrated = true;
          cache.fetchedAt = parsed.fetchedAt;
          setArticles(parsed.articles);
          setLoading(false);
        }
      }
    } catch {}

    // Local data paints immediately, but every app load verifies the current
    // published snapshot in the background.
    void load();

    const interval = window.setInterval(() => {
      if (Date.now() - cache.fetchedAt < CACHE_TTL_MS) return;
      void load(true);
    }, 60_000);

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - cache.fetchedAt < CACHE_TTL_MS) return;
      void load(true);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, category, cache]);

  const refresh = useCallback(() => {
    cache.hydrated = false; cache.articles = []; cache.fetchedAt = 0;
    try { localStorage.removeItem(storageKey(category)); } catch {}
    setArticles([]);
    void load(true);
  }, [load, category, cache]);

  const heading = category === "ai" ? "Umělá inteligence" : "Technologie";

  return (
    <>
      <div>
        <div className="mb-6 flex items-center justify-between">
          <h2
            className="text-[1.1rem] font-semibold text-[color:var(--foreground)]"
            style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
          >
            {heading}
            {articles.length > 0 && (
              <span className="ml-2 text-[0.85rem] font-normal text-[color:var(--muted)]">{articles.length} článků</span>
            )}
          </h2>
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1.5 text-[11px] font-medium text-[color:var(--muted)] transition-colors hover:bg-[color:var(--surface-muted)] disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            Aktualizovat
          </button>
        </div>

        {error && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-[color:var(--muted)]">{error}</p>
            <button
              onClick={refresh}
              className="flex items-center gap-1.5 rounded-lg border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm text-[color:var(--foreground)] hover:bg-[color:var(--surface-muted)]"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Zkusit znovu
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {articles.map(article => (
            <FeedCard key={article.id} article={article} onClick={() => setSelected(article)} />
          ))}
          {loading && Array.from({ length: 8 }).map((_, i) => (
            <div key={`sk-${i}`} className="overflow-hidden rounded-xl bg-[color:var(--surface)]">
              <div className="aspect-video w-full animate-pulse bg-[color:var(--surface-muted)]" />
              <div className="space-y-2 p-4">
                <div className="h-4 w-3/4 animate-pulse rounded bg-[color:var(--surface-muted)]" />
                <div className="h-3 w-full animate-pulse rounded bg-[color:var(--surface-muted)]" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-[color:var(--surface-muted)]" />
              </div>
            </div>
          ))}
        </div>

        {!loading && articles.length === 0 && !error && (
          <div className="py-16 text-center text-[color:var(--muted)]">Žádné články k zobrazení</div>
        )}

        {loading && articles.length > 0 && (
          <div className="mt-8 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[color:var(--muted)]" />
          </div>
        )}
      </div>

      {selected && <ArticleModal article={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
