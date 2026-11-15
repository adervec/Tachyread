import { FILTER_PRESETS, FILTER_DEFAULTS, normalizeFilter, filterCss, matchPreset } from '../features/displayFilters.js';
import { t } from '../i18n.js';

// Shared display-filter editor (camera feed looks + source page looks): a preset dropdown plus the
// full slider set for custom mixes. `value` is the stored fx object (null = off); onChange gets
// the next fx or null when reset to neutral.

const SLIDERS = [
  ['blur', t('Blur'), 0, 8, 0.2, (v) => `${v}px`],
  ['brightness', t('Brightness'), 0.4, 1.8, 0.02, (v) => `${v}×`],
  ['contrast', t('Contrast'), 0.4, 2.5, 0.02, (v) => `${v}×`],
  ['saturate', t('Saturation'), 0, 4, 0.05, (v) => `${v}×`],
  ['hueRotate', t('Hue shift'), 0, 360, 5, (v) => `${v}°`],
  ['sepia', t('Sepia'), 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`],
  ['invert', t('Invert'), 0, 1, 0.02, (v) => `${Math.round(v * 100)}%`],
  ['grayscale', t('Grayscale'), 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`],
];

export default function FilterControls({ value, onChange }) {
  const fx = { ...FILTER_DEFAULTS, ...(value || {}) };
  const preset = matchPreset(value);
  const set = (k, v) => {
    const next = normalizeFilter({ ...fx, [k]: v });
    onChange(filterCss(next) ? next : null);
  };
  return (
    <div className="fxc">
      <div className="fxc-row">
        <select
          value={preset}
          onChange={(e) => {
            const p = FILTER_PRESETS.find((x) => x.id === e.target.value);
            if (p) onChange(p.id === 'none' ? null : { ...p.fx });
          }}
          title={t('Ready-made looks — pick one, then fine-tune with the sliders')}
        >
          {FILTER_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          {preset === 'custom' && <option value="custom">{t('Custom…')}</option>}
        </select>
        {filterCss(fx) !== '' && <button type="button" onClick={() => onChange(null)} title={t('Back to no filter')}>{t('Reset')}</button>}
      </div>
      <div className="fxc-grid">
        {SLIDERS.map(([k, label, min, max, step, fmt]) => (
          <label key={k} className="fxc-slider" title={label}>
            <span className="fxc-l">{label}</span>
            <input type="range" min={min} max={max} step={step} value={fx[k]} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="fxc-v">{fmt(Math.round(fx[k] * 100) / 100)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
