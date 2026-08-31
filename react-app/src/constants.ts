import type { Settings, ImagePerfConfig, ImagePerfProfile } from './types';

export const FALLBACK_MODEL = 'gemma4:e4b';

export const SETTINGS_KEY = 'offlineai_settings';
export const PROMPTS_KEY = 'offlineai_prompts';
export const AUTH_TOKEN_KEY = 'offlineai_auth_token';
export const HISTORY_KEY = 'offlineai_history';
export const HISTORY_DB = 'offlineai_history_db';
export const HISTORY_STORE = 'conversations';

export const DEFAULT_SETTINGS: Settings = {
  model: FALLBACK_MODEL,
  contextSize: 20,
  username: '',
  defaultPromptId: '',
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 0,
  numCtx: 0,
  historyLimit: 60,
  autoTitle: true,
  imageModel: 'x/z-image-turbo',
  imagePerfProfile: 'eco',
  intentModel: '',
  codeModel: '',
  webSearch: false,
  imageGeneration: false,
};

export const IMAGE_PERF_PRESETS: Record<ImagePerfProfile, ImagePerfConfig> = {
  eco: { width: 640, height: 640, steps: 6 },
  balanced: { width: 768, height: 768, steps: 10 },
  quality: { width: 1024, height: 1024, steps: 16 },
};

export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';
export const TEXT_ACCEPT =
  '.txt,.md,.py,.js,.ts,.jsx,.tsx,.json,.csv,.xml,.yaml,.yml,.sh,.bash,.html,.css,.java,.c,.cpp,.h,.rs,.go,.rb,.php,.swift,.kt,.sql,.toml,.ini,.conf,.env,.log,.tex,.rst,.adoc,.diff,.patch,.properties,.cfg,.vue,.svelte,.cs,.vb,.fs,.r,.lua,.ps1,.ex,.exs,.hs,.nim,.zig,.proto';
export const DOC_ACCEPT = '.docx,.odt,.ods,.odp,.pdf';
export const AUDIO_ACCEPT = '.mp3,.wav,.ogg,.opus,.m4a,.webm,.flac,.aac,.wma,.aiff,.alac';
export const CLIENT_BODY_LIMIT = 45 * 1024 * 1024;

export const DOC_FILE_RE = /\.(docx|odt|ods|odp|pdf)$/i;

export interface CreationTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  workflow: string;
  defaultDepth: 'quick' | 'standard' | 'deep';
}

export const CREATION_TEMPLATES: CreationTemplate[] = [
  {
    id: 'literature-review',
    name: 'Literature Review',
    icon: '📚',
    description: 'Research a topic thoroughly and produce a cited literature review',
    workflow: 'Research {topic} comprehensively, then write a detailed literature review with citations',
    defaultDepth: 'deep',
  },
  {
    id: 'competitive-analysis',
    name: 'Competitive Analysis',
    icon: '📊',
    description: 'Analyze competitors and market positioning',
    workflow: 'Research competitors for {topic}, then write a competitive analysis report with comparison table',
    defaultDepth: 'standard',
  },
  {
    id: 'blog-post',
    name: 'Blog Post',
    icon: '✍️',
    description: 'Research and write a polished blog post',
    workflow: 'Research {topic}, then write an engaging blog post with key takeaways',
    defaultDepth: 'quick',
  },
  {
    id: 'data-report',
    name: 'Data Report',
    icon: '📈',
    description: 'Research and generate a data-driven report',
    workflow: 'Research {topic}, write an analysis report, and generate a comparison data table',
    defaultDepth: 'standard',
  },
  {
    id: 'technical-spec',
    name: 'Technical Spec',
    icon: '🔧',
    description: 'Draft a technical specification or RFC',
    workflow: 'Research best practices for {topic}, then write a detailed technical specification with requirements and architecture',
    defaultDepth: 'standard',
  },
];

export interface ConversationTemplate {
  id: string;
  name: string;
  icon: string;
  systemPrompt: string;
  starterMessage: string;
}

export const CONVERSATION_TEMPLATES: ConversationTemplate[] = [
  {
    id: 'code-review',
    name: 'Code Review',
    icon: '🔍',
    systemPrompt: 'You are an expert code reviewer. Analyze code for bugs, performance issues, security vulnerabilities, and style problems. Be specific and suggest fixes.',
    starterMessage: 'Paste your code and I\'ll review it for bugs, performance, security, and style.',
  },
  {
    id: 'summarize',
    name: 'Summarize',
    icon: '📝',
    systemPrompt: 'You are a summarization expert. Create clear, concise summaries that capture key points. Use bullet points for complex topics.',
    starterMessage: 'Paste text, a document, or describe what you need summarized.',
  },
  {
    id: 'brainstorm',
    name: 'Brainstorm',
    icon: '💡',
    systemPrompt: 'You are a creative brainstorming partner. Generate diverse, unconventional ideas. Build on concepts, make unexpected connections, and think outside the box. Never dismiss an idea without exploring it first.',
    starterMessage: 'What would you like to brainstorm about? I\'ll generate creative ideas and unexpected angles.',
  },
  {
    id: 'explain',
    name: 'Explain Like I\'m 5',
    icon: '🎓',
    systemPrompt: 'Explain concepts in the simplest possible terms. Use analogies, examples, and everyday language. Avoid jargon. Build understanding step by step.',
    starterMessage: 'What concept would you like me to explain simply?',
  },
  {
    id: 'debug',
    name: 'Debug Helper',
    icon: '🐛',
    systemPrompt: 'You are a debugging expert. Help identify the root cause of bugs systematically. Ask clarifying questions, suggest debugging steps, and explain why errors occur.',
    starterMessage: 'Describe your bug or paste the error message. I\'ll help you find the root cause.',
  },
];
