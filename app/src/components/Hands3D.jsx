import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { poseIdFor, HAND_POSES, activityHandPose } from '../features/handPoses.js';

// Full 3D floating hands for the avatars: a palm, four articulated fingers (two bones each with
// real knuckle joints) and an opposable thumb, tinted with the avatar's own skin/stroke palette.
// Every joint is damped toward a target pose, so activity changes and biometric flashes GLIDE
// instead of snapping. Rendered inside the shared WebGL scene (FaceHead) — the SVG renderer keeps
// its flat fallback gloves.

// Where the hands float relative to the head: clear of the silhouette, low enough to read as
// hands rather than ears, and big enough to see the fingers articulate.
const HOME = { x: 1.42, y: -0.42, z: 0.5, s: 0.92 };

const P = { // proportions, hand-local (palm centred at origin, fingers +y, palm faces +z)
  palm: [0.5, 0.52, 0.2], palmR: 0.09,
  fingerX: [-0.175, -0.058, 0.058, 0.175],
  fingerLen: [0.2, 0.23, 0.22, 0.18], // index → pinky
  fingerR: 0.052,
  knuckleY: 0.24,
  thumbPos: [-0.26, -0.05, 0.05],
};

// One articulated finger: proximal bone hinged at the knuckle, distal bone hinged at the joint.
function Finger({ i, mat, refs }) {
  const len = P.fingerLen[i];
  const l1 = len * 0.58;
  const l2 = len * 0.42;
  return (
    <group ref={(el) => { refs.current[i] = el; }} position={[P.fingerX[i], P.knuckleY, 0]}>
      <mesh position={[0, l1 / 2, 0]}>
        <capsuleGeometry args={[P.fingerR, l1, 4, 10]} />
        {mat}
      </mesh>
      <group ref={(el) => { refs.current[i + 4] = el; }} position={[0, l1, 0]}>
        <mesh position={[0, l2 / 2, 0]}>
          <capsuleGeometry args={[P.fingerR * 0.88, l2, 4, 10]} />
          {mat}
        </mesh>
      </group>
    </group>
  );
}

