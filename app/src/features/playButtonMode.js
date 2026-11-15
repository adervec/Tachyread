// What the Play button should show given the active reading toggles. Beyond scroll-to-read (which
// disables auto-play entirely), read-aloud changes Play from "flash words" to "speak", so the glyph
// reflects it (🔊 native / 🎧 offline voice that survives a screen lock); the title enumerates every
// engaged mode so the button explains itself.
import { t } from '../i18n.js';

export function playButtonView({ playing, scrollMode, readAloud, offlineVoice, followMode, timerMin, adapt, voiceCmd }) {
  if (scrollMode) {
    return { glyph: '📜', cls: 'scroll-disabled', disabled: true, title: t('Scroll-to-read is on — auto-play off; scroll the Lines pane to read') };
  }
  const modes = [];
  if (readAloud) modes.push(offlineVoice ? t('read aloud · offline voice') : t('read aloud'));
  if (followMode && followMode !== 'off') modes.push(followMode === 'line' ? t('follow: line') : t('follow: first word'));
  if (adapt) modes.push(t('adaptive pace'));
  if (timerMin) modes.push(t('auto-stop {min}m', { min: timerMin }));
  if (voiceCmd) modes.push(t('voice commands'));
  const suffix = modes.length ? ` — ${modes.join(' · ')}` : '';
  const glyph = playing ? '⏸️' : (readAloud ? (offlineVoice ? '🎧' : '🔊') : '▶️');
  const cls = readAloud ? 'read-aloud' : '';
  return { glyph, cls, disabled: false, title: (playing ? t('Pause (Space)') : t('Play (Space)')) + suffix };
}
