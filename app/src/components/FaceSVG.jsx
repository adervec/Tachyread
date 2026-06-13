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

function Eye({ cx, expr, offset }) {
  const ix = irisColor(expr.iris);
  const glowCls = expr.tier === 7 ? 'face-glow-7' : expr.tier === 6 ? 'face-glow-6' : '';
  const irisCls = expr.tier === 7 ? 'face-iris-7' : '';
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

export default function FaceSVG({ wpm = 0, lineProgress = 0.5, faceStyle = 'Man', artStyle = 'Cartoon', size = 130 }) {
  const expr = faceExpression(wpm);
  const d = decor(faceStyle);
  const offset = (Math.max(0, Math.min(1, lineProgress)) - 0.5) * 2 * RIG.MaxOffset;
  const scleraFill = d.sclera || '#fafaff';
  const lidFill = d.skin;
  const w = Math.round((size * RIG.W) / RIG.H); // preserve the 130:165 aspect ratio

  return (
    <svg
      className={`reader-face art-${artStyle.toLowerCase()}`}
      width={w}
      height={size}
      viewBox={`0 0 ${RIG.W} ${RIG.H}`}
      style={{ width: w, height: size }}
      role="img"
      aria-label={`${faceStyle} reader face`}
    >
      {d.bg}
      {/* Sclera */}
      <circle cx={LCx} cy={ECy} r={ScR} fill={scleraFill} stroke={d.stroke} strokeWidth={1.5} />
      <circle cx={RCx} cy={ECy} r={ScR} fill={scleraFill} stroke={d.stroke} strokeWidth={1.5} />
      {/* Animated irises / pupils */}
      <Eye cx={LCx} expr={expr} offset={offset} />
      <Eye cx={RCx} expr={expr} offset={offset} />
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
