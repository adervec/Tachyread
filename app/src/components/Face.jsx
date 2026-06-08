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
export default function Face({ wpm = 0, lineProgress = 0.5, faceStyle = 'Man', artStyle = 'Cartoon', size = 130 }) {
  const w = Math.round((size * RIG.W) / RIG.H); // preserve the 130:165 aspect ratio

  if (!webglAvailable()) {
    return <FaceSVG wpm={wpm} lineProgress={lineProgress} faceStyle={faceStyle} artStyle={artStyle} size={size} />;
  }

  return (
    <View
      className={`reader-face-3d art-${artStyle.toLowerCase()}`}
      style={{ width: w, height: size }}
    >
      <FaceHead wpm={wpm} lineProgress={lineProgress} faceStyle={faceStyle} artStyle={artStyle} />
    </View>
  );
}
