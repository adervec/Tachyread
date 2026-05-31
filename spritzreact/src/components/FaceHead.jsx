import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { faceExpression } from '../engine/faceExpression.js';
import { decor3d, artMaterial } from './faceDecor3d.js';

// The 3D reader head. The shared eye/brow/lid/mouth rig is animated every frame from
// faceExpression(wpm) (the same pure model the 2D face used), and the whole head yaws to
// follow the reading position (lineProgress). Per-style decorations come from decor3d().
// All values are damped toward their targets so the ~1 Hz WPM updates and per-word gaze
// changes glide instead of stepping.

const DEG = Math.PI / 180;
const RIG3D = {
  eyeX: 0.4, eyeY: 0.12, eyeZ: 0.62, eyeR: 0.26,
  irisR: 0.13, pupilR: 0.065,
  browX: 0.4, browY: 0.52, browZ: 0.86,
  noseY: -0.06, noseZ: 0.84,
  mouthY: -0.52, mouthZ: 0.82,
  maxYaw: 15 * DEG, maxGaze: 22 * DEG, tilt: 4 * DEG,
  lidOpen: -12 * DEG, lidClosed: 96 * DEG,
};

function Geom({ kind, args }) {
  switch (kind) {
    case 'box': return <boxGeometry args={args} />;
    case 'cone': return <coneGeometry args={args} />;
    case 'cyl': return <cylinderGeometry args={args} />;
    case 'capsule': return <capsuleGeometry args={args} />;
    case 'torus': return <torusGeometry args={args} />;
    case 'circle': return <circleGeometry args={args} />;
    case 'sphere':
    default: return <sphereGeometry args={args && args.length ? args : [1, 28, 24]} />;
  }
}

// Renders one decoration/head part, blending the art-style surface preset with per-part
// color and overrides. Neon makes every part self-emit its own color.
function Part({ part, mat, neon }) {
  const {
    kind, args = [], pos = [0, 0, 0], rot = [0, 0, 0], scale = 1,
    color, emissive, emissiveIntensity, metalness, roughness, opacity, radius,
  } = part;
  const emis = emissive || (neon ? color : undefined);
  const emisI = emissiveIntensity != null ? emissiveIntensity : (neon ? (mat.emissiveIntensity ?? 0.5) : 0);
  const matEl = (
    <meshStandardMaterial
      color={color}
      flatShading={!!mat.flatShading}
      roughness={roughness != null ? roughness : mat.roughness}
      metalness={metalness != null ? metalness : mat.metalness}
      transparent={opacity != null || !!mat.transparent}
      opacity={opacity != null ? opacity : (mat.opacity != null ? mat.opacity : 1)}
      emissive={emis}
      emissiveIntensity={emisI}
    />
  );
  if (kind === 'rbox') {
    return (
      <RoundedBox args={args} radius={radius ?? 0.1} smoothness={4} position={pos} rotation={rot} scale={scale}>
        {matEl}
      </RoundedBox>
    );
  }
  return (
    <mesh position={pos} rotation={rot} scale={scale}>
      <Geom kind={kind} args={args} />
      {matEl}
    </mesh>
  );
}

