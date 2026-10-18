import { useEffect, useState } from 'react';

// useState that survives switching tabs and closing/reopening a panel, for the rest of this browser
// session (sessionStorage — per window, gone when it closes). Used for table filters and sorts, so
// coming back to a big table doesn't mean setting them all up again. JSON-able values only.
export function useSessionState(key, initial) {
  const [v, setV] = useState(() => {
    const init = typeof initial === 'function' ? initial() : initial;
    try {
      const s = sessionStorage.getItem(key);
      if (s != null) {
        const got = JSON.parse(s);
        // Objects merge over the defaults, so a field added since this value was saved still exists.
        const plain = (x) => x && typeof x === 'object' && !Array.isArray(x);
        return plain(init) && plain(got) ? { ...init, ...got } : got;
      }
    } catch { /* private mode / bad JSON */ }
    return init;
  });
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* quota / private mode */ } }, [key, v]);
  return [v, setV];
}
