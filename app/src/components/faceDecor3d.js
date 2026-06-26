// Per-style 3D decoration table for the WebGL reader faces — the spiritual port of the SVG
// decor() table in FaceSVG.jsx. Each style returns the base head plus a list of decorative
// "parts" (ears, hair, hats, horns, beaks, whiskers, bolts, fangs…) built from three.js
// primitives. The shared eye/brow/lid/mouth rig lives in FaceHead.jsx and reads the colors
// and hide-flags returned here. Coordinates are head-local: head centred at the origin with
// radius ~1, +x right, +y up, +z toward the camera.

const DEG = Math.PI / 180;

// part kinds map to three geometries in FaceHead.<Part>:
//   sphere  -> sphereGeometry(r, ws, hs, phiStart, phiLength, thetaStart, thetaLength)
//   box     -> boxGeometry(w, h, d)
//   rbox    -> drei <RoundedBox args={[w,h,d]} radius>
//   cone    -> coneGeometry(r, h, seg)          (apex +y)
//   cyl     -> cylinderGeometry(rTop, rBot, h, seg)
//   capsule -> capsuleGeometry(r, len, cap, radial)
//   torus   -> torusGeometry(r, tube, radialSeg, tubularSeg, arc)
//   circle  -> circleGeometry(r, seg)           (flat disc facing +z)
const p = (kind, opts) => ({ kind, ...opts });

// The selectable reader-face styles, in display order. Single source of truth — the Settings and
// Face Library dialogs import this so adding a style here (plus its decor3d case below) is enough.
export const FACE_STYLES = [
  'Man', 'Owl', 'Robot', 'Alien', 'Wizard', 'Cat', 'Baby', 'Skull', 'Panda', 'Frankenstein',
  'Vampire', 'Viking', 'Clown', 'Bunny', 'Dragon', 'Ninja',
  'Devil', 'Goblin', 'Pirate', 'Zombie', 'Pig', 'Bear', 'Fox', 'Mouse', 'Penguin', 'Astronaut',
  'Unicorn', 'Santa', 'Knight', 'Witch',
];

// Material surface qualities per art style (color is applied per-part). Neon emissive is
// handled in FaceHead (emissive set to each part's color).
export function artMaterial(artStyle) {
  switch ((artStyle || 'Cartoon').toLowerCase()) {
    case 'flat': return { roughness: 0.95, metalness: 0.0, flatShading: true };
    case 'sketch': return { roughness: 1.0, metalness: 0.0, flatShading: true };
    case 'neon': return { roughness: 0.35, metalness: 0.15, emissiveIntensity: 0.5 };
    case 'watercolor': return { roughness: 0.85, metalness: 0.0, transparent: true, opacity: 0.9 };
    case 'pastel': return { roughness: 0.85, metalness: 0.0 };
    case 'cartoon':
    default: return { roughness: 0.5, metalness: 0.05 };
  }
}

// Convenience builders for common decorations.
const sphere = (r, opts = {}) => p('sphere', { args: [r, 28, 24], ...opts });
const cap = (r, thetaLength, opts = {}) => p('sphere', { args: [r, 28, 18, 0, Math.PI * 2, 0, thetaLength], ...opts });

