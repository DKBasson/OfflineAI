import { useApp } from '../context/AppContext';
import { CONVERSATION_TEMPLATES, CREATION_TEMPLATES } from '../constants';

export function WelcomeScreen() {
  const { activeUsername, activeModel, sendMessage } = useApp();

  const greeting = activeUsername ? `Hello, ${activeUsername}` : 'OfflineAI';

  const handleTemplate = (template: typeof CONVERSATION_TEMPLATES[number]) => {
    sendMessage(template.systemPrompt + '\n\nPlease greet the user with: "' + template.starterMessage + '"');
  };

  return (
    <div
      id="welcome"
      className="flex flex-col items-center justify-center flex-1 text-center py-12 select-none"
    >
      <div className="welcome-glyph mb-6">⚡</div>
      <h2 className="text-[22px] font-semibold text-text-primary mb-1">{greeting}</h2>
      <p className="text-[13px] leading-relaxed max-w-xs" style={{ color: 'var(--text-2)' }}>
        Chatting with <strong style={{ color: 'var(--accent)' }}>{activeModel}</strong>
      </p>
      <p className="text-[11px] mt-2 tracking-widest uppercase" style={{ color: 'var(--text-3)' }}>
        Local · Private · No cloud
      </p>

      {/* Chat Templates */}
      <div className="mt-8 w-full max-w-md px-4">
        <p className="text-[11px] text-text-dim uppercase tracking-wider mb-3">Chat Templates</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {CONVERSATION_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => handleTemplate(tpl)}
              className="flex flex-col items-center gap-1.5 px-3 py-3 bg-surface border border-border rounded-lg hover:bg-surface-md hover:border-border-hi transition-colors cursor-pointer text-center"
              title={tpl.systemPrompt}
            >
              <span className="text-lg">{tpl.icon}</span>
              <span className="text-[12px] text-text-primary font-medium">{tpl.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Creation Templates */}
      <div className="mt-6 w-full max-w-md px-4">
        <p className="text-[11px] text-text-dim uppercase tracking-wider mb-3">
          Create with AI <span className="normal-case opacity-60">(requires a project)</span>
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {CREATION_TEMPLATES.map((tpl) => (
            <div
              key={tpl.id}
              className="flex flex-col items-center gap-1.5 px-3 py-3 bg-surface border border-border rounded-lg text-center opacity-70 hover:opacity-100 transition-opacity cursor-default"
              title={tpl.description}
            >
              <span className="text-lg">{tpl.icon}</span>
              <span className="text-[12px] text-text-primary font-medium">{tpl.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
