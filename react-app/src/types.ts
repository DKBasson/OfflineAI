export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[];
  generatedImage?: string;
  imagePrompt?: string;
  imageModel?: string;
  intent?: 'image' | 'code' | 'text';
  modelUsed?: string;
}

export interface PendingImage {
  dataUrl: string;
  base64: string;
}

export interface PendingFile {
  name: string;
  file: File;
}

export interface PendingAudio {
  name: string;
  file: File;
}

export interface Conversation {
  id: string;
  title: string;
  timestamp: number;
  model: string;
  messages: Message[];
  systemPrompt?: string;
  systemPromptId?: string;
}

export interface SystemPrompt {
  id: string;
  name: string;
  content: string;
}

export type ImagePerfProfile = 'eco' | 'balanced' | 'quality';

export interface Settings {
  model: string;
  contextSize: number;
  username: string;
  defaultPromptId: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  numCtx: number;
  historyLimit: number;
  autoTitle: boolean;
  imageModel: string;
  imagePerfProfile: ImagePerfProfile;
  intentModel: string;
  codeModel: string;
}

export interface TokenStats {
  input: number;
  output: number;
}

export interface OllamaStatus {
  ollama: boolean;
  models_count?: number;
  lan?: boolean;
  auth_required?: boolean;
  host?: string;
  port?: number;
  error?: string;
}

export type ConnectionState = 'checking' | 'online' | 'offline';

export interface ConnectionInfo {
  state: ConnectionState;
  label: string;
  title: string;
}

export interface ModelCap {
  vision: boolean;
}

export interface ImagePerfConfig {
  width: number;
  height: number;
  steps: number;
}
