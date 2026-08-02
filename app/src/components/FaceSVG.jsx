import { faceExpression, lidPoints, browPoints, mouthPath, irisColor, RIG } from '../engine/faceExpression.js';

// Procedural animated reader face (2D SVG). This is the original flat renderer, kept as a
// graceful fallback for the WebGL 3D face (see Face.jsx / FaceHead.jsx) and used for the
// many-thumbnail grid in the Face Library dialog. The eye/brow/lid/mouth "rig" is shared
// across every style and animates with WPM; each FaceStyle layers distinctive decorations.

const { LCx, RCx, ECy, ScR, IrisR, PupilR, GlowR } = RIG;

// ── Per-style decoration table ──────────────────────────────────────────────
function decor(style) {
  const E = (key, props) => <ellipse key={key} {...props} />;
  const R = (key, props) => <rect key={key} {...props} />;
  const P = (key, props) => <polygon key={key} {...props} />;
  const L = (key, props) => <polyline key={key} {...props} />;
  const PATH = (key, props) => <path key={key} {...props} />;

  switch (style) {
    case 'Owl':
      return {
        skin: '#caa46a', stroke: '#7a5a2a', brow: '#5a3f1a',
        bg: [
          P('tuftL', { points: '14,18 30,2 40,26', fill: '#8a6a38' }),
          P('tuftR', { points: '116,18 100,2 90,26', fill: '#8a6a38' }),
          E('head', { cx: 65, cy: 88, rx: 60, ry: 72, fill: '#caa46a', stroke: '#7a5a2a', strokeWidth: 2.5 }),
          E('discL', { cx: 37, cy: 82, rx: 26, ry: 30, fill: '#e6cfa0', stroke: '#7a5a2a', strokeWidth: 1.5 }),
          E('discR', { cx: 93, cy: 82, rx: 26, ry: 30, fill: '#e6cfa0', stroke: '#7a5a2a', strokeWidth: 1.5 }),
        ],
        fg: [P('beak', { points: '65,108 58,120 72,120', fill: '#e0a020', stroke: '#9a6a10', strokeWidth: 1 })],
        hideNose: true,
      };
    case 'Robot':
      return {
        skin: '#b8c4cc', stroke: '#5a6a72', brow: '#3a4a52',
        sclera: '#dff4ff',
        bg: [
          L('ant', { points: '65,2 65,16', stroke: '#5a6a72', strokeWidth: 2, fill: 'none' }),
          E('antBulb', { cx: 65, cy: 2, rx: 4, ry: 4, fill: '#ff5252' }),
          R('head', { x: 10, y: 16, width: 110, height: 134, rx: 12, fill: '#b8c4cc', stroke: '#5a6a72', strokeWidth: 2.5 }),
          R('boltL', { x: 4, y: 70, width: 8, height: 24, rx: 2, fill: '#8a9aa2' }),
          R('boltR', { x: 118, y: 70, width: 8, height: 24, rx: 2, fill: '#8a9aa2' }),
        ],
        fg: [
          R('mouthGrille', { x: 46, y: 122, width: 38, height: 14, rx: 2, fill: 'none', stroke: '#5a6a72', strokeWidth: 1.5 }),
          L('g1', { points: '56,122 56,136', stroke: '#5a6a72', strokeWidth: 1, fill: 'none' }),
          L('g2', { points: '65,122 65,136', stroke: '#5a6a72', strokeWidth: 1, fill: 'none' }),
          L('g3', { points: '74,122 74,136', stroke: '#5a6a72', strokeWidth: 1, fill: 'none' }),
        ],
        hideNose: true, hideMouth: true,
      };
    case 'Alien':
      return {
        skin: '#9fe0a0', stroke: '#3f8a4a',
        brow: '#2f6a3a',
        bg: [PATH('head', { d: 'M65,2 C112,2 124,60 100,118 C88,150 42,150 30,118 C6,60 18,2 65,2 Z', fill: '#9fe0a0', stroke: '#3f8a4a', strokeWidth: 2.5 })],
        fg: [L('mouthA', { points: '54,134 65,138 76,134', stroke: '#3f8a4a', strokeWidth: 1.5, fill: 'none' })],
        hideNose: true,
      };
    case 'Wizard':
      return {
        skin: '#f0d2b0', stroke: '#9a6a44', brow: '#cfcfcf',
        bg: [
          E('head', { cx: 65, cy: 80, rx: 56, ry: 66, fill: '#f0d2b0', stroke: '#9a6a44', strokeWidth: 2.5 }),
          P('hat', { points: '65,-30 30,40 100,40', fill: '#2a2a6a', stroke: '#1a1a4a', strokeWidth: 2 }),
          R('hatBrim', { x: 22, y: 38, width: 86, height: 10, rx: 4, fill: '#2a2a6a' }),
          E('star', { cx: 65, cy: 8, rx: 4, ry: 4, fill: '#ffd24a' }),
        ],
        fg: [PATH('beard', { d: 'M40,118 C45,170 85,170 90,118 C80,140 50,140 40,118 Z', fill: '#e8e8e8', stroke: '#c0c0c0', strokeWidth: 1 })],
      };
    case 'Cat':
      return {
        skin: '#f4a64a', stroke: '#a8631a', brow: '#7a4410',
        bg: [
          P('earL', { points: '14,30 6,0 44,22', fill: '#f4a64a', stroke: '#a8631a', strokeWidth: 1.5 }),
          P('earR', { points: '116,30 124,0 86,22', fill: '#f4a64a', stroke: '#a8631a', strokeWidth: 1.5 }),
          E('head', { cx: 65, cy: 88, rx: 58, ry: 64, fill: '#f4a64a', stroke: '#a8631a', strokeWidth: 2.5 }),
        ],
        fg: [
          P('nose', { points: '60,116 70,116 65,122', fill: '#c0506a' }),
          L('whL1', { points: '40,118 4,112', stroke: '#7a4410', strokeWidth: 1, fill: 'none' }),
          L('whL2', { points: '40,124 6,128', stroke: '#7a4410', strokeWidth: 1, fill: 'none' }),
          L('whR1', { points: '90,118 126,112', stroke: '#7a4410', strokeWidth: 1, fill: 'none' }),
          L('whR2', { points: '90,124 124,128', stroke: '#7a4410', strokeWidth: 1, fill: 'none' }),
        ],
        hideNose: true,
      };
    case 'Baby':
      return {
        skin: '#ffd9bf', stroke: '#d99a72', brow: '#b5793f',
        bg: [
          E('head', { cx: 65, cy: 90, rx: 56, ry: 64, fill: '#ffd9bf', stroke: '#d99a72', strokeWidth: 2.5 }),
          PATH('curl', { d: 'M65,28 q12,-14 2,-22', fill: 'none', stroke: '#a86838', strokeWidth: 3 }),
          E('cheekL', { cx: 30, cy: 108, rx: 9, ry: 7, fill: '#ffb0a0', opacity: 0.7 }),
          E('cheekR', { cx: 100, cy: 108, rx: 9, ry: 7, fill: '#ffb0a0', opacity: 0.7 }),
        ],
        fg: [],
      };
    case 'Skull':
      return {
        skin: '#ece8e0', stroke: '#9a948a', brow: '#9a948a', sclera: '#1a1a1a',
        bg: [
          PATH('skull', { d: 'M65,6 C108,6 120,48 116,86 C113,112 102,120 96,140 L34,140 C28,120 17,112 14,86 C10,48 22,6 65,6 Z', fill: '#ece8e0', stroke: '#9a948a', strokeWidth: 2 }),
          E('socketL', { cx: 37, cy: 82, rx: 19, ry: 21, fill: '#1a1a1a' }),
          E('socketR', { cx: 93, cy: 82, rx: 19, ry: 21, fill: '#1a1a1a' }),
          P('nasal', { points: '65,104 59,118 71,118', fill: '#1a1a1a' }),
        ],
        fg: [
          R('teeth', { x: 44, y: 138, width: 42, height: 18, fill: '#ece8e0', stroke: '#9a948a', strokeWidth: 1 }),
          L('t1', { points: '54,138 54,156', stroke: '#9a948a', strokeWidth: 1, fill: 'none' }),
          L('t2', { points: '65,138 65,156', stroke: '#9a948a', strokeWidth: 1, fill: 'none' }),
          L('t3', { points: '76,138 76,156', stroke: '#9a948a', strokeWidth: 1, fill: 'none' }),
        ],
        hideNose: true, hideMouth: true,
      };
    case 'Panda':
      return {
        skin: '#ffffff', stroke: '#bdbdbd', brow: '#222',
        bg: [
          E('earL', { cx: 22, cy: 30, rx: 16, ry: 16, fill: '#222' }),
          E('earR', { cx: 108, cy: 30, rx: 16, ry: 16, fill: '#222' }),
          E('head', { cx: 65, cy: 88, rx: 60, ry: 66, fill: '#fff', stroke: '#bdbdbd', strokeWidth: 2 }),
          E('patchL', { cx: 37, cy: 84, rx: 18, ry: 24, fill: '#222', transform: 'rotate(-12 37 84)' }),
          E('patchR', { cx: 93, cy: 84, rx: 18, ry: 24, fill: '#222', transform: 'rotate(12 93 84)' }),
        ],
        fg: [E('nose', { cx: 65, cy: 116, rx: 7, ry: 5, fill: '#222' })],
        hideNose: true,
      };
    case 'Frankenstein':
      return {
        skin: '#9cc49a', stroke: '#4a6a48', brow: '#1a1a1a',
        bg: [
          R('hair', { x: 8, y: 8, width: 114, height: 24, fill: '#1a1a1a' }),
          R('head', { x: 8, y: 26, width: 114, height: 128, rx: 8, fill: '#9cc49a', stroke: '#4a6a48', strokeWidth: 2.5 }),
          R('boltL', { x: 0, y: 92, width: 12, height: 8, rx: 2, fill: '#888' }),
          R('boltR', { x: 118, y: 92, width: 12, height: 8, rx: 2, fill: '#888' }),
        ],
        fg: [
          L('stitch', { points: '40,150 44,144 48,150 52,144 56,150', stroke: '#3a4a38', strokeWidth: 1, fill: 'none' }),
          PATH('scar', { d: 'M100,40 l0,22 M96,46 l8,0 M96,54 l8,0', stroke: '#4a6a48', strokeWidth: 1, fill: 'none' }),
        ],
      };
    case 'Vampire':
      return {
        skin: '#e8e0e6', stroke: '#9a8a96', brow: '#1a0a14',
        bg: [
          PATH('hair', { d: 'M8,40 C8,8 40,4 65,4 C90,4 122,8 122,40 L122,24 L70,30 L65,16 L60,30 L8,24 Z', fill: '#1a0a14' }),
          E('head', { cx: 65, cy: 86, rx: 54, ry: 68, fill: '#e8e0e6', stroke: '#9a8a96', strokeWidth: 2 }),
        ],
        fg: [
          P('fangL', { points: '56,132 60,132 58,142', fill: '#fff' }),
          P('fangR', { points: '70,132 74,132 72,142', fill: '#fff' }),
        ],
      };
    case 'Viking':
      return {
        skin: '#f0c89a', stroke: '#a8743a', brow: '#8a5a28',
        bg: [
          E('head', { cx: 65, cy: 92, rx: 54, ry: 60, fill: '#f0c89a', stroke: '#a8743a', strokeWidth: 2.5 }),
          PATH('helm', { d: 'M14,58 C14,18 116,18 116,58 Z', fill: '#9aa0a8', stroke: '#6a7078', strokeWidth: 2 }),
          R('helmBand', { x: 12, y: 54, width: 106, height: 10, fill: '#7a8088' }),
          PATH('hornL', { d: 'M16,56 C-6,44 -2,18 14,22 C8,34 10,48 24,52 Z', fill: '#efe8d8', stroke: '#c8bfa8', strokeWidth: 1 }),
          PATH('hornR', { d: 'M114,56 C136,44 132,18 116,22 C122,34 120,48 106,52 Z', fill: '#efe8d8', stroke: '#c8bfa8', strokeWidth: 1 }),
        ],
        fg: [PATH('beard', { d: 'M34,120 C40,168 90,168 96,120 C80,148 50,148 34,120 Z', fill: '#c8862a', stroke: '#a8743a', strokeWidth: 1 })],
      };
    case 'Clown':
      return {
        skin: '#fff4ee', stroke: '#d0a090', brow: '#c02020',
        bg: [
          E('hairL', { cx: 18, cy: 56, rx: 18, ry: 18, fill: '#ff3030' }),
          E('hairR', { cx: 112, cy: 56, rx: 18, ry: 18, fill: '#3060ff' }),
          E('hairM', { cx: 65, cy: 30, rx: 16, ry: 16, fill: '#30c030' }),
          E('head', { cx: 65, cy: 90, rx: 52, ry: 62, fill: '#fff4ee', stroke: '#d0a090', strokeWidth: 2 }),
          E('cheekL', { cx: 30, cy: 104, rx: 10, ry: 8, fill: '#ff6060', opacity: 0.7 }),
          E('cheekR', { cx: 100, cy: 104, rx: 10, ry: 8, fill: '#ff6060', opacity: 0.7 }),
        ],
        fg: [E('nose', { cx: 65, cy: 112, rx: 9, ry: 9, fill: '#ff2020', stroke: '#b01010', strokeWidth: 1 })],
        hideNose: true,
      };
    case 'Bunny':
      return {
        skin: '#fff7f2', stroke: '#e0b8c0', brow: '#c89aa2',
        bg: [
          E('earL', { cx: 44, cy: 16, rx: 11, ry: 34, fill: '#fff7f2', stroke: '#e0b8c0', strokeWidth: 1.5 }),
          E('earLin', { cx: 44, cy: 18, rx: 5, ry: 24, fill: '#ffd0d8' }),
          E('earR', { cx: 86, cy: 16, rx: 11, ry: 34, fill: '#fff7f2', stroke: '#e0b8c0', strokeWidth: 1.5 }),
          E('earRin', { cx: 86, cy: 18, rx: 5, ry: 24, fill: '#ffd0d8' }),
          E('head', { cx: 65, cy: 96, rx: 52, ry: 56, fill: '#fff7f2', stroke: '#e0b8c0', strokeWidth: 2.5 }),
        ],
        fg: [
          P('nose', { points: '61,116 69,116 65,121', fill: '#e878a0' }),
          R('teeth', { x: 60, y: 124, width: 10, height: 12, rx: 2, fill: '#fff', stroke: '#ddd', strokeWidth: 0.8 }),
          L('teethSplit', { points: '65,124 65,136', stroke: '#ddd', strokeWidth: 0.8, fill: 'none' }),
        ],
        hideNose: true, hideMouth: true,
      };
    case 'Dragon':
      return {
        skin: '#5aa84a', stroke: '#2f6a24', brow: '#1f4a18',
        bg: [
          PATH('hornL', { d: 'M22,30 C8,8 30,2 34,20 Z', fill: '#d8c89a', stroke: '#a89a6a', strokeWidth: 1 }),
          PATH('hornR', { d: 'M108,30 C122,8 100,2 96,20 Z', fill: '#d8c89a', stroke: '#a89a6a', strokeWidth: 1 }),
          E('head', { cx: 65, cy: 84, rx: 56, ry: 62, fill: '#5aa84a', stroke: '#2f6a24', strokeWidth: 2.5 }),
          P('crest', { points: '65,24 60,40 70,40', fill: '#3f8a30' }),
          E('snout', { cx: 65, cy: 122, rx: 24, ry: 18, fill: '#6fc05a', stroke: '#2f6a24', strokeWidth: 1.5 }),
        ],
        fg: [
          E('nostrilL', { cx: 57, cy: 118, rx: 2.5, ry: 3.5, fill: '#1f4a18' }),
          E('nostrilR', { cx: 73, cy: 118, rx: 2.5, ry: 3.5, fill: '#1f4a18' }),
        ],
        hideNose: true,
      };
    case 'Ninja':
      return {
        skin: '#2a2a32', stroke: '#15151a', brow: '#2a2a32',
        bg: [
          E('head', { cx: 65, cy: 84, rx: 58, ry: 70, fill: '#2a2a32', stroke: '#15151a', strokeWidth: 2 }),
          R('eyeband', { x: 7, y: 66, width: 116, height: 34, fill: '#e0c8a0' }),
          R('knot', { x: 116, y: 70, width: 14, height: 10, fill: '#c8a878' }),
          L('knotTail', { points: '128,80 138,96 122,90', stroke: '#c8a878', strokeWidth: 4, fill: 'none' }),
        ],
        fg: [],
        hideNose: true, hideMouth: true,
      };
    case 'Devil':
      return {
        skin: '#c0392b', stroke: '#7a1f16', brow: '#3a0a06',
        bg: [
          P('hornL', { points: '34,24 20,-4 50,18', fill: '#8a2018', stroke: '#5a1410', strokeWidth: 1.5 }),
          P('hornR', { points: '96,24 110,-4 80,18', fill: '#8a2018', stroke: '#5a1410', strokeWidth: 1.5 }),
          E('head', { cx: 65, cy: 90, rx: 57, ry: 65, fill: '#c0392b', stroke: '#7a1f16', strokeWidth: 2.5 }),
        ],
        fg: [PATH('goatee', { d: 'M52,142 C58,166 72,166 78,142 C72,152 58,152 52,142 Z', fill: '#3a0a06' })],
      };
    case 'Goblin':
      return {
        skin: '#86b04a', stroke: '#46641f', brow: '#2c4414', hideNose: true,
        bg: [
          P('earL', { points: '14,72 -14,88 16,104', fill: '#86b04a', stroke: '#46641f', strokeWidth: 1.5 }),
          P('earR', { points: '116,72 144,88 114,104', fill: '#86b04a', stroke: '#46641f', strokeWidth: 1.5 }),
          P('hornL', { points: '46,28 40,6 58,24', fill: '#5a7a30' }),
          P('hornR', { points: '84,28 90,6 72,24', fill: '#5a7a30' }),
          E('head', { cx: 65, cy: 90, rx: 53, ry: 63, fill: '#86b04a', stroke: '#46641f', strokeWidth: 2.5 }),
        ],
        fg: [PATH('nose', { d: 'M65,104 C73,114 72,126 62,128 C70,122 67,112 65,104 Z', fill: '#6a8a36' })],
      };
    case 'Pirate':
      return {
        skin: '#e8b88a', stroke: '#9b643c', brow: '#3a2a1a',
        bg: [
          E('head', { cx: 65, cy: 90, rx: 57, ry: 65, fill: '#e8b88a', stroke: '#9b643c', strokeWidth: 2.5 }),
          PATH('bandana', { d: 'M9,56 Q65,18 121,56 L121,34 Q65,8 9,34 Z', fill: '#c0392b', stroke: '#8a2018', strokeWidth: 1.5 }),
        ],
        fg: [
          L('strap', { points: '16,72 114,84', stroke: '#1a1a1a', strokeWidth: 3, fill: 'none' }),
          E('patch', { cx: 93, cy: 82, rx: 18, ry: 15, fill: '#1a1a1a' }),
          E('earring', { cx: 11, cy: 108, rx: 6, ry: 6, fill: 'none', stroke: '#e0b020', strokeWidth: 2.5 }),
        ],
      };
    case 'Zombie':
      return {
        skin: '#8fae7a', stroke: '#3a5a30', brow: '#2a3a20', sclera: '#e8e8c0',
        bg: [
          E('head', { cx: 65, cy: 90, rx: 56, ry: 64, fill: '#8fae7a', stroke: '#3a5a30', strokeWidth: 2.5 }),
          PATH('hair', { d: 'M14,46 Q40,18 65,30 Q90,18 116,46 Q92,36 65,42 Q38,36 14,46 Z', fill: '#3a4a28' }),
        ],
        fg: [
          L('stitch', { points: '24,60 52,66', stroke: '#2a3a20', strokeWidth: 1.5, fill: 'none' }),
          L('s1', { points: '30,57 28,69', stroke: '#2a3a20', strokeWidth: 1.5 }),
          L('s2', { points: '40,59 38,71', stroke: '#2a3a20', strokeWidth: 1.5 }),
          E('decay', { cx: 96, cy: 118, rx: 10, ry: 7, fill: '#6a8a52' }),
        ],
      };
    case 'Pig':
      return {
        skin: '#ffb6c1', stroke: '#d98a98', brow: '#c07080', hideNose: true,
        bg: [
          P('earL', { points: '30,40 18,12 52,30', fill: '#ffb6c1', stroke: '#d98a98', strokeWidth: 1.5 }),
          P('earR', { points: '100,40 112,12 78,30', fill: '#ffb6c1', stroke: '#d98a98', strokeWidth: 1.5 }),
          E('head', { cx: 65, cy: 92, rx: 58, ry: 62, fill: '#ffb6c1', stroke: '#d98a98', strokeWidth: 2.5 }),
        ],
        fg: [
          E('snout', { cx: 65, cy: 116, rx: 20, ry: 14, fill: '#ff9aa8', stroke: '#d98a98', strokeWidth: 1.5 }),
          E('nos1', { cx: 58, cy: 116, rx: 3, ry: 5, fill: '#c06070' }),
          E('nos2', { cx: 72, cy: 116, rx: 3, ry: 5, fill: '#c06070' }),
        ],
      };
    case 'Bear':
      return {
        skin: '#a9744f', stroke: '#6a4428', brow: '#3a2414', hideNose: true,
        bg: [
          E('earL', { cx: 24, cy: 40, rx: 18, ry: 18, fill: '#a9744f', stroke: '#6a4428', strokeWidth: 2 }),
          E('earR', { cx: 106, cy: 40, rx: 18, ry: 18, fill: '#a9744f', stroke: '#6a4428', strokeWidth: 2 }),
          E('earLi', { cx: 24, cy: 42, rx: 9, ry: 9, fill: '#caa07a' }),
          E('earRi', { cx: 106, cy: 42, rx: 9, ry: 9, fill: '#caa07a' }),
          E('head', { cx: 65, cy: 90, rx: 57, ry: 62, fill: '#a9744f', stroke: '#6a4428', strokeWidth: 2.5 }),
        ],
        fg: [
          E('muzzle', { cx: 65, cy: 118, rx: 24, ry: 18, fill: '#d8b48a' }),
          E('nose', { cx: 65, cy: 108, rx: 9, ry: 6, fill: '#2a1a12' }),
        ],
      };
    case 'Fox':
      return {
        skin: '#e8772e', stroke: '#a8521a', brow: '#7a3a10', hideNose: true,
        bg: [
          P('earL', { points: '18,30 8,-8 50,22', fill: '#e8772e', stroke: '#a8521a', strokeWidth: 1.5 }),
          P('earR', { points: '112,30 122,-8 80,22', fill: '#e8772e', stroke: '#a8521a', strokeWidth: 1.5 }),
          P('earLt', { points: '14,8 8,-8 26,8', fill: '#2a1a12' }),
          P('earRt', { points: '116,8 122,-8 104,8', fill: '#2a1a12' }),
          E('head', { cx: 65, cy: 90, rx: 56, ry: 60, fill: '#e8772e', stroke: '#a8521a', strokeWidth: 2.5 }),
        ],
        fg: [
          E('snout', { cx: 65, cy: 120, rx: 22, ry: 18, fill: '#fff4ee' }),
          E('nose', { cx: 65, cy: 112, rx: 7, ry: 5, fill: '#2a1a12' }),
        ],
      };
    case 'Mouse':
      return {
        skin: '#b8b8c0', stroke: '#8a8a92', brow: '#5a5a62', hideNose: true,
        bg: [
          E('earL', { cx: 22, cy: 38, rx: 24, ry: 24, fill: '#b8b8c0', stroke: '#8a8a92', strokeWidth: 2 }),
          E('earR', { cx: 108, cy: 38, rx: 24, ry: 24, fill: '#b8b8c0', stroke: '#8a8a92', strokeWidth: 2 }),
          E('earLi', { cx: 22, cy: 40, rx: 13, ry: 13, fill: '#f0b8c8' }),
          E('earRi', { cx: 108, cy: 40, rx: 13, ry: 13, fill: '#f0b8c8' }),
          E('head', { cx: 65, cy: 92, rx: 55, ry: 60, fill: '#b8b8c0', stroke: '#8a8a92', strokeWidth: 2.5 }),
        ],
        fg: [E('nose', { cx: 65, cy: 112, rx: 6, ry: 5, fill: '#e87090' })],
      };
    case 'Penguin':
      return {
        skin: '#2a2a32', stroke: '#15151a', brow: '#2a2a32', hideNose: true,
        bg: [
          E('head', { cx: 65, cy: 90, rx: 56, ry: 64, fill: '#2a2a32', stroke: '#15151a', strokeWidth: 2.5 }),
          E('facePatch', { cx: 65, cy: 96, rx: 40, ry: 48, fill: '#fafafa' }),
        ],
        fg: [P('beak', { points: '54,116 76,116 65,134', fill: '#f0a020', stroke: '#c07a10', strokeWidth: 1 })],
      };
    case 'Astronaut':
      return {
        skin: '#ffd5aa', stroke: '#9b643c', brow: '#231608',
        bg: [E('head', { cx: 65, cy: 90, rx: 54, ry: 62, fill: '#ffd5aa', stroke: '#9b643c', strokeWidth: 2.5 })],
        fg: [
          L('ant', { points: '104,30 112,14', stroke: '#bbbbbb', strokeWidth: 2, fill: 'none' }),
          E('antBulb', { cx: 113, cy: 12, rx: 4, ry: 4, fill: '#ff5252' }),
          E('helmet', { cx: 65, cy: 86, rx: 64, ry: 70, fill: '#bfe0ff', opacity: 0.22, stroke: '#9ec8e8', strokeWidth: 2.5 }),
          PATH('ring', { d: 'M8,150 Q65,168 122,150', fill: 'none', stroke: '#e0e0e4', strokeWidth: 6 }),
        ],
      };
    case 'Unicorn':
      return {
        skin: '#fbefff', stroke: '#d8a0c0', brow: '#c890b0', hideNose: true,
        bg: [
          E('maneL', { cx: 24, cy: 50, rx: 12, ry: 12, fill: '#ff8ac0' }),
          E('maneM', { cx: 65, cy: 24, rx: 12, ry: 12, fill: '#8ac0ff' }),
          E('maneR', { cx: 106, cy: 50, rx: 12, ry: 12, fill: '#b0ff8a' }),
          P('horn', { points: '59,18 71,18 65,-18', fill: '#ffd24a', stroke: '#e0b020', strokeWidth: 1 }),
          P('earL', { points: '34,30 28,8 50,28', fill: '#fbefff', stroke: '#d8a0c0', strokeWidth: 1.5 }),
          P('earR', { points: '96,30 102,8 80,28', fill: '#fbefff', stroke: '#d8a0c0', strokeWidth: 1.5 }),
          E('head', { cx: 65, cy: 92, rx: 55, ry: 60, fill: '#fbefff', stroke: '#d8a0c0', strokeWidth: 2.5 }),
        ],
        fg: [],
      };
    case 'Santa':
      return {
        skin: '#ffcaa0', stroke: '#b07050', brow: '#d8d8d8',
        bg: [
          E('head', { cx: 65, cy: 92, rx: 55, ry: 60, fill: '#ffcaa0', stroke: '#b07050', strokeWidth: 2.5 }),
          P('hat', { points: '18,40 80,40 110,-16', fill: '#c0392b', stroke: '#8a2018', strokeWidth: 1.5 }),
          R('trim', { x: 14, y: 34, width: 96, height: 14, rx: 7, fill: '#fafafa' }),
          E('pompom', { cx: 110, cy: -16, rx: 9, ry: 9, fill: '#fafafa' }),
        ],
        fg: [PATH('beard', { d: 'M34,138 C40,178 90,178 96,138 C88,158 42,158 34,138 Z', fill: '#fafafa', stroke: '#dddddd', strokeWidth: 1 })],
      };
    case 'Knight':
      return {
        skin: '#c8b89a', stroke: '#6a5a3a', brow: '#3a2a1a', sclera: '#1a1a1a', hideNose: true,
        bg: [
          E('head', { cx: 65, cy: 90, rx: 55, ry: 62, fill: '#c8b89a', stroke: '#6a5a3a', strokeWidth: 2.5 }),
          PATH('dome', { d: 'M12,72 Q65,2 118,72 Z', fill: '#9aa0a8', stroke: '#6a6a72', strokeWidth: 2 }),
          L('plume', { points: '65,8 65,-22', stroke: '#c0392b', strokeWidth: 6, fill: 'none' }),
        ],
        fg: [
          R('browband', { x: 12, y: 64, width: 106, height: 12, fill: '#8a9098' }),
          R('noseguard', { x: 59, y: 70, width: 12, height: 60, rx: 3, fill: '#9aa0a8', stroke: '#6a6a72', strokeWidth: 1 }),
        ],
      };
    case 'Witch':
      return {
        skin: '#9fce7a', stroke: '#4f7a30', brow: '#2c4414',
        bg: [
          E('head', { cx: 65, cy: 92, rx: 55, ry: 60, fill: '#9fce7a', stroke: '#4f7a30', strokeWidth: 2.5 }),
          P('hat', { points: '30,36 100,36 78,-44', fill: '#1a1430', stroke: '#0a0820', strokeWidth: 1.5 }),
          E('brim', { cx: 65, cy: 38, rx: 62, ry: 12, fill: '#1a1430' }),
          R('band', { x: 42, y: 24, width: 46, height: 8, fill: '#7a30c0' }),
        ],
        fg: [E('wart', { cx: 84, cy: 120, rx: 4, ry: 4, fill: '#6a8a36' })],
      };
    case 'Frog':
      return {
        skin: '#7ec850', stroke: '#3f7a28', brow: '#2c5a18', hideNose: true,
        bg: [
          E('bumpL', { cx: 37, cy: 32, rx: 20, ry: 18, fill: '#7ec850', stroke: '#3f7a28', strokeWidth: 1.5 }),
          E('bumpR', { cx: 93, cy: 32, rx: 20, ry: 18, fill: '#7ec850', stroke: '#3f7a28', strokeWidth: 1.5 }),
          E('head', { cx: 65, cy: 92, rx: 60, ry: 62, fill: '#7ec850', stroke: '#3f7a28', strokeWidth: 2.5 }),
          E('cheekL', { cx: 26, cy: 122, rx: 13, ry: 10, fill: '#a8dc80', opacity: 0.8 }),
          E('cheekR', { cx: 104, cy: 122, rx: 13, ry: 10, fill: '#a8dc80', opacity: 0.8 }),
        ],
        fg: [
          E('nosL', { cx: 58, cy: 112, rx: 2.5, ry: 3, fill: '#2c5a18' }),
          E('nosR', { cx: 72, cy: 112, rx: 2.5, ry: 3, fill: '#2c5a18' }),
        ],
      };
    case 'Lion':
      return {
        skin: '#e8a33c', stroke: '#9a6316', brow: '#6a4410', hideNose: true,
        bg: [
          E('mane', { cx: 65, cy: 86, rx: 64, ry: 76, fill: '#b06a1a', stroke: '#8a4e10', strokeWidth: 2 }),
          E('earL', { cx: 20, cy: 26, rx: 12, ry: 12, fill: '#e8a33c', stroke: '#9a6316', strokeWidth: 1.5 }),
          E('earR', { cx: 110, cy: 26, rx: 12, ry: 12, fill: '#e8a33c', stroke: '#9a6316', strokeWidth: 1.5 }),
          E('head', { cx: 65, cy: 90, rx: 50, ry: 58, fill: '#e8a33c', stroke: '#9a6316', strokeWidth: 2.5 }),
        ],
        fg: [
          E('muzzle', { cx: 65, cy: 120, rx: 22, ry: 16, fill: '#f4c88a' }),
          E('nose', { cx: 65, cy: 111, rx: 8, ry: 5.5, fill: '#6a3a1a' }),
        ],
      };
    case 'Koala':
      return {
        skin: '#b0b4bc', stroke: '#767a84', brow: '#4a4e58', hideNose: true,
        bg: [
          E('earL', { cx: 16, cy: 46, rx: 26, ry: 26, fill: '#b0b4bc', stroke: '#767a84', strokeWidth: 2 }),
          E('earR', { cx: 114, cy: 46, rx: 26, ry: 26, fill: '#b0b4bc', stroke: '#767a84', strokeWidth: 2 }),
          E('earLi', { cx: 16, cy: 48, rx: 14, ry: 14, fill: '#e8c8d0' }),
          E('earRi', { cx: 114, cy: 48, rx: 14, ry: 14, fill: '#e8c8d0' }),
          E('head', { cx: 65, cy: 92, rx: 55, ry: 60, fill: '#b0b4bc', stroke: '#767a84', strokeWidth: 2.5 }),
        ],
        fg: [E('nose', { cx: 65, cy: 116, rx: 9, ry: 14, fill: '#2a2a2e' })],
      };
    case 'Tiger':
      return {
        skin: '#f08a2e', stroke: '#a85a14', brow: '#1a1a1a', hideNose: true,
        bg: [
          P('earL', { points: '16,32 8,2 46,24', fill: '#f08a2e', stroke: '#a85a14', strokeWidth: 1.5 }),
          P('earR', { points: '114,32 122,2 84,24', fill: '#f08a2e', stroke: '#a85a14', strokeWidth: 1.5 }),
          E('head', { cx: 65, cy: 90, rx: 57, ry: 62, fill: '#f08a2e', stroke: '#a85a14', strokeWidth: 2.5 }),
          P('stripeM', { points: '62,30 68,30 65,52', fill: '#1a1a1a' }),
          P('stripeL', { points: '42,34 50,32 49,50', fill: '#1a1a1a' }),
          P('stripeR', { points: '88,34 80,32 81,50', fill: '#1a1a1a' }),
          P('cheekL', { points: '10,96 34,100 12,108', fill: '#1a1a1a' }),
          P('cheekR', { points: '120,96 96,100 118,108', fill: '#1a1a1a' }),
        ],
        fg: [
          E('muzzle', { cx: 65, cy: 122, rx: 21, ry: 15, fill: '#fff4ee' }),
          E('nose', { cx: 65, cy: 113, rx: 6.5, ry: 4.5, fill: '#e87090' }),
        ],
      };
    case 'Ghost':
      return {
        skin: '#f4f4fb', stroke: '#a8a8c8', brow: '#8888aa', hideNose: true,
        bg: [
          PATH('body', {
            d: 'M65,6 C110,6 120,58 118,124 L106,112 L94,130 L82,114 L70,132 L58,114 L46,130 L34,112 L12,124 C10,58 20,6 65,6 Z',
            fill: '#f4f4fb', stroke: '#a8a8c8', strokeWidth: 2.5, opacity: 0.95,
          }),
        ],
        fg: [],
      };
    case 'Elf':
      return {
        skin: '#ffd9b5', stroke: '#c08a5a', brow: '#8a5a28',
        bg: [
          P('earL', { points: '14,78 -12,64 16,96', fill: '#ffd9b5', stroke: '#c08a5a', strokeWidth: 1.5 }),
          P('earR', { points: '116,78 142,64 114,96', fill: '#ffd9b5', stroke: '#c08a5a', strokeWidth: 1.5 }),
          E('head', { cx: 65, cy: 92, rx: 54, ry: 60, fill: '#ffd9b5', stroke: '#c08a5a', strokeWidth: 2.5 }),
          P('hat', { points: '18,42 96,42 108,-30', fill: '#2e8b46', stroke: '#1f6a32', strokeWidth: 1.5 }),
          R('brim', { x: 14, y: 36, width: 88, height: 12, rx: 6, fill: '#1f6a32' }),
          E('bell', { cx: 108, cy: -28, rx: 7, ry: 7, fill: '#ffd24a', stroke: '#e0b020', strokeWidth: 1 }),
        ],
        fg: [],
      };
    case 'Chef':
      return {
        skin: '#ffd5aa', stroke: '#9b643c', brow: '#3a2a1a',
        bg: [
          E('head', { cx: 65, cy: 94, rx: 54, ry: 58, fill: '#ffd5aa', stroke: '#9b643c', strokeWidth: 2.5 }),
          E('puffL', { cx: 30, cy: 18, rx: 20, ry: 18, fill: '#fafafa', stroke: '#d8d8d8', strokeWidth: 1 }),
          E('puffM', { cx: 65, cy: 10, rx: 24, ry: 20, fill: '#fafafa', stroke: '#d8d8d8', strokeWidth: 1 }),
          E('puffR', { cx: 100, cy: 18, rx: 20, ry: 18, fill: '#fafafa', stroke: '#d8d8d8', strokeWidth: 1 }),
          R('band', { x: 20, y: 26, width: 90, height: 18, fill: '#fafafa', stroke: '#d8d8d8', strokeWidth: 1 }),
        ],
        fg: [
          PATH('mustL', { d: 'M63,124 C50,116 40,122 42,130 C50,134 60,130 63,124 Z', fill: '#4a2a12' }),
          PATH('mustR', { d: 'M67,124 C80,116 90,122 88,130 C80,134 70,130 67,124 Z', fill: '#4a2a12' }),
        ],
      };
    case 'Cowboy':
      return {
        skin: '#eab884', stroke: '#a8743a', brow: '#5a3a1a',
        bg: [
          E('head', { cx: 65, cy: 94, rx: 54, ry: 58, fill: '#eab884', stroke: '#a8743a', strokeWidth: 2.5 }),
          PATH('crown', { d: 'M30,44 C30,4 100,4 100,44 Z', fill: '#8a5a2a', stroke: '#6a4420', strokeWidth: 1.5 }),
          E('brimE', { cx: 65, cy: 46, rx: 63, ry: 13, fill: '#8a5a2a', stroke: '#6a4420', strokeWidth: 1.5 }),
          R('hatband', { x: 30, y: 32, width: 70, height: 8, fill: '#4a2a12' }),
        ],
        fg: [PATH('bandana', { d: 'M38,142 Q65,158 92,142 L92,150 Q65,166 38,150 Z', fill: '#c0392b' })],
      };
    case 'Professor':
      return {
        skin: '#f0d2b0', stroke: '#9a6a44', brow: '#9a9a9a',
        bg: [
          E('tuftL', { cx: 13, cy: 62, rx: 12, ry: 18, fill: '#c8c8cc' }),
          E('tuftR', { cx: 117, cy: 62, rx: 12, ry: 18, fill: '#c8c8cc' }),
          E('head', { cx: 65, cy: 88, rx: 56, ry: 66, fill: '#f0d2b0', stroke: '#9a6a44', strokeWidth: 2.5 }),
        ],
        fg: [
          E('lensL', { cx: 37, cy: 82, rx: 24, ry: 22, fill: 'none', stroke: '#3a3a42', strokeWidth: 2.5 }),
          E('lensR', { cx: 93, cy: 82, rx: 24, ry: 22, fill: 'none', stroke: '#3a3a42', strokeWidth: 2.5 }),
          L('bridge', { points: '61,80 69,80', stroke: '#3a3a42', strokeWidth: 2.5, fill: 'none' }),
          PATH('must', { d: 'M46,126 Q65,116 84,126 Q65,134 46,126 Z', fill: '#b8b8bc' }),
        ],
      };
    case 'Grandma':
      return {
        skin: '#ffd9c0', stroke: '#c89a78', brow: '#b8b8bc',
        bg: [
          E('bun', { cx: 65, cy: 8, rx: 18, ry: 14, fill: '#d8d8dc', stroke: '#b8b8c0', strokeWidth: 1 }),
          PATH('hair', { d: 'M9,74 C9,18 121,18 121,74 C104,44 26,44 9,74 Z', fill: '#d8d8dc' }),
          E('head', { cx: 65, cy: 92, rx: 54, ry: 62, fill: '#ffd9c0', stroke: '#c89a78', strokeWidth: 2.5 }),
          E('cheekL', { cx: 30, cy: 110, rx: 9, ry: 7, fill: '#ffb0a0', opacity: 0.7 }),
          E('cheekR', { cx: 100, cy: 110, rx: 9, ry: 7, fill: '#ffb0a0', opacity: 0.7 }),
        ],
        fg: [
          E('lensL', { cx: 37, cy: 82, rx: 23, ry: 21, fill: 'none', stroke: '#8a6a4a', strokeWidth: 2.5 }),
          E('lensR', { cx: 93, cy: 82, rx: 23, ry: 21, fill: 'none', stroke: '#8a6a4a', strokeWidth: 2.5 }),
          L('bridge', { points: '60,80 70,80', stroke: '#8a6a4a', strokeWidth: 2.5, fill: 'none' }),
        ],
      };
    case 'Pumpkin':
      return {
        skin: '#f28c28', stroke: '#b05a10', brow: '#7a3a08', hideNose: true,
        bg: [
          R('stem', { x: 60, y: 2, width: 10, height: 20, rx: 3, fill: '#3f7a28', transform: 'rotate(8 65 12)' }),
          E('head', { cx: 65, cy: 92, rx: 62, ry: 62, fill: '#f28c28', stroke: '#b05a10', strokeWidth: 2.5 }),
          E('lobeL', { cx: 38, cy: 92, rx: 26, ry: 58, fill: 'none', stroke: '#d8781a', strokeWidth: 2 }),
          E('lobeR', { cx: 92, cy: 92, rx: 26, ry: 58, fill: 'none', stroke: '#d8781a', strokeWidth: 2 }),
        ],
        fg: [P('nose', { points: '65,106 58,120 72,120', fill: '#1a1a1a' })],
      };
    case 'Snowman':
      return {
        skin: '#ffffff', stroke: '#a8b4c0', brow: '#4a4e58', hideNose: true,
        bg: [
          E('head', { cx: 65, cy: 94, rx: 56, ry: 60, fill: '#ffffff', stroke: '#a8b4c0', strokeWidth: 2.5 }),
          R('topper', { x: 34, y: -18, width: 62, height: 52, rx: 4, fill: '#1a1a1a' }),
          R('brim', { x: 20, y: 32, width: 90, height: 10, rx: 5, fill: '#1a1a1a' }),
          R('ribbon', { x: 34, y: 22, width: 62, height: 10, fill: '#c0392b' }),
        ],
        fg: [P('carrot', { points: '60,104 70,104 66,132', fill: '#f08030', stroke: '#c05a10', strokeWidth: 1 })],
      };
    case 'Man':
    default:
      return {
        skin: '#ffd5aa', stroke: '#9b643c', brow: '#231608',
        bg: [
          E('earL', { cx: 8.5, cy: 83, rx: 6.5, ry: 10, fill: '#ffd5aa', stroke: '#9b643c', strokeWidth: 1.5 }),
          E('earR', { cx: 121.5, cy: 83, rx: 6.5, ry: 10, fill: '#ffd5aa', stroke: '#9b643c', strokeWidth: 1.5 }),
          E('head', { cx: 65, cy: 84, rx: 60, ry: 74, fill: '#ffd5aa', stroke: '#9b643c', strokeWidth: 2.5 }),
          P('hair', { points: '65,0 98,8 114,22 116,36 108,44 94,34 65,27 36,34 22,44 14,36 16,22 32,8', fill: '#231608' }),
          R('sideL', { x: 8, y: 60, width: 9, height: 26, rx: 3, fill: '#231608' }),
          R('sideR', { x: 113, y: 60, width: 9, height: 26, rx: 3, fill: '#231608' }),
        ],
        fg: [L('chin', { points: '63,148 67,154', stroke: '#9b643c', strokeWidth: 1.5, fill: 'none' })],
      };
  }
}