export default function FaceHead({ wpm = 0, lineProgress = 0.5, faceStyle = 'Man', artStyle = 'Cartoon' }) {
  const d = useMemo(() => decor3d(faceStyle), [faceStyle]);
  const baseMat = useMemo(() => artMaterial(artStyle), [artStyle]);
  const neon = (artStyle || '').toLowerCase() === 'neon';
  const eyeScale = d.eyeScale || 1;
  const sclera = d.sclera || '#fafaff';

  // Live prop mirrors so the persistent render loop always sees the latest values.
  const wpmRef = useRef(wpm); wpmRef.current = wpm;
  const lpRef = useRef(lineProgress); lpRef.current = lineProgress;

  const headGroup = useRef();
  const gazeL = useRef(); const gazeR = useRef();
  const lidL = useRef(); const lidR = useRef();
  const browL = useRef(); const browR = useRef();
  const mouth = useRef();
  const irisMatL = useRef(); const irisMatR = useRef();

  useFrame((state, dt) => {
    const ddt = Math.min(dt, 0.05);
    const damp = THREE.MathUtils.damp;
    const expr = faceExpression(wpmRef.current);
    const lp = Math.max(0, Math.min(1, lpRef.current));
    const t = state.clock.elapsedTime;

    // Head turn + a slight downward tilt, following the reading position.
    const yaw = (lp - 0.5) * 2 * RIG3D.maxYaw;
    if (headGroup.current) {
      headGroup.current.rotation.y = damp(headGroup.current.rotation.y, yaw, 6, ddt);
      headGroup.current.rotation.x = damp(headGroup.current.rotation.x, RIG3D.tilt, 5, ddt);
    }
    // Gaze — eyes lead the head a touch.
    const gaze = (lp - 0.5) * 2 * RIG3D.maxGaze;
    if (gazeL.current) gazeL.current.rotation.y = damp(gazeL.current.rotation.y, gaze, 12, ddt);
    if (gazeR.current) gazeR.current.rotation.y = damp(gazeR.current.rotation.y, gaze, 12, ddt);
    // Eyelids droop with low WPM.
    const lidX = THREE.MathUtils.lerp(RIG3D.lidOpen, RIG3D.lidClosed, expr.lidDroop);
    if (lidL.current) lidL.current.rotation.x = damp(lidL.current.rotation.x, lidX, 14, ddt);
    if (lidR.current) lidR.current.rotation.x = damp(lidR.current.rotation.x, lidX, 14, ddt);
    // Brows raise/arch (browOff/Arch are negative when raised).
    const browY = RIG3D.browY + (-expr.browOff) / 26;
    const archZ = (-expr.browArch) / 40;
    if (browL.current) {
      browL.current.position.y = damp(browL.current.position.y, browY, 12, ddt);
      browL.current.rotation.z = damp(browL.current.rotation.z, archZ, 12, ddt);
    }
    if (browR.current) {
      browR.current.position.y = damp(browR.current.position.y, browY, 12, ddt);
      browR.current.rotation.z = damp(browR.current.rotation.z, -archZ, 12, ddt);
    }
    // Mouth: negative mouthCtrl = smile. Signed vertical scale bends the arc (DoubleSide
    // keeps it lit when flipped to a frown); ~0 at neutral reads as a flat line.
    const smile = THREE.MathUtils.clamp(-expr.mouthCtrl / 12, -1, 1);
    if (mouth.current) mouth.current.scale.y = damp(mouth.current.scale.y, 0.15 + smile * 0.85, 12, ddt);
    // Iris color + glow (pulses at the top speed tiers).
    const [r, g, b] = expr.iris;
    const pulse = expr.tier >= 6 ? 0.6 + 0.4 * Math.sin(t * (expr.tier === 7 ? 11 : 6)) : 1;
    const gi = expr.glow > 0 ? (expr.glow / 6) * pulse * 1.6 : 0;
    for (const m of [irisMatL.current, irisMatR.current]) {
      if (!m) continue;
      m.color.setRGB(r / 255, g / 255, b / 255);
      m.emissive.setRGB(r / 255, g / 255, b / 255);
      m.emissiveIntensity = gi;
    }
  });

  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight position={[-2.5, 3, 4]} intensity={1.15} />
      <directionalLight position={[3, -1.5, 2]} intensity={0.35} />
      <group ref={headGroup} scale={0.8} position={[0, -0.05, 0]}>
        {/* Base head */}
        <Part part={{ ...d.head, pos: d.head.pos || [0, 0, 0] }} mat={baseMat} neon={neon} />

        {/* Eyes */}
        {[-1, 1].map((s) => (
          <group key={`eye${s}`} position={[s * RIG3D.eyeX, RIG3D.eyeY, RIG3D.eyeZ]} scale={eyeScale}>
            <mesh>
              <sphereGeometry args={[RIG3D.eyeR, 28, 28]} />
              <meshStandardMaterial color={sclera} roughness={0.18} metalness={0} />
            </mesh>
            <group ref={s < 0 ? gazeL : gazeR}>
              <mesh position={[0, 0, RIG3D.eyeR * 0.9]}>
                <circleGeometry args={[RIG3D.irisR, 28]} />
                <meshStandardMaterial ref={s < 0 ? irisMatL : irisMatR} color="#8a8a5a" roughness={0.35} emissive="#000000" emissiveIntensity={0} />
              </mesh>
              <mesh position={[0, 0, RIG3D.eyeR * 0.92]}>
                <circleGeometry args={[RIG3D.pupilR, 20]} />
                <meshBasicMaterial color="#0b0b14" />
              </mesh>
              <mesh position={[-RIG3D.pupilR * 0.5, RIG3D.pupilR * 0.55, RIG3D.eyeR * 0.94]}>
                <circleGeometry args={[RIG3D.pupilR * 0.42, 12]} />
                <meshBasicMaterial color="#ffffff" />
              </mesh>
            </group>
            <mesh ref={s < 0 ? lidL : lidR} rotation={[RIG3D.lidOpen, 0, 0]}>
              <sphereGeometry args={[RIG3D.eyeR * 1.05, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
              <meshStandardMaterial color={d.skin} side={THREE.DoubleSide} roughness={0.6} />
            </mesh>
          </group>
        ))}

        {/* Brows */}
        {!d.hideBrows && [-1, 1].map((s) => (
          <group key={`brow${s}`} ref={s < 0 ? browL : browR} position={[s * RIG3D.browX, RIG3D.browY, RIG3D.browZ]}>
            <mesh>
              <boxGeometry args={[0.34, 0.08, 0.12]} />
              <meshStandardMaterial color={d.brow} roughness={0.6} />
            </mesh>
          </group>
        ))}

        {/* Nose */}
        {!d.hideNose && (
          <mesh position={[0, RIG3D.noseY, RIG3D.noseZ]} scale={[0.7, 0.95, 0.7]}>
            <sphereGeometry args={[0.16, 20, 20]} />
            <meshStandardMaterial color={d.skin} roughness={0.6} />
          </mesh>
        )}

        {/* Mouth */}
        {!d.hideMouth && (
          <group ref={mouth} position={[0, RIG3D.mouthY, RIG3D.mouthZ]} rotation={[0, 0, Math.PI]}>
            <mesh>
              <torusGeometry args={[0.3, 0.045, 8, 24, Math.PI]} />
              <meshStandardMaterial color={d.stroke} side={THREE.DoubleSide} roughness={0.5} />
            </mesh>
          </group>
        )}

        {/* Per-style decorations */}
        {d.extras.map((part, i) => (
          <Part key={`x${i}`} part={part} mat={baseMat} neon={neon} />
        ))}
      </group>
    </>
  );
}
