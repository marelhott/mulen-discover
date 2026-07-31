"use client";

import { useState } from "react";
import Image from "next/image";
import { Star } from "lucide-react";
import { Movie } from "@/types/movie";
import MovieModal from "./MovieModal";

export default function MovieCard({ movie }: { movie: Movie }) {
  const [open, setOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

  const hasYts = movie.sources?.includes("yts");
  const isOnline = hasYts || movie.sources?.some(s => ["srrdb", "predb", "scnsrc"].includes(s));
  const bestQuality = movie.releases?.find(r => r.quality)?.quality ?? movie.torrents?.[0]?.quality ?? null;
  const genre = movie.genres?.[0] ?? null;

  return (
    <>
      <div
        className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl bg-[color:var(--surface)] transition-all duration-150 hover:shadow-[0_4px_24px_rgba(39,26,0,0.10)]"
        onClick={() => setOpen(true)}
        style={{ contentVisibility: "auto", containIntrinsicSize: "200px 360px" }}
      >
        {/* Poster — 2:3 portrait */}
        <div className="relative w-full overflow-hidden bg-[color:var(--surface-muted)]" style={{ aspectRatio: "2/3" }}>
          {movie.poster && !imgError ? (
            <Image
              src={movie.poster} alt={movie.title} fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 16vw"
              className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
              onError={() => setImgError(true)} loading="lazy"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-[color:var(--muted)]">{movie.title}</div>
          )}

          {/* Hover overlay — popis */}
          <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-[rgba(27,24,18,0.88)] via-[rgba(27,24,18,0.1)] to-transparent p-3 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            {movie.overview && <p className="line-clamp-5 text-[11px] leading-relaxed text-white/90">{movie.overview}</p>}
          </div>

          {/* ONLINE badge */}
          {isOnline && (
            <div className="absolute bottom-2 left-2">
              <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm">
                ● {bestQuality ?? "DOSTUPNÉ"}
              </span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex flex-col gap-1 px-3 py-2.5">
          <h3
            className="line-clamp-2 text-[0.8125rem] font-medium leading-snug text-[color:var(--foreground)] transition-colors group-hover:text-[color:var(--accent)]"
            style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
          >
            {movie.czech_title ?? movie.title}
          </h3>
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[color:var(--muted)]">
            <span>{movie.year}</span>
            {genre && <><span className="opacity-40">·</span><span className="truncate">{genre}</span></>}
            {movie.ratings.imdb && (
              <span className="ml-auto flex items-center gap-0.5 text-yellow-500">
                <Star className="h-2.5 w-2.5 fill-yellow-500" />
                {movie.ratings.imdb}
              </span>
            )}
          </div>
        </div>
      </div>

      {open && <MovieModal movie={movie} onClose={() => setOpen(false)} />}
    </>
  );
}
