// One-time WebGL capability probe. The 3D faces fall back to the SVG renderer
// (FaceSVG) when WebGL is unavailable (old browsers, headless, blocked GPU).
let cached;

export function webglAvailable() {
  if (cached !== undefined) return cached;
  try {
    const c = document.createElement('canvas');
    cached = !!(
      window.WebGLRenderingContext &&
      (c.getContext('webgl2') || c.getContext('webgl'))
    );
  } catch {
    cached = false;
  }
  return cached;
}
