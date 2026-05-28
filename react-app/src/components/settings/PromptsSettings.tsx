import { useState } from 'react';
import type { Settings, SystemPrompt } from '../../types';

interface PromptsSettingsProps {
  prompts: SystemPrompt[];
  defaultPromptId: string;
  onSetDefault: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onDuplicate: (index: number) => void;
  onDelete: (id: string) => void;
  onSave: (prompt: { id?: string; name: string; content: string }) => void;
  onPromptsChanged: () => void;
  form: Settings;
  setField: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

export function PromptsSettings({
  prompts,
  defaultPromptId,
  onSetDefault,
  onReorder,
  onDuplicate,
  onDelete,
  onSave,
  onPromptsChanged,
  setField,
}: PromptsSettingsProps) {
  const [showNewPromptForm, setShowNewPromptForm] = useState(false);
  const [editingPromptIdx, setEditingPromptIdx] = useState(-1);
  const [newPromptName, setNewPromptName] = useState('');
  const [newPromptContent, setNewPromptContent] = useState('');

  function resetPromptForm() {
    setNewPromptName('');
    setNewPromptContent('');
    setEditingPromptIdx(-1);
    setShowNewPromptForm(false);
  }

  function handleSavePrompt() {
    const name = newPromptName.trim();
    const content = newPromptContent.trim();
    if (!name || !content) return;
    if (editingPromptIdx >= 0) {
      const existing = prompts[editingPromptIdx];
      onSave({ id: existing.id, name, content });
    } else {
      onSave({ name, content });
    }
    onPromptsChanged();
    resetPromptForm();
  }

  function openEditPrompt(idx: number) {
    const p = prompts[idx];
    setNewPromptName(p.name);
    setNewPromptContent(p.content);
    setEditingPromptIdx(idx);
    setShowNewPromptForm(true);
  }

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <span className="settings-card-title">System prompts</span>
        <span className="ml-auto text-[11px] text-text-dim">★ = default for new chats</span>
      </div>
      <div className="settings-card-body">
        <div id="sp-saved-list">
          {prompts.length === 0 ? (
            <p className="text-[12px] text-text-dim">No saved prompts yet.</p>
          ) : (
            <div className="space-y-1.5">
              {prompts.map((p, i) => (
                <div key={p.id} className="sp-saved-item">
                  <span className="sp-saved-name flex-1 text-[13px] text-text-muted truncate">
                    {p.name}
                  </span>
                  <button
                    className={`sp-saved-default sp-btn text-[14px] ${
                      p.id === defaultPromptId
                        ? 'text-yellow-400 active'
                        : 'text-text-dim hover:text-yellow-400'
                    }`}
                    title="Set as default"
                    onClick={() => {
                      onSetDefault(p.id);
                      onPromptsChanged();
                      setField('defaultPromptId', p.id);
                    }}
                  >
                    ★
                  </button>
                  <button
                    className="sp-btn"
                    title="Move up"
                    disabled={i === 0}
                    onClick={() => {
                      onReorder(i, i - 1);
                      onPromptsChanged();
                    }}
                  >
                    ↑
                  </button>
                  <button
                    className="sp-btn"
                    title="Move down"
                    disabled={i === prompts.length - 1}
                    onClick={() => {
                      onReorder(i, i + 1);
                      onPromptsChanged();
                    }}
                  >
                    ↓
                  </button>
                  <button
                    className="sp-saved-copy sp-btn"
                    title="Duplicate"
                    onClick={() => {
                      onDuplicate(i);
                      onPromptsChanged();
                    }}
                  >
                    ⧉
                  </button>
                  <button
                    className="sp-saved-edit sp-btn"
                    title="Edit"
                    onClick={() => openEditPrompt(i)}
                  >
                    ✎
                  </button>
                  <button
                    className="sp-saved-del sp-btn hover:text-err-text"
                    title="Delete"
                    onClick={() => {
                      onDelete(p.id);
                      onPromptsChanged();
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3">
          <button
            id="sp-add-btn"
            className={`flex items-center gap-1.5 text-[13px] font-medium transition-colors ${
              showNewPromptForm ? 'hidden' : ''
            }`}
            style={{
              color: 'var(--accent)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
            onClick={() => setShowNewPromptForm(true)}
          >
            <span style={{ fontSize: 16 }}>+</span> Add prompt
          </button>
          <div id="sp-new-form" className={`space-y-2 ${!showNewPromptForm ? 'hidden' : ''}`}>
            <input
              id="sp-new-name"
              className="settings-input"
              type="text"
              placeholder="Prompt name…"
              maxLength={48}
              value={newPromptName}
              onChange={(e) => setNewPromptName(e.target.value)}
            />
            <textarea
              id="sp-new-content"
              className="settings-input resize-none"
              placeholder="Prompt instructions…"
              rows={5}
              value={newPromptContent}
              onChange={(e) => setNewPromptContent(e.target.value)}
            />
            <div className="flex gap-2 justify-end">
              <button
                id="sp-new-cancel"
                className="settings-secondary-btn"
                style={{ width: 'auto', padding: '7px 14px' }}
                onClick={resetPromptForm}
              >
                Cancel
              </button>
              <button
                id="sp-new-save"
                className="settings-save-btn-inline"
                onClick={handleSavePrompt}
              >
                {editingPromptIdx >= 0 ? 'Update' : 'Save prompt'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
