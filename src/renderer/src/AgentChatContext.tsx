import { createContext, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { AgentChatContextUsage, AgentChatDisplayMessage, AgentChatHistoryEntry, AgentChatStatus, AgentToolApprovalDecision, AgentToolCallProposal } from '../../shared/agentChat';
import type { EditAgentProjectContext } from '../../shared/editAgentContext';
import type { AiDomainModelConfig } from '../../shared/aiDomainModels';
import { isProviderConnected } from '../../shared/llmProviders';
import { resolveOpenAiAuthMode, type ReasoningEffort } from '../../shared/openAiAuth';
import {
  REASONING_EFFORT_STORAGE_KEY,
  parseReasoningEfforts,
  resolveReasoningEffort,
  serializeReasoningEfforts,
  withReasoningEffort
} from './reasoningEffortPreferences';
import { buildAgentChatSessionRows, type AgentChatSessionRow } from './agentChatSessions';
import { mergePendingUserMessage } from './agentChatTranscript';
import { useChatGptAuth } from './ChatGptAuthContext';
import { useAiDomainModel } from './AiDomainModelContext';
import { useLlmModel } from './LlmProviderContext';

function createConversationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `conv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface AgentChatController {
  readonly selectedModel: AiDomainModelConfig;
  readonly isLocalModel: boolean;
  /** True when the selected model's provider is usable: local, or cloud with a stored key. */
  readonly modelReady: boolean;
  /** Thinking effort chosen for the active model (undefined = provider default). */
  readonly reasoningEffort: ReasoningEffort | undefined;
  readonly setReasoningEffort: (effort: ReasoningEffort | undefined) => void;
  readonly input: string;
  readonly setInput: (value: string) => void;
  readonly messages: readonly AgentChatDisplayMessage[];
  readonly pendingApproval: AgentToolCallProposal | null;
  readonly status: AgentChatStatus;
  readonly error: string | undefined;
  readonly isBusy: boolean;
  readonly activeProject: EditAgentProjectContext | null;
  /** Context window consumed by the conversation, when a turn reported it. */
  readonly contextUsage: AgentChatContextUsage | undefined;
  /** Saved conversations for this project, plus the one currently open. */
  readonly sessions: readonly AgentChatSessionRow[];
  readonly startNewSession: () => void;
  readonly switchSession: (conversationId: string) => Promise<void>;
  readonly sendMessage: (text: string) => Promise<void>;
  readonly respondToApproval: (decision: AgentToolApprovalDecision, feedback?: string) => Promise<void>;
  readonly resetConversation: () => Promise<void>;
  /** Folds the conversation into a summary so it keeps fitting the window. */
  readonly compactConversation: () => Promise<void>;
}

const AgentChatContext = createContext<AgentChatController | null>(null);

/** A persisted conversation to load into the chat panel (from home screen history). */
export type AgentChatRestoreRequest = {
  readonly conversationId: string;
  readonly messages: readonly AgentChatDisplayMessage[];
};

type AgentChatProviderProps = {
  readonly activeProject: EditAgentProjectContext | null;
  readonly restoreRequest?: AgentChatRestoreRequest | null;
  readonly onRestoreHandled?: () => void;
  readonly children: ReactNode;
};

export function AgentChatProvider({ activeProject, restoreRequest = null, onRestoreHandled, children }: AgentChatProviderProps): ReactElement {
  const { providerConfig, credentialStatus } = useLlmModel();
  const chatGptAuth = useChatGptAuth();
  const { selectedModel: getSelectedDomainModel } = useAiDomainModel();
  const selectedModel = getSelectedDomainModel('edit-agent');
  const conversationIdRef = useRef<string>(createConversationId());

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<readonly AgentChatDisplayMessage[]>([]);
  const [pendingApproval, setPendingApproval] = useState<AgentToolCallProposal | null>(null);
  const [status, setStatus] = useState<AgentChatStatus>('idle');
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);
  const [contextUsage, setContextUsage] = useState<AgentChatContextUsage | undefined>(undefined);
  const [historyEntries, setHistoryEntries] = useState<readonly AgentChatHistoryEntry[]>([]);
  // Re-read after each turn so a session that just got its title shows it.
  const [historyRevision, setHistoryRevision] = useState(0);
  const [activeConversationId, setActiveConversationId] = useState(conversationIdRef.current);
  // Transcript restored from history: sent along with the next message so the
  // main process can re-seed an empty (e.g. post-relaunch) conversation thread.
  const restoredSeedRef = useRef<readonly AgentChatDisplayMessage[] | null>(null);
  // Effort is stored per model, so switching models keeps each choice.
  const [reasoningEfforts, setReasoningEfforts] = useState<Readonly<Record<string, ReasoningEffort>>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      return parseReasoningEfforts(window.localStorage.getItem(REASONING_EFFORT_STORAGE_KEY));
    } catch {
      return {};
    }
  });

  const isLocalModel = selectedModel.executionPath === 'local';
  // OpenAI has two connection methods: a stored API key, or ChatGPT sign-in for
  // Codex-family models. Either one makes the model runnable.
  const openAiAuthMode = resolveOpenAiAuthMode(selectedModel.id, chatGptAuth.isConnected);
  const reasoningEffort = resolveReasoningEffort(reasoningEfforts, selectedModel);

  const setReasoningEffort = (effort: ReasoningEffort | undefined): void => {
    setReasoningEfforts((current) => {
      const next = withReasoningEffort(current, selectedModel.id, effort);
      if (next !== current) {
        try {
          window.localStorage.setItem(REASONING_EFFORT_STORAGE_KEY, serializeReasoningEfforts(next));
        } catch {
          // The in-memory choice stays usable when local storage is unavailable.
        }
      }
      return next;
    });
  };
  const modelReady =
    isLocalModel ||
    openAiAuthMode === 'chatgpt' ||
    isProviderConnected(selectedModel.providerId, credentialStatus);

  useEffect(() => {
    if (restoreRequest === null) return;
    conversationIdRef.current = restoreRequest.conversationId;
    setActiveConversationId(restoreRequest.conversationId);
    restoredSeedRef.current = restoreRequest.messages;
    setMessages(restoreRequest.messages);
    setPendingApproval(null);
    setStatus('idle');
    setError(undefined);
    setInput('');
    onRestoreHandled?.();
  }, [restoreRequest, onRestoreHandled]);

  const projectId = activeProject?.projectId ?? null;

  useEffect(() => {
    if (projectId === null) {
      setHistoryEntries([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const response = await window.videoTool.agentChatHistoryList();
      if (!cancelled && response.ok) setHistoryEntries(response.value);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, historyRevision]);

  const sessions = buildAgentChatSessionRows({ entries: historyEntries, projectId, activeConversationId });

  const startNewSession = (): void => {
    if (isBusy) return;
    // The previous session stays in the project's saved history; only the
    // thread this panel points at changes.
    conversationIdRef.current = createConversationId();
    setActiveConversationId(conversationIdRef.current);
    restoredSeedRef.current = null;
    setMessages([]);
    setPendingApproval(null);
    setStatus('idle');
    setError(undefined);
    setInput('');
    setContextUsage(undefined);
    setHistoryRevision((revision) => revision + 1);
  };

  const switchSession = async (conversationId: string): Promise<void> => {
    if (isBusy || projectId === null || conversationId === conversationIdRef.current) return;
    const response = await window.videoTool.agentChatHistoryGet({ projectId, conversationId });
    if (!response.ok || response.value === null) {
      setStatus('error');
      setError(response.ok ? 'That conversation is no longer in this project.' : response.error.message);
      return;
    }
    conversationIdRef.current = conversationId;
    setActiveConversationId(conversationId);
    // Seed the main-process thread from the stored transcript, the same path
    // the home screen uses when reopening a conversation.
    restoredSeedRef.current = response.value.messages;
    setMessages(response.value.messages);
    setPendingApproval(null);
    setStatus('idle');
    setError(undefined);
    setInput('');
  };

  const sendMessage = async (text: string): Promise<void> => {
    if (text.trim().length === 0 || isBusy || !modelReady) return;

    // Echo the turn immediately. The main-process round trip takes as long as
    // the model does, so waiting for it leaves the panel looking like the
    // message was dropped.
    const pendingUserMessage: AgentChatDisplayMessage = {
      id: `pending-user-${createConversationId()}`,
      role: 'user',
      text
    };
    setMessages((current) => [...current, pendingUserMessage]);
    setIsBusy(true);
    setError(undefined);
    setStatus('thinking');
    setInput('');

    try {
      const response = await window.videoTool.agentChatSend({
        conversationId: conversationIdRef.current,
        text,
        modelId: selectedModel.id,
        ollamaBaseUrl: providerConfig.ollamaBaseUrl,
        activeProject: activeProject ?? undefined,
        openAiAuthMode,
        reasoningEffort,
        restoredMessages: restoredSeedRef.current ?? undefined
      });

      if (response.ok) {
        restoredSeedRef.current = null;
        setContextUsage(response.value.contextUsage);
        setHistoryRevision((revision) => revision + 1);
        setMessages(
          response.value.status === 'error'
            ? mergePendingUserMessage(response.value.messages, pendingUserMessage)
            : response.value.messages
        );
        setPendingApproval(response.value.pendingApproval);
        setStatus(response.value.status);
        setError(response.value.error);
      } else {
        // The echoed turn stays on screen so the error reads as a reply to it.
        setStatus('error');
        setError(response.error.message);
      }
    } catch (cause) {
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Agent request failed.');
    } finally {
      setIsBusy(false);
    }
  };

  const respondToApproval = async (decision: AgentToolApprovalDecision, feedback?: string): Promise<void> => {
    if (!pendingApproval || isBusy) return;

    setIsBusy(true);
    try {
      const response = await window.videoTool.agentChatApprove({
        conversationId: conversationIdRef.current,
        toolCallId: pendingApproval.toolCallId,
        decision,
        ...(feedback === undefined || feedback.trim().length === 0 ? {} : { feedback })
      });

      if (response.ok) {
        setContextUsage(response.value.contextUsage);
        setMessages(response.value.messages);
        setPendingApproval(response.value.pendingApproval);
        setStatus(response.value.status);
        setError(response.value.error);
      } else {
        setStatus('error');
        setError(response.error.message);
      }
    } catch (cause) {
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Agent approval failed.');
    } finally {
      setIsBusy(false);
    }
  };

  const compactConversation = async (): Promise<void> => {
    if (isBusy) return;
    setIsBusy(true);
    setStatus('thinking');
    try {
      const response = await window.videoTool.agentChatCompact({ conversationId: conversationIdRef.current });
      if (!response.ok) {
        setStatus('error');
        setError(response.error.message);
        return;
      }
      restoredSeedRef.current = null;
      setMessages(response.value.messages);
      setPendingApproval(response.value.pendingApproval);
      setStatus(response.value.status);
      setError(response.value.error);
      setContextUsage(response.value.contextUsage);
    } catch (cause) {
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Could not compact the conversation.');
    } finally {
      setIsBusy(false);
    }
  };

  const resetConversation = async (): Promise<void> => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      const response = await window.videoTool.agentChatReset({ conversationId: conversationIdRef.current });
      if (!response.ok) {
        setStatus('error');
        setError(response.error.message);
        return;
      }

      restoredSeedRef.current = null;
      setMessages([]);
      setPendingApproval(null);
      setStatus('idle');
      setError(undefined);
    } catch (cause) {
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Could not reset the agent conversation.');
    } finally {
      setIsBusy(false);
    }
  };

  const controller: AgentChatController = {
    selectedModel,
    isLocalModel,
    modelReady,
    reasoningEffort,
    setReasoningEffort,
    input,
    setInput,
    messages,
    pendingApproval,
    status,
    error,
    isBusy,
    activeProject,
    contextUsage,
    sessions,
    startNewSession,
    switchSession,
    sendMessage,
    respondToApproval,
    resetConversation,
    compactConversation
  };

  return <AgentChatContext.Provider value={controller}>{children}</AgentChatContext.Provider>;
}

export function useAgentChat(): AgentChatController {
  const context = useContext(AgentChatContext);
  if (context === null) {
    throw new Error('useAgentChat must be used within AgentChatProvider.');
  }
  return context;
}
