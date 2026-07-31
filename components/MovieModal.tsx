"use client";

import { useEffect, useState } from "react";
import { lockScroll, unlockScroll } from "@/lib/scrollLock";
import Image from "next/image";
import { X, Clock, Calendar, ExternalLink, Film } from "lucide-react";
import { Movie, CastMember, MovieRelease } from "@/types/movie";
import PersonModal from "./PersonModal";

const SOURCE_LABELS: Record<string, string> = {
  yts: "YTS", tmdb: "TMDB", srrdb: "SRRDB", predb: "PreDB",
  scnsrc: "ScnSrc", letterboxd: "Letterboxd",
};

function ReleaseCard({ release }: { release: MovieRelease }) {
  const badge = SOURCE_LABELS[release.source] ?? release.source.toUpperCase();

  const content = (
    <div className="flex items-baseline gap-2 py-1.5 text-sm">
      <span className="w-14 flex-shrink-0 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--muted)]">{badge}</span>
      {release.quality && (
        <span className="flex-shrink-0 text-xs font-bold text-[color:var(--accent)]">{release.quality}</span>
      )}
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-[color:var(--foreground)]">{release.label}</span>
      <span className="flex-shrink-0 text-xs text-[color:var(--muted)]">
        {release.size ?? (typeof release.seeds === "number" ? `▲${release.seeds}` : null)}
      </span>
    </div>
  );

  if (!release.url) return content;

  return (
    <a href={release.url} target="_blank" rel="noopener noreferrer"
      className="block rounded transition-colors hover:bg-[color:var(--surface-muted)]">
      {content}
    </a>
  );
}

function CastCard({ member, onClick }: { member: CastMember; onClick?: () => void }) {
  const [err, setErr] = useState(false);
  return (
    <button onClick={onClick} className="group flex w-[72px] flex-shrink-0 flex-col items-center gap-1.5 text-center">
      <div className="relative h-[88px] w-[72px] flex-shrink-0 overflow-hidden rounded-lg bg-[color:var(--surface-muted)]">
        {member.photo && !err ? (
          <Image src={member.photo} alt={member.name} fill className="object-cover transition-transform group-hover:scale-105" onError={() => setErr(true)} sizes="72px" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[color:var(--muted)]">
            <Film className="w-5 h-5" />
          </div>
        )}
      </div>
      <p className="line-clamp-2 w-full text-[11px] font-semibold leading-tight text-[color:var(--foreground)] group-hover:text-[color:var(--accent)]">{member.name}</p>
      {member.character && <p className="line-clamp-1 w-full text-[11px] italic leading-tight text-[color:var(--muted)]">{member.character}</p>}
    </button>
  );
}

