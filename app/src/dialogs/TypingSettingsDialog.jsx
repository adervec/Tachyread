import { useState } from 'react';
import Dialog from './Dialog.jsx';

// Typing-practice settings, reachable from the Typing menu (they used to hide inside Tab
// Settings). Everything here is a per-tab setting under settings.typing / typingEndFanfare;
// the run-time options (mode, limit, sounds) stay on the typing screen itself where they're used.
function Field({ label, children }) {
  return (
    <div className="field-row">
      <label>{label}</label>
      <div>{children}</div>
    </div>
  );
}

export default function TypingSettingsDialog({ settings, onPatch, global, onPatchGlobal, onClose }) {
  const [s, setS] = useState(settings);
  function patch(p) {
    setS({ ...s, ...p });
    onPatch(p);
  }
  const t = s.typing || {};
  const patchTyping = (p) => patch({ typing: { ...t, ...p } });

  return (
    <Dialog title="Typing Settings" onClose={onClose} width={520} buttons={<button onClick={onClose}>Close</button>}>
      <p className="settings-note">
        How typing runs behave for this tab. Run length, drills, one-word mode and sounds live on
        the typing screen itself; a run can start with ▶ Start or just by typing the first letter.
      </p>
      <Field label="Case sensitive">
        <input
          type="checkbox"
          checked={!!t.caseSensitive}
          onChange={(e) => patchTyping({ caseSensitive: e.target.checked })}
        />
      </Field>
      <div className="field-section">Transform the text</div>
      <p className="settings-note" style={{ margin: '2px 0 6px' }}>
        Change the drill text so you always type <strong>exactly what you see</strong> — also toggleable
        on the typing screen.
      </p>
      <Field label="All lowercase">
        <input type="checkbox" checked={!!t.lowercase} onChange={(e) => patchTyping({ lowercase: e.target.checked })} />
      </Field>
      <Field label="No special characters">
        <input
          type="checkbox"
          checked={!!t.noSpecial}
          onChange={(e) => patchTyping({ noSpecial: e.target.checked })}
          title="Strip punctuation & symbols — type letters, numbers and spaces only"
        />
      </Field>
      <Field label="Remove non-typeable characters">
        <input
          type="checkbox"
          checked={t.bypassNonQwerty !== false}
          onChange={(e) => patchTyping({ bypassNonQwerty: e.target.checked })}
          title="Characters a standard keyboard can't reach (•, ¶, curly quotes, em-dashes, accents…) are converted to the nearest key or removed — so you never see a character you can't type."
        />
      </Field>
      <Field label="Per-word timeout (ms, 0 = off)">
        <input
          type="number"
          min={0}
          max={60000}
          value={t.perWordTimeoutMs || 0}
          onChange={(e) => patchTyping({ perWordTimeoutMs: Number(e.target.value) })}
        />
      </Field>
      <Field label="End-of-run grade fanfare">
        <input
          type="checkbox"
          checked={global.typingEndFanfare !== false}
          onChange={(e) => onPatchGlobal({ typingEndFanfare: e.target.checked })}
        />
      </Field>
    </Dialog>
  );
}
