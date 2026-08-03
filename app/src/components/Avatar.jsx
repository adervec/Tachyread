import { useEffect, useRef, useState } from 'react';
import Face from './Face.jsx';
import { decor3d } from './faceDecor3d.js';
import { subscribeHandPose } from '../features/avatarBus.js';

// An AVATAR = a reader face plus its theatrics: optional FLOATING HANDS — disembodied cartoon
// gloves tinted to match the avatar's own skin/stroke colours — that mirror the biometric
// controls (a detected 👍 flashes as a badge; the scroll joystick raises a gliding palm) and
// float with the current activity; and the idle sleep act — drowsy first, then snoozing with
// floating zzz and counting sheep. The face itself animates per activity too (FaceSVG classes /
// FaceHead frame loop). Everything display-only.
//
// Props: the Face props, plus activity (reading-mode id or 'typing'), stage ('awake'|'drowsy'|
// 'asleep'), speaking (TTS is talking — the mouth moves with it), irisOverride (typing screen's
// consensus-WPM eye colour), hands (show the floating hands), forceSvg (typing overlay sits above
// the shared WebGL canvas, so it must use the SVG renderer).

// One floating glove, tinted with the avatar's palette (mirrored for the left via CSS).
function Mitt({ skin, stroke }) {
  return (
    <svg className="av-mitt" viewBox="0 0 40 44" aria-hidden="true">
      <path
        d="M9 27 Q6 15 13 12 Q12 4 18 5 Q20 1 24 4 Q31 4 30 12 Q36 16 34 27 Q35 40 21 41 Q7 40 9 27 Z"
        fill={skin} stroke={stroke} strokeWidth="2.4" strokeLinejoin="round"
      />
      <path d="M14 33 Q21 37 28 33" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

export default function Avatar({
  wpm = 0, lineProgress = 0.5, faceStyle = 'Man', artStyle = 'Cartoon', size = 72,
  activity = 'idle', stage = 'awake', speaking = false, irisOverride = null,
  hands = false, forceSvg = false,
}) {
  // Biometric flourish: the last published pose flashes on the right hand for ~1.6s.
  const [pose, setPose] = useState(null); // { emoji, ts }
  const poseTimer = useRef(0);
  useEffect(() => {
    if (!hands) return undefined;
    const off = subscribeHandPose((p) => {
      setPose(p);
      clearTimeout(poseTimer.current);
      poseTimer.current = setTimeout(() => setPose(null), 1600);
    });
    return () => { off(); clearTimeout(poseTimer.current); };
  }, [hands]);

  // Counting sheep: while asleep, one 🐑 hops by every few seconds and the tally climbs.
  const [sheep, setSheep] = useState(0);
  useEffect(() => {
    if (stage !== 'asleep') { setSheep(0); return undefined; }
    const id = setInterval(() => setSheep((n) => n + 1), 3600);
    return () => clearInterval(id);
  }, [stage]);

  // The gloves wear the avatar's own palette, so a Frog gets green hands and a Robot steel ones.
  const pal = decor3d(faceStyle) || {};
  const handW = Math.round(size * 0.3);

  return (
    <div className={`avatar av-${activity} av-${stage}${speaking ? ' av-speaking' : ''}`} style={{ position: 'relative' }}>
      <Face
        wpm={wpm} lineProgress={lineProgress} faceStyle={faceStyle} artStyle={artStyle} size={size}
        activity={activity} stage={stage} speaking={speaking} irisOverride={irisOverride} forceSvg={forceSvg}
      />
      {hands && stage !== 'asleep' && (
        <>
          <span className="av-hand av-hand-l" style={{ width: handW }} aria-hidden="true"><Mitt skin={pal.skin || '#ffd5aa'} stroke={pal.stroke || '#9b643c'} /></span>
          <span className={`av-hand av-hand-r${pose ? ' av-hand-pose' : ''}`} style={{ width: handW }} aria-hidden="true">
            <Mitt skin={pal.skin || '#ffd5aa'} stroke={pal.stroke || '#9b643c'} />
            {pose && <span className="av-hand-badge" style={{ fontSize: Math.round(size * 0.22) }}>{pose.emoji}</span>}
          </span>
        </>
      )}
      {stage === 'asleep' && (
        <span className="av-sleep" aria-hidden="true">
          <span className="av-zzz">z<span>z</span><span>Z</span></span>
          <span className="av-sheep" key={sheep}>🐑</span>
          {sheep > 0 && <span className="av-sheep-count">×{sheep}</span>}
        </span>
      )}
    </div>
  );
}
