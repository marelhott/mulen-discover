"use client";

import { useEffect, useState } from "react";
import TabNav, { Tab } from "./TabNav";
import MovieGrid from "./MovieGrid";
import NewsTab from "./NewsTab";
import FeedTab from "./FeedTab";

export default function AppShell() {
  const [tab, setTab] = useState<Tab>("ai");
  const [visited, setVisited] = useState<Record<Tab, boolean>>({
    ai: true, tech: false, news: false, releases: false,
  });

  const selectTab = (nextTab: Tab) => {
    setVisited((current) => (current[nextTab] ? current : { ...current, [nextTab]: true }));
    setTab(nextTab);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setVisited((current) => (current.releases ? current : { ...current, releases: true }));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const id = window.requestIdleCallback(() => {
      setVisited(() => ({ ai: true, tech: true, news: true, releases: true }));
    }, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-[color:var(--line)] bg-[color:var(--background)]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-screen-2xl items-center gap-6 px-4 sm:px-6">
          <button
            onClick={() => { selectTab("ai"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
            className="flex-shrink-0 text-[0.9375rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)] hover:text-[color:var(--accent)] transition-colors"
            style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
          >
            Přehled
          </button>
          <TabNav active={tab} onChange={selectTab} />
        </div>
      </header>

      <div className="mx-auto max-w-screen-2xl px-4 py-5 sm:py-8">
        <section className={tab === "news" ? "block" : "hidden"}>
          <NewsTab />
        </section>
        {visited.releases && (
          <section className={tab === "releases" ? "block" : "hidden"}>
            <MovieGrid />
          </section>
        )}
        {visited.ai && (
          <section className={tab === "ai" ? "block" : "hidden"}>
            <FeedTab category="ai" />
          </section>
        )}
        {visited.tech && (
          <section className={tab === "tech" ? "block" : "hidden"}>
            <FeedTab category="tech" />
          </section>
        )}
      </div>
    </>
  );
}
