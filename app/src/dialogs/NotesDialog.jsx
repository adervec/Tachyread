import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { getNotes, saveNote, deleteNote } from '../state/storage.js';
import { askClaude, anthropicConfigured, ANTHROPIC_MODELS } from '../features/anthropic.js';

const MAX_CONTEXT = 14000; // chars of document text sent to the AI (keeps token use in check)
const when = (ts) => (ts ? new Date(ts).toLocaleString() : '');

// Notes & annotation suite for a document: free-form and position-anchored notes (synced by content
// checksum across devices), plus optional AI (Anthropic) to summarize/analyze the text and discuss
// it together with your notes. The API key lives on this device; text sent to the AI leaves it.
export default function NotesDialog({ tab, onJumpWord, onClose }) {
  const { state, updateGlobal, openDialog } = useApp();
  const checksum = tab?.doc?.contentChecksum;
  const [pane, setPane] = useState('notes'); // 'notes' | 'ai'
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');
  const [anchor, setAnchor] = useState(true); // anchor the new note to the current reading position
  const [editing, setEditing] = useState(null); // { id, text }

  async function refresh() { if (checksum) setNotes((await getNotes(checksum)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))); }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [checksum]);

  async function addNote(text, wordIndex) {
    if (!(text || '').trim()) return;
    await saveNote(checksum, { text: text.trim(), wordIndex: wordIndex ?? null });
    setDraft(''); refresh();
  }
  async function saveEdit() {
    if (!editing) return;
    await saveNote(checksum, { id: editing.id, text: editing.text, wordIndex: editing.wordIndex });
    setEditing(null); refresh();
  }
  async function remove(id) { await deleteNote(checksum, id); refresh(); }

  // ── AI ──
  const key = state.global.anthropicKey;
  const model = state.global.anthropicModel || 'claude-sonnet-5';
  const hasKey = anthropicConfigured(key);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState('');
  const [output, setOutput] = useState(''); // summary/analysis result
  const [chat, setChat] = useState([]); // { role, content }
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef(null);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ block: 'end' }); }, [chat]);

  const docExcerpt = () => {
    const full = tab.doc.fullText || tab.doc.words.join(' ');
    return full.length > MAX_CONTEXT ? full.slice(0, MAX_CONTEXT) + '\n…[truncated]' : full;
  };
  const notesBlock = () => (notes.length ? notes.map((n) => `- ${n.wordIndex != null ? `[@word ${n.wordIndex + 1}] ` : ''}${n.text}`).join('\n') : '(no notes yet)');

  async function runAI(kind) {
    setAiBusy(true); setAiErr(''); setOutput('');
    try {
      const system = `You are a reading companion for the document "${tab.doc.fileName}". Be concise and specific; ground everything in the provided text.`;
      const prompt = kind === 'summary'
        ? `Summarize the following text in a few tight paragraphs, then list the key points as bullets.\n\n<text>\n${docExcerpt()}\n</text>`
        : `Analyze the following text: its themes, structure, argument/plot, tone, and anything notable. Reference the reader's notes where relevant.\n\n<notes>\n${notesBlock()}\n</notes>\n\n<text>\n${docExcerpt()}\n</text>`;
      setOutput(await askClaude([{ role: 'user', content: prompt }], { key, model, maxTokens: 1400, system, source: `notes-${kind}` }));
    } catch (e) { setAiErr(e?.message || String(e)); }
    setAiBusy(false);
  }
  async function sendChat() {
    const q = chatInput.trim();
    if (!q || aiBusy) return;
    const history = [...chat, { role: 'user', content: q }];
    setChat(history); setChatInput(''); setAiBusy(true); setAiErr('');
    try {
      const system = `You are discussing the document "${tab.doc.fileName}" with the reader. Use the text and their notes to answer; be concise and cite specifics. If something isn't in the text, say so.\n\n<notes>\n${notesBlock()}\n</notes>\n\n<text_excerpt>\n${docExcerpt()}\n</text_excerpt>`;
      const reply = await askClaude(history.map((m) => ({ role: m.role, content: m.content })), { key, model, maxTokens: 1024, system, source: 'notes-chat' });
      setChat((c) => [...c, { role: 'assistant', content: reply }]);
    } catch (e) { setAiErr(e?.message || String(e)); setChat((c) => c.slice(0, -1)); setChatInput(q); }
    setAiBusy(false);
  }

  return (
    <Dialog title={`Notes — ${tab.doc.fileName}`} onClose={onClose} width={640} buttons={<button onClick={onClose}>Close</button>}>
      <div className="rh-tabs">
        <button className={`rh-tab${pane === 'notes' ? ' on' : ''}`} onClick={() => setPane('notes')}>📝 Notes ({notes.length})</button>
        <button className={`rh-tab${pane === 'ai' ? ' on' : ''}`} onClick={() => setPane('ai')}>✨ AI</button>
      </div>

      {pane === 'notes' ? (
        <>
          <div className="note-add">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder="Write a note…" />
            <div className="note-add-row">
              <label className="inline-check" title="Link this note to your current reading position so you can jump back to it">
                <input type="checkbox" checked={anchor} onChange={(e) => setAnchor(e.target.checked)} /> Anchor to current position (word {tab.settings.wordIndex + 1})
              </label>
              <button className="toggle-on" disabled={!draft.trim()} onClick={() => addNote(draft, anchor ? tab.settings.wordIndex : null)}>Add note</button>
            </div>
          </div>
          <div className="note-list">
            {notes.length === 0 && <p className="settings-note">No notes yet. Add one above, or from the reader (long-press / right-click a word → 📝 Add note).</p>}
            {notes.map((n) => (
              <div key={n.id} className="note-card">
                {editing?.id === n.id ? (
                  <>
                    <textarea value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} rows={2} />
                    <div className="note-card-actions">
                      <button className="toggle-on" onClick={saveEdit}>Save</button>
                      <button onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="note-text">{n.text}</div>
                    <div className="note-card-actions">
                      {n.wordIndex != null && <button className="note-anchor" title="Jump to this position" onClick={() => { onJumpWord(n.wordIndex); }}>↪ word {n.wordIndex + 1}</button>}
                      <span className="note-when">{when(n.updatedAt)}</span>
                      <span style={{ flex: 1 }} />
                      <button onClick={() => setEditing({ id: n.id, text: n.text, wordIndex: n.wordIndex })}>Edit</button>
                      <button className="grab-trash" onClick={() => remove(n.id)}>🗑</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          {!hasKey ? (
            <p className="settings-note">
              Add your <strong>Anthropic API key</strong> in{' '}
              <button className="link-btn" onClick={() => { onClose(); openDialog({ kind: 'app-settings' }); }}>Application Settings</button>{' '}
              to summarize, analyze, and discuss this text with AI. The key stays on this device; text you send goes to Anthropic.
            </p>
          ) : (
            <>
              <div className="note-add-row" style={{ marginTop: 4 }}>
                <select value={model} onChange={(e) => updateGlobal({ anthropicModel: e.target.value })} title="Anthropic model">
                  {ANTHROPIC_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <button onClick={() => runAI('summary')} disabled={aiBusy}>Summarize</button>
                <button onClick={() => runAI('analyze')} disabled={aiBusy}>Analyze</button>
                {aiBusy && <span className="settings-note" style={{ margin: 0 }}>Thinking…</span>}
              </div>
              {aiErr && <p className="settings-note" style={{ color: '#c0392b' }}>{aiErr}</p>}
              {output && (
                <div className="ai-output">
                  <div className="ai-output-text">{output}</div>
                  <button className="note-anchor" onClick={() => { addNote(output, null); setOutput(''); setPane('notes'); }}>＋ Save as note</button>
                </div>
              )}
              <div className="field-section" style={{ marginTop: 10 }}>Discuss</div>
              <div className="ai-chat">
                {chat.length === 0 && <div className="settings-note">Ask about the text or your notes — e.g. “What’s the main argument?”, “Summarize my notes”, “Explain the passage at word {tab.settings.wordIndex + 1}”.</div>}
                {chat.map((m, i) => <div key={i} className={`ai-msg ${m.role}`}><span className="ai-role">{m.role === 'user' ? 'You' : 'Claude'}</span><div className="ai-msg-text">{m.content}</div></div>)}
                <div ref={chatEndRef} />
              </div>
              <div className="ai-chat-input">
                <textarea value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }} rows={2} placeholder="Ask about this text…" />
                <button className="toggle-on" disabled={aiBusy || !chatInput.trim()} onClick={sendChat}>Send</button>
              </div>
              <p className="settings-note" style={{ margin: '4px 0 0' }}>Sends a text excerpt (first {(MAX_CONTEXT / 1000) | 0}k chars) + your notes to Anthropic — spends your API credits.</p>
            </>
          )}
        </>
      )}
    </Dialog>
  );
}
