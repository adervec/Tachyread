import { useEffect, useRef } from 'react';
import { t } from '../i18n.js';

const STATE_LABEL = {
  starting: t('starting…'), watching: t('watching'), away: t('looked away'), drowsy: t('drowsy'),
  denied: t('blocked'), error: t('error'), unsupported: t('no detection'), off: '',
};

// Small live self-view shown while a webcam guard is on, so you can confirm framing and see that the
// camera is active. The frame is mirrored (selfie-style); a coloured ring reflects the current state.
export default function WebcamPreview({ stream, state, canCalibrate, onCalibrate, onHide }) {
  const vref = useRef(null);
  useEffect(() => {
    const v = vref.current;
    if (!v) return;
    v.srcObject = stream || null;
    if (stream) v.play?.().catch(() => {});
  }, [stream]);

  return (
    <div className={`webcam-preview wb-${state}`}>
      <video ref={vref} muted playsInline className="webcam-preview-vid" />
      <div className="webcam-preview-bar">
        <span className="wpv-dot" />
        <span className="wpv-state">{STATE_LABEL[state] ?? state}</span>
        <span style={{ flex: 1 }} />
        {canCalibrate && <button title={t('Calibrate eye detection')} onClick={onCalibrate}>⚙</button>}
        <button title={t('Hide preview')} onClick={onHide}>×</button>

      </div>
    </div>
  );
}
