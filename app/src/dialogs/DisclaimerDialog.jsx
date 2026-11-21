/* global __BUILD_NUMBER__, __BUILD_SHA__, __BUILD_DATE__ */
import Dialog from './Dialog.jsx';
import { deviceKind, isCompactScreen, isCoarsePointer } from '../state/device.js';
import { t } from '../i18n.js';

const REPO_URL = 'https://github.com/adervec/Tachyread';
// deviceKind() is shown with t(): i18n-keys: Mobile | Desktop

// First-run notice surfacing the seizure warning + "not professional advice" +
// non-affiliation. Shown once (gated by localStorage in App), reopenable from the
// View menu. Full text lives in the repo's DISCLAIMER.md / PRIVACY.md.
export default function DisclaimerDialog({ onClose }) {
  return (
    <Dialog
      title={t('Before you start — please read')}
      onClose={onClose}
      buttons={<button className="toggle-on" onClick={onClose}>{t('I understand')}</button>}
    >
      <div style={{ maxWidth: 480 }}>
        <p
          style={{
            background: 'rgba(220, 60, 60, 0.12)',
            borderInlineStart: '3px solid #d9534f',
            padding: '10px 12px',
            borderRadius: 6,
            lineHeight: 1.45,
            margin: '0 0 12px',
          }}
        >
          ⚠️ <strong>{t('Photosensitivity / seizure warning.')}</strong>{' '}
          {t('This app flashes words rapidly (up to ~{speed}) and has animated, neon, and pulsing visuals, which can trigger seizures in people with photosensitive epilepsy. If you have any history of seizures, consult a doctor first. Stop and seek medical help if you feel dizzy or disoriented or notice altered vision or twitching. Use lower speeds and calmer themes, and take breaks.', { speed: '1500\u00a0WPM' })}
        </p>
        <p style={{ lineHeight: 1.45, margin: '0 0 12px' }}>
          <strong>{t('Not professional advice.')}</strong>{' '}
          {t('This is a free hobby project by a software developer — not a doctor, coach, teacher, or lawyer.')}{' '}
          {t('The speed and “efficiency” numbers are for fun and self-tracking, not a medical, educational, or cognitive assessment, and not a promise of any improvement. Speed-reading benefits are scientifically debated.')}
        </p>
        <p style={{ lineHeight: 1.45, margin: '0 0 12px' }}>
          <strong>{t('Your files stay on your device.')}</strong>{' '}
          {t('No account, no servers, no tracking. Some optional features use your microphone, screen capture, or the browser’s speech recognition (which, in Chrome, sends audio to Google).')}
        </p>
        <p style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.4, margin: 0 }}>
          {t('Provided “as is,” without warranty. Not affiliated with any company.')}{' '}
          <a href={`${REPO_URL}/blob/main/DISCLAIMER.md`} target="_blank" rel="noopener noreferrer">{t('Full disclaimer')}</a>
          {' · '}
          <a href={`${REPO_URL}/blob/main/PRIVACY.md`} target="_blank" rel="noopener noreferrer">{t('Privacy')}</a>.
          {' '}{t('More apps by this maker —')}{' '}
          <a href="https://adervec.github.io" target="_blank" rel="noopener noreferrer">adervec.github.io</a>.
        </p>
        <p style={{ fontSize: 11, opacity: 0.6, lineHeight: 1.5, margin: '12px 0 0', borderTop: '1px solid var(--divider)', paddingTop: 8 }}>
          {t('Build')} <strong>{__BUILD_NUMBER__}</strong> · {__BUILD_SHA__} · {__BUILD_DATE__}<br />
          {t('Detected:')} <strong>{t(deviceKind())}</strong> — {isCoarsePointer() ? t('touch pointer') : t('fine pointer')},{' '}
          {isCompactScreen() ? t('compact layout') : t('full layout')} ({typeof window !== 'undefined' ? `${window.innerWidth}×${window.innerHeight}` : '—'})
        </p>
      </div>
    </Dialog>
  );
}
