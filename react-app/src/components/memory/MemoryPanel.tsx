import { useCallback, useEffect, useState } from 'react';
import { fetchMemories, addMemoryApi, removeMemoryApi } from '../../utils/api';

export function MemoryPanel() {
  const [memories, setMemories] = useState<string[]>([]);
  const [newMemory, setNewMemory] = useState('');
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    setMemories(await fetchMemories());
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleAdd = useCallback(async () => {
    if (!newMemory.trim()) return;
    setAdding(true);
    await addMemoryApi(newMemory.trim());
    setNewMemory('');
    await refresh();
    setAdding(false);
  }, [newMemory, refresh]);

  const handleRemove = useCallback(async (index: number) => {
    await removeMemoryApi(index);
    await refresh();
  }, [refresh]);

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <span className="settings-card-title">Memory ({memories.length})</span>
      </div>
      <div className="settings-card-body space-y-2">
        <p className="text-[11.5px] text-text-dim">
          The AI remembers these preferences across all conversations.
        </p>
        <div className="flex gap-1.5">
          <input
            type="text"
            placeholder="e.g. I prefer Python over JavaScript"
            value={newMemory}
            onChange={(e) => setNewMemory(e.target.value)}
            className="settings-input flex-1"
            maxLength={200}
            disabled={adding}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          />
          <button
            className="px-3 py-1.5 bg-accent text-[#07080f] text-[11px] font-semibold rounded-sm disabled:opacity-50 shrink-0"
            onClick={handleAdd}
            disabled={!newMemory.trim() || adding}
          >
            Add
          </button>
        </div>
        {memories.length > 0 && (
          <div className="space-y-1 mt-2">
            {memories.map((m, i) => (
              <div key={i} className="flex items-start gap-2 px-2 py-1.5 bg-surface rounded-sm">
                <span className="text-[12px] text-text-muted flex-1">{m}</span>
                <button
                  className="text-[10px] text-text-dim hover:text-red-400 shrink-0"
                  onClick={() => handleRemove(i)}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
