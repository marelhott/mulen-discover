// Compatibility bridge for the existing data services. The implementation is
// intentionally strict: it never reports an English source string as Czech.
export { hasTranslationProvider as hasGoogleTranslateKey, translateText, translateTexts } from "@/lib/translation";
