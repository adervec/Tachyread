import { View } from '@react-three/drei';
import { RIG } from '../engine/faceExpression.js';
import FaceHead from './FaceHead.jsx';
import FaceSVG from './FaceSVG.jsx';
import { webglAvailable } from './webgl.js';

// Drop-in reader face. Same props/signature as the old SVG face, but renders a true 3D head
// (FaceHead) into the shared WebGL canvas via drei's <View>. <View> itself lays out the
// tracked DOM box here; its 3D children render into <FaceStage>'s <View.Port/>. Falls back to
// the SVG renderer when WebGL is unavailable. NOTE: requires <FaceStage/> mounted once at the
// app root, otherwise the tunnelled scene has nowhere to render.
export default function Face({
  wpm = 0, lineProgress = 0.5, faceStyle = 'Man', artStyle = 'Cartoon', size = 130,
  activity = null, stage = 'awake', speaking = false, irisOverride = null, forceSvg = false,
  hands = false, handPose = null,
}) {
  // Hands need horizontal room beside the head, so the 3D box widens when they're on.
  const w = Math.round((size * (hands ? RIG.W * 1.9 : RIG.W)) / RIG.H);
  const extra = { activity, stage, speaking, irisOverride };

  // forceSvg: the typing overlay stacks ABOVE the shared WebGL canvas, so a <View> face would
  // paint its pixels behind it — the SVG renderer is the only face that can live there.
  if (forceSvg || !webglAvailable()) {
    return <FaceSVG wpm={wpm} lineProgress={lineProgress} faceStyle={faceStyle} artStyle={artStyle} size={size} {...extra} />;
  }

  return (
    <View
      className={`reader-face-3d art-${artStyle.toLowerCase()}${hands ? ' with-hands' : ''}`}
      style={{ width: w, height: size }}
    >
      <FaceHead wpm={wpm} lineProgress={lineProgress} faceStyle={faceStyle} artStyle={artStyle} hands={hands} handPose={handPose} {...extra} />
    </View>
  );
}
