import { useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { TYPING_MODES } from '../engine/typingModes.js';
import { makePlan, makeStep, duplicatePlan, applySetOp, totalSets } from '../engine/typingPlans.js';

// Create / edit typing plans (ordered workouts of drill steps × sets) and start one.
export default function TypingPlanDialog({ onStart, onClose }) {
  const { state, updateGlobal } = useApp();
  const plans = state.global.typingPlans || [];
  const [selId, setSelId] = useState(plans[0]?.id || null);
  const sel = useMemo(() => plans.find((p) => p.id === selId) || null, [plans, selId]);

  function savePlans(next) { updateGlobal({ typingPlans: next }); }
  function updatePlan(id, fn) { savePlans(plans.map((p) => (p.id === id ? fn(p) : p))); }

  function newPlan() {
    const p = makePlan('New plan');
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
      title="Typing plans"
      onClose={onClose}
      width={680}
      buttons={
        <>
          {sel && <button className="toggle-on" disabled={!onStart} onClick={() => { onStart?.(sel); }}>▶ Start plan</button>}
          <button onClick={onClose}>Close</button>
        </>
      }
    >
      <p className="settings-note" style={{ marginTop: 0 }}>
        A plan is an ordered workout of typing steps; each step is a drill repeated for a number of
        <strong> sets</strong>, with an optional description spoken aloud when the step begins.
      </p>

      <div className="data-row">
        <select value={selId || ''} onChange={(e) => setSelId(e.target.value)} disabled={!plans.length} style={{ minWidth: 200 }}>
          {!plans.length && <option value="">No plans yet</option>}
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {totalSets(p)} sets</option>)}
        </select>
        <button onClick={newPlan}>+ New</button>
        <button onClick={dupSelected} disabled={!sel} title="Start from a copy of this plan">⧉ Duplicate</button>
        <button className="grab-trash" onClick={deleteSelected} disabled={!sel}>Delete</button>
      </div>

      {sel && (
        <>
          <div className="field-row">
            <label>Plan name</label>
            <input value={sel.name} onChange={(e) => updatePlan(sel.id, (p) => ({ ...p, name: e.target.value }))} />
          </div>

          <div className="field-section" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Steps</span>
            <span style={{ flex: 1 }} />
            <span className="settings-note" style={{ margin: 0 }}>Sets, all steps:</span>
            <button onClick={() => bulkSets('double')} title="Double every step's sets">×2</button>
            <button onClick={() => bulkSets('halve')} title="Halve every step's sets">÷2</button>
            <button onClick={() => bulkSets('inc')} title="Add 1 set to every step">+1</button>
            <button onClick={() => bulkSets('dec')} title="Remove 1 set from every step (min 1)">−1</button>
          </div>

          <div className="tp-steps">
            {(sel.steps || []).map((s, i) => (
              <div key={s.id} className="tp-step">
                <div className="tp-step-head">
                  <span className="tp-step-n">{i + 1}</span>
                  <select value={s.mode} onChange={(e) => patchStep(i, { mode: e.target.value })} title="Drill / mode">
                    {TYPING_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                  <select value={s.runMode} onChange={(e) => patchStep(i, { runMode: e.target.value })} title="Run length type">
                    <option value="seconds">Seconds</option>
                    <option value="words">Words</option>
                    <option value="endless">Endless</option>
                  </select>
                  {s.runMode !== 'endless' && (
                    <input type="number" min={1} max={9999} value={s.runLimit} title="Limit" style={{ width: 64 }}
                      onChange={(e) => patchStep(i, { runLimit: Math.max(1, Number(e.target.value) || 1) })} />
                  )}
                  <label className="tp-sets" title="How many times to repeat this step">
                    ×<input type="number" min={1} max={99} value={s.sets}
                      onChange={(e) => patchStep(i, { sets: Math.max(1, Number(e.target.value) || 1) })} /> sets
                  </label>
                  <span style={{ flex: 1 }} />
                  <button className="tp-mini" title="Move up" disabled={i === 0} onClick={() => moveStep(i, -1)}>↑</button>
                  <button className="tp-mini" title="Move down" disabled={i === sel.steps.length - 1} onClick={() => moveStep(i, 1)}>↓</button>
                  <button className="tp-mini grab-trash" title="Remove step" disabled={sel.steps.length <= 1} onClick={() => removeStep(i)}>✕</button>
                </div>
                <input className="tp-step-desc" placeholder="Spoken description (optional) — read aloud when this step starts"
                  value={s.description} onChange={(e) => patchStep(i, { description: e.target.value })} />
              </div>
            ))}
          </div>
          <div className="data-row">
            <button onClick={addStep}>+ Add step</button>
            <span className="settings-note" style={{ margin: 0 }}>{totalSets(sel)} sets total across {sel.steps.length} step(s).</span>
          </div>
          {!onStart && <p className="settings-note">Open a document first to run a plan (typing practice types against it / its drills).</p>}
        </>
      )}
    </Dialog>
  );
}
