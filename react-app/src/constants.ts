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