// side: -1 left, +1 right. The left hand is the right one mirrored, so one rig serves both.
function Hand({ side, skin, stroke, poseRef, activityRef, stageRef, seed }) {
  const root = useRef();
  const wrist = useRef();
  const fingers = useRef([]);   // 0..3 proximal, 4..7 distal
  const thumb1 = useRef();
  const thumb2 = useRef();
  const cur = useRef({ curl: [0.2, 0.2, 0.2, 0.2], thumb: 0.2, spread: 0.15 });

  useFrame((state, dt) => {
    const ddt = Math.min(dt, 0.05);
    const damp = THREE.MathUtils.damp;
    const t = state.clock.elapsedTime;
    const asleep = stageRef.current === 'asleep';
    const act = activityRef.current;
    // The biometric flash wins while it's live; otherwise the activity decides the resting pose.
    const flash = poseRef.current && Date.now() - poseRef.current.ts < 1600 ? poseIdFor(poseRef.current.emoji) : null;
    const pose = HAND_POSES[flash || activityHandPose(act, asleep)] || HAND_POSES.relaxed;

    // Per-activity motion layered on top of the pose: typing drums the fingers in sequence,
    // scrolling glides the whole hand, page/para sweeps it sideways, idle just breathes.
    let drum = 0, glideY = 0, swayX = 0, rollZ = 0;
    if (!asleep) {
      if (act === 'typing') drum = 1;
      else if (act === 'scroll') glideY = Math.sin(t * 2.2 + seed) * 0.09;
      else if (act === 'para' || act === 'page') swayX = Math.sin(t * 1.3 + seed) * 0.12;
      else if (act === 'word') rollZ = Math.sin(t * 8 + seed) * 0.05;
      else if (act === 'line') glideY = Math.max(0, Math.sin(t * 3.2 + seed)) * 0.06;
    }
    const float = asleep ? 0 : Math.sin(t * 1.5 + seed) * 0.035;

    // Joint targets → damped angles. Curl maps to a hinge sweep at knuckle and mid-joint.
    for (let i = 0; i < 4; i++) {
      // Drumming: each finger falls a beat after the last, so it reads as real keystrokes.
      const beat = drum ? Math.max(0, Math.sin(t * 9 - i * 0.9)) * 0.85 : 0;
      const target = THREE.MathUtils.clamp(pose.curl[i] + beat, 0, 1.35);
      cur.current.curl[i] = damp(cur.current.curl[i], target, 9, ddt);
      const c = cur.current.curl[i];
      const prox = fingers.current[i];
      const dist = fingers.current[i + 4];
      if (prox) {
        prox.rotation.x = -c * 1.35;
        // Spread fans the fingers apart around the knuckle line.
        prox.rotation.z = (P.fingerX[i] * 1.6) * damp(cur.current.spread, pose.spread, 8, ddt);
      }
      if (dist) dist.rotation.x = -c * 1.25;
    }
    cur.current.spread = damp(cur.current.spread, pose.spread, 8, ddt);
    cur.current.thumb = damp(cur.current.thumb, pose.thumb, 9, ddt);
    if (thumb1.current) thumb1.current.rotation.z = 0.75 + cur.current.thumb * 0.75;
    if (thumb2.current) thumb2.current.rotation.z = cur.current.thumb * 0.9;

    if (wrist.current) {
      // The wrist sits INSIDE the mirror group, so the same angles read symmetrically on both
      // hands — no per-side sign juggling needed here.
      const [wx, wy, wz] = pose.wrist || [0, 0, 0];
      wrist.current.rotation.x = damp(wrist.current.rotation.x, wx, 8, ddt);
      wrist.current.rotation.y = damp(wrist.current.rotation.y, wy, 8, ddt);
      wrist.current.rotation.z = damp(wrist.current.rotation.z, wz + rollZ, 8, ddt);
    }
    if (root.current) {
      root.current.position.y = damp(root.current.position.y, HOME.y + float + glideY, 7, ddt);
      root.current.position.x = damp(root.current.position.x, side * (HOME.x + swayX * side), 7, ddt);
      root.current.visible = !asleep; // hands tuck away while the avatar snoozes
    }
  });

  const mat = <meshStandardMaterial color={skin} roughness={0.55} metalness={0.02} />;
  const l1 = 0.13, l2 = 0.11; // thumb bones
  return (
    <group ref={root} position={[side * HOME.x, HOME.y, HOME.z]} rotation={[0, -side * 0.32, 0]} scale={HOME.s}>
      {/* The mirror lives on its own node: composing it with the yaw above would un-mirror the
          left hand (a reflection times a rotation reads as the opposite turn). */}
      <group scale={[side, 1, 1]}>
      <group ref={wrist}>
        {/* Palm */}
        <RoundedBox args={P.palm} radius={P.palmR} smoothness={3}>
          <meshStandardMaterial color={skin} roughness={0.55} metalness={0.02} />
        </RoundedBox>
        {/* A faint crease so the palm reads as a palm, not a block */}
        <mesh position={[0, -0.06, P.palm[2] / 2 + 0.005]} rotation={[0, 0, 0.35]}>
          <capsuleGeometry args={[0.012, 0.22, 3, 8]} />
          <meshStandardMaterial color={stroke} roughness={0.8} transparent opacity={0.5} />
        </mesh>
        {[0, 1, 2, 3].map((i) => <Finger key={i} i={i} mat={mat} refs={fingers} />)}
        {/* Thumb: hinged out from the palm's edge, two bones like the fingers */}
        <group ref={thumb1} position={P.thumbPos} rotation={[0, 0, 0.75]}>
          <mesh position={[0, l1 / 2, 0]}>
            <capsuleGeometry args={[0.06, l1, 4, 10]} />
            {mat}
          </mesh>
          <group ref={thumb2} position={[0, l1, 0]}>
            <mesh position={[0, l2 / 2, 0]}>
              <capsuleGeometry args={[0.052, l2, 4, 10]} />
              {mat}
            </mesh>
          </group>
        </group>
      </group>
      </group>
    </group>
  );
}

export default function Hands3D({ skin = '#ffd5aa', stroke = '#9b643c', pose = null, activity = 'idle', stage = 'awake' }) {
  const poseRef = useRef(pose); poseRef.current = pose;
  const actRef = useRef(activity); actRef.current = activity;
  const stageRef = useRef(stage); stageRef.current = stage;
  return (
    <>
      <Hand side={-1} skin={skin} stroke={stroke} poseRef={poseRef} activityRef={actRef} stageRef={stageRef} seed={0} />
      <Hand side={1} skin={skin} stroke={stroke} poseRef={poseRef} activityRef={actRef} stageRef={stageRef} seed={1.7} />
    </>
  );
}
