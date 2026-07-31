export type EditorialImageTopic = "ai" | "technology" | "film";

// These are deliberately photographic editorial fallbacks, not source logos.
// The URL parameters ask the image CDN for a 1600×900 asset so cards never
// degrade to a tiny thumbnail when an upstream publisher omits an image.
const FALLBACK_SOURCES: Record<EditorialImageTopic, string[]> = {
  ai: [
    "https://images.unsplash.com/photo-1518770660439-4636190af475",
    "https://images.unsplash.com/photo-1485827404703-89b55fcc595e",
    "https://images.unsplash.com/photo-1555949963-aa79dcee981c",
  ],
  technology: [
    "https://images.unsplash.com/photo-1519389950473-47ba0277781c",
    "https://images.unsplash.com/photo-1498050108023-c5249f4df085",
    "https://images.unsplash.com/photo-1550751827-4bd374c3f58b",
  ],
  film: [
    "https://images.unsplash.com/photo-1485846234645-a62644f84728",
    "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c",
    "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba",
  ],
};

function stableIndex(seed: string, length: number) {
  let hash = 0;
  for (let index = 0; index < seed.length; index++) hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  return Math.abs(hash) % length;
}

export function editorialFallbackImage(topic: EditorialImageTopic, seed: string) {
  const source = FALLBACK_SOURCES[topic][stableIndex(seed, FALLBACK_SOURCES[topic].length)];
  return `${source}?auto=format&fit=crop&w=1600&h=900&q=88`;
}
