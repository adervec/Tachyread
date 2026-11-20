import { useState } from 'react';
import Dialog from './Dialog.jsx';
import ProfilesBar from '../components/ProfilesBar.jsx';
import { keyboardList, renameKeyboard, removeKeyboard, upsertKeyboard, linkKeyboard, hidSupported, setActiveKeyboard } from '../features/keyboards.js';
import { t } from '../i18n.js';

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
  const ty = s.typing || {};
  const patchTyping = (p) => patch({ typing: { ...ty, ...p } });
  const [linkNote, setLinkNote] = useState('');
  const list = keyboardList(global.keyboards);
  const current = list.find((k) => k.id === global.activeKeyboard) || null;

  return (
    <Dialog title={t('Typing Settings')} onClose={onClose} width={520} buttons={<button onClick={onClose}>{t('Close')}</button>}>
      <ProfilesBar
        kind="typing"
        profiles={global.settingsProfiles}
        onChange={(p) => onPatchGlobal({ settingsProfiles: p })}
        capture={() => ({ typing: { caseSensitive: !!ty.caseSensitive, lowercase: !!ty.lowercase, noSpecial: !!ty.noSpecial, bypassNonQwerty: ty.bypassNonQwerty !== false } })}
        apply={(data) => patchTyping(data.typing || {})}
      />
      <p className="settings-note">
        {t('How typing runs behave for this tab. Run length, drills, one-word mode and sounds live on the typing screen itself; a run can start with ▶ Start or just by typing the first letter.')}
      </p>
      <Field label={t('Case sensitive')}>
        <input
          type="checkbox"
          checked={!!ty.caseSensitive}
          onChange={(e) => patchTyping({ caseSensitive: e.target.checked })}
        />
      </Field>
      <div className="field-section">{t('Transform the text')}</div>
      <p className="settings-note" style={{ margin: '2px 0 6px' }}>
        {t('Change the drill text so you always type exactly what you see — also toggleable on the typing screen.')}
      </p>
      <Field label={t('All lowercase')}>
        <input type="checkbox" checked={!!ty.lowercase} onChange={(e) => patchTyping({ lowercase: e.target.checked })} />
      </Field>
      {!!ty.lowercase && (
        <Field label={t('…but show capitals as written')}>
          <label className="inline-check" title={t('Display the original capitalisation while typing lowercase still counts — display only')}>
            <input type="checkbox" checked={!!ty.showCaps} onChange={(e) => patchTyping({ showCaps: e.target.checked })} />
            {t('The drill shows “The”, you type “the”')}
          </label>
        </Field>
      )}
      <Field label={t('No special characters')}>
        <input
          type="checkbox"
          checked={!!ty.noSpecial}
          onChange={(e) => patchTyping({ noSpecial: e.target.checked })}
          title={t('Strip punctuation & symbols — type letters, numbers and spaces only')}
        />
      </Field>
      {!!ty.noSpecial && (
        <Field label={t('…but ghost the stripped characters')}>
          <label className="inline-check" title={t('Show the removed punctuation & symbols as dim auto-skipped ghosts in their own colour — you never type them; display only')}>
            <input type="checkbox" checked={!!ty.ghostSpecials} onChange={(e) => patchTyping({ ghostSpecials: e.target.checked })} />
            {t('Dim 👻 ghosts sit where the specials were')}
          </label>
        </Field>
      )}
      <Field label={t('Show line breaks (Passage)')}>
        <label className="inline-check" title={t('Show the book’s own line and paragraph breaks instead of a flowing wall — visual only, the words you type are identical')}>
          <input type="checkbox" checked={!!ty.showBreaks} onChange={(e) => patchTyping({ showBreaks: e.target.checked })} />
          {t('Break the passage where the book does (visual only)')}
        </label>
      </Field>
      <Field label={t('Remove non-typeable characters')}>
        <input
          type="checkbox"
          checked={ty.bypassNonQwerty !== false}
          onChange={(e) => patchTyping({ bypassNonQwerty: e.target.checked })}
          title={t('Characters a standard keyboard can’t reach (•, ¶, curly quotes, em-dashes, accents…) are converted to the nearest key or removed — so you never see a character you can’t type.')}
        />
      </Field>
      <Field label={t('Per-word timeout (ms, 0 = off)')}>
        <input
          type="number"
          min={0}
          max={60000}
          value={ty.perWordTimeoutMs || 0}
          onChange={(e) => patchTyping({ perWordTimeoutMs: Number(e.target.value) })}
        />
      </Field>
      <Field label={t('End-of-run grade fanfare')}>
        <input
          type="checkbox"
          checked={global.typingEndFanfare !== false}
          onChange={(e) => onPatchGlobal({ typingEndFanfare: e.target.checked })}
        />
      </Field>

      <div className="field-section">{t('Keyboard')}</div>
      <p className="settings-note">
        {t('Every run is stamped with the keyboard you typed it on, so Typing Progress can compare them. Detection is best-effort: the web hides keyboard hardware from key events, so Tachyread reads your OS layout (a QWERTY board is told apart from an AZERTY or QWERTZ one, not from another QWERTY) — link the hardware below to tell same-layout boards apart, and rename either way.')}
      </p>
      <Field label={t('Typing on')}>
        <select value={global.activeKeyboard || ''} onChange={(e) => onPatchGlobal({ activeKeyboard: e.target.value })}>
          {!list.length && <option value="">{t('Not detected yet')}</option>}
          {list.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </Field>
      {!!current && (
        <Field label={t('Name it')}>
          <input
            type="text"
            value={current.label}
            placeholder={t('e.g. Keychron K2, ThinkPad built-in')}
            onChange={(e) => onPatchGlobal({ keyboards: renameKeyboard(list, current.id, e.target.value) })}
          />
        </Field>
      )}
      <Field label={t('Link hardware')}>
        <button
          disabled={!hidSupported()}
          title={hidSupported()
            ? t('Grant access to the keyboard so runs can be matched to it by vendor and product id')
            : t('Needs a Chromium browser (Chrome, Edge, Brave)')}
          onClick={async () => {
            try {
              const kb = await linkKeyboard();
              if (!kb) return setLinkNote(t('No keyboard was picked.'));
              onPatchGlobal({ keyboards: upsertKeyboard(list, kb), activeKeyboard: kb.id });
              setActiveKeyboard(kb);
              setLinkNote(t('Linked {name}.', { name: kb.label }));
            } catch (err) { setLinkNote(t('Couldn’t link that: {error}', { error: err.message })); }
          }}
        >{t('Choose keyboard…')}</button>
      </Field>
      <p className="settings-note">
        {linkNote || t('Chrome hides plain keyboards from this chooser for security — only boards that also publish a vendor channel (QMK/VIA, Keychron, Logitech, Razer…) appear. A laptop’s built-in keyboard never will; name it by hand instead.')}
      </p>
      {!!current && list.length > 1 && (
        <Field label={t('Forget this keyboard')}>
          <button onClick={() => onPatchGlobal({ keyboards: removeKeyboard(list, current.id), activeKeyboard: '' })}>{t('Remove')}</button>
        </Field>
      )}
    </Dialog>
  );
}