function Eye({ cx, expr, offset, irisOverride }) {
  const ix = irisOverride || irisColor(expr.iris);
  const glowCls = irisOverride ? '' : expr.tier === 7 ? 'face-glow-7' : expr.tier === 6 ? 'face-glow-6' : '';
  const irisCls = irisOverride ? '' : expr.tier === 7 ? 'face-iris-7' : '';
  return (
    <g>
      <circle
        className={`face-glow ${glowCls}`}
        cx={cx}
        cy={ECy}
        r={GlowR}
        fill={ix}
        opacity={0.55}
        style={{ filter: `blur(${expr.glow}px)` }}
      />
      <circle className={`face-iris ${irisCls}`} cx={cx} cy={ECy} r={IrisR} fill={ix} />
      <circle cx={cx} cy={ECy} r={IrisR} fill="none" stroke="rgba(35,35,70,0.9)" strokeWidth={0.8} />
      <g style={{ transform: `translateX(${offset.toFixed(2)}px)`, transition: 'transform 90ms ease-out' }}>
        <circle cx={cx} cy={ECy} r={PupilR} fill="#0f0f19" />
        <circle cx={cx - 1.5} cy={ECy - 2} r={1.5} fill="#fff" opacity={0.9} />
      </g>
    </g>
  );
}

