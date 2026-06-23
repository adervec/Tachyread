// A curated list of popular Google Fonts families for the picker to surface when the user opts in
// to the Google Fonts CDN (global.enableGoogleFonts). This is NOT the whole ~1,700-family library —
// it's the discoverable shortlist. The picker's "type any family name" box can load ANY Google
// family by name from the CDN, so the full library is still reachable; this list just saves typing.
// Every Google Fonts family is libre (OFL / Apache / Ubuntu licence). cat: sans|serif|display|hand|mono.

export const GOOGLE_FAMILIES = [
  // Sans-serif
  ['Roboto', 'sans'], ['Open Sans', 'sans'], ['Montserrat', 'sans'], ['Poppins', 'sans'],
  ['Raleway', 'sans'], ['Nunito Sans', 'sans'], ['Mukta', 'sans'], ['Rubik', 'sans'],
  ['Noto Sans', 'sans'], ['Ubuntu', 'sans'], ['Kanit', 'sans'], ['Oswald', 'sans'],
  ['PT Sans', 'sans'], ['Mulish', 'sans'], ['Manrope', 'sans'], ['DM Sans', 'sans'],
  ['Karla', 'sans'], ['Cabin', 'sans'], ['Quicksand', 'sans'], ['Heebo', 'sans'],
  ['Barlow', 'sans'], ['Hind', 'sans'], ['Titillium Web', 'sans'], ['Josefin Sans', 'sans'],
  ['Fira Sans', 'sans'], ['Libre Franklin', 'sans'], ['Archivo', 'sans'], ['Assistant', 'sans'],
  ['Public Sans', 'sans'], ['Schibsted Grotesk', 'sans'], ['Outfit', 'sans'], ['Sora', 'sans'],
  ['Space Grotesk', 'sans'], ['Plus Jakarta Sans', 'sans'], ['Figtree', 'sans'], ['Onest', 'sans'],
  ['Geologica', 'sans'], ['Albert Sans', 'sans'], ['Lexend', 'sans'], ['Be Vietnam Pro', 'sans'],
  ['Cairo', 'sans'], ['Tajawal', 'sans'], ['Jost', 'sans'], ['Red Hat Display', 'sans'],
  ['Signika', 'sans'], ['Catamaran', 'sans'], ['Saira', 'sans'], ['Exo 2', 'sans'],
  ['Maven Pro', 'sans'], ['Overpass', 'sans'], ['Anton', 'sans'], ['Bebas Neue', 'display'],
  // Serif
  ['Roboto Slab', 'serif'], ['Merriweather', 'serif'], ['Playfair Display', 'serif'],
  ['PT Serif', 'serif'], ['Noto Serif', 'serif'], ['Lora', 'serif'], ['Libre Baskerville', 'serif'],
  ['Crimson Text', 'serif'], ['Cormorant Garamond', 'serif'], ['EB Garamond', 'serif'],
  ['Bitter', 'serif'], ['Source Serif 4', 'serif'], ['Domine', 'serif'], ['Arvo', 'serif'],
  ['Vollkorn', 'serif'], ['Spectral', 'serif'], ['Frank Ruhl Libre', 'serif'], ['Literata', 'serif'],
  ['Zilla Slab', 'serif'], ['Cardo', 'serif'], ['Alegreya', 'serif'], ['Bodoni Moda', 'serif'],
  ['Cormorant', 'serif'], ['Old Standard TT', 'serif'], ['Noto Serif Display', 'serif'],
  ['Marcellus', 'serif'], ['Gelasio', 'serif'], ['Newsreader', 'serif'], ['Fraunces', 'serif'],
  ['DM Serif Display', 'serif'], ['DM Serif Text', 'serif'], ['Petrona', 'serif'],
  ['Source Serif Pro', 'serif'], ['Tinos', 'serif'], ['Rosario', 'serif'], ['Besley', 'serif'],
  // Display / decorative
  ['Lobster', 'display'], ['Pacifico', 'display'], ['Comfortaa', 'display'], ['Righteous', 'display'],
  ['Abril Fatface', 'display'], ['Alfa Slab One', 'display'], ['Bungee', 'display'],
  ['Cinzel', 'display'], ['Cinzel Decorative', 'display'], ['Fjalla One', 'display'],
  ['Russo One', 'display'], ['Staatliches', 'display'], ['Teko', 'display'], ['Pathway Gothic One', 'display'],
  ['Archivo Black', 'display'], ['Black Ops One', 'display'], ['Bangers', 'display'],
  ['Permanent Marker', 'display'], ['Press Start 2P', 'display'], ['Orbitron', 'display'],
  ['Audiowide', 'display'], ['Monoton', 'display'], ['Faster One', 'display'], ['Rye', 'display'],
  ['Special Elite', 'display'], ['Creepster', 'display'], ['UnifrakturMaguntia', 'display'],
  ['Pirata One', 'display'], ['MedievalSharp', 'display'], ['Cherry Cream Soda', 'display'],
  ['Shrikhand', 'display'], ['Titan One', 'display'], ['Fredoka', 'display'], ['Baloo 2', 'display'],
  // Handwriting / script
  ['Dancing Script', 'hand'], ['Caveat', 'hand'], ['Satisfy', 'hand'], ['Sacramento', 'hand'],
  ['Great Vibes', 'hand'], ['Kalam', 'hand'], ['Shadows Into Light', 'hand'], ['Indie Flower', 'hand'],
  ['Patrick Hand', 'hand'], ['Amatic SC', 'hand'], ['Courgette', 'hand'], ['Gloria Hallelujah', 'hand'],
  ['Cookie', 'hand'], ['Yellowtail', 'hand'], ['Parisienne', 'hand'], ['Homemade Apple', 'hand'],
  // Monospace
  ['Roboto Mono', 'mono'], ['Source Code Pro', 'mono'], ['JetBrains Mono', 'mono'],
  ['Fira Code', 'mono'], ['IBM Plex Mono', 'mono'], ['Space Mono', 'mono'], ['Inconsolata', 'mono'],
  ['Ubuntu Mono', 'mono'], ['PT Mono', 'mono'], ['Cousine', 'mono'], ['DM Mono', 'mono'],
  ['Overpass Mono', 'mono'], ['Red Hat Mono', 'mono'], ['Martian Mono', 'mono'],
  // IBM Plex family (popular)
  ['IBM Plex Sans', 'sans'], ['IBM Plex Serif', 'serif'],
].map(([name, cat]) => ({ name, css: `'${name}'`, cat, source: 'google' }));
