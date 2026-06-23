// Bundled open fonts — shipped WITH the app so they work fully offline and reveal nothing to any
// third party. Every family here is libre (SIL Open Font License or Apache-2.0); see
// THIRD_PARTY_NOTICES.md. Importing each @fontsource package below registers its @font-face rules;
// the actual woff2 is fetched by the browser only when a family is rendered (so this import is
// cheap at startup). Variable-font packages register a family literally named "<Name> Variable" —
// that exact string is what we must use in CSS, hence the `css` values below.

import '@fontsource-variable/inter';
import '@fontsource-variable/source-sans-3';
import '@fontsource-variable/work-sans';
import '@fontsource-variable/nunito';
import '@fontsource-variable/open-sans';
import '@fontsource/lato';
import '@fontsource-variable/lora';
import '@fontsource-variable/source-serif-4';
import '@fontsource-variable/eb-garamond';
import '@fontsource-variable/merriweather';
import '@fontsource-variable/literata';
import '@fontsource-variable/bitter';
import '@fontsource-variable/playfair-display';
import '@fontsource-variable/crimson-pro';
import '@fontsource/atkinson-hyperlegible';
import '@fontsource/opendyslexic';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/fira-code';
import '@fontsource-variable/source-code-pro';

// name = label shown in the picker; css = the exact registered font-family; cat groups the picker.
export const BUNDLED = [
  // Sans-serif
  { name: 'Inter', css: "'Inter Variable'", cat: 'sans' },
  { name: 'Source Sans 3', css: "'Source Sans 3 Variable'", cat: 'sans' },
  { name: 'Work Sans', css: "'Work Sans Variable'", cat: 'sans' },
  { name: 'Nunito', css: "'Nunito Variable'", cat: 'sans' },
  { name: 'Open Sans', css: "'Open Sans Variable'", cat: 'sans' },
  { name: 'Lato', css: "'Lato'", cat: 'sans' },
  // Serif
  { name: 'Lora', css: "'Lora Variable'", cat: 'serif' },
  { name: 'Source Serif 4', css: "'Source Serif 4 Variable'", cat: 'serif' },
  { name: 'EB Garamond', css: "'EB Garamond Variable'", cat: 'serif' },
  { name: 'Merriweather', css: "'Merriweather Variable'", cat: 'serif' },
  { name: 'Literata', css: "'Literata Variable'", cat: 'serif' },
  { name: 'Bitter', css: "'Bitter Variable'", cat: 'serif' },
  { name: 'Playfair Display', css: "'Playfair Display Variable'", cat: 'serif' },
  { name: 'Crimson Pro', css: "'Crimson Pro Variable'", cat: 'serif' },
  // Accessibility / high-legibility
  { name: 'Atkinson Hyperlegible', css: "'Atkinson Hyperlegible'", cat: 'a11y' },
  { name: 'OpenDyslexic', css: "'OpenDyslexic'", cat: 'a11y' },
  // Monospace
  { name: 'JetBrains Mono', css: "'JetBrains Mono Variable'", cat: 'mono' },
  { name: 'Fira Code', css: "'Fira Code Variable'", cat: 'mono' },
  { name: 'Source Code Pro', css: "'Source Code Pro Variable'", cat: 'mono' },
].map((f) => ({ ...f, source: 'bundled' }));
