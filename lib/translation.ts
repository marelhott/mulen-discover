import { jsonrepair } from "jsonrepair";

type TranslationOptions = {
  source?: string;
  target?: string;
};

const MAX_BATCH_ITEMS = 24;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_OPENROUTER_MODEL = "qwen/qwen3.7-flash";
const DEFAULT_FALLBACK_MODEL = "google/gemini-3.1-flash-lite";
const ENGLISH_SIGNAL = /\b(the|and|with|from|into|that|this|for|about|new|will|has|have|are|was|were|after|before|their|its|your|you)\b/i;

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function assertCzechResults(source: string[], translated: string[]) {
  if (translated.length !== source.length) throw new Error("Překladač vrátil neúplnou dávku");
  for (let index = 0; index < source.length; index++) {
    const input = clean(source[index]);
    const output = clean(translated[index]);
    if (!input) continue;
    if (!output) throw new Error("Překladač vrátil prázdný text");
    if (input.length > 12 && input.toLocaleLowerCase() === output.toLocaleLowerCase() && ENGLISH_SIGNAL.test(input)) {
      throw new Error("Překladač neprovedl český překlad");
    }
  }
}

async function translateWithOpenRouter(texts: string[], options: TranslationOptions): Promise<string[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY není nastavený");

  const models = [
    process.env.OPENROUTER_TRANSLATION_MODEL || DEFAULT_OPENROUTER_MODEL,
    process.env.OPENROUTER_TRANSLATION_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL,
  ].filter((model, index, values) => Boolean(model) && values.indexOf(model) === index);

  let lastError: unknown;
  for (const model of models) {
    try {
      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://news-movie-release.vercel.app",
          "X-OpenRouter-Title": "Movie Releases",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: Math.max(256, texts.reduce((total, text) => total + Math.ceil(text.length / 2), 0)),
          provider: { sort: "throughput" },
          messages: [
            {
              role: "system",
              content: `Jsi precizní překladač. Přelož každý text z ${options.source ?? "en"} do ${options.target ?? "cs"}. Zachovej vlastní jména, URL, čísla, značky, HTML entity a význam. Nezkracuj a nepřidávej komentář. Odpověz výhradně validním JSON ve tvaru {"translations":["...", ...]} ve stejném pořadí.`,
            },
            { role: "user", content: JSON.stringify(texts) },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error("OpenRouter vrátil prázdnou odpověď");
      const parsed = JSON.parse(jsonrepair(content)) as { translations?: unknown[] };
      const translated = (parsed.translations ?? []).map(clean);
      assertCzechResults(texts, translated);
      return translated;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OpenRouter překlad selhal");
}

export function hasTranslationProvider() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export async function translateTexts(texts: string[], options: TranslationOptions = {}): Promise<string[]> {
  if (texts.length === 0) return [];
  if (!hasTranslationProvider()) throw new Error("OPENROUTER_API_KEY není nastavený");
  const indexed = texts.map((text, index) => ({ text: clean(text), index })).filter((item) => item.text.length > 0);
  if (indexed.length === 0) return texts.map(() => "");

  const translate = async (input: string[]) => {
    return translateWithOpenRouter(input, options);
  };

  const translated = await translate(indexed.map((item) => item.text));
  const result = texts.map(() => "");
  for (let index = 0; index < indexed.length; index++) result[indexed[index].index] = translated[index];
  return result;
}

export async function translateText(text: string, options: TranslationOptions = {}) {
  const [translated] = await translateTexts([text], options);
  return translated;
}
