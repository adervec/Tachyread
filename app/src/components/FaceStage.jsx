import { Canvas } from '@react-three/fiber';
import { View } from '@react-three/drei';
import { webglAvailable } from './webgl.js';

// The single shared WebGL context for every 3D reader face. drei's <View> uses one
// module-global tunnel, so exactly ONE <View.Port/> may be mounted — every <Face> on screen
// portals its head into this canvas, which is scissored to each face's DOM box. Mounted once
// at the app root as a fixed, click-through full-window overlay sitting *below* menus and
// dialogs (z-index in App.css), so faces are naturally occluded by any overlay above them.
export default function FaceStage() {
  if (!webglAvailable()) return null;
  return (
    <Canvas
      className="face-canvas-overlay"
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      camera={{ position: [0, 0, 5.2], fov: 32 }}
      frameloop="always"
    >
      <View.Port />
    </Canvas>
  );
}
