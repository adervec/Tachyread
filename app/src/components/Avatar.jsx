import { useEffect, useRef, useState } from 'react';
import Face from './Face.jsx';
import { subscribeHandPose } from '../features/avatarBus.js';

// An AVATAR = a reader face plus its theatrics: optional Rayman-style floating hands that mirror
// the biometric controls (a detected 👍 flashes on a hand; the scroll joystick raises a gliding
// palm) and otherwise move with the current activity; and the idle sleep act — drowsy first, then
// snoozing with floating zzz and counting sheep. The face itself animates per activity too
// (FaceSVG classes / FaceHead frame loop). Everything display-only.
//
// Props: the Face props, plus activity (reading-mode id or 'typing'), stage ('awake'|'drowsy'|
// 'asleep'), speaking (TTS is talking — the mouth moves with it), irisOverride (typing screen's
// consensus-WPM eye colour), hands (show the Rayman hands), forceSvg (typing overlay sits above
// the shared WebGL canvas, so it must use the SVG renderer).

// Default hand glyphs per activity (right hand leads; the left mirrors, flipped by CSS).
const ACTIVITY_HANDS = {
  typing: ['🤛', '🤜'], scroll: ['🤚', '✋'], page: ['🫱', '🫲'], para: ['🫱', '🫲'],
  listen: ['🫲', '🫱'], speak: ['🤙', '🎤'], idle: ['🤚', '🤚'],
};

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

  const [handL, handR] = ACTIVITY_HANDS[activity] || ['🤚', '✋'];
  const shownR = pose?.emoji || handR;

  return (
    <div className={`avatar av-${activity} av-${stage}${speaking ? ' av-speaking' : ''}`} style={{ position: 'relative' }}>
      <Face
        wpm={wpm} lineProgress={lineProgress} faceStyle={faceStyle} artStyle={artStyle} size={size}
        activity={activity} stage={stage} speaking={speaking} irisOverride={irisOverride} forceSvg={forceSvg}
      />
      {hands && stage !== 'asleep' && (
        <>
          <span className="av-hand av-hand-l" style={{ fontSize: Math.round(size * 0.3) }} aria-hidden="true">{handL}</span>
          <span className={`av-hand av-hand-r${pose ? ' av-hand-pose' : ''}`} style={{ fontSize: Math.round(size * 0.3) }} aria-hidden="true">{shownR}</span>
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
