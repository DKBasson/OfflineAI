export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[];
  generatedImage?: string;
  imagePrompt?: string;
  imageModel?: string;
  intent?: 'image' | 'code' | 'text' | 'search' | 'research' | 'document';
  modelUsed?: string;
  searchResults?: SearchResult[];
  timestamp?: number;
  tokens?: number;
  generatedFiles?: string[];
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

export interface ConversationBranch {
  parentMessageIndex: number;
  messages: Message[];
}

export interface Conversation {
  id: string;
  title: string;
  timestamp: number;
  model: string;
  messages: Message[];
  systemPrompt?: string;
  systemPromptId?: string;
  branches?: ConversationBranch[];
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
  webSearch: boolean;
  imageGeneration: boolean;
}

export interface SearchResult {
  title: string;
  href: string;
  body: string;
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

export interface Project {
  id: string;
  name: string;
  description: string;
  created: string;
  sources_count: number;
  findings_count: number;
  files_count: number;
}

export interface ProjectFile {
  path: string;
  size: number;
  modified: string;
}

export interface ResearchEvent {
  type: 'status' | 'search' | 'finding' | 'source' | 'done' | 'error';
  message?: string;
  query?: string;
  results_count?: number;
  text?: string;
  summary_file?: string;
  error?: string;
}

export interface WorkflowStep {
  id: number;
  type: 'research' | 'document' | 'code' | 'image' | 'data';
  description: string;
  status: 'pending' | 'running' | 'done' | 'error';
  output?: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
  module: string;
  created: string;
  usage_count: number;
  last_used: string | null;
  enabled: boolean;
  consecutive_failures?: number;
  code?: string;
}

export type SpecPhase = 'requirements' | 'requirements_review' | 'design' | 'design_review' | 'tasks' | 'tasks_review' | 'ready' | 'executing' | 'active';

export interface SpecState {
  phase: SpecPhase;
  requirementsMd: string;
  designMd: string;
  tasksMd: string;
  tasksCompleted: string[];
}

export interface Hook {
  id: string;
  name: string;
  event_type: string;
  file_pattern: string;
  instructions: string;
  system_prompt: string;
  enabled: boolean;
  created_at: string;
  runs: { timestamp: string; trigger: string; success: boolean; duration_ms: number }[];
}

export interface SteeringDoc {
  name: string;
  size: number;
  modified: number;
}