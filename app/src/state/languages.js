// Document languages the app can work in. This does NOT translate the UI — it drives the
// language-bound machinery: OCR (tesseract traineddata), dictation / read-along speech
// recognition (BCP-47), and TTS voice matching. The reading pipeline itself is Unicode-safe
// (\p{L} throughout) and needs no per-language setup.
//   code — stored in global settings;  bcp — Web Speech;  tess — tesseract.js pack
export const LANGUAGES = [
  { code: 'en', label: 'English', bcp: 'en-US', tess: 'eng' },
  { code: 'hr', label: 'Hrvatski (Croatian)', bcp: 'hr-HR', tess: 'hrv' },
  { code: 'ar', label: 'العربية (Arabic)', bcp: 'ar-SA', tess: 'ara' },
  { code: 'zh', label: '中文 (Chinese, Simplified)', bcp: 'zh-CN', tess: 'chi_sim' },
  { code: 'cs', label: 'Čeština (Czech)', bcp: 'cs-CZ', tess: 'ces' },
  { code: 'nl', label: 'Nederlands (Dutch)', bcp: 'nl-NL', tess: 'nld' },
  { code: 'fr', label: 'Français (French)', bcp: 'fr-FR', tess: 'fra' },
  { code: 'de', label: 'Deutsch (German)', bcp: 'de-DE', tess: 'deu' },
  { code: 'hi', label: 'हिन्दी (Hindi)', bcp: 'hi-IN', tess: 'hin' },
  { code: 'hu', label: 'Magyar (Hungarian)', bcp: 'hu-HU', tess: 'hun' },
  { code: 'it', label: 'Italiano (Italian)', bcp: 'it-IT', tess: 'ita' },
  { code: 'ja', label: '日本語 (Japanese)', bcp: 'ja-JP', tess: 'jpn' },
  { code: 'ko', label: '한국어 (Korean)', bcp: 'ko-KR', tess: 'kor' },
  { code: 'pl', label: 'Polski (Polish)', bcp: 'pl-PL', tess: 'pol' },
  { code: 'pt', label: 'Português (Portuguese)', bcp: 'pt-PT', tess: 'por' },
  { code: 'ro', label: 'Română (Romanian)', bcp: 'ro-RO', tess: 'ron' },
  { code: 'ru', label: 'Русский (Russian)', bcp: 'ru-RU', tess: 'rus' },
  { code: 'sl', label: 'Slovenščina (Slovenian)', bcp: 'sl-SI', tess: 'slv' },
  { code: 'es', label: 'Español (Spanish)', bcp: 'es-ES', tess: 'spa' },
  { code: 'tr', label: 'Türkçe (Turkish)', bcp: 'tr-TR', tess: 'tur' },
  { code: 'uk', label: 'Українська (Ukrainian)', bcp: 'uk-UA', tess: 'ukr' },
];

export function getLanguage(code) {
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
}
