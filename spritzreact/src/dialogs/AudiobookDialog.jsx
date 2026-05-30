import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import {
  getAudiobookManifest,
  getAudioClip,
  deleteAudioClip,
  saveAudioClip,
} from '../state/storage.js';
import { recordClip } from '../features/audioRecorder.js';

export default function AudiobookDialog({ tab, onClose }) {
  const [manifest, setManifest] = useState({ lines: {} });
  const [recordingLi, setRecordingLi] = useState(null);
  const [recorder, setRecorder] = useState(null);

  async function refresh() {
    if (!tab?.doc?.contentChecksum) return;
    setManifest(await getAudiobookManifest(tab.doc.contentChecksum));
  }

  useEffect(() => {
    refresh();
  }, [tab?.doc?.contentChecksum]);

  async function play(li) {
    const clip = await getAudioClip(tab.doc.contentChecksum, li);
    if (!clip) return;
    const url = URL.createObjectURL(clip.blob);
    const a = new Audio(url);
    a.onended = () => URL.revokeObjectURL(url);
    a.play();
  }

  async function record(li) {
    if (recorder) recorder.stop();
    setRecordingLi(li);
    const rec = await recordClip({
      onStop: async ({ blob, durationMs }) => {
        await saveAudioClip(tab.doc.contentChecksum, li, blob, durationMs);
        setRecordingLi(null);
        refresh();
      },
    });
    setRecorder(rec);
  }
  function stopRecord() {
    if (recorder) {
      recorder.stop();
      setRecorder(null);
    }
  }

  async function exportZip() {
    // Concatenate all clips into a single Blob via simple sequential playback.
    // Browser-only: produces a webm container per clip; we offer a JSON manifest + clip blobs.
    const lines = Object.keys(manifest.lines).map(Number).sort((a, b) => a - b);
    const blobs = [];
    for (const li of lines) {
      const clip = await getAudioClip(tab.doc.contentChecksum, li);
      if (clip) blobs.push(clip.blob);
    }
    if (!blobs.length) return;
    const combined = new Blob(blobs, { type: blobs[0].type || 'audio/webm' });
    const url = URL.createObjectURL(combined);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tab.doc.fileName || 'audiobook'}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog title="Audiobook Manager" onClose={onClose} width={680}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button onClick={exportZip}>Export combined audio</button>
      </div>
      <table className="history-table">
        <thead>
          <tr><th>Line</th><th>Preview</th><th>Recorded?</th><th>Duration</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {tab.doc.lines.slice(0, 1000).map((line, li) => {
            const entry = manifest.lines[li];
            return (
              <tr key={li}>
                <td>{li + 1}</td>
                <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {line.text.slice(0, 80)}
                </td>
                <td>{entry ? '✓' : ''}</td>
                <td>{entry ? Math.round(entry.durationMs / 100) / 10 + 's' : ''}</td>
                <td>
                  {entry && <button onClick={() => play(li)}>Play</button>}{' '}
                  {recordingLi === li ? (
                    <button className="toggle-on" onClick={stopRecord}>Stop</button>
                  ) : (
                    <button onClick={() => record(li)}>Rec</button>
                  )}{' '}
                  {entry && (
                    <button onClick={async () => { await deleteAudioClip(tab.doc.contentChecksum, li); refresh(); }}>
                      Del
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {tab.doc.lines.length > 1000 && (
        <div style={{ color: 'var(--status-fg)', marginTop: 6 }}>
          Showing first 1,000 lines. Use the inline REC toggle while reading to capture in order.
        </div>
      )}
    </Dialog>
  );
}