export default function MovieModal({ movie, onClose }: { movie: Movie; onClose: () => void }) {
  const [personId, setPersonId] = useState<number | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === "Escape" && !personId && onClose();
    window.addEventListener("keydown", handler);
    lockScroll();
    return () => { window.removeEventListener("keydown", handler); unlockScroll(); };
  }, [onClose, personId]);

  const { ratings } = movie;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(29,42,36,0.28)] p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
        <div className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-[1.75rem] border border-[color:var(--line)] bg-[color:var(--surface)] shadow-2xl sm:max-h-[90vh] sm:rounded-2xl" onClick={e => e.stopPropagation()}>

          {/* Backdrop */}
          {movie.backdrop && (
            <div className="relative h-36 w-full overflow-hidden rounded-t-[1.75rem] sm:h-48 sm:rounded-t-2xl">
              <Image src={movie.backdrop} alt="" fill className="object-cover opacity-60" sizes="100vw" />
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[color:var(--surface)]" />
            </div>
          )}

          <button onClick={onClose} className="absolute right-3 top-3 z-10 rounded-full bg-white/80 p-1.5 text-[color:var(--foreground)] shadow hover:bg-white transition-colors">
            <X className="w-5 h-5" />
          </button>

          <div className={`relative flex flex-col gap-4 px-4 pb-4 sm:gap-6 sm:px-6 sm:pb-6 ${movie.backdrop ? "-mt-10 sm:-mt-16" : "pt-4 sm:pt-6"}`}>
            {/* Poster */}
            <div className="w-24 flex-shrink-0 self-center sm:block sm:w-32 sm:self-auto">
              <div className="relative aspect-[2/3] rounded-xl overflow-hidden shadow-xl ring-2 ring-white/10">
                {movie.poster ? (
                  <Image src={movie.poster} alt={movie.title} fill className="object-cover" sizes="(max-width: 640px) 96px, 128px" />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-[color:var(--surface-muted)] p-2 text-center text-xs text-[color:var(--muted)]">{movie.title}</div>
                )}
              </div>
            </div>

            {/* Details */}
            <div className="min-w-0 flex-1 pt-0 sm:pt-0">
              <h2 className="text-xl font-bold leading-tight text-[color:var(--foreground)] sm:text-2xl">{movie.czech_title ?? movie.title}</h2>
              {movie.czech_title && <p className="mt-0.5 text-[color:var(--muted)]">Původní název: {movie.title}</p>}

              <div className="mt-3 flex flex-wrap gap-3 text-sm text-[color:var(--muted)]">
                <span className="flex items-center gap-1"><Calendar className="w-4 h-4" />{movie.year}</span>
                {movie.runtime > 0 && <span className="flex items-center gap-1"><Clock className="w-4 h-4" />{movie.runtime} min</span>}
              </div>

              {movie.genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {movie.genres.map(g => (
                    <span key={g} className="rounded-full bg-[color:var(--surface-muted)] px-2 py-0.5 text-xs text-[color:var(--foreground)]">{g}</span>
                  ))}
                </div>
              )}

              {/* Ratings */}
              <div className="flex flex-wrap gap-5 mt-4">
                {ratings.imdb && <RatingBadge label="IMDB" value={`${ratings.imdb}/10`} color="text-yellow-400" />}
                {ratings.tmdb && <RatingBadge label="TMDB" value={`${ratings.tmdb}/10`} color="text-blue-400" />}
                {ratings.rt && <RatingBadge label="Rotten Tomatoes" value={ratings.rt} color="text-red-400" />}
                {ratings.metacritic && <RatingBadge label="Metacritic" value={ratings.metacritic} color="text-green-400" />}
              </div>

              {/* Overview */}
              {movie.overview ? (
                <p className="mt-4 text-sm leading-relaxed text-[color:var(--foreground)]">{movie.overview}</p>
              ) : (
                <p className="mt-4 text-sm italic text-[color:var(--muted)]">Popis není k dispozici.</p>
              )}

              {/* No release notice */}
              {movie.torrents?.length === 0 && (movie.releases?.length ?? 0) === 0 && (
                <p className="mt-4 text-sm italic text-[color:var(--muted)]">
                  Zatím bez potvrzeného releasu.
                </p>
              )}

              {/* Director */}
              {movie.director && (
                <div className="mt-5">
                  <p className="mb-2 text-xs uppercase tracking-wider text-[color:var(--muted)]">Režisér</p>
                  <button
                    onClick={() => setPersonId(movie.director!.id)}
                    className="-ml-2 flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-[color:var(--surface-muted)] group"
                  >
                    <div className="h-14 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-[color:var(--surface-muted)]">
                      {movie.director.photo ? (
                        <Image src={movie.director.photo} alt={movie.director.name} width={48} height={56} className="object-cover w-full h-full" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-600"><Film className="w-4 h-4" /></div>
                      )}
                    </div>
                    <span className="font-semibold text-[color:var(--foreground)] transition-colors group-hover:text-[color:var(--accent)]">{movie.director.name}</span>
                  </button>
                </div>
              )}

              {/* Cast */}
              {movie.cast.length > 0 && (
                <div className="mt-5">
                  <p className="mb-3 text-xs uppercase tracking-wider text-[color:var(--muted)]">Obsazení</p>
                  <div className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div className="flex gap-4 pb-1">
                      {movie.cast.map(m => (
                        <CastCard key={m.id} member={m} onClick={() => setPersonId(m.id)} />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Sources */}
              {movie.sources?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-4">
                  {movie.sources.map(s => (
                    <span key={s} className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-2 py-0.5 text-xs text-[color:var(--muted)]">
                      {SOURCE_LABELS[s] ?? s}
                    </span>
                  ))}
                </div>
              )}

              {/* Torrents (YTS) */}
              {movie.torrents?.length > 0 && (
                <div className="mt-5">
                    <p className="mb-2 text-xs uppercase tracking-wider text-[color:var(--muted)]">Dostupné varianty</p>
                  <div className="flex flex-wrap gap-2">
                    {movie.torrents.map((t, i) => {
                      const slug = movie.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                      const ytsUrl = `https://yts.mx/movies/${slug}-${movie.year}`;
                      return (
                        <a key={i} href={ytsUrl} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-2 rounded-lg border border-[color:var(--accent)]/30 bg-[color:var(--accent)]/8 px-3 py-1.5 text-xs text-[color:var(--foreground)] transition-colors hover:bg-[color:var(--accent)]/15 hover:border-[color:var(--accent)]/60">
                          <span className="font-bold text-[color:var(--accent)]">{t.quality}</span>
                          <span className="text-[color:var(--muted)]">{t.type}</span>
                          <span className="text-[color:var(--muted)]">{t.size}</span>
                          {typeof t.seeds === "number" && <span className="text-green-500 font-medium">▲{t.seeds}</span>}
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              {movie.releases?.length > 0 && (
                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wider text-[color:var(--muted)]">Doložené releasy</p>
                    <a href={`https://www.1337x.to/search/${encodeURIComponent(movie.title + " " + movie.year)}/1/`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 rounded-lg bg-[color:var(--accent)]/10 px-2 py-1 text-[11px] font-medium text-[color:var(--accent)] hover:bg-[color:var(--accent)]/20 transition-colors">
                      <ExternalLink className="w-3 h-3" /> Hledat torrent
                    </a>
                  </div>
                  <div className="divide-y divide-[color:var(--line)]">
                    {movie.releases.map((release, index) => (
                      <ReleaseCard key={`${release.source}-${release.label}-${index}`} release={release} />
                    ))}
                  </div>
                </div>
              )}

              {/* Links */}
              <div className="mt-5 flex flex-wrap gap-3">
                {movie.imdb_code && (
                  <a href={`https://www.imdb.com/title/${movie.imdb_code}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-lg bg-yellow-500/10 px-3 py-1.5 text-xs text-yellow-700 transition-colors hover:bg-yellow-500/20">
                    <ExternalLink className="w-3.5 h-3.5" /> IMDB
                  </a>
                )}
                {movie.torrents?.length > 0 && (
                  <a href={`https://yts.mx/movies/${movie.title.toLowerCase().replace(/\s+/g, "-")}-${movie.year}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs text-[color:var(--accent)] transition-colors hover:bg-emerald-500/20">
                    <Film className="w-3.5 h-3.5" /> YTS
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {personId && <PersonModal personId={personId} onClose={() => setPersonId(null)} />}
    </>
  );
}

function RatingBadge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className={`text-lg font-bold ${color}`}>{value}</span>
      <span className="text-xs text-[color:var(--muted)]">{label}</span>
    </div>
  );
}
