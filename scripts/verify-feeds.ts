#!/usr/bin/env npx tsx
/**
 * verify-feeds.ts
 *
 * Verifies all configured RSS feed sources:
 *   - HTTP reachability
 *   - Parseable RSS/Atom structure
 *   - Item count (min 3)
 *   - Content freshness (newest item ≤ 7 days old)
 *   - Optional: Claude relevance check (~$0.001/source)
 *
 * Usage:
 *   npx tsx scripts/verify-feeds.ts              # all sources
 *   npx tsx scripts/verify-feeds.ts --category ai
 *   npx tsx scripts/verify-feeds.ts --category tech
 *   npx tsx scripts/verify-feeds.ts --claude      # + AI relevance check
 *   npx tsx scripts/verify-feeds.ts --url https://example.com/feed.xml --topic "artificial intelligence"
 */

import { XMLParser } from "fast-xml-parser";

// ── Source definitions (mirrors route.ts) ────────────────────────────────────

const AI_SOURCES = [
  { name: "OpenAI Blog",      url: "https://openai.com/news/rss.xml",                                           topic: "AI/ML models, OpenAI products" },
  { name: "Google DeepMind",  url: "https://deepmind.google/blog/rss.xml",                                      topic: "AI research, DeepMind" },
  { name: "Hugging Face",     url: "https://huggingface.co/blog/feed.xml",                                      topic: "open-source AI, ML models" },
  { name: "The Verge AI",     url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",         topic: "AI news" },
  { name: "MIT Tech Review",  url: "https://www.technologyreview.com/topic/artificial-intelligence/feed/",      topic: "AI research" },
  { name: "TechCrunch AI",    url: "https://techcrunch.com/category/artificial-intelligence/feed/",             topic: "AI startups and products" },
  { name: "NVIDIA Blog",      url: "https://blogs.nvidia.com/feed/",                                            topic: "AI hardware and products" },
  { name: "The Decoder",      url: "https://the-decoder.com/feed/",                                             topic: "AI news" },
  { name: "Google AI Blog",   url: "https://blog.google/technology/ai/rss/",                                    topic: "Google AI" },
];

const TECH_SOURCES = [
  { name: "Hacker News",      url: "https://news.ycombinator.com/rss",                                          topic: "technology, startups, programming" },
  { name: "Ars Technica",     url: "https://feeds.arstechnica.com/arstechnica/index",                           topic: "technology news" },
  { name: "The Verge",        url: "https://www.theverge.com/rss/index.xml",                                    topic: "consumer tech news" },
  { name: "The Register",     url: "https://www.theregister.com/headlines.atom",                                 topic: "enterprise tech, software" },
  { name: "9to5Mac",          url: "https://9to5mac.com/feed/",                                                  topic: "Apple, iOS, Mac" },
  { name: "Engadget",         url: "https://www.engadget.com/rss.xml",                                          topic: "consumer electronics" },
  { name: "MacRumors",        url: "https://www.macrumors.com/macrumors.xml",                                   topic: "Apple rumors" },
  { name: "BleepingComputer", url: "https://www.bleepingcomputer.com/feed/",                                    topic: "cybersecurity news" },
  { name: "Tom's Hardware",   url: "https://www.tomshardware.com/feeds/all",                                    topic: "hardware, CPUs, GPUs" },
  { name: "IEEE Spectrum",    url: "https://spectrum.ieee.org/rss/fulltext",                                    topic: "engineering, electronics" },
];

// ── XML parser ────────────────────────────────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
});

function decodeEntities(s: string) {
  return s.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")
          .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/<[^>]+>/g,"").trim();
}

// ── Verification ──────────────────────────────────────────────────────────────

type VerifyResult = {
  name: string;
  url: string;
  status: "ok" | "warn" | "fail";
  issues: string[];
  itemCount: number;
  newestAge: string;
  sampleTitles: string[];
  claudeRelevant?: boolean | null;
  claudeComment?: string;
  latencyMs: number;
};

