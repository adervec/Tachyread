import { useState } from 'react';
import Dialog from './Dialog.jsx';
import ProfilesBar from '../components/ProfilesBar.jsx';

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
      <ProfilesBar
        kind="typing"
        profiles={global.settingsProfiles}
        onChange={(p) => onPatchGlobal({ settingsProfiles: p })}
        capture={() => ({ typing: { caseSensitive: !!t.caseSensitive, lowercase: !!t.lowercase, noSpecial: !!t.noSpecial, bypassNonQwerty: t.bypassNonQwerty !== false } })}
        apply={(data) => patchTyping(data.typing || {})}
      />
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
      {!!t.lowercase && (
        <Field label="…but show capitals as written">
          <label className="inline-check" title="Display the original capitalisation while typing lowercase still counts — display only">
            <input type="checkbox" checked={!!t.showCaps} onChange={(e) => patchTyping({ showCaps: e.target.checked })} />
            The drill shows “The”, you type “the”
          </label>
        </Field>
      )}
      <Field label="No special characters">
        <input
          type="checkbox"
          checked={!!t.noSpecial}
          onChange={(e) => patchTyping({ noSpecial: e.target.checked })}
          title="Strip punctuation & symbols — type letters, numbers and spaces only"
        />
      </Field>
      {!!t.noSpecial && (
        <Field label="…but ghost the stripped characters">
          <label className="inline-check" title="Show the removed punctuation & symbols as dim auto-skipped ghosts in their own colour — you never type them; display only">
            <input type="checkbox" checked={!!t.ghostSpecials} onChange={(e) => patchTyping({ ghostSpecials: e.target.checked })} />
            Dim 👻 ghosts sit where the specials were
          </label>
        </Field>
      )}
      <Field label="Show line breaks (Passage)">
        <label className="inline-check" title="Show the book's own line and paragraph breaks instead of a flowing wall — visual only, the words you type are identical">
          <input type="checkbox" checked={!!t.showBreaks} onChange={(e) => patchTyping({ showBreaks: e.target.checked })} />
          Break the passage where the book does (visual only)
        </label>
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
