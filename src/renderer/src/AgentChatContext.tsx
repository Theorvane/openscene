import { createContext, useContext, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { AgentChatDisplayMessage, AgentChatStatus, AgentToolCallProposal } from '../../shared/agentChat';
import type { EditAgentProjectContext } from '../../shared/editAgentContext';
import type { AiDomainModelConfig } from '../../shared/aiDomainModels';
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
  readonly input: string;
  readonly setInput: (value: string) => void;
  readonly messages: readonly AgentChatDisplayMessage[];
  readonly pendingApproval: AgentToolCallProposal | null;
  readonly status: AgentChatStatus;
  readonly error: string | undefined;
  readonly isBusy: boolean;
  readonly activeProject: EditAgentProjectContext | null;
  readonly sendMessage: (text: string) => Promise<void>;
  readonly respondToApproval: (decision: 'approve' | 'deny') => Promise<void>;
  readonly resetConversation: () => Promise<void>;
}

const AgentChatContext = createContext<AgentChatController | null>(null);

type AgentChatProviderProps = {
  readonly activeProject: EditAgentProjectContext | null;
  readonly children: ReactNode;
};

export function AgentChatProvider({ activeProject, children }: AgentChatProviderProps): ReactElement {
  const { providerConfig } = useLlmModel();
  const { selectedModel: getSelectedDomainModel } = useAiDomainModel();
  const selectedModel = getSelectedDomainModel('edit-agent');
  const conversationIdRef = useRef<string>(createConversationId());

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<readonly AgentChatDisplayMessage[]>([]);
  const [pendingApproval, setPendingApproval] = useState<AgentToolCallProposal | null>(null);
  const [status, setStatus] = useState<AgentChatStatus>('idle');
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);

  const isLocalModel = selectedModel.providerId === 'local_ollama';

  const sendMessage = async (text: string): Promise<void> => {
    if (text.trim().length === 0 || isBusy || !isLocalModel) return;

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
        activeProject: activeProject ?? undefined
      });

      if (response.ok) {
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
      setError(cause instanceof Error ? cause.message : 'Agent request failed.');
    } finally {
      setIsBusy(false);
    }
  };

  const respondToApproval = async (decision: 'approve' | 'deny'): Promise<void> => {
    if (!pendingApproval || isBusy) return;

    setIsBusy(true);
    try {
      const response = await window.videoTool.agentChatApprove({
        conversationId: conversationIdRef.current,
        toolCallId: pendingApproval.toolCallId,
        decision
      });

      if (response.ok) {
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
    input,
    setInput,
    messages,
    pendingApproval,
    status,
    error,
    isBusy,
    activeProject,
    sendMessage,
    respondToApproval,
    resetConversation
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