async function verifySource(
  source: { name: string; url: string; topic: string },
  checkClaude: boolean,
  anthropicKey?: string
): Promise<VerifyResult> {
  const issues: string[] = [];
  const t0 = Date.now();
  let itemCount = 0;
  let newestAge = "unknown";
  const sampleTitles: string[] = [];
  let claudeRelevant: boolean | null = null;
  let claudeComment: string | undefined;

  try {
    const res = await fetch(source.url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FeedVerifier/1.0)" },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return {
        name: source.name, url: source.url,
        status: "fail", issues: [`HTTP ${res.status}`],
        itemCount: 0, newestAge: "–", sampleTitles: [],
        latencyMs: Date.now() - t0,
      };
    }

    const text = await res.text();
    let parsed: any;
    try {
      parsed = xmlParser.parse(text);
    } catch {
      return {
        name: source.name, url: source.url,
        status: "fail", issues: ["XML parse error"],
        itemCount: 0, newestAge: "–", sampleTitles: [],
        latencyMs: Date.now() - t0,
      };
    }

    const channel = parsed?.rss?.channel ?? parsed?.feed ?? {};
    const rawItems: any[] = channel.item ?? channel.entry ?? [];
    const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
    itemCount = items.length;

    if (itemCount < 3) issues.push(`Only ${itemCount} items`);

    // Check freshness
    const dates = items.slice(0, 5).map((item: any) => {
      const d = item.pubDate ?? item.updated ?? item.published;
      return d ? new Date(d).getTime() : 0;
    }).filter(Boolean);

    if (dates.length > 0) {
      const newest = Math.max(...dates);
      const ageMs = Date.now() - newest;
      const ageDays = ageMs / 86_400_000;
      const ageHours = ageMs / 3_600_000;
      newestAge = ageDays < 1 ? `${Math.round(ageHours)}h ago` : `${Math.round(ageDays)}d ago`;
      if (ageDays > 7) issues.push(`Newest item is ${Math.round(ageDays)}d old`);
    } else {
      newestAge = "no dates";
      issues.push("No parseable dates in items");
    }

    // Sample titles
    for (const item of items.slice(0, 5)) {
      const title = decodeEntities(String(item.title?.["#text"] ?? item.title ?? "")).slice(0, 80);
      if (title) sampleTitles.push(title);
    }

    // Claude relevance check
    if (checkClaude && anthropicKey && sampleTitles.length >= 3) {
      try {
        const { default: Anthropic } = await import("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey: anthropicKey });
        const msg = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 120,
          messages: [{
            role: "user",
            content: `Is this RSS feed topically relevant to "${source.topic}"? Reply with JSON: {"relevant":true/false,"comment":"<10 words why>"}\n\nSample titles:\n${sampleTitles.slice(0,5).map((t,i)=>`${i+1}. ${t}`).join("\n")}`,
          }],
        });
        const raw = msg.content[0].type === "text" ? msg.content[0].text : "{}";
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          claudeRelevant = parsed.relevant ?? null;
          claudeComment = parsed.comment;
          if (claudeRelevant === false) issues.push(`Claude: not relevant — ${claudeComment}`);
        }
      } catch {
        claudeRelevant = null;
      }
    }

    const latencyMs = Date.now() - t0;
    const status = issues.length === 0 ? "ok" : issues.some(i => i.includes("HTTP") || i.includes("XML")) ? "fail" : "warn";
    return { name: source.name, url: source.url, status, issues, itemCount, newestAge, sampleTitles, claudeRelevant, claudeComment, latencyMs };

  } catch (err) {
    return {
      name: source.name, url: source.url,
      status: "fail",
      issues: [err instanceof Error ? err.message : "Unknown error"],
      itemCount: 0, newestAge: "–", sampleTitles: [],
      latencyMs: Date.now() - t0,
    };
  }
}

// ── Reporter ──────────────────────────────────────────────────────────────────

function color(s: string, code: number) { return `\x1b[${code}m${s}\x1b[0m`; }
const green  = (s: string) => color(s, 32);
const yellow = (s: string) => color(s, 33);
const red    = (s: string) => color(s, 31);
const dim    = (s: string) => color(s, 2);
const bold   = (s: string) => color(s, 1);

function printResult(r: VerifyResult) {
  const icon = r.status === "ok" ? green("✓") : r.status === "warn" ? yellow("⚠") : red("✗");
  const latency = dim(`${r.latencyMs}ms`);
  console.log(`\n${icon} ${bold(r.name)} ${latency}`);
  console.log(`  ${dim(r.url)}`);
  console.log(`  Items: ${r.itemCount}  Newest: ${r.newestAge}`);
  if (r.sampleTitles.length > 0) {
    console.log(`  ${dim("Sample titles:")}`);
    for (const t of r.sampleTitles.slice(0, 3)) {
      console.log(`    • ${t}`);
    }
  }
  if (r.claudeRelevant !== undefined && r.claudeRelevant !== null) {
    const relevance = r.claudeRelevant ? green("relevant") : red("NOT relevant");
    console.log(`  Claude: ${relevance} — ${r.claudeComment ?? ""}`);
  }
  if (r.issues.length > 0) {
    for (const issue of r.issues) console.log(`  ${yellow("⚠")} ${issue}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const checkClaude = args.includes("--claude");
  const catIdx = args.indexOf("--category");
  const categoryArg = catIdx !== -1 ? args[catIdx + 1] : undefined;
  const urlIdx = args.indexOf("--url");
  const customUrl = urlIdx !== -1 ? args[urlIdx + 1] : undefined;
  const topicIdx = args.indexOf("--topic");
  const customTopic = topicIdx !== -1 ? args[topicIdx + 1] : undefined;

  const anthropicKey = process.env.MOVIE_ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (checkClaude && !anthropicKey) {
    console.warn(yellow("⚠ --claude flag set but no MOVIE_ANTHROPIC_KEY in environment. Skipping AI check."));
  }

  let sources: { name: string; url: string; topic: string }[];

  if (customUrl) {
    sources = [{ name: customUrl, url: customUrl, topic: customTopic ?? "general" }];
  } else if (categoryArg === "ai") {
    sources = AI_SOURCES;
  } else if (categoryArg === "tech") {
    sources = TECH_SOURCES;
  } else {
    sources = [...AI_SOURCES, ...TECH_SOURCES];
  }

  console.log(bold(`\n🔍 Verifying ${sources.length} RSS sources…`) + (checkClaude ? " (+ Claude relevance)" : ""));
  console.log(dim("─".repeat(60)));

  const results = await Promise.all(sources.map(s => verifySource(s, checkClaude && !!anthropicKey, anthropicKey)));

  for (const r of results) printResult(r);

  // Summary
  const ok   = results.filter(r => r.status === "ok").length;
  const warn = results.filter(r => r.status === "warn").length;
  const fail = results.filter(r => r.status === "fail").length;

  console.log(`\n${dim("─".repeat(60))}`);
  console.log(bold("Summary:"), `${green(`${ok} ok`)}  ${yellow(`${warn} warnings`)}  ${red(`${fail} failed`)}`);

  if (fail > 0) process.exit(1);
}

main().catch(err => { console.error(red(String(err))); process.exit(1); });
