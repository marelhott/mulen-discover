"use client";

export type Tab = "ai" | "tech" | "news" | "games";

const TABS: { id: Tab; label: string }[] = [
  { id: "ai", label: "AI" },
  { id: "tech", label: "Technologie" },
  { id: "news", label: "Film" },
  { id: "games", label: "Hry" },
];

export default function TabNav({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
}) {
  return (
    <nav className="flex items-center gap-0">
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`relative px-3 py-2.5 text-[0.8125rem] font-medium transition-colors sm:px-4 ${
            active === t.id
              ? "text-[color:var(--foreground)]"
              : "text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
          }`}
        >
          {t.label}
          {active === t.id && (
            <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-[color:var(--foreground)]" />
          )}
        </button>
      ))}
    </nav>
  );
}
