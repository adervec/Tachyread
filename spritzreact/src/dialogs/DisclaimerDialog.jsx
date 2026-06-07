import Dialog from './Dialog.jsx';

const REPO_URL = 'https://github.com/adervec/Tachyread';

// First-run notice surfacing the seizure warning + "not professional advice" +
// non-affiliation. Shown once (gated by localStorage in App), reopenable from the
// View menu. Full text lives in the repo's DISCLAIMER.md / PRIVACY.md.
export default function DisclaimerDialog({ onClose }) {
  return (
    <Dialog
      title="Before you start — please read"
      onClose={onClose}
      buttons={<button className="toggle-on" onClick={onClose}>I understand</button>}
    >
      <div style={{ maxWidth: 480 }}>
        <p
          style={{
            background: 'rgba(220, 60, 60, 0.12)',
            borderLeft: '3px solid #d9534f',
            padding: '10px 12px',
            borderRadius: 6,
            lineHeight: 1.45,
            margin: '0 0 12px',
          }}
        >
          ⚠️ <strong>Photosensitivity / seizure warning.</strong> This app flashes words
          rapidly (up to ~1500&nbsp;WPM) and has animated, neon, and pulsing visuals,
          which can trigger seizures in people with photosensitive epilepsy. If you have
          any history of seizures, consult a doctor first. Stop and seek medical help if
          you feel dizzy or disoriented or notice altered vision or twitching. Use lower
          speeds and calmer themes, and take breaks.
        </p>
        <p style={{ lineHeight: 1.45, margin: '0 0 12px' }}>
          <strong>Not professional advice.</strong> This is a free hobby project by a
          software developer — <strong>not a doctor, coach, teacher, or lawyer</strong>.
          The speed and &ldquo;efficiency&rdquo; numbers are for fun and self-tracking,
          not a medical, educational, or cognitive assessment, and not a promise of any
          improvement. Speed-reading benefits are scientifically debated.
        </p>
        <p style={{ lineHeight: 1.45, margin: '0 0 12px' }}>
          <strong>Your files stay on your device.</strong> No account, no servers, no
          tracking. Some optional features use your microphone, screen capture, or the
          browser&rsquo;s speech recognition (which, in Chrome, sends audio to Google).
        </p>
        <p style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.4, margin: 0 }}>
          Provided &ldquo;as is,&rdquo; without warranty. Not affiliated with Spritz
          Technology,&nbsp;Inc. Full{' '}
          <a href={`${REPO_URL}/blob/main/DISCLAIMER.md`} target="_blank" rel="noopener noreferrer">disclaimer</a>
          {' · '}
          <a href={`${REPO_URL}/blob/main/PRIVACY.md`} target="_blank" rel="noopener noreferrer">privacy</a>.
        </p>
      </div>
    </Dialog>
  );
}
