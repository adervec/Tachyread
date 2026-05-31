import { Canvas } from '@react-three/fiber';
import { RIG } from '../engine/faceExpression.js';
import FaceHead from './FaceHead.jsx';
import FaceSVG from './FaceSVG.jsx';
import { webglAvailable } from './webgl.js';

// Standalone 3D face preview with its OWN small WebGL context. Used inside dialogs (e.g. the
// Face Library), where the shared FaceStage overlay sits *below* the modal and so can't draw
// there. It does not use drei's <View> tunnel, so it never conflicts with FaceStage. Mounted
// only while the dialog is open, so the extra context is short-lived. Falls back to SVG.
export default function FacePreview({ wpm = 0, lineProgress = 0.5, faceStyle = 'Man', artStyle = 'Cartoon', size = 160 }) {
  const w = Math.round((size * RIG.W) / RIG.H);

  if (!webglAvailable()) {
    return <FaceSVG wpm={wpm} lineProgress={lineProgress} faceStyle={faceStyle} artStyle={artStyle} size={size} />;
  }

  return (
    <div className={`face-preview-3d art-${artStyle.toLowerCase()}`} style={{ width: w, height: size }}>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
        camera={{ position: [0, 0, 5.2], fov: 32 }}
        frameloop="always"
      >
        <FaceHead wpm={wpm} lineProgress={lineProgress} faceStyle={faceStyle} artStyle={artStyle} />
      </Canvas>
    </div>
  );
}
