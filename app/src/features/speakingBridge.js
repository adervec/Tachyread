// Reading-aloud sessions for SpeechImprover: one small JSON file per session in the Tachyread
// folder's speech/ subfolder — next to the narration logs it already watches — so the reading done
// here counts as speech practice there, with the voice and presenting scores to analyse in depth.
// Protocol `tachyread-speaking` v1; the field meanings travel inside the file.
import { SPEECH_LOG_FIELDS } from './speechLog.js';
import { subDir } from './tachyFolder.js';

export const SPEAKING_PROTOCOL = 'tachyread-speaking';

// Pure: the file's content for a finished speech-log record.
export function speakingLog(rec, now = new Date(rec.end || rec.at || Date.now())) {
  return {
    app: 'tachyread', protocol: SPEAKING_PROTOCOL, version: 1,
    createdAt: now.toISOString(), docName: rec.name || '',
    fields: SPEECH_LOG_FIELDS,
    session: rec,
  };
}
export const speakingLogName = (rec) => `tachyread-speaking-${new Date(rec.at).toISOString().replace(/[:.]/g, '-')}.json`;

// Writes the log when the Tachyread folder is set up (silently skipped otherwise — the record is
// still in this device's speech log). Returns the file name, or null.
export async function writeSpeakingLog(rec) {
  const dir = await subDir('speech').catch(() => null);
  if (!dir) return null;
  try {
    const name = speakingLogName(rec);
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable(); await w.write(JSON.stringify(speakingLog(rec), null, 2)); await w.close();
    return name;
  } catch { return null; }
}