export default function FaceSVG({
  wpm = 0, lineProgress = 0.5, faceStyle = 'Man', artStyle = 'Cartoon', size = 130,
  activity = null, stage = 'awake', speaking = false, irisOverride = null,
}) {
  const baseExpr = faceExpression(wpm);
  // Drowsy droops the lids well past the pace expression; asleep closes them entirely.
  const expr = stage === 'asleep' ? { ...baseExpr, lidDroop: 1, glow: 0 }
    : stage === 'drowsy' ? { ...baseExpr, lidDroop: Math.max(baseExpr.lidDroop, 0.72) }
      : baseExpr;
  const d = decor(faceStyle);
  const offset = (Math.max(0, Math.min(1, lineProgress)) - 0.5) * 2 * RIG.MaxOffset;
  const scleraFill = d.sclera || '#fafaff';
  const lidFill = d.skin;
  const w = Math.round((size * RIG.W) / RIG.H); // preserve the 130:165 aspect ratio
  // Activity/stage/speaking become CSS classes — the animations live in App.css (av* keyframes).
  const cls = [`reader-face art-${artStyle.toLowerCase()}`,
    activity ? `avf-${activity}` : '', `avf-${stage}`, speaking ? 'avf-speaking' : ''].filter(Boolean).join(' ');

  return (
    <svg
      className={cls}
      width={w}
      height={size}
      viewBox={`0 0 ${RIG.W} ${RIG.H}`}
      style={{ width: w, height: size }}
      role="img"
      aria-label={`${faceStyle} reader avatar`}
    >
      {d.bg}
      {/* Sclera */}
      <circle cx={LCx} cy={ECy} r={ScR} fill={scleraFill} stroke={d.stroke} strokeWidth={1.5} />
      <circle cx={RCx} cy={ECy} r={ScR} fill={scleraFill} stroke={d.stroke} strokeWidth={1.5} />
      {/* Animated irises / pupils */}
      <Eye cx={LCx} expr={expr} offset={offset} irisOverride={irisOverride} />
      <Eye cx={RCx} expr={expr} offset={offset} irisOverride={irisOverride} />
      {/* Eyelids (droop with low WPM) */}
      <polygon
        className="face-lid"
        points={lidPoints(LCx, ECy, ScR, expr.lidDroop)}
        fill={lidFill}
        stroke="rgba(160,100,60,0.9)"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <polygon
        className="face-lid"
        points={lidPoints(RCx, ECy, ScR, expr.lidDroop)}
        fill={lidFill}
        stroke="rgba(160,100,60,0.9)"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      {/* Brows */}
      {!d.hideBrows && (
        <>
          <polyline className="face-brow" points={browPoints('L', expr.browOff, expr.browArch)} fill="none" stroke={d.brow} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
          <polyline className="face-brow" points={browPoints('R', expr.browOff, expr.browArch)} fill="none" stroke={d.brow} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {/* Nose */}
      {!d.hideNose && (
        <polyline
          points="59,102 57,115 60,118 65,116 70,118 73,115 71,102"
          fill="none"
          stroke={d.stroke}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {/* Mouth */}
      {!d.hideMouth && (
        <path className="face-mouth" d={mouthPath(expr.mouthCtrl)} fill="none" stroke={d.stroke} strokeWidth={2.5} strokeLinecap="round" />
      )}
      {d.fg}
    </svg>
  );
}
