import { useApp } from '../state/AppContext.jsx';
import { getDeviceId } from '../state/storage.js';

// A short, human-readable "Browser on OS" label from the UA — just for display on the settings pages.
function platformLabel() {
  try {
    const ua = navigator.userAgent || '';
    const os = /Windows/.test(ua) ? 'Windows'
      : /Android/.test(ua) ? 'Android'
        : /(iPhone|iPad|iPod)/.test(ua) ? 'iOS'
          : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
            : /Linux/.test(ua) ? 'Linux'
              : (navigator.userAgentData?.platform || navigator.platform || 'Unknown');
    const br = /Edg\//.test(ua) ? 'Edge'
      : /OPR\/|Opera/.test(ua) ? 'Opera'
        : /Firefox\//.test(ua) ? 'Firefox'
          : /Chrome\//.test(ua) ? 'Chrome'
            : /Safari\//.test(ua) ? 'Safari'
              : 'Browser';
    return `${br} on ${os}`;
  } catch { return 'Unknown platform'; }
}

// "This device" panel for the settings pages that are device-specific (Application Settings, Biometric
// Controls): the editable device name (used for cross-device presence + grab/audiobook markers), the
// stable per-device id, and the platform — plus a note that this page's settings don't sync.
export default function DeviceInfo({ note = 'These settings are specific to this device and don’t sync. Only your reading progress and Default Tab Settings follow you between devices.' }) {
  const { state, updateGlobal } = useApp();
  const id = getDeviceId();
  return (
    <div className="device-info">
      <div className="device-info-head"><span className="device-info-title">🖥 This device</span></div>
      <div className="device-info-row">
        <label className="device-info-name">Name
          <input type="text" value={state.global.deviceName || ''} onChange={(e) => updateGlobal({ deviceName: e.target.value })} placeholder="e.g. Laptop, Phone" />
        </label>
        <span className="device-info-fact" title={id}><b>ID</b> <code>{id.replace(/^dev-/, '').slice(0, 8)}…</code></span>
        <span className="device-info-fact">{platformLabel()}</span>
      </div>
      {note && <p className="settings-note device-info-note">{note}</p>}
    </div>
  );
}
