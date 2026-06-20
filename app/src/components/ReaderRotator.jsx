import { useLayoutEffect, useRef, useState } from 'react';

// Mobile-only: rotate JUST the reader content (Fast Reader / Lines) by a quarter-turn while the
// surrounding menus, tabs and controls stay upright. For 90°/270° the inner box is sized to the
// container's SWAPPED dimensions, then rotated, so the rotated content still fills the same region
// (a plain `transform: rotate()` would keep the old box and spill/clip). The container size is
// measured live so the fit survives rotations of the device, the controls dock, or the keyboard.
export default function ReaderRotator({ rotation = 0, children }) {
  const wrapRef = useRef(null);
  const [{ w, h }, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const q = ((rotation % 360) + 360) % 360;
  const swap = q === 90 || q === 270;
  const inner = q === 0
    ? { width: '100%', height: '100%' }
    : {
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: swap ? h : w,
        height: swap ? w : h,
        transform: `translate(-50%, -50%) rotate(${q}deg)`,
        transformOrigin: 'center center',
      };

  return (
    <div className="reader-rotate-wrap" ref={wrapRef}>
      <div className="reader-rotate-inner" style={inner}>{children}</div>
    </div>
  );
}
