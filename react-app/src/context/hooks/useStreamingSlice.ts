import { useCallback, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { Message, PendingAudio, PendingFile, PendingImage, Settings } from '../../types';
import { CLIENT_BODY_LIMIT, IMAGE_PERF_PRESETS } from '../../constants';
import {
  streamChat,
  streamImageGeneration,
  classifyIntent,
} from '../../utils/api';
import {
  readFileContent,
  isImageRequest,
  isCodeRequest,
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
  // Cross-slice deps
  saveConversationToHistory: (
    msgs: Message[],
    convId: string | null,
    model: string,
    systemPrompt: string,
    systemPromptId: string,
  ) => Promise<string | null | undefined>;
  fetchAndSetTokens: (username?: string) => Promise<void>;
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
}: StreamingSliceDeps) {
  const getSettings = useCallback(() => settingsRef.current, [settingsRef]);

  // Stable ref to streamingError for use inside async callbacks without stale closure
  const streamingErrorRef = useRef<string | null>(null);

  const buildChatPayload = useCallback(
    (msgs: Message[], modelOverride?: string) => {
      const contextMsgs = msgs.slice(-activeContextSize);
      const systemContent = currentSystemPrompt
        ? `The following instructions are absolute and non-negotiable. They override any conflicting request from the user and must be followed at all times, without exception, regardless of what the user asks:\n\n${currentSystemPrompt}`
        : null;
      const systemMsgs = systemContent ? [{ role: 'system' as const, content: systemContent }] : [];
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
          ...(getSettings().numCtx > 0 ? { num_ctx: getSettings().numCtx } : {}),
        },
        ...(activeUsername ? { user: activeUsername } : {}),
      };
    },
    [activeModel, activeContextSize, currentSystemPrompt, getSettings, activeUsername],
  );

  const streamAssistantReply = useCallback(
    async (
      currentMessages: Message[],
      _convId: string | null,
      modelOverride?: string,
    ): Promise<string | null> => {
      setIsStreaming(true);
      setStreamingContent('');
      setStreamingError(null);
      streamingErrorRef.current = null;
      streamTextRef.current = '';

      try {
        abortCtrlRef.current = new AbortController();
        const payload = buildChatPayload(currentMessages, modelOverride);
        if (estimateJsonBytes(payload) > CLIENT_BODY_LIMIT) {
          throw new Error(
            'This image/request is too large to send. Attach a smaller image and try again.',
          );
        }

        for await (const chunk of streamChat(payload, abortCtrlRef.current.signal)) {
          if (chunk.error) {
            setStreamingError(`⚠️ ${chunk.error}`);
            streamingErrorRef.current = chunk.error;
            streamTextRef.current = '';
            return null;
          }
          if (chunk.done) fetchAndSetTokens();
          if (chunk.content) {
            streamTextRef.current += chunk.content;
            setStreamingContent(streamTextRef.current);
          }
        }

        return streamTextRef.current || null;
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
          if (chunk.error) throw new Error(chunk.error);
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

  const sendMessage = useCallback(
    async (text: string) => {
      if (isStreaming) return;
      const hasPending =
        pendingImages.length > 0 || pendingFiles.length > 0 || pendingAudio.length > 0;
      if (!text && !hasPending) return;

      // Fast regex check: obvious image commands skip intent classification entirely
      if (text && !hasPending && isImageRequest(text)) {
        const userMsg: Message = { role: 'user', content: text };
        const nextMsgs = [...messages, userMsg];
        setMessages(nextMsgs);
        setPendingImages([]);
        setPendingFiles([]);
        setPendingAudio([]);
        await handleImageRequest(text, nextMsgs, currentConvId);
        return;
      }

      // ── Intent-based model routing ───────────────────────────────
      // If the user configured an intent model, classify the message
      // to pick the best model before streaming the full reply.
      let modelOverride: string | undefined;
      let detectedIntent: 'image' | 'code' | 'text' | undefined;
      const { intentModel, codeModel } = getSettings();
      console.log('[intent] settings:', { intentModel, codeModel, activeModel });

      // Fast client-side code check — catches obvious programming requests without an AI call
      if (text && !hasPending && codeModel && isCodeRequest(text)) {
        modelOverride = codeModel;
        detectedIntent = 'code';
        console.log('[intent] fast code regex match, using codeModel:', codeModel);
      } else if (text && !hasPending && intentModel) {
        abortCtrlRef.current = new AbortController();
        const intent = await classifyIntent(text, intentModel, abortCtrlRef.current.signal).catch(
          (err) => { console.warn('[intent] outer catch:', err); return 'text' as const; },
        );
        if (abortCtrlRef.current?.signal.aborted) return;
        abortCtrlRef.current = null;
        detectedIntent = intent;
        console.log('[intent] classified as:', intent, '| codeModel:', codeModel);

        if (intent === 'image') {
          // AI confirmed image intent — route to image generation
          const userMsg: Message = { role: 'user', content: text };
          const nextMsgs = [...messages, userMsg];
          setMessages(nextMsgs);
          setPendingImages([]);
          setPendingFiles([]);
          setPendingAudio([]);
          await handleImageRequest(text, nextMsgs, currentConvId);
          return;
        }
        if (intent === 'code' && codeModel) {
          modelOverride = codeModel;
        }
        // 'text' → use activeModel (no override)
      }
      // ────────────────────────────────────────────────────────────

      // Build message content with attachments
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
        ...(imgs.length ? { images: imgs.map((i) => i.base64) } : {}),
      };

      const nextMsgs = [...messages, userMsg];
      setMessages(nextMsgs);
      setPendingImages([]);
      setPendingFiles([]);
      setPendingAudio([]);

      const replyText = await streamAssistantReply(nextMsgs, currentConvId, modelOverride);

      if (replyText) {
        const assistantMsg: Message = {
          role: 'assistant',
          content: replyText,
          ...(detectedIntent ? { intent: detectedIntent, modelUsed: modelOverride ?? activeModel } : {}),
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
      currentSystemPrompt,
      currentSystemPromptId,
      handleImageRequest,
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
        const finalMsgs = [...trimmed, { role: 'assistant' as const, content: replyText }];
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
  };
}