export function decor3d(style) {
  switch (style) {
    case 'Owl':
      return {
        skin: '#caa46a', stroke: '#7a5a2a', brow: '#5a3f1a', eyeScale: 1.25,
        head: { kind: 'sphere', args: [1, 32, 28], scale: [1.04, 1.0, 0.96], color: '#caa46a' },
        hideNose: true,
        extras: [
          p('cone', { args: [0.2, 0.5, 16], pos: [-0.5, 1.0, -0.1], rot: [0, 0, 18 * DEG], color: '#8a6a38' }),
          p('cone', { args: [0.2, 0.5, 16], pos: [0.5, 1.0, -0.1], rot: [0, 0, -18 * DEG], color: '#8a6a38' }),
          sphere(0.34, { pos: [-0.4, 0.14, 0.74], scale: [0.95, 1.12, 0.4], color: '#e6cfa0' }),
          sphere(0.34, { pos: [0.4, 0.14, 0.74], scale: [0.95, 1.12, 0.4], color: '#e6cfa0' }),
          p('cone', { args: [0.13, 0.34, 12], pos: [0, -0.18, 0.92], rot: [125 * DEG, 0, 0], color: '#e0a020' }),
        ],
      };
    case 'Robot':
      return {
        skin: '#b8c4cc', stroke: '#5a6a72', brow: '#3a4a52', sclera: '#dff4ff',
        hideNose: true, hideMouth: true,
        head: { kind: 'rbox', args: [1.7, 2.0, 1.6], radius: 0.2, color: '#b8c4cc', metalness: 0.7, roughness: 0.3 },
        extras: [
          p('cyl', { args: [0.04, 0.04, 0.4, 12], pos: [0, 1.2, 0], color: '#5a6a72', metalness: 0.7 }),
          sphere(0.11, { pos: [0, 1.45, 0], color: '#ff5252', emissive: '#ff2020', emissiveIntensity: 1.2 }),
          p('cyl', { args: [0.09, 0.09, 0.3, 12], pos: [-0.92, 0.1, 0], rot: [0, 0, 90 * DEG], color: '#8a9aa2', metalness: 0.6 }),
          p('cyl', { args: [0.09, 0.09, 0.3, 12], pos: [0.92, 0.1, 0], rot: [0, 0, 90 * DEG], color: '#8a9aa2', metalness: 0.6 }),
          p('box', { args: [0.7, 0.26, 0.08], pos: [0, -0.52, 0.8], color: '#3a4a52' }),
        ],
      };
    case 'Alien':
      return {
        skin: '#9fe0a0', stroke: '#3f8a4a', brow: '#2f6a3a', eyeScale: 1.55,
        hideNose: true,
        head: { kind: 'sphere', args: [1, 32, 28], scale: [0.82, 1.22, 0.82], color: '#9fe0a0' },
        extras: [],
      };
    case 'Wizard':
      return {
        skin: '#f0d2b0', stroke: '#9a6a44', brow: '#cfcfcf',
        head: { kind: 'sphere', args: [1, 32, 28], scale: [0.95, 1.05, 0.92], color: '#f0d2b0' },
        extras: [
          p('cone', { args: [0.92, 1.5, 28], pos: [0, 1.45, -0.05], color: '#2a2a6a' }),
          p('cyl', { args: [0.98, 0.98, 0.14, 28], pos: [0, 0.72, -0.02], color: '#2a2a6a' }),
          sphere(0.09, { pos: [0, 2.15, 0.1], color: '#ffd24a', emissive: '#ffd24a', emissiveIntensity: 0.6 }),
          p('cone', { args: [0.5, 0.95, 20], pos: [0, -1.05, 0.35], rot: [Math.PI, 0, 0], color: '#e8e8e8' }),
        ],
      };
    case 'Cat':
      return {
        skin: '#f4a64a', stroke: '#a8631a', brow: '#7a4410',
        hideNose: true,
        head: { kind: 'sphere', args: [1, 32, 28], scale: [1.02, 0.98, 0.96], color: '#f4a64a' },
        extras: [
          p('cone', { args: [0.24, 0.42, 16], pos: [-0.52, 0.95, 0], rot: [0, 0, 14 * DEG], color: '#f4a64a' }),
          p('cone', { args: [0.24, 0.42, 16], pos: [0.52, 0.95, 0], rot: [0, 0, -14 * DEG], color: '#f4a64a' }),
          p('cone', { args: [0.09, 0.12, 12], pos: [0, -0.3, 0.92], rot: [Math.PI, 0, 0], color: '#c0506a' }),
          p('cyl', { args: [0.012, 0.012, 0.7, 6], pos: [-0.6, -0.28, 0.6], rot: [0, 0, 95 * DEG], color: '#7a4410' }),
          p('cyl', { args: [0.012, 0.012, 0.7, 6], pos: [-0.6, -0.4, 0.6], rot: [0, 0, 85 * DEG], color: '#7a4410' }),
          p('cyl', { args: [0.012, 0.012, 0.7, 6], pos: [0.6, -0.28, 0.6], rot: [0, 0, 85 * DEG], color: '#7a4410' }),
          p('cyl', { args: [0.012, 0.012, 0.7, 6], pos: [0.6, -0.4, 0.6], rot: [0, 0, 95 * DEG], color: '#7a4410' }),
        ],
      };
    case 'Baby':
      return {
        skin: '#ffd9bf', stroke: '#d99a72', brow: '#b5793f',
        head: { kind: 'sphere', args: [1, 32, 28], scale: [1.0, 1.0, 0.95], color: '#ffd9bf' },
        extras: [
          sphere(0.18, { pos: [-0.5, -0.28, 0.72], scale: [1, 0.8, 0.5], color: '#ffb0a0' }),
          sphere(0.18, { pos: [0.5, -0.28, 0.72], scale: [1, 0.8, 0.5], color: '#ffb0a0' }),
          p('torus', { args: [0.1, 0.04, 10, 20, Math.PI * 1.4], pos: [0.08, 1.02, 0], rot: [0, 0, 40 * DEG], color: '#a86838' }),
        ],
      };
    case 'Skull':
      return {
        skin: '#ece8e0', stroke: '#9a948a', brow: '#9a948a', sclera: '#1a1a1a',
        hideNose: true, hideMouth: true,
        head: { kind: 'sphere', args: [1, 32, 28], scale: [0.95, 1.05, 0.92], color: '#ece8e0' },
        extras: [
          p('cone', { args: [0.1, 0.26, 8], pos: [0, -0.2, 0.86], rot: [Math.PI, 0, 0], color: '#1a1a1a' }),
          p('box', { args: [0.62, 0.22, 0.12], pos: [0, -0.72, 0.72], color: '#ece8e0' }),
          p('box', { args: [0.02, 0.22, 0.13], pos: [0, -0.72, 0.73], color: '#9a948a' }),
          p('box', { args: [0.02, 0.22, 0.13], pos: [-0.2, -0.72, 0.73], color: '#9a948a' }),
          p('box', { args: [0.02, 0.22, 0.13], pos: [0.2, -0.72, 0.73], color: '#9a948a' }),
        ],
      };
    case 'Panda':
      return {
        skin: '#ffffff', stroke: '#bdbdbd', brow: '#222222',
        hideNose: true,
        head: { kind: 'sphere', args: [1, 32, 28], scale: [1.04, 1.0, 0.96], color: '#ffffff' },
        extras: [
          sphere(0.28, { pos: [-0.72, 0.82, -0.1], color: '#222222' }),
          sphere(0.28, { pos: [0.72, 0.82, -0.1], color: '#222222' }),
          sphere(0.32, { pos: [-0.4, 0.1, 0.7], scale: [0.95, 1.25, 0.5], rot: [0, 0, 12 * DEG], color: '#222222' }),
          sphere(0.32, { pos: [0.4, 0.1, 0.7], scale: [0.95, 1.25, 0.5], rot: [0, 0, -12 * DEG], color: '#222222' }),
          sphere(0.1, { pos: [0, -0.32, 0.92], scale: [1.2, 0.9, 0.8], color: '#222222' }),
        ],
      };
    case 'Frankenstein':
      return {
        skin: '#9cc49a', stroke: '#4a6a48', brow: '#1a1a1a',
        head: { kind: 'rbox', args: [1.7, 2.0, 1.5], radius: 0.14, color: '#9cc49a' },
        extras: [
          p('box', { args: [1.74, 0.42, 1.54], pos: [0, 0.92, 0], color: '#1a1a1a' }),
          p('cyl', { args: [0.1, 0.1, 0.36, 12], pos: [-0.96, -0.3, 0], rot: [0, 0, 90 * DEG], color: '#888888', metalness: 0.6 }),
          p('cyl', { args: [0.1, 0.1, 0.36, 12], pos: [0.96, -0.3, 0], rot: [0, 0, 90 * DEG], color: '#888888', metalness: 0.6 }),
        ],
      };
    case 'Vampire':
      return {
        skin: '#e8e0e6', stroke: '#9a8a96', brow: '#1a0a14',
        head: { kind: 'sphere', args: [1, 32, 28], scale: [0.92, 1.12, 0.9], color: '#e8e0e6' },
        extras: [
          // Widow's-peak hair shell, enveloping the taller head so the scalp can't poke through.
          cap(1.0, 0.98, { scale: [0.97, 1.19, 0.95], pos: [0, 0, -0.02], color: '#1a0a14' }),
          p('cone', { args: [0.05, 0.18, 8], pos: [-0.12, -0.62, 0.72], rot: [Math.PI, 0, 0], color: '#ffffff' }),
          p('cone', { args: [0.05, 0.18, 8], pos: [0.12, -0.62, 0.72], rot: [Math.PI, 0, 0], color: '#ffffff' }),
        ],
      };
    case 'Viking':
      return {
        skin: '#f0c89a', stroke: '#a8743a', brow: '#8a5a28',
        head: { kind: 'sphere', args: [1, 32, 28], scale: [0.95, 1.0, 0.92], color: '#f0c89a' },
        extras: [
          cap(1.05, 0.85, { pos: [0, 0.15, 0], color: '#9aa0a8', metalness: 0.6, roughness: 0.4 }),
          p('cone', { args: [0.16, 0.5, 14], pos: [-0.85, 0.55, 0], rot: [0, 0, 55 * DEG], color: '#efe8d8' }),
          p('cone', { args: [0.16, 0.5, 14], pos: [0.85, 0.55, 0], rot: [0, 0, -55 * DEG], color: '#efe8d8' }),
          p('cone', { args: [0.52, 0.95, 20], pos: [0, -1.0, 0.3], rot: [Math.PI, 0, 0], color: '#c8862a' }),
        ],
      };
    case 'Clown':
      return {
        skin: '#fff4ee', stroke: '#d0a090', brow: '#c02020',
        hideNose: true,
        head: { kind: 'sphere', args: [1, 32, 28], scale: [0.95, 1.02, 0.92], color: '#fff4ee' },
        extras: [
          sphere(0.34, { pos: [-0.85, 0.5, -0.1], color: '#ff3030' }),
          sphere(0.34, { pos: [0.85, 0.5, -0.1], color: '#3060ff' }),
          sphere(0.3, { pos: [0, 1.05, -0.1], color: '#30c030' }),
          sphere(0.19, { pos: [0, -0.25, 0.95], color: '#ff2020', emissive: '#ff2020', emissiveIntensity: 0.25 }),
          sphere(0.16, { pos: [-0.5, -0.2, 0.74], scale: [1, 0.8, 0.5], color: '#ff6060' }),
          sphere(0.16, { pos: [0.5, -0.2, 0.74], scale: [1, 0.8, 0.5], color: '#ff6060' }),
        ],
      };
    case 'Bunny':
      return {
        skin: '#fff7f2', stroke: '#e0b8c0', brow: '#c89aa2',
        hideNose: true, hideMouth: true,
        head: { kind: 'sphere', args: [1, 32, 28], scale: [0.9, 0.98, 0.9], color: '#fff7f2' },
        extras: [
          p('capsule', { args: [0.13, 0.7, 6, 12], pos: [-0.3, 1.35, -0.05], rot: [0, 0, 8 * DEG], color: '#fff7f2' }),
          p('capsule', { args: [0.13, 0.7, 6, 12], pos: [0.3, 1.35, -0.05], rot: [0, 0, -8 * DEG], color: '#fff7f2' }),
          p('capsule', { args: [0.06, 0.5, 6, 10], pos: [-0.3, 1.35, 0.04], rot: [0, 0, 8 * DEG], color: '#ffd0d8' }),
          p('capsule', { args: [0.06, 0.5, 6, 10], pos: [0.3, 1.35, 0.04], rot: [0, 0, -8 * DEG], color: '#ffd0d8' }),
          p('cone', { args: [0.08, 0.1, 12], pos: [0, -0.28, 0.9], rot: [Math.PI, 0, 0], color: '#e878a0' }),
          p('box', { args: [0.14, 0.18, 0.08], pos: [0, -0.52, 0.82], color: '#ffffff' }),
        ],
      };
    case 'Dragon':
      return {
        skin: '#5aa84a', stroke: '#2f6a24', brow: '#1f4a18',
        hideNose: true,
        head: { kind: 'sphere', args: [1, 32, 28], scale: [1.0, 0.95, 1.0], color: '#5aa84a' },
        extras: [
          p('cone', { args: [0.13, 0.5, 14], pos: [-0.45, 0.95, -0.25], rot: [-25 * DEG, 0, 16 * DEG], color: '#d8c89a' }),
          p('cone', { args: [0.13, 0.5, 14], pos: [0.45, 0.95, -0.25], rot: [-25 * DEG, 0, -16 * DEG], color: '#d8c89a' }),
          sphere(0.45, { pos: [0, -0.5, 0.72], scale: [1.05, 0.8, 0.95], color: '#6fc05a' }),
          sphere(0.05, { pos: [-0.16, -0.42, 1.05], color: '#1f4a18' }),
          sphere(0.05, { pos: [0.16, -0.42, 1.05], color: '#1f4a18' }),
        ],
      };
    case 'Ninja':
      return {
        skin: '#2a2a32', stroke: '#15151a', brow: '#2a2a32',
        hideNose: true, hideMouth: true,
        head: { kind: 'sphere', args: [1, 32, 28], scale: [0.98, 1.05, 0.94], color: '#2a2a32' },
        extras: [
          p('torus', { args: [1.0, 0.17, 12, 28], pos: [0, 0.28, 0], rot: [Math.PI / 2, 0, 0], color: '#e0c8a0' }),
          p('box', { args: [0.22, 0.18, 0.16], pos: [0.98, 0.34, -0.35], color: '#c8a878' }),
          p('cone', { args: [0.08, 0.5, 8], pos: [1.05, 0.05, -0.5], rot: [0, 0, 50 * DEG], color: '#c8a878' }),
        ],
      };
    case 'Devil':
      return {
        skin: '#c0392b', stroke: '#7a1f16', brow: '#3a0a06',
        head: { kind: 'sphere', args: [1, 32, 28], scale: [0.95, 1.05, 0.92], color: '#c0392b' },
        extras: [
          p('cone', { args: [0.16, 0.55, 14], pos: [-0.45, 1.02, -0.05], rot: [0, 0, 28 * DEG], color: '#8a2018' }),
          p('cone', { args: [0.16, 0.55, 14], pos: [0.45, 1.02, -0.05], rot: [0, 0, -28 * DEG], color: '#8a2018' }),
          p('cone', { args: [0.18, 0.5, 14], pos: [0, -1.05, 0.4], rot: [Math.PI, 0, 0], color: '#3a0a06' }), // goatee
        ],
      };
    case 'Goblin':
      return {
        skin: '#86b04a', stroke: '#46641f', brow: '#2c4414',
        hideNose: true,
        head: { kind: 'sphere', args: [1, 32, 28], scale: [1.0, 0.98, 0.95], color: '#86b04a' },
        extras: [
          p('cone', { args: [0.2, 0.85, 14], pos: [-0.98, 0.32, 0], rot: [0, 0, 102 * DEG], color: '#86b04a' }), // big ear
          p('cone', { args: [0.2, 0.85, 14], pos: [0.98, 0.32, 0], rot: [0, 0, -102 * DEG], color: '#86b04a' }),
          p('cone', { args: [0.09, 0.3, 12], pos: [-0.3, 1.0, -0.05], rot: [0, 0, 16 * DEG], color: '#5a7a30' }), // horn
          p('cone', { args: [0.09, 0.3, 12], pos: [0.3, 1.0, -0.05], rot: [0, 0, -16 * DEG], color: '#5a7a30' }),
          p('cone', { args: [0.12, 0.34, 10], pos: [0, -0.12, 0.92], rot: [125 * DEG, 0, 0], color: '#6a8a36' }), // hooked nose
        ],
      };
    case 'Pirate':
      return {
        skin: '#e8b88a', stroke: '#9b643c', brow: '#3a2a1a',
        head: { kind: 'sphere', args: [1, 32, 28], scale: [0.95, 1.06, 0.92], color: '#e8b88a' },
        extras: [
          cap(1.02, 0.72, { pos: [0, 0.2, 0], color: '#c0392b' }), // bandana
          p('box', { args: [0.36, 0.32, 0.06], pos: [0.4, 0.14, 0.9], color: '#1a1a1a' }), // eyepatch
          p('box', { args: [1.7, 0.05, 0.05], pos: [0, 0.32, 0.8], rot: [0, 0, -8 * DEG], color: '#1a1a1a' }), // strap
          p('torus', { args: [0.1, 0.025, 8, 16], pos: [-0.96, -0.28, 0], rot: [0, 90 * DEG, 0], color: '#e0b020', metalness: 0.6 }), // earring
        ],
      };
    case 'Zombie':
      return {
        skin: '#8fae7a', stroke: '#3a5a30', brow: '#2a3a20', sclera: '#e8e8c0',
        head: { kind: 'sphere', args: [1, 32, 28], scale: [0.97, 1.04, 0.9], color: '#8fae7a' },
        extras: [
          cap(1.0, 0.55, { pos: [0, 0.4, 0], color: '#3a4a28' }), // patchy hair
          p('box', { args: [0.3, 0.03, 0.04], pos: [-0.35, 0.78, 0.78], rot: [0, 0, -20 * DEG], color: '#2a3a20' }), // stitch line
          p('box', { args: [0.03, 0.16, 0.05], pos: [-0.44, 0.79, 0.79], color: '#2a3a20' }),
          p('box', { args: [0.03, 0.16, 0.05], pos: [-0.26, 0.77, 0.79], color: '#2a3a20' }),
          sphere(0.12, { pos: [0.5, -0.36, 0.78], scale: [1, 0.8, 0.4], color: '#6a8a52' }), // decay patch
        ],
      };
    case 'Pig':
      return {
        skin: '#ffb6c1', stroke: '#d98a98', brow: '#c07080',
        hideNose: true,
        head: { kind: 'sphere', args: [1, 32, 28], scale: [1.04, 0.98, 0.96], color: '#ffb6c1' },
        extras: [
          p('cyl', { args: [0.24, 0.24, 0.16, 18], pos: [0, -0.12, 0.94], rot: [90 * DEG, 0, 0], color: '#ff9aa8' }), // snout
          sphere(0.045, { pos: [-0.1, -0.12, 1.05], color: '#c06070' }), // nostril
          sphere(0.045, { pos: [0.1, -0.12, 1.05], color: '#c06070' }),
          p('cone', { args: [0.22, 0.34, 4], pos: [-0.5, 0.92, 0.1], rot: [20 * DEG, 0, 18 * DEG], color: '#ffb6c1' }), // ear
          p('cone', { args: [0.22, 0.34, 4], pos: [0.5, 0.92, 0.1], rot: [20 * DEG, 0, -18 * DEG], color: '#ffb6c1' }),
        ],
      };
    case 'Bear':
      return {
        skin: '#a9744f', stroke: '#6a4428', brow: '#3a2414',
        hideNose: true,
        head: { kind: 'sphere', args: [1, 32, 28], scale: [1.02, 0.98, 0.96], color: '#a9744f' },
        extras: [
          sphere(0.32, { pos: [-0.66, 0.86, -0.05], color: '#a9744f' }), // ear
          sphere(0.32, { pos: [0.66, 0.86, -0.05], color: '#a9744f' }),
          sphere(0.17, { pos: [-0.66, 0.86, 0.12], color: '#caa07a' }), // inner ear
          sphere(0.17, { pos: [0.66, 0.86, 0.12], color: '#caa07a' }),
          sphere(0.34, { pos: [0, -0.34, 0.82], scale: [1.0, 0.85, 0.7], color: '#d8b48a' }), // muzzle
          sphere(0.12, { pos: [0, -0.16, 1.05], scale: [1.3, 0.9, 0.8], color: '#2a1a12' }), // nose
        ],
      };
    case 'Fox':
      return {
        skin: '#e8772e', stroke: '#a8521a', brow: '#7a3a10',
        hideNose: true,
        head: { kind: 'sphere', args: [1, 32, 28], scale: [1.0, 0.96, 1.0], color: '#e8772e' },
        extras: [
          p('cone', { args: [0.26, 0.62, 14], pos: [-0.5, 1.0, -0.05], rot: [0, 0, 12 * DEG], color: '#e8772e' }), // ear
          p('cone', { args: [0.26, 0.62, 14], pos: [0.5, 1.0, -0.05], rot: [0, 0, -12 * DEG], color: '#e8772e' }),
          p('cone', { args: [0.12, 0.28, 12], pos: [-0.5, 1.14, 0.0], rot: [0, 0, 12 * DEG], color: '#2a1a12' }), // ear tip
          p('cone', { args: [0.12, 0.28, 12], pos: [0.5, 1.14, 0.0], rot: [0, 0, -12 * DEG], color: '#2a1a12' }),
          sphere(0.3, { pos: [0, -0.42, 0.8], scale: [0.9, 0.85, 0.95], color: '#fff4ee' }), // white snout
          sphere(0.09, { pos: [0, -0.28, 1.05], scale: [1.2, 0.9, 0.8], color: '#2a1a12' }), // nose
        ],
      };
    case 'Mouse':
      return {
        skin: '#b8b8c0', stroke: '#8a8a92', brow: '#5a5a62',
        hideNose: true,
        head: { kind: 'sphere', args: [1, 32, 28], scale: [0.98, 0.98, 0.95], color: '#b8b8c0' },
        extras: [
          sphere(0.44, { pos: [-0.72, 0.82, -0.1], scale: [1, 1, 0.45], color: '#b8b8c0' }), // big round ear
          sphere(0.44, { pos: [0.72, 0.82, -0.1], scale: [1, 1, 0.45], color: '#b8b8c0' }),
          sphere(0.3, { pos: [-0.72, 0.82, 0.02], scale: [1, 1, 0.45], color: '#f0b8c8' }), // inner ear
          sphere(0.3, { pos: [0.72, 0.82, 0.02], scale: [1, 1, 0.45], color: '#f0b8c8' }),
          sphere(0.08, { pos: [0, -0.2, 1.0], color: '#e87090' }), // pink nose
        ],
      };
    case 'Penguin':
      return {
        skin: '#2a2a32', stroke: '#15151a', brow: '#2a2a32',
        hideNose: true,
        head: { kind: 'sphere', args: [1, 32, 28], scale: [0.98, 1.0, 0.95], color: '#2a2a32' },
        extras: [
          sphere(0.72, { pos: [0, -0.05, 0.45], scale: [0.95, 1.0, 0.5], color: '#fafafa' }), // white face patch
          p('cone', { args: [0.16, 0.42, 14], pos: [0, -0.2, 0.92], rot: [100 * DEG, 0, 0], color: '#f0a020' }), // beak
        ],
      };
    case 'Astronaut':
      return {
        skin: '#ffd5aa', stroke: '#9b643c', brow: '#231608',
        head: { kind: 'sphere', args: [1, 32, 28], scale: [0.95, 1.05, 0.92], color: '#ffd5aa' },
        extras: [
          sphere(1.32, { opacity: 0.2, color: '#bfe0ff', metalness: 0.1, roughness: 0.1 }), // glass helmet
          p('torus', { args: [0.95, 0.12, 12, 28], pos: [0, -0.95, 0], rot: [Math.PI / 2, 0, 0], color: '#e8e8ec', metalness: 0.4 }), // neck ring
          p('cyl', { args: [0.03, 0.03, 0.3, 8], pos: [0.7, 1.16, -0.2], color: '#cccccc', metalness: 0.5 }), // antenna
          sphere(0.06, { pos: [0.7, 1.33, -0.2], color: '#ff5252', emissive: '#ff2020', emissiveIntensity: 1.0 }), // tip
        ],
      };
    case 'Unicorn':
      return {
        skin: '#fbefff', stroke: '#d8a0c0', brow: '#c890b0',
        hideNose: true,
        head: { kind: 'sphere', args: [1, 32, 28], scale: [0.96, 1.04, 0.95], color: '#fbefff' },
        extras: [
          p('cone', { args: [0.12, 0.62, 16], pos: [0, 1.12, 0.2], rot: [-12 * DEG, 0, 0], color: '#ffd24a', metalness: 0.3 }), // horn
          p('cone', { args: [0.14, 0.32, 12], pos: [-0.45, 0.98, -0.05], rot: [0, 0, 16 * DEG], color: '#fbefff' }), // ear
          p('cone', { args: [0.14, 0.32, 12], pos: [0.45, 0.98, -0.05], rot: [0, 0, -16 * DEG], color: '#fbefff' }),
          sphere(0.16, { pos: [-0.2, 1.0, -0.4], color: '#ff8ac0' }), // mane tufts
          sphere(0.16, { pos: [0.2, 1.05, -0.45], color: '#8ac0ff' }),
          sphere(0.16, { pos: [0, 0.95, -0.5], color: '#b0ff8a' }),
        ],
      };
    case 'Santa':
      return {
        skin: '#ffcaa0', stroke: '#b07050', brow: '#d8d8d8',
        head: { kind: 'sphere', args: [1, 32, 28], scale: [0.95, 1.05, 0.92], color: '#ffcaa0' },
        extras: [
          p('cone', { args: [0.92, 1.3, 24], pos: [0.18, 1.5, -0.05], rot: [0, 0, -16 * DEG], color: '#c0392b' }), // hat
          p('cyl', { args: [1.0, 1.0, 0.22, 28], pos: [0, 0.78, 0], color: '#fafafa' }), // trim
          sphere(0.18, { pos: [0.66, 2.0, -0.05], color: '#fafafa' }), // pompom
          p('cone', { args: [0.6, 1.0, 22], pos: [0, -1.05, 0.3], rot: [Math.PI, 0, 0], color: '#fafafa' }), // beard
        ],
      };
    case 'Knight':
      return {
        skin: '#c8b89a', stroke: '#6a5a3a', brow: '#3a2a1a', sclera: '#1a1a1a',
        hideNose: true,
        head: { kind: 'sphere', args: [1, 32, 28], scale: [0.95, 1.05, 0.92], color: '#c8b89a' },
        extras: [
          cap(1.06, 0.95, { pos: [0, 0.18, 0], color: '#9aa0a8', metalness: 0.6, roughness: 0.35 }), // helmet dome
          p('box', { args: [0.16, 1.1, 0.16], pos: [0, 0.0, 0.92], color: '#9aa0a8', metalness: 0.6 }), // nose guard
          p('box', { args: [1.7, 0.12, 0.3], pos: [0, 0.36, 0.78], color: '#8a9098', metalness: 0.6 }), // brow band
          p('cone', { args: [0.12, 0.7, 12], pos: [0, 1.55, -0.1], color: '#c0392b' }), // plume
        ],
      };
    case 'Witch':
      return {
        skin: '#9fce7a', stroke: '#4f7a30', brow: '#2c4414',
        head: { kind: 'sphere', args: [1, 32, 28], scale: [0.95, 1.04, 0.92], color: '#9fce7a' },
        extras: [
          p('cone', { args: [0.78, 1.7, 24], pos: [0.1, 1.7, -0.05], rot: [0, 0, -10 * DEG], color: '#1a1430' }), // tall pointy hat
          p('cyl', { args: [1.25, 1.25, 0.1, 28], pos: [0, 0.78, -0.02], color: '#1a1430' }), // brim
          p('torus', { args: [0.42, 0.06, 8, 20], pos: [0, 0.84, 0.0], rot: [Math.PI / 2, 0, 0], color: '#7a30c0' }), // hat band
          sphere(0.07, { pos: [0.32, -0.5, 0.84], color: '#6a8a36' }), // wart
        ],
      };
    case 'Man':
    default:
      return {
        skin: '#ffd5aa', stroke: '#9b643c', brow: '#231608',
        head: { kind: 'sphere', args: [1, 32, 28], scale: [0.95, 1.08, 0.92], color: '#ffd5aa' },
        extras: [
          // Hair shell must sit OUTSIDE the (taller) head scale or the scalp pokes through.
          cap(1.0, 1.04, { scale: [1.0, 1.13, 0.97], pos: [0, 0.0, -0.02], color: '#231608' }),
          sphere(0.16, { pos: [-0.95, 0.0, 0], scale: [0.7, 1, 0.9], color: '#ffd5aa' }),
          sphere(0.16, { pos: [0.95, 0.0, 0], scale: [0.7, 1, 0.9], color: '#ffd5aa' }),
        ],
      };
  }
}
