import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { hasGoogleTranslateKey, translateTexts } from "@/lib/googleTranslate";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALLOWED_ARTICLE_DOMAINS = [
  "openai.com", "deepmind.google", "huggingface.co", "theverge.com", "technologyreview.com",
  "techcrunch.com", "the-decoder.com", "blog.google", "nvidia.com", "anthropic.com",
  "ycombinator.com", "arstechnica.com", "theregister.com", "9to5mac.com", "engadget.com",
  "macrumors.com", "bleepingcomputer.com", "tomshardware.com", "spectrum.ieee.org",
  "deadline.com", "variety.com", "hollywoodreporter.com", "indiewire.com", "screendaily.com",
  "filmneweurope.com", "moviezone.cz",
];

function isAllowedArticleUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return ALLOWED_ARTICLE_DOMAINS.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function decodeHtml(text: string) {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&hellip;/g, "...").replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractParagraphs(html: string) {
  const paragraphs = [...html.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)]
    .map((match) => decodeHtml(match[1]))
    .filter((paragraph) => paragraph.length >= 55)
    .filter((paragraph) => !/^(advertisement|reklama|subscribe|sign up|read more|related:|copyright)/i.test(paragraph));

  return Array.from(new Set(paragraphs)).slice(0, 36);
}

function extractReadableContent(html: string): { content: string; image: string | null; author: string | null } {
  // Remove scripts, styles, nav, header, footer, aside
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<figure[\s\S]*?<\/figure>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Extract og:image
  const ogImg = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
             ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
             ?? html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
  const image = ogImg?.[1]?.startsWith("http") ? ogImg[1] : null;

  // Extract author
  const authorMatch = html.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i)
                   ?? html.match(/class=["'][^"']*author[^"']*["'][^>]*>([^<]{2,60})</i);
  const author = authorMatch?.[1]?.trim().replace(/<[^>]+>/g, "") ?? null;

  // Try to find main article content in order of preference
  const articlePatterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]+(?:class|id)=["'][^"']*(?:article-body|entry-content|post-content|article-content|story-body|main-content|content-body)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
  ];

  let bodyHtml = "";
  for (const pattern of articlePatterns) {
    const m = clean.match(pattern);
    if (m?.[1] && m[1].length > 200) {
      bodyHtml = m[1];
      break;
    }
  }

  if (!bodyHtml) {
    // Fallback: extract all <p> tags
    const paragraphs = [...clean.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
    bodyHtml = paragraphs.map(m => m[1]).join("\n");
  }

  // Keep native paragraph boundaries; removing all tags first previously merged a
  // full story into a tiny, unreadable excerpt in the modal.
  let paras = extractParagraphs(bodyHtml);
  if (paras.length === 0) paras = extractParagraphs(clean);
  if (paras.length === 0) {
    const text = decodeHtml(bodyHtml.replace(/<\/(?:p|div|section|h[1-6])>/gi, "\n\n"));
    paras = text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter((paragraph) => paragraph.length >= 55);
  }

  return { content: paras.join("\n\n"), image, author };
}

async function fetchArticle(url: string) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(12000),
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const article = extractReadableContent(html);
  if (!article.content) throw new Error("Zdroj neposkytl čitelný obsah článku");
  if (!hasGoogleTranslateKey()) throw new Error("Český překladač není nakonfigurovaný");

  const paragraphs = article.content
    .split("\n\n")
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, 36);

  if (paragraphs.length === 0) return article;

  const translated = await translateTexts(paragraphs);
  return {
    ...article,
    content: translated.join("\n\n"),
  };
}

const getCachedArticle = unstable_cache(
  async (url: string) => fetchArticle(url),
  ["article-content-v3"],
  { revalidate: 3600 }
);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  if (!url || !isAllowedArticleUrl(url)) {
    return NextResponse.json({ error: "Nepovolený zdroj článku" }, { status: 400 });
  }

  try {
    const data = await getCachedArticle(url);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200" },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
