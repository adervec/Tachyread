import { useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { TYPING_MODES } from '../engine/typingModes.js';
import { makePlan, makeStep, duplicatePlan, applySetOp, totalSets } from '../engine/typingPlans.js';
import { t } from '../i18n.js';

// Create / edit typing plans (ordered workouts of drill steps × sets) and start one.
export default function TypingPlanDialog({ onStart, onClose }) {
  const { state, updateGlobal } = useApp();
  const plans = state.global.typingPlans || [];
  const [selId, setSelId] = useState(plans[0]?.id || null);
  const sel = useMemo(() => plans.find((p) => p.id === selId) || null, [plans, selId]);

  function savePlans(next) { updateGlobal({ typingPlans: next }); }
  function updatePlan(id, fn) { savePlans(plans.map((p) => (p.id === id ? fn(p) : p))); }

  function newPlan() {
    const p = makePlan(t('New plan'));
    savePlans([...plans, p]);
    setSelId(p.id);
  }
  function dupSelected() {
    if (!sel) return;
    const p = duplicatePlan(sel);
    savePlans([...plans, p]);
    setSelId(p.id);
  }
  function deleteSelected() {
    if (!sel) return;
    const next = plans.filter((p) => p.id !== sel.id);
    savePlans(next);
    setSelId(next[0]?.id || null);
  }

  // ── step edits (on the selected plan) ──
  const setSteps = (fn) => updatePlan(sel.id, (p) => ({ ...p, steps: fn(p.steps || []) }));
  const patchStep = (i, patch) => setSteps((steps) => steps.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const addStep = () => setSteps((steps) => [...steps, makeStep()]);
  const removeStep = (i) => setSteps((steps) => (steps.length > 1 ? steps.filter((_, k) => k !== i) : steps));
  const moveStep = (i, d) => setSteps((steps) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return steps;
    const next = steps.slice();
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const bulkSets = (op) => updatePlan(sel.id, (p) => applySetOp(p, op));

  return (
    <Dialog
      title={t('Typing plans')}
      onClose={onClose}
      width={680}
      buttons={
        <>
          {sel && <button className="toggle-on" disabled={!onStart} onClick={() => { onStart?.(sel); }}>▶ {t('Start plan')}</button>}
          <button onClick={onClose}>{t('Close')}</button>
        </>
      }
    >
      <p className="settings-note" style={{ marginTop: 0 }}>
        {t('A plan is an ordered workout of typing steps; each step is a drill repeated for a number of sets, with an optional description spoken aloud when the step begins.')}
      </p>

      <div className="data-row">
        <select value={selId || ''} onChange={(e) => setSelId(e.target.value)} disabled={!plans.length} style={{ minWidth: 200 }}>
          {!plans.length && <option value="">{t('No plans yet')}</option>}
          {plans.map((p) => <option key={p.id} value={p.id}>{t.n('{name} · {n} set', '{name} · {n} sets', totalSets(p), { name: p.name })}</option>)}
        </select>
        <button onClick={newPlan}>+ {t('New')}</button>
        <button onClick={dupSelected} disabled={!sel} title={t('Start from a copy of this plan')}>⧉ {t('Duplicate')}</button>
        <button className="grab-trash" onClick={deleteSelected} disabled={!sel}>{t('Delete')}</button>
      </div>

      {sel && (
        <>
          <div className="field-row">
            <label>{t('Plan name')}</label>
            <input value={sel.name} onChange={(e) => updatePlan(sel.id, (p) => ({ ...p, name: e.target.value }))} />
          </div>

          <div className="field-section" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>{t('Steps')}</span>
            <span style={{ flex: 1 }} />
            <span className="settings-note" style={{ margin: 0 }}>{t('Sets, all steps:')}</span>
            <button onClick={() => bulkSets('double')} title={t('Double every step’s sets')}>×2</button>
            <button onClick={() => bulkSets('halve')} title={t('Halve every step’s sets')}>÷2</button>
            <button onClick={() => bulkSets('inc')} title={t('Add 1 set to every step')}>+1</button>
            <button onClick={() => bulkSets('dec')} title={t('Remove 1 set from every step (min 1)')}>−1</button>
          </div>

          <div className="tp-steps">
            {(sel.steps || []).map((s, i) => (
              <div key={s.id} className="tp-step">
                <div className="tp-step-head">
                  <span className="tp-step-n">{i + 1}</span>
                  <select value={s.mode} onChange={(e) => patchStep(i, { mode: e.target.value })} title={t('Drill / mode')}>
                    {TYPING_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                  <select value={s.runMode} onChange={(e) => patchStep(i, { runMode: e.target.value })} title={t('Run length type')}>
                    <option value="seconds">{t('Seconds')}</option>
                    <option value="words">{t('Words')}</option>
                    <option value="endless">{t('Endless')}</option>
                  </select>
                  {s.runMode !== 'endless' && (
                    <input type="number" min={1} max={9999} value={s.runLimit} title={t('Limit')} style={{ width: 64 }}
                      onChange={(e) => patchStep(i, { runLimit: Math.max(1, Number(e.target.value) || 1) })} />
                  )}
                  <input type="number" min={0} max={300} value={s.passWpm || 0} style={{ width: 56 }} aria-label={t('Pass mark: minimum net WPM')}
                    title={t('Pass mark: minimum net WPM to move on (0 = none) — a set below it has to be redone')}
                    onChange={(e) => patchStep(i, { passWpm: Math.max(0, Number(e.target.value) || 0) })} />
                  <span className="lj-qdim" style={{ fontSize: 11 }}>{t('wpm')}</span>
                  <input type="number" min={0} max={100} value={s.passAcc || 0} style={{ width: 50 }} aria-label={t('Pass mark: minimum accuracy %')}
                    title={t('Pass mark: minimum accuracy % to move on (0 = none)')}
                    onChange={(e) => patchStep(i, { passAcc: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
                  <span className="lj-qdim" style={{ fontSize: 11 }}>%</span>
                  <label className="tp-sets" title={t('How many times to repeat this step')}>
                    ×<input type="number" min={1} max={99} value={s.sets}
                      onChange={(e) => patchStep(i, { sets: Math.max(1, Number(e.target.value) || 1) })} /> {t('sets')}
                  </label>
                  <span style={{ flex: 1 }} />
                  <button className="tp-mini" title={t('Move up')} disabled={i === 0} onClick={() => moveStep(i, -1)}>↑</button>
                  <button className="tp-mini" title={t('Move down')} disabled={i === sel.steps.length - 1} onClick={() => moveStep(i, 1)}>↓</button>
                  <button className="tp-mini grab-trash" title={t('Remove step')} disabled={sel.steps.length <= 1} onClick={() => removeStep(i)}>✕</button>
                </div>
                <input className="tp-step-desc" placeholder={t('Spoken description (optional) — read aloud when this step starts')}
                  value={s.description} onChange={(e) => patchStep(i, { description: e.target.value })} />
              </div>
            ))}
          </div>
          <div className="data-row">
            <button onClick={addStep}>+ {t('Add step')}</button>
            <span className="settings-note" style={{ margin: 0 }}>{t.n('{sets} sets total across {n} step.', '{sets} sets total across {n} steps.', sel.steps.length, { sets: totalSets(sel) })}</span>
          </div>
          {!onStart && <p className="settings-note">{t('Open a document first to run a plan (typing practice types against it / its drills).')}</p>}
        </>
      )}
    </Dialog>
  );
}
