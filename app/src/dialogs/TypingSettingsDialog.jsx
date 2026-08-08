import { useState } from 'react';
import Dialog from './Dialog.jsx';
import ProfilesBar from '../components/ProfilesBar.jsx';
import { keyboardList, renameKeyboard, removeKeyboard, upsertKeyboard, linkKeyboard, hidSupported, setActiveKeyboard } from '../features/keyboards.js';

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
  const [linkNote, setLinkNote] = useState('');
  const list = keyboardList(global.keyboards);
  const current = list.find((k) => k.id === global.activeKeyboard) || null;

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

      <div className="field-section">Keyboard</div>
      <p className="settings-note">
        Every run is stamped with the keyboard you typed it on, so Typing Progress can compare them.
        Detection is best-effort: the web hides keyboard hardware from key events, so Tachyread reads
        your OS layout (a QWERTY board is told apart from an AZERTY or QWERTZ one, not from another
        QWERTY) — link the hardware below to tell same-layout boards apart, and rename either way.
      </p>
      <Field label="Typing on">
        <select value={global.activeKeyboard || ''} onChange={(e) => onPatchGlobal({ activeKeyboard: e.target.value })}>
          {!list.length && <option value="">Not detected yet</option>}
          {list.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </Field>
      {!!current && (
        <Field label="Name it">
          <input
            type="text"
            value={current.label}
            placeholder="e.g. Keychron K2, ThinkPad built-in"
            onChange={(e) => onPatchGlobal({ keyboards: renameKeyboard(list, current.id, e.target.value) })}
          />
        </Field>
      )}
      <Field label="Link hardware">
        <button
          disabled={!hidSupported()}
          title={hidSupported()
            ? 'Grant access to the keyboard so runs can be matched to it by vendor and product id'
            : 'Needs a Chromium browser (Chrome, Edge, Brave)'}
          onClick={async () => {
            try {
              const kb = await linkKeyboard();
              if (!kb) return setLinkNote('No keyboard was picked.');
              onPatchGlobal({ keyboards: upsertKeyboard(list, kb), activeKeyboard: kb.id });
              setActiveKeyboard(kb);
              setLinkNote(`Linked ${kb.label}.`);
            } catch (err) { setLinkNote(`Couldn’t link that: ${err.message}`); }
          }}
        >Choose keyboard…</button>
      </Field>
      <p className="settings-note">
        {linkNote || 'Chrome hides plain keyboards from this chooser for security — only boards that also publish a vendor channel (QMK/VIA, Keychron, Logitech, Razer…) appear. A laptop’s built-in keyboard never will; name it by hand instead.'}
      </p>
      {!!current && list.length > 1 && (
        <Field label="Forget this keyboard">
          <button onClick={() => onPatchGlobal({ keyboards: removeKeyboard(list, current.id), activeKeyboard: '' })}>Remove</button>
        </Field>
      )}
    </Dialog>
  );
}
