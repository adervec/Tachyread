// Reading pointer drawn next to the current line in the right pane.
// Geometric styles ported from the WPF PointerStyle enum (Arrow/Diamond/Star/Circle/Hand).

function glyph(style, size, color) {
  const s = size;
  const common = { width: s, height: s, viewBox: '0 0 24 24', fill: color, 'aria-hidden': true };
  switch (style) {
    case 'Diamond':
      return (
        <svg {...common}>
          <polygon points="12,2 22,12 12,22 2,12" />
        </svg>
      );
    case 'Star':
      return (
        <svg {...common}>
          <polygon points="12,1 15,9 23,9 16,14 19,22 12,17 5,22 8,14 1,9 9,9" />
        </svg>
      );
    case 'Circle':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
    case 'Hand':
      return (
        <svg {...common} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12 H17 M13 8 L17 12 L13 16" />
        </svg>
      );
    case 'Arrow':
    default:
      return (
        <svg {...common}>
          <polygon points="3,12 15,4 15,9 21,9 21,15 15,15 15,20" />
        </svg>
      );
  }
}

export default function Pointer({ style = 'Arrow', placement = 'Left', size = 16, blinkMs = 0 }) {
  const color = 'var(--orp-fg)';
  const rotate = placement === 'Above' ? 90 : placement === 'Below' ? -90 : placement === 'Right' ? 180 : 0;
  const cls = ['reading-pointer', `pointer-${placement.toLowerCase()}`, blinkMs > 0 ? 'pointer-blink' : ''].filter(Boolean).join(' ');
  const animationDuration = blinkMs > 0 ? `${blinkMs}ms` : undefined;
  return (
    <span className={cls} style={{ transform: `rotate(${rotate}deg)`, animationDuration }}>
      {glyph(style, size, color)}
    </span>
  );
}
