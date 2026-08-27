import { useCallback, useEffect, useState } from 'react';
import type { Tool } from '../types';
import { fetchTools, deleteTool, toggleTool, buildToolApi, authHeaders } from '../utils/api';
import { useApp } from '../context/AppContext';

export function ToolsPanel() {
  const { activeModel } = useApp();
  const [tools, setTools] = useState<Tool[]>([]);
  const [buildDesc, setBuildDesc] = useState('');
  const [building, setBuilding] = useState(false);
  const [buildStatus, setBuildStatus] = useState('');
  const [showCode, setShowCode] = useState<string | null>(null);
  const [codeContent, setCodeContent] = useState<string>('');
  const [testResult, setTestResult] = useState<{ name: string; result: string } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await fetchTools();
    setTools(list);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleBuild = useCallback(async () => {
    if (!buildDesc.trim()) return;
    setBuilding(true);
    setBuildStatus('Building tool... (this may take 30-60 seconds)');
    const result = await buildToolApi(buildDesc.trim(), activeModel);
    if (result.ok) {
      setBuildStatus(`✔ Tool "${result.name}" created!`);
      setBuildDesc('');
      await refresh();
    } else {
      setBuildStatus(`⚠️ ${result.error || 'Build failed'}`);
    }
    setBuilding(false);
  }, [buildDesc, activeModel, refresh]);

  const handleToggle = useCallback(async (name: string) => {
    await toggleTool(name);
    await refresh();
  }, [refresh]);

  const handleDelete = useCallback(async (name: string) => {
    if (!confirm(`Delete tool "${name}"? This cannot be undone.`)) return;
    await deleteTool(name);
    await refresh();
  }, [refresh]);

  const handleShowCode = useCallback(async (name: string) => {
    if (showCode === name) {
      setShowCode(null);
      setCodeContent('');
      return;
    }
    try {
      const r = await fetch(`/api/tools/${encodeURIComponent(name)}`, { headers: authHeaders() });
      if (r.ok) {
        const data = await r.json();
        setCodeContent(data.code || 'No code available');
      } else {
        setCodeContent('Failed to load code');
      }
    } catch {
      setCodeContent('Failed to load code');
    }
    setShowCode(name);
  }, [showCode]);

  const handleTest = useCallback(async (tool: Tool) => {
    setTesting(tool.name);
    setTestResult(null);
    try {
      const testParams: Record<string, string> = {};
      for (const [k, v] of Object.entries(tool.parameters || {})) {
        if (k.toLowerCase().includes('city')) testParams[k] = 'London';
        else if (k.toLowerCase().includes('country')) testParams[k] = 'UK';
        else if (k.toLowerCase().includes('currency') || k.toLowerCase().includes('from')) testParams[k] = 'USD';
        else if (k.toLowerCase().includes('to')) testParams[k] = 'EUR';
        else if (k.toLowerCase().includes('symbol') || k.toLowerCase().includes('ticker')) testParams[k] = 'AAPL';
        else if (v.type === 'number') testParams[k] = '100';
        else testParams[k] = 'test';
      }
      const r = await fetch(`/api/tools/${encodeURIComponent(tool.name)}/execute`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ params: testParams }),
      });
      const data = await r.json();
      setTestResult({ name: tool.name, result: JSON.stringify(data, null, 2) });
    } catch (err) {
      setTestResult({ name: tool.name, result: `Error: ${err}` });
    }
    setTesting(null);
    await refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      {/* Build a tool */}
      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-title">Build a Tool</span>
        </div>
        <div className="settings-card-body space-y-2">
          <p className="text-[11.5px] text-text-dim">
            Describe what you need and the AI will research, build, and test a tool automatically.
          </p>
          <input
            type="text"
            placeholder="e.g. Get current exchange rates between currencies"
            value={buildDesc}
            onChange={(e) => setBuildDesc(e.target.value)}
            className="settings-input"
            maxLength={200}
            disabled={building}
            onKeyDown={(e) => { if (e.key === 'Enter') handleBuild(); }}
          />
          <button
            className="w-full py-2 bg-accent text-[#07080f] text-[12px] font-semibold rounded-sm disabled:opacity-50"
            onClick={handleBuild}
            disabled={!buildDesc.trim() || building}
          >
            {building ? 'Building... (researching → coding → testing)' : 'Build Tool'}
          </button>
          {buildStatus && (
            <p className={`text-[11.5px] ${buildStatus.startsWith('✔') ? 'text-green-400' : buildStatus.startsWith('⚠') ? 'text-yellow-400' : 'text-text-dim'}`}>
              {buildStatus}
            </p>
          )}
        </div>
      </div>

      {/* Installed tools */}
      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-title">Installed Tools ({tools.length})</span>
        </div>
        <div className="settings-card-body">
          {tools.length === 0 ? (
            <p className="text-[11.5px] text-text-dim">No tools installed. The AI will build them automatically when needed, or you can build one above.</p>
          ) : (
            <div className="space-y-2">
              {tools.map((tool) => (
                <div key={tool.name} className="border border-border rounded-sm p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[13px] font-medium ${tool.enabled ? 'text-text-primary' : 'text-text-dim line-through'}`}>
                          {tool.name}
                        </span>
                        {!tool.enabled && (
                          <span className="text-[9px] bg-red-500/20 text-red-400 px-1 rounded">disabled</span>
                        )}
                      </div>
                      <p className="text-[11px] text-text-dim mt-0.5">{tool.description}</p>
                      <div className="flex gap-3 text-[10px] text-text-dim mt-1">
                        <span>Used {tool.usage_count}×</span>
                        <span>{new Date(tool.created).toLocaleDateString()}</span>
                        {tool.last_used && <span>Last: {new Date(tool.last_used).toLocaleDateString()}</span>}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        className="text-[10px] px-1.5 py-0.5 rounded-sm border border-border text-text-dim hover:text-green-400 hover:border-green-400/30"
                        onClick={() => handleTest(tool)}
                        disabled={testing === tool.name}
                        title="Test this tool with sample data"
                      >
                        {testing === tool.name ? '...' : 'Test'}
                      </button>
                      <button
                        className="text-[10px] px-1.5 py-0.5 rounded-sm border border-border text-text-dim hover:text-text-muted"
                        onClick={() => handleShowCode(tool.name)}
                      >
                        {showCode === tool.name ? 'Hide' : 'Code'}
                      </button>
                      <button
                        className="text-[10px] px-1.5 py-0.5 rounded-sm border border-border text-text-dim hover:text-accent"
                        onClick={() => handleToggle(tool.name)}
                      >
                        {tool.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        className="text-[10px] px-1.5 py-0.5 rounded-sm border border-border text-text-dim hover:text-red-400"
                        onClick={() => handleDelete(tool.name)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  {showCode === tool.name && (
                    <pre className="mt-2 p-2 bg-surface rounded-sm text-[10px] text-text-muted overflow-x-auto max-h-[200px] overflow-y-auto font-mono">
                      {codeContent || 'Loading...'}
                    </pre>
                  )}
                  {testResult && testResult.name === tool.name && (
                    <pre className="mt-2 p-2 bg-green-500/5 border border-green-500/20 rounded-sm text-[10px] text-green-400 overflow-x-auto max-h-[150px] overflow-y-auto font-mono">
                      {testResult.result}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
