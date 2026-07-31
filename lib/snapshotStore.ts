import { get, put } from "@vercel/blob";

export type SnapshotSection = "ai" | "tech" | "news" | "movies";

export type SectionSnapshot<T> = {
  schemaVersion: 1;
  section: SnapshotSection;
  version: string;
  sourceFetchedAt: string;
  translatedAt: string;
  itemCount: number;
  data: T;
};

const snapshotPath = (section: SnapshotSection) => `movie-releases/snapshots/${section}.json`;

function canUseBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function readSnapshot<T>(section: SnapshotSection): Promise<SectionSnapshot<T> | null> {
  if (!canUseBlob()) return null;

  try {
    const result = await get(snapshotPath(section), { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return null;
    const text = await new Response(result.stream).text();
    const parsed = JSON.parse(text) as SectionSnapshot<T>;
    return parsed.schemaVersion === 1 && parsed.section === section ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeSnapshot<T>(
  section: SnapshotSection,
  data: T,
  itemCount: number
): Promise<SectionSnapshot<T> | null> {
  if (!canUseBlob()) return null;

  const now = new Date().toISOString();
  const snapshot: SectionSnapshot<T> = {
    schemaVersion: 1,
    section,
    version: crypto.randomUUID(),
    sourceFetchedAt: now,
    translatedAt: now,
    itemCount,
    data,
  };

  await put(snapshotPath(section), JSON.stringify(snapshot), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: 0,
  });
  return snapshot;
}
