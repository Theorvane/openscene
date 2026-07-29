import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';

/**
 * ChatGPT sign-in state for the unified OpenAI provider. The renderer only ever
 * sees a connected/disconnected status — tokens live in main-process storage
 * and never cross the bridge.
 */
export type ChatGptAuthState = 'checking' | 'connected' | 'disconnected' | 'connecting';

type ChatGptAuthContextValue = {
  readonly state: ChatGptAuthState;
  readonly isConnected: boolean;
  readonly error: string | undefined;
  readonly connect: () => Promise<boolean>;
  readonly cancel: () => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly refresh: () => Promise<void>;
};

const ChatGptAuthContext = createContext<ChatGptAuthContextValue | null>(null);

export function ChatGptAuthProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [state, setState] = useState<ChatGptAuthState>('checking');
  const [error, setError] = useState<string | undefined>(undefined);

  const refresh = useCallback(async (): Promise<void> => {
    const response = await window.videoTool.getChatGptOAuthStatus();
    setState(response.ok && response.value.kind === 'connected' ? 'connected' : 'disconnected');
    if (!response.ok) setError(response.error.message);
  }, []);

  useEffect(() => {
    void refresh();
    // A sign-in finishes in the browser, so re-read the status when the window
    // comes back into focus rather than trusting a single mount-time read.
    const onFocus = (): void => {
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const connect = useCallback(async (): Promise<boolean> => {
    setState('connecting');
    setError(undefined);
    // The main process opens the system browser and waits for the loopback
    // callback, so this promise stays pending until the user finishes or cancels.
    const response = await window.videoTool.startChatGptOAuth();
    if (response.ok && response.value.kind === 'connected') {
      setState('connected');
      return true;
    }
    setState('disconnected');
    setError(response.ok ? 'ChatGPT sign-in did not complete.' : response.error.message);
    return false;
  }, []);

  const cancel = useCallback(async (): Promise<void> => {
    await window.videoTool.cancelChatGptOAuth();
    setState('disconnected');
  }, []);

  const disconnect = useCallback(async (): Promise<void> => {
    const response = await window.videoTool.logoutChatGptOAuth();
    setState(response.ok && response.value.kind === 'connected' ? 'connected' : 'disconnected');
    setError(undefined);
  }, []);

  const value = useMemo<ChatGptAuthContextValue>(
    () => ({ state, isConnected: state === 'connected', error, connect, cancel, disconnect, refresh }),
    [cancel, connect, disconnect, error, refresh, state]
  );

  return <ChatGptAuthContext.Provider value={value}>{children}</ChatGptAuthContext.Provider>;
}

export function useChatGptAuth(): ChatGptAuthContextValue {
  const context = useContext(ChatGptAuthContext);
  if (context === null) {
    throw new Error('useChatGptAuth must be used within ChatGptAuthProvider.');
  }
  return context;
}
