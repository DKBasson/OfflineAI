import { useCallback, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { Message, PendingAudio, PendingFile, PendingImage, Settings } from '../../types';
import { CLIENT_BODY_LIMIT, IMAGE_PERF_PRESETS } from '../../constants';
import {
  streamChat,
  streamImageGeneration,
  classifyIntent,
  webSearch,
  authHeaders,
} from '../../utils/api';
import {
  readFileContent,
  isImageRequest,
  isCodeRequest,
  isSearchRequest,
  transcribeWithProgress,
  estimateJsonBytes,
} from '../../utils/files';

export interface StreamingSliceDeps {
  isStreaming: boolean;
  messages: Message[];
  pendingImages: PendingImage[];
  pendingFiles: PendingFile[];
  pendingAudio: PendingAudio[];
  activeModel: string;
  activeContextSize: number;
  activeUsername: string;
  activeProjectId: string | null;
  currentSystemPrompt: string;
  currentSystemPromptId: string;
  currentConvId: string | null;
  settingsRef: MutableRefObject<Settings>;
  abortCtrlRef: MutableRefObject<AbortController | null>;
  streamTextRef: MutableRefObject<string>;
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setStreamingContent: React.Dispatch<React.SetStateAction<string>>;
  setStreamingError: React.Dispatch<React.SetStateAction<string | null>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setPendingImages: React.Dispatch<React.SetStateAction<PendingImage[]>>;
  setPendingFiles: React.Dispatch<React.SetStateAction<PendingFile[]>>;
  setPendingAudio: React.Dispatch<React.SetStateAction<PendingAudio[]>>;
  setImageProgress: React.Dispatch<React.SetStateAction<number | null>>;
  setImageProgressLabel: React.Dispatch<React.SetStateAction<string>>;
  setCurrentConvId: React.Dispatch<React.SetStateAction<string | null>>;
  saveConversationToHistory: (
    msgs: Message[],
    convId: string | null,
    model: string,
    systemPrompt: string,
    systemPromptId: string,
  ) => Promise<string | null | undefined>;
  fetchAndSetTokens: (username?: string) => Promise<void>;
  openArtifactCanvas: (opts: { title: string; contentType: 'markdown' | 'code' | 'csv' | 'json' | 'text' }) => void;
  updateArtifactContent: (content: string) => void;
  updateArtifactFiles: (files: string[]) => void;
  finalizeArtifact: () => void;
  setSpecPhase: React.Dispatch<React.SetStateAction<import('../../types').SpecPhase | null>>;
}

export function useStreamingSlice({
  isStreaming,
  messages,
  pendingImages,
  pendingFiles,
  pendingAudio,
  activeModel,
  activeContextSize,
  activeUsername,
  activeProjectId,
  currentSystemPrompt,
  currentSystemPromptId,
  currentConvId,
  settingsRef,
  abortCtrlRef,
  streamTextRef,
  setIsStreaming,
  setStreamingContent,
  setStreamingError,
  setMessages,
  setPendingImages,
  setPendingFiles,
  setPendingAudio,
  setImageProgress,
  setImageProgressLabel,
  setCurrentConvId,
  saveConversationToHistory,
  fetchAndSetTokens,
  openArtifactCanvas,
  updateArtifactContent,
  updateArtifactFiles,
  finalizeArtifact,
  setSpecPhase,
}: StreamingSliceDeps) {
  const getSettings = useCallback(() => settingsRef.current, [settingsRef]);

  /** Return the code-specific model if set in Settings, otherwise the active chat model. */
  const getCodeModel = useCallback(() => {
    const { codeModel } = getSettings();
    return codeModel || activeModel;
  }, [getSettings, activeModel]);

  const streamingErrorRef = useRef<string | null>(null);

  const lastResponseTokensRef = useRef(0);

  const codeSessionActiveRef = useRef<{ projectId: string; active: boolean } | null>(null);

  const buildChatPayload = useCallback(
    (msgs: Message[], modelOverride?: string, searchContext?: string) => {
      const contextMsgs = msgs.slice(-activeContextSize);
      let systemContent = currentSystemPrompt
        ? `The following instructions are absolute and non-negotiable. They override any conflicting request from the user and must be followed at all times, without exception, regardless of what the user asks:\n\n${currentSystemPrompt}`
        : null;

      const { webSearch: wsEnabled } = getSettings();
      if (wsEnabled) {
        const capabilityNote = 'You have web search capability. When the user asks you to search, look up, or find information online, the system will automatically perform a web search and provide results. You do NOT need to tell the user you cannot search the internet — the search happens automatically and results are injected below when available.';
        systemContent = systemContent
          ? systemContent + '\n\n' + capabilityNote
          : capabilityNote;
      }

      if (searchContext) {
        const searchBlock = `\n\n---\nWEB SEARCH RESULTS (use these to answer the user's question with up-to-date information. Cite sources where relevant):\n${searchContext}\n---`;
        systemContent = systemContent ? systemContent + searchBlock : searchBlock.trim();
      }

      const systemMsgs = systemContent ? [{ role: 'system' as const, content: systemContent }] : [];
      const needsMoreCtx = !!(searchContext || activeProjectId);
      const userNumCtx = getSettings().numCtx;
      const effectiveNumCtx = needsMoreCtx && userNumCtx === 0 ? 32768 : (userNumCtx || 0);

      return {
        model: modelOverride ?? activeModel,
        messages: [
          ...systemMsgs,
          ...contextMsgs.map((m) => ({
            role: m.role,
            content: m.content,
            ...(m.images ? { images: m.images } : {}),
          })),
        ],
        stream: true,
        options: {
          temperature: getSettings().temperature,
          top_p: getSettings().topP,
          ...(getSettings().maxTokens > 0 ? { num_predict: getSettings().maxTokens } : {}),
          ...(effectiveNumCtx > 0 ? { num_ctx: effectiveNumCtx } : {}),
        },
        ...(activeUsername ? { user: activeUsername } : {}),
        ...(activeProjectId ? { project_id: activeProjectId } : {}),
      };
    },
    [activeModel, activeContextSize, currentSystemPrompt, getSettings, activeUsername, activeProjectId],
  );

  const streamAssistantReply = useCallback(
    async (
      currentMessages: Message[],
      _convId: string | null,
      modelOverride?: string,
      searchContext?: string,
    ): Promise<string | null> => {
      setIsStreaming(true);
      setStreamingContent('');
      setStreamingError(null);
      streamingErrorRef.current = null;
      streamTextRef.current = '';

      try {
        abortCtrlRef.current = new AbortController();
        const payload = buildChatPayload(currentMessages, modelOverride, searchContext);
        if (estimateJsonBytes(payload) > CLIENT_BODY_LIMIT) {
          throw new Error(
            'This image/request is too large to send. Attach a smaller image and try again.',
          );
        }

        lastResponseTokensRef.current = 0;
        let previousPassText = '';
        for await (const chunk of streamChat(payload, abortCtrlRef.current.signal)) {
          if (chunk.error) {
            setStreamingError(`⚠️ ${chunk.error}`);
            streamingErrorRef.current = chunk.error;
            streamTextRef.current = '';
            return null;
          }
          if (chunk.done) {
            lastResponseTokensRef.current = chunk.tokens || 0;
            fetchAndSetTokens();
            if (streamTextRef.current) {
              previousPassText = streamTextRef.current;
              streamTextRef.current = '';
              setStreamingContent('');
            }
            continue;
          }
          if (chunk.content) {
            streamTextRef.current += chunk.content;
            setStreamingContent(streamTextRef.current);
          }
        }

        const finalText = streamTextRef.current || previousPassText || null;
        streamTextRef.current = finalText || '';

        return finalText;
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return null;
        const msg = err instanceof Error ? err.message : String(err);
        setStreamingError(`⚠️ ${msg}`);
        streamingErrorRef.current = msg;
        return null;
      } finally {
        setIsStreaming(false);
        abortCtrlRef.current = null;
        streamTextRef.current = '';
      }
    },
    [
      buildChatPayload,
      fetchAndSetTokens,
      abortCtrlRef,
      streamTextRef,
      setIsStreaming,
      setStreamingContent,
      setStreamingError,
    ],
  );

  const stopStreaming = useCallback(() => {
    abortCtrlRef.current?.abort();
  }, [abortCtrlRef]);

  const handleSlashCommand = useCallback(
    async (cmd: string, arg: string, projectId: string, depth: 'quick' | 'standard' | 'deep' = 'standard') => {
      setIsStreaming(true);
      setStreamingContent('');
      setStreamingError(null);

      // Determine content type for the artifact canvas
      const contentTypeMap: Record<string, 'markdown' | 'code' | 'csv' | 'json' | 'text'> = {
        research: 'markdown',
        document: 'markdown',
        doc: 'markdown',
        code: 'code',
        data: 'csv',
        workflow: 'markdown',
        steering: 'markdown',
      };
      const artifactType = contentTypeMap[cmd] || 'text';
      const artifactTitle = cmd === 'research' ? `Research: ${arg}` : cmd === 'document' || cmd === 'doc' ? `Document: ${arg}` : cmd === 'code' ? `Code: ${arg}` : cmd === 'data' ? `Data: ${arg}` : cmd === 'workflow' ? `Workflow: ${arg}` : arg;
      openArtifactCanvas({ title: artifactTitle, contentType: artifactType });

      try {
        let endpoint = '';
        let body: Record<string, unknown> = {};

        switch (cmd) {
          case 'research':
            endpoint = `/api/projects/${encodeURIComponent(projectId)}/research`;
            body = { topic: arg, depth, model: activeModel };
            break;
          case 'document':
          case 'doc':
            endpoint = `/api/projects/${encodeURIComponent(projectId)}/generate-document`;
            body = { topic: arg, type: 'report', model: activeModel, use_knowledge: true };
            break;
          case 'code':
            endpoint = `/api/projects/${encodeURIComponent(projectId)}/code/plan`;
            body = { description: arg, model: getCodeModel() };
            break;
          case 'data':
            endpoint = `/api/projects/${encodeURIComponent(projectId)}/generate-data`;
            body = { topic: arg, format: 'csv', model: activeModel };
            break;
          case 'workflow':
            endpoint = `/api/projects/${encodeURIComponent(projectId)}/workflow`;
            body = { request: arg, model: activeModel };
            break;
          case 'steering':
            endpoint = `/api/projects/${encodeURIComponent(projectId)}/steering/generate`;
            body = { model: activeModel };
            break;
          default:
            setStreamingError('Unknown command: /' + cmd);
            setIsStreaming(false);
            return;
        }

        abortCtrlRef.current = new AbortController();
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
          signal: abortCtrlRef.current.signal,
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          setStreamingError(`⚠️ ${(err as {error?: string}).error || 'Request failed'}`);
          setIsStreaming(false);
          return;
        }

        const reader = resp.body!.getReader();
        const dec = new TextDecoder();
        let buf = '';
        let progressMessages: string[] = [];
        let finalContent = '';
        let summaryContent = '';
        let generatedFiles: string[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop()!;
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === 'status' || evt.type === 'search' || evt.type === 'source' || evt.type === 'step_start' || evt.type === 'step_done' || evt.type === 'phase') {
                const msg = evt.message || evt.description || evt.query || '';
                if (msg) progressMessages.push(msg);
                setStreamingContent(progressMessages.join('\n'));
              } else if (evt.type === 'token' || evt.type === 'step_token') {
                // Stream tokens directly into the artifact canvas
                finalContent += (evt.text || '');
                updateArtifactContent(finalContent);
              } else if (evt.type === 'question') {
                // Clarification question from /code/plan
                progressMessages.push(`❓ ${evt.text || ''}`);
                setStreamingContent(progressMessages.join('\n'));
              } else if (evt.type === 'plan') {
                // Plan document generated — show in artifact canvas
                if (evt.plan_md) {
                  finalContent = evt.plan_md;
                  updateArtifactContent(evt.plan_md);
                }
              } else if (evt.type === 'summary') {
                // Edit summary from /code/edit
                const summaryText = evt.text || '';
                progressMessages.push(`📝 Changes:\n${summaryText}`);
                setStreamingContent(progressMessages.join('\n'));
              } else if (evt.type === 'change') {
                // Individual file change from /code/edit
                progressMessages.push(`  ${evt.action === 'created' ? '✨' : '✏️'} ${evt.file}: ${evt.action}`);
                setStreamingContent(progressMessages.join('\n'));
              } else if (evt.type === 'finding') {
                if (!summaryContent) finalContent = evt.text || '';
              } else if (evt.type === 'content') {
                summaryContent = evt.text || '';
                updateArtifactContent(summaryContent);
              } else if (evt.type === 'done') {
                const doneMsg = evt.message || 'Done!';
                progressMessages.push(`✔ ${doneMsg}`);

                if (evt.spec_phase) {
                  setSpecPhase(evt.spec_phase);
                }

                // If this is a code spec completion, let user review in the artifact canvas
                if (evt.session_id && cmd === 'code' && endpoint.includes('/code/plan')) {
                  progressMessages.push('📋 Requirements ready — review in the panel and click "Approve & Continue" to proceed to Design.');
                  setStreamingContent(progressMessages.join('\n'));
                  codeSessionActiveRef.current = { projectId: projectId, active: true };
                }

                if (evt.summary_file) {
                  progressMessages.push(`📄 Saved: ${evt.summary_file}`);
                  generatedFiles.push(evt.summary_file);
                  const pdfVersion = evt.summary_file.replace(/\.md$/, '.pdf');
                  generatedFiles.push(pdfVersion);
                }
                if (evt.file_path) {
                  generatedFiles.push(evt.file_path);
                  const pdfVersion = evt.file_path.replace(/\.md$/, '.pdf');
                  if (pdfVersion !== evt.file_path) generatedFiles.push(pdfVersion);
                }
                updateArtifactFiles([...generatedFiles]);
                setStreamingContent(progressMessages.join('\n'));
              } else if (evt.type === 'error') {
                setStreamingError(`⚠️ ${evt.error}`);
              } else if (evt.type === 'file') {
                progressMessages.push(`📄 ${evt.path}`);
                if (evt.path) generatedFiles.push(evt.path);
                updateArtifactFiles([...generatedFiles]);
                setStreamingContent(progressMessages.join('\n'));
              } else if (evt.type === 'plan') {
                const steps = evt.steps || [];
                progressMessages.push(`📋 Plan: ${steps.map((s: {type: string; description: string}) => s.description).join(' → ')}`);
                setStreamingContent(progressMessages.join('\n'));
              }
            } catch { /* ignore */ }
          }
        }

        const resultContent = summaryContent || finalContent || progressMessages.join('\n');
        if (resultContent) {
          const assistantMsg: Message = {
            role: 'assistant',
            content: resultContent,
            timestamp: Date.now(),
            intent: cmd === 'research' ? 'search' : cmd === 'code' ? 'code' : cmd === 'document' || cmd === 'doc' ? 'document' : 'text',
            ...(generatedFiles.length > 0 ? { generatedFiles } : {}),
          };
          setMessages((prev) => {
            const updated = [...prev, assistantMsg];
            saveConversationToHistory(
              updated,
              currentConvId,
              activeModel,
              currentSystemPrompt,
              currentSystemPromptId,
            ).then((newId) => {
              if (newId) setCurrentConvId(newId);
            });
            return updated;
          });
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setStreamingError(`⚠️ ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsStreaming(false);
        setStreamingContent('');
        abortCtrlRef.current = null;
        finalizeArtifact();
      }
    },
    [activeModel, abortCtrlRef, setIsStreaming, setStreamingContent, setStreamingError, setMessages, saveConversationToHistory, currentConvId, currentSystemPrompt, currentSystemPromptId, setCurrentConvId, openArtifactCanvas, updateArtifactContent, updateArtifactFiles, finalizeArtifact, setSpecPhase],
  );

  const handleSpecGenerate = useCallback(
    async (projectId: string, phase: string) => {
      setIsStreaming(true);
      setStreamingContent('');
      setStreamingError(null);
      openArtifactCanvas({ title: `Spec: ${phase}`, contentType: 'markdown' });

      try {
        abortCtrlRef.current = new AbortController();
        const resp = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/code/spec/generate`,
          {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ model: getCodeModel() }),
            signal: abortCtrlRef.current.signal,
          },
        );

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          setStreamingError(`⚠️ ${(err as { error?: string }).error || 'Failed'}`);
          setIsStreaming(false);
          return;
        }

        const reader = resp.body!.getReader();
        const dec = new TextDecoder();
        let buf = '';
        let content = '';
        const progress: string[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop()!;
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === 'status') {
                progress.push(evt.message || '');
                setStreamingContent(progress.join('\n'));
              } else if (evt.type === 'token') {
                content += (evt.text || '');
                updateArtifactContent(content);
              } else if (evt.type === 'done') {
                if (evt.spec_phase) setSpecPhase(evt.spec_phase);
                progress.push(`✔ ${evt.message || 'Done'}`);
                setStreamingContent(progress.join('\n'));
              } else if (evt.type === 'error') {
                setStreamingError(`⚠️ ${evt.error}`);
              }
            } catch { /* ignore */ }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setStreamingError(`⚠️ ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsStreaming(false);
        setStreamingContent('');
        abortCtrlRef.current = null;
        finalizeArtifact();
      }
    },
    [getCodeModel, abortCtrlRef, setIsStreaming, setStreamingContent, setStreamingError, openArtifactCanvas, updateArtifactContent, finalizeArtifact, setSpecPhase],
  );

  const refineImagePrompt = useCallback(
    async (text: string, signal: AbortSignal, msgs: Message[]): Promise<string> => {
      if (!activeModel) {
        throw new Error(
          'No chat model selected. Set a text model in Settings to enable prompt enhancement.',
        );
      }

      const contextMsgs = msgs
        .slice(-activeContextSize)
        .map((m) => ({ role: m.role, content: String(m.content || '').trim() }))
        .filter((m) => m.content);
      if (!contextMsgs.length || contextMsgs[contextMsgs.length - 1].content !== text.trim()) {
        contextMsgs.push({ role: 'user', content: text.trim() });
      }
      const compact = contextMsgs
        .map((m) => `${m.role.toUpperCase()}: ${m.content.replace(/\s+/g, ' ')}`)
        .join('\n')
        .slice(-6000);

      const body = {
        model: activeModel,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert image prompt engineer. Use the recent conversation context to infer references, subjects, style, and constraints. Convert the latest user image request into one detailed, vivid image-generation prompt. Reply with ONLY the final prompt text: no explanations, no bullets, no quotes, no preamble. Keep it under 200 words.',
          },
          {
            role: 'user',
            content: `Recent conversation context:\n${compact}\n\nLatest image request:\n${text}`,
          },
        ],
        stream: true,
        options: { temperature: 0.7, top_p: 0.9 },
        ...(activeUsername ? { user: activeUsername } : {}),
      };

      let content = '';
      for await (const chunk of streamChat(body, signal)) {
        if (chunk.error) {
          throw new Error(chunk.error);
        }
        if (chunk.content) content += chunk.content;
      }
      const refined = content.trim();

      if (!refined) {
        throw new Error(
          `"${activeModel}" returned no text. Make sure your chat model is a generative text model, not an image or embedding model.`,
        );
      }

      fetchAndSetTokens();
      return refined;
    },
    [activeModel, activeContextSize, activeUsername, fetchAndSetTokens],
  );

  const handleImageRequest = useCallback(
    async (text: string, msgs: Message[], convId: string | null) => {
      setIsStreaming(true);
      setImageProgress(0);
      setImageProgressLabel('Preparing…');
      setStreamingError(null);

      try {
        abortCtrlRef.current = new AbortController();
        const signal = abortCtrlRef.current.signal;

        let refinedPrompt = text;
        let promptWarning: string | null = null;
        try {
          refinedPrompt = await refineImagePrompt(text, signal, msgs);
        } catch (e: unknown) {
          if (e instanceof Error && e.name === 'AbortError') throw e;
          const reason = e instanceof Error ? e.message : String(e);
          promptWarning = `⚠️ Prompt enhancement failed (${reason}). Using original prompt.`;
        }

        const imageModel = getSettings().imageModel;
        if (!imageModel) {
          throw new Error(
            'No image model configured. Go to Settings → Image generation model and select or pull one.',
          );
        }

        setImageProgressLabel(`Generating image with ${imageModel}…`);

        const perf = IMAGE_PERF_PRESETS[getSettings().imagePerfProfile] || IMAGE_PERF_PRESETS.eco;
        const imageBody = {
          model: imageModel,
          prompt: refinedPrompt,
          stream: true,
          width: perf.width,
          height: perf.height,
          steps: perf.steps,
        };

        let generatedB64: string | null = null;
        for await (const chunk of streamImageGeneration(imageBody, signal)) {
          if (chunk.error) {
            throw new Error(chunk.error);
          }
          if (chunk.progress != null) {
            setImageProgress(chunk.progress);
            setImageProgressLabel(
              chunk.progress >= 100 ? 'Done!' : `Generating image… ${chunk.progress}%`,
            );
          }
          if (chunk.image) generatedB64 = chunk.image;
          if (chunk.status) setImageProgressLabel(chunk.status);
        }

        if (!generatedB64) {
          throw new Error(
            'No image was returned. Make sure the image model is pulled and supports image generation.',
          );
        }

        const assistantMsg: Message = {
          role: 'assistant',
          content: `Prompt: ${refinedPrompt}`,
          generatedImage: generatedB64,
          imagePrompt: refinedPrompt,
          imageModel,
          intent: 'image',
          modelUsed: imageModel,
          timestamp: Date.now(),
        };

        const nextMsgs = [...msgs, assistantMsg];
        setMessages(nextMsgs);
        const newConvId = await saveConversationToHistory(
          nextMsgs,
          convId,
          activeModel,
          currentSystemPrompt,
          currentSystemPromptId,
        );
        setCurrentConvId(newConvId ?? null);

        if (promptWarning) setStreamingError(promptWarning);
        return;
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            return last?.role === 'user' ? prev.slice(0, -1) : prev;
          });
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          setStreamingError(`⚠️ ${msg}`);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'user') {
              saveConversationToHistory(
                prev,
                convId,
                activeModel,
                currentSystemPrompt,
                currentSystemPromptId,
              );
            }
            return prev;
          });
        }
      } finally {
        setIsStreaming(false);
        setImageProgress(null);
        setImageProgressLabel('');
        abortCtrlRef.current = null;
      }
    },
    [
      getSettings,
      refineImagePrompt,
      saveConversationToHistory,
      activeModel,
      currentSystemPrompt,
      currentSystemPromptId,
      abortCtrlRef,
      setIsStreaming,
      setImageProgress,
      setImageProgressLabel,
      setStreamingError,
      setMessages,
      setCurrentConvId,
    ],
  );

  const editAndResend = useCallback(
    async (messageIndex: number, newContent: string) => {
      if (isStreaming) return;
      const trimmed = messages.slice(0, messageIndex);
      const userMsg: Message = { role: 'user', content: newContent, timestamp: Date.now() };
      const nextMsgs = [...trimmed, userMsg];
      setMessages(nextMsgs);

      const replyText = await streamAssistantReply(nextMsgs, currentConvId);
      if (replyText) {
        const assistantMsg: Message = { role: 'assistant', content: replyText, timestamp: Date.now(), tokens: lastResponseTokensRef.current || undefined };
        const finalMsgs = [...nextMsgs, assistantMsg];
        setMessages(finalMsgs);
        const newConvId = await saveConversationToHistory(finalMsgs, currentConvId, activeModel, currentSystemPrompt, currentSystemPromptId);
        setCurrentConvId(newConvId ?? null);
      }
    },
    [isStreaming, messages, currentConvId, activeModel, currentSystemPrompt, currentSystemPromptId, streamAssistantReply, saveConversationToHistory, setMessages, setCurrentConvId, lastResponseTokensRef],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (isStreaming) return;
      const hasPending =
        pendingImages.length > 0 || pendingFiles.length > 0 || pendingAudio.length > 0;
      if (!text && !hasPending) return;

      if (text && activeProjectId) {
        // Handle /code import <path> specially
        const importMatch = text.match(/^\/code\s+import\s+(.+)/i);
        if (importMatch) {
          const folderPath = importMatch[1].trim();
          const userMsg: Message = { role: 'user', content: text, timestamp: Date.now() };
          setMessages((prev) => [...prev, userMsg]);
          setPendingImages([]);
          setPendingFiles([]);
          setPendingAudio([]);
          setIsStreaming(true);
          setStreamingContent('');
          setStreamingError(null);
          openArtifactCanvas({ title: `Import: ${folderPath.split('/').pop() || folderPath}`, contentType: 'markdown' });
          // Invalidate code session cache — import creates a new session
          codeSessionActiveRef.current = null;

          try {
            abortCtrlRef.current = new AbortController();
            const resp = await fetch(
              `/api/projects/${encodeURIComponent(activeProjectId)}/code/import`,
              {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ folder_path: folderPath, model: activeModel }),
                signal: abortCtrlRef.current.signal,
              },
            );

            if (!resp.ok) {
              const err = await resp.json().catch(() => ({}));
              setStreamingError(`⚠️ ${(err as {error?: string}).error || 'Import failed'}`);
              setIsStreaming(false);
              return;
            }

            const reader = resp.body!.getReader();
            const dec = new TextDecoder();
            let buf = '';
            let progressMessages: string[] = [];
            let content = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += dec.decode(value, { stream: true });
              const lines = buf.split('\n');
              buf = lines.pop()!;
              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                  const evt = JSON.parse(line.slice(6));
                  if (evt.type === 'status' || evt.type === 'scan') {
                    progressMessages.push(evt.message || '');
                    setStreamingContent(progressMessages.join('\n'));
                  } else if (evt.type === 'token') {
                    content += (evt.text || '');
                    updateArtifactContent(content);
                  } else if (evt.type === 'understanding') {
                    content = evt.content || content;
                    updateArtifactContent(content);
                  } else if (evt.type === 'done') {
                    progressMessages.push(`✔ ${evt.message || 'Import complete'}`);
                    setStreamingContent(progressMessages.join('\n'));
                  } else if (evt.type === 'error') {
                    setStreamingError(`⚠️ ${evt.error}`);
                  }
                } catch { /* ignore */ }
              }
            }

            if (content) {
              const assistantMsg: Message = {
                role: 'assistant',
                content: `**Project imported and analyzed.** The understanding document is shown in the artifact canvas.\n\nYou can now send messages to request code changes.`,
                timestamp: Date.now(),
                intent: 'code',
              };
              setMessages((prev) => {
                const updated = [...prev, assistantMsg];
                saveConversationToHistory(updated, currentConvId, activeModel, currentSystemPrompt, currentSystemPromptId)
                  .then((newId) => { if (newId) setCurrentConvId(newId); });
                return updated;
              });
            }
          } catch (err: unknown) {
            if (err instanceof Error && err.name === 'AbortError') return;
            setStreamingError(`⚠️ ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            setIsStreaming(false);
            setStreamingContent('');
            abortCtrlRef.current = null;
            finalizeArtifact();
          }
          return;
        }

        const steeringMatch = text.match(/^\/steering\s+generate/i);
        if (steeringMatch) {
          const userMsg: Message = { role: 'user', content: text, timestamp: Date.now() };
          setMessages((prev) => [...prev, userMsg]);
          setPendingImages([]); setPendingFiles([]); setPendingAudio([]);
          await handleSlashCommand('steering', 'generate', activeProjectId);
          return;
        }

        const slashMatch = text.match(/^\/(research|document|doc|code|data|workflow)\s+(.+)/i);
        if (slashMatch) {
          const cmd = slashMatch[1].toLowerCase();
          const arg = slashMatch[2].trim();
          const userMsg: Message = { role: 'user', content: text, timestamp: Date.now() };
          setMessages((prev) => [...prev, userMsg]);
          setPendingImages([]);
          setPendingFiles([]);
          setPendingAudio([]);

          // Parse optional depth flag for /research (e.g. "/research --deep quantum computing")
          let depth: 'quick' | 'standard' | 'deep' = 'standard';
          let cleanArg = arg;
          if (cmd === 'research') {
            const depthMatch = arg.match(/\s*--(quick|standard|deep)\b\s*/i);
            if (depthMatch) {
              depth = depthMatch[1].toLowerCase() as 'quick' | 'standard' | 'deep';
              cleanArg = arg.replace(depthMatch[0], ' ').trim();
            }
          }

          // Invalidate code session cache — slash commands may create sessions
          codeSessionActiveRef.current = null;
          await handleSlashCommand(cmd, cleanArg, activeProjectId, depth);
          return;
        }
      }

      if (text) {
        const buildMatch = text.match(/^\/build\s+(.+)/i);
        if (buildMatch) {
          const description = buildMatch[1].trim();
          const userMsg: Message = { role: 'user', content: text, timestamp: Date.now() };
          setMessages((prev) => [...prev, userMsg]);
          setPendingImages([]);
          setPendingFiles([]);
          setPendingAudio([]);
          setIsStreaming(true);
          setStreamingContent('🔨 Building tool: ' + description + '...');
          setStreamingError(null);
          try {
            const resp = await fetch('/api/tools/build', {
              method: 'POST',
              headers: authHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({ description, model: activeModel }),
            });
            const result = await resp.json();
            const assistantMsg: Message = {
              role: 'assistant',
              content: result.ok
                ? `✔ Tool **${result.name}** has been built and is ready to use!\n\n${result.description || description}`
                : `⚠️ Failed to build tool: ${result.error || 'Unknown error'}`,
              timestamp: Date.now(),
            };
            setMessages((prev) => {
              const updated = [...prev, assistantMsg];
              saveConversationToHistory(
                updated,
                currentConvId,
                activeModel,
                currentSystemPrompt,
                currentSystemPromptId,
              ).then((newId) => {
                if (newId) setCurrentConvId(newId);
              });
              return updated;
            });
          } catch (err: unknown) {
            setStreamingError(`⚠️ ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            setIsStreaming(false);
            setStreamingContent('');
          }
          return;
        }
      }

      // ── Code edit: if active code session exists, route edits through /code/edit ──
      if (text && activeProjectId && !hasPending) {
        // Use cached session state — skip network call when we know there's no session
        const cached = codeSessionActiveRef.current;
        const needsCheck = !cached || cached.projectId !== activeProjectId || cached.active;
        if (needsCheck) {
        try {
          const sessionResp = await fetch(
            `/api/projects/${encodeURIComponent(activeProjectId)}/code/session`,
            { headers: authHeaders() },
          );
          if (sessionResp.ok) {
            const session = await sessionResp.json();
            codeSessionActiveRef.current = { projectId: activeProjectId, active: session.status === 'active' || session.status === 'planned' };
            if (session.status === 'active' || session.status === 'planned') {
              const userMsg: Message = { role: 'user', content: text, timestamp: Date.now() };
              setMessages((prev) => [...prev, userMsg]);
              setPendingImages([]);
              setPendingFiles([]);
              setPendingAudio([]);
              setIsStreaming(true);
              setStreamingContent('');
              setStreamingError(null);

              // Open artifact canvas to show live editing
              openArtifactCanvas({ title: `Editing: ${session.description || 'code'}`, contentType: 'code' });

              try {
                abortCtrlRef.current = new AbortController();
                const isPlanned = session.status === 'planned';
                const codeEndpoint = isPlanned
                  ? `/api/projects/${encodeURIComponent(activeProjectId)}/code/generate`
                  : `/api/projects/${encodeURIComponent(activeProjectId)}/code/edit`;
                const codeBody = isPlanned
                  ? { model: getCodeModel(), answers: [text] }
                  : { instruction: text, model: getCodeModel() };
                const editResp = await fetch(
                  codeEndpoint,
                  {
                    method: 'POST',
                    headers: authHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify(codeBody),
                    signal: abortCtrlRef.current.signal,
                  },
                );

                if (editResp.ok && editResp.body) {
                  const editReader = editResp.body.getReader();
                  const editDec = new TextDecoder();
                  let editBuf = '';
                  const editProgress: string[] = [];
                  let editSummary = '';
                  let liveContent = '';
                  const changedFiles: string[] = [];

                  while (true) {
                    const { done: editDone, value: editValue } = await editReader.read();
                    if (editDone) break;
                    editBuf += editDec.decode(editValue, { stream: true });
                    const editLines = editBuf.split('\n');
                    editBuf = editLines.pop()!;
                    for (const editLine of editLines) {
                      if (!editLine.startsWith('data: ')) continue;
                      try {
                        const evt = JSON.parse(editLine.slice(6));
                        if (evt.type === 'status') {
                          editProgress.push(evt.message || '');
                          setStreamingContent(editProgress.join('\n'));
                        } else if (evt.type === 'token') {
                          // Stream tokens live into the artifact canvas
                          liveContent += (evt.text || '');
                          updateArtifactContent(liveContent);
                        } else if (evt.type === 'change') {
                          const icon = evt.action === 'created' ? '✨' : '✏️';
                          editProgress.push(`  ${icon} ${evt.file}: ${evt.action}`);
                          if (evt.file) changedFiles.push(evt.file);
                          updateArtifactFiles([...changedFiles]);
                          setStreamingContent(editProgress.join('\n'));
                        } else if (evt.type === 'summary') {
                          editSummary = evt.text || '';
                          // Show summary in the canvas as markdown
                          const summaryMd = `# Changes Applied\n\n${editSummary}\n\n---\n*Click a file below to preview the updated code.*`;
                          updateArtifactContent(summaryMd);
                        } else if (evt.type === 'done') {
                          editProgress.push(`✔ ${evt.message || 'Changes applied'}`);
                          setStreamingContent(editProgress.join('\n'));
                        } else if (evt.type === 'error') {
                          setStreamingError(`⚠️ ${evt.error}`);
                        }
                      } catch { /* ignore */ }
                    }
                  }

                  const resultText = editSummary
                    ? `**Changes applied:**\n${editSummary}`
                    : editProgress.join('\n');

                  const assistantMsg: Message = {
                    role: 'assistant',
                    content: resultText,
                    timestamp: Date.now(),
                    intent: 'code',
                    ...(changedFiles.length > 0 ? { generatedFiles: changedFiles } : {}),
                  };
                  setMessages((prev) => {
                    const updated = [...prev, assistantMsg];
                    saveConversationToHistory(updated, currentConvId, activeModel, currentSystemPrompt, currentSystemPromptId)
                      .then((newId) => { if (newId) setCurrentConvId(newId); });
                    return updated;
                  });
                }
              } catch (err: unknown) {
                if (err instanceof Error && err.name === 'AbortError') return;
                setStreamingError(`⚠️ ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsStreaming(false);
                setStreamingContent('');
                abortCtrlRef.current = null;
              }
              return;
            }
          } else {
            codeSessionActiveRef.current = { projectId: activeProjectId, active: false };
          }
        } catch {
          // No active session or fetch failed — fall through to normal chat
        }
        } // needsCheck
      }

      if (text && !hasPending && getSettings().imageGeneration && isImageRequest(text)) {
        const userMsg: Message = { role: 'user', content: text, timestamp: Date.now() };
        const nextMsgs = [...messages, userMsg];
        setMessages(nextMsgs);
        setPendingImages([]);
        setPendingFiles([]);
        setPendingAudio([]);
        await handleImageRequest(text, nextMsgs, currentConvId);
        return;
      }

      let modelOverride: string | undefined;
      let detectedIntent: 'image' | 'code' | 'text' | 'search' | 'research' | 'document' | undefined;
      const { intentModel, codeModel, webSearch: webSearchEnabled } = getSettings();

      if (text && !hasPending && codeModel && isCodeRequest(text)) {
        modelOverride = codeModel;
        detectedIntent = 'code';
      } else if (text && !hasPending && intentModel) {
        abortCtrlRef.current = new AbortController();
        const intent = await classifyIntent(text, intentModel, abortCtrlRef.current.signal).catch(
          (err) => { console.warn('[intent] outer catch:', err); return 'text' as const; },
        );
        if (abortCtrlRef.current?.signal.aborted) return;
        abortCtrlRef.current = null;
        detectedIntent = intent;

        if (intent === 'image' && getSettings().imageGeneration) {
          const userMsg: Message = { role: 'user', content: text, timestamp: Date.now() };
          const nextMsgs = [...messages, userMsg];
          setMessages(nextMsgs);
          setPendingImages([]);
          setPendingFiles([]);
          setPendingAudio([]);
          await handleImageRequest(text, nextMsgs, currentConvId);
          return;
        }
        if ((intent === 'research' || intent === 'document') && activeProjectId) {
          const userMsg: Message = { role: 'user', content: text, timestamp: Date.now() };
          setMessages((prev) => [...prev, userMsg]);
          setPendingImages([]);
          setPendingFiles([]);
          setPendingAudio([]);
          const cmd = intent === 'research' ? 'research' : 'document';
          await handleSlashCommand(cmd, text, activeProjectId);
          return;
        }
        if (intent === 'code' && codeModel) {
          modelOverride = codeModel;
        }
      }

      let fullContent = text;

      if (pendingFiles.length) {
        const fileContents = await Promise.all(
          pendingFiles.map((f) => readFileContent(f.name, f.file).catch(() => '')),
        );
        const fileBlocks = pendingFiles
          .map((f, i) => `**${f.name}**\n\`\`\`\n${fileContents[i]}\n\`\`\``)
          .join('\n\n');
        fullContent = fileBlocks + (fullContent ? '\n\n' + fullContent : '');
      }

      if (pendingAudio.length) {
        const transcripts = await Promise.all(
          pendingAudio.map((a) => transcribeWithProgress(a.file, () => {}).catch(() => null)),
        );
        const audioBlocks = pendingAudio
          .map((a, i) =>
            transcripts[i] != null
              ? `**[Audio transcript: ${a.name}]**\n${transcripts[i]}`
              : `**[Audio file attached: ${a.name}]** *(transcription unavailable)*`,
          )
          .join('\n\n');
        fullContent = audioBlocks + (fullContent ? '\n\n' + fullContent : '');
      }

      const imgs = [...pendingImages];
      const userMsg: Message = {
        role: 'user',
        content: fullContent,
        timestamp: Date.now(),
        ...(imgs.length ? { images: imgs.map((i) => i.base64) } : {}),
      };

      const nextMsgs = [...messages, userMsg];
      setMessages(nextMsgs);
      setPendingImages([]);
      setPendingFiles([]);
      setPendingAudio([]);

      let searchContext: string | undefined;
      let searchResults: import('../../types').SearchResult[] | undefined;
      const fastSearchMatch = text ? isSearchRequest(text) : false;
      const shouldSearch = webSearchEnabled && (
        fastSearchMatch ||
        detectedIntent === 'search' ||
        (!intentModel && text)
      );

      if (shouldSearch && text) {
        setStreamingContent('🔍 Searching the web…');
        setIsStreaming(true);
        const results = await webSearch(text, 5, abortCtrlRef.current?.signal);
        if (results.length > 0) {
          searchResults = results;
          searchContext = results
            .map((r, i) => `[${i + 1}] ${r.title}: ${r.body.slice(0, 150)}\nURL: ${r.href}`)
            .join('\n')
            .slice(0, 2000);
        }
        setStreamingContent('');
        setIsStreaming(false);
      }

      const replyText = await streamAssistantReply(nextMsgs, currentConvId, modelOverride, searchContext);

      if (replyText) {
        const assistantMsg: Message = {
          role: 'assistant',
          content: replyText,
          timestamp: Date.now(),
          ...(lastResponseTokensRef.current > 0 ? { tokens: lastResponseTokensRef.current } : {}),
          ...(detectedIntent ? { intent: detectedIntent, modelUsed: modelOverride ?? activeModel } : {}),
          ...(searchResults ? { searchResults } : {}),
        };
        const finalMsgs = [...nextMsgs, assistantMsg];
        setMessages(finalMsgs);
        const newConvId = await saveConversationToHistory(
          finalMsgs,
          currentConvId,
          activeModel,
          currentSystemPrompt,
          currentSystemPromptId,
        );
        setCurrentConvId(newConvId ?? null);
      } else {
        if (streamingErrorRef.current && currentConvId) {
          await saveConversationToHistory(
            nextMsgs,
            currentConvId,
            activeModel,
            currentSystemPrompt,
            currentSystemPromptId,
          );
        }
      }
    },
    [
      isStreaming,
      pendingImages,
      pendingFiles,
      pendingAudio,
      messages,
      currentConvId,
      activeModel,
      activeProjectId,
      currentSystemPrompt,
      currentSystemPromptId,
      handleImageRequest,
      handleSlashCommand,
      streamAssistantReply,
      saveConversationToHistory,
      getSettings,
      abortCtrlRef,
      setMessages,
      setPendingImages,
      setPendingFiles,
      setPendingAudio,
      setCurrentConvId,
    ],
  );

  const regenerateLastResponse = useCallback(
    async () => {
      if (isStreaming) return;
      const last = messages[messages.length - 1];
      if (last?.role !== 'assistant') return;
      const trimmed = messages.slice(0, -1);
      setMessages(trimmed);
      setStreamingContent('');
      setStreamingError(null);
      await saveConversationToHistory(
        trimmed,
        currentConvId,
        activeModel,
        currentSystemPrompt,
        currentSystemPromptId,
      );

      const replyText = await streamAssistantReply(trimmed, currentConvId);
      if (replyText) {
        const finalMsgs = [...trimmed, { role: 'assistant' as const, content: replyText, timestamp: Date.now(), ...(lastResponseTokensRef.current > 0 ? { tokens: lastResponseTokensRef.current } : {}) }];
        setMessages(finalMsgs);
        const newConvId = await saveConversationToHistory(
          finalMsgs,
          currentConvId,
          activeModel,
          currentSystemPrompt,
          currentSystemPromptId,
        );
        setCurrentConvId(newConvId ?? null);
      }
    },
    [
      isStreaming,
      messages,
      currentConvId,
      activeModel,
      currentSystemPrompt,
      currentSystemPromptId,
      streamAssistantReply,
      saveConversationToHistory,
      setMessages,
      setStreamingContent,
      setStreamingError,
      setCurrentConvId,
    ],
  );

  return {
    sendMessage,
    stopStreaming,
    regenerateLastResponse,
    editAndResend,
    handleSpecGenerate,
  };
}
