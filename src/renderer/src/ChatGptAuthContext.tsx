import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';

/** Codex device authorization state; tokens remain in main-process storage. */
export type ChatGptAuthState = 'checking' | 'connected' | 'disconnected' | 'connecting';

type DeviceAuthorization = {
  readonly verificationUrl: string;
  readonly userCode: string;
};

type ChatGptAuthContextValue = {
  readonly state: ChatGptAuthState;
  readonly isConnected: boolean;
  readonly deviceAuthorization: DeviceAuthorization | undefined;
  readonly error: string | undefined;
  readonly connect: () => Promise<boolean>;
  readonly cancel: () => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly refresh: () => Promise<void>;
};

const ChatGptAuthContext = createContext<ChatGptAuthContextValue | null>(null);

export function ChatGptAuthProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [state, setState] = useState<ChatGptAuthState>('checking');
  const [deviceAuthorization, setDeviceAuthorization] = useState<DeviceAuthorization | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const refresh = useCallback(async (): Promise<void> => {
    const response = await window.videoTool.getChatGptOAuthStatus();
    if (!response.ok) {
      setState('disconnected');
      setDeviceAuthorization(undefined);
      setError(response.error.message);
      return;
    }
    if (response.value.kind === 'connected') {
      setState('connected');
      setDeviceAuthorization(undefined);
      return;
    }
    if (response.value.kind === 'pending') {
      setState('connecting');
      setDeviceAuthorization({ verificationUrl: response.value.verificationUrl, userCode: response.value.userCode });
      return;
    }
    setState('disconnected');
    setDeviceAuthorization(undefined);
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = (): void => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  useEffect(() => {
    if (state !== 'connecting') return;
    const timer = window.setInterval(() => void refresh(), 1_500);
    return () => window.clearInterval(timer);
  }, [refresh, state]);

  const connect = useCallback(async (): Promise<boolean> => {
    setState('connecting');
    setError(undefined);
    const response = await window.videoTool.startChatGptOAuth();
    if (response.ok && response.value.kind === 'pending') {
      setDeviceAuthorization({ verificationUrl: response.value.verificationUrl, userCode: response.value.userCode });
      return false;
    }
    if (response.ok && response.value.kind === 'connected') {
      setState('connected');
      return true;
    }
    setState('disconnected');
    setError(response.ok ? 'Codex device authorization did not start.' : response.error.message);
    return false;
  }, []);

  const cancel = useCallback(async (): Promise<void> => {
    await window.videoTool.cancelChatGptOAuth();
    setState('disconnected');
    setDeviceAuthorization(undefined);
  }, []);

  const disconnect = useCallback(async (): Promise<void> => {
    const response = await window.videoTool.logoutChatGptOAuth();
    setState(response.ok && response.value.kind === 'connected' ? 'connected' : 'disconnected');
    setDeviceAuthorization(undefined);
    setError(undefined);
  }, []);

  const value = useMemo<ChatGptAuthContextValue>(
    () => ({ state, isConnected: state === 'connected', deviceAuthorization, error, connect, cancel, disconnect, refresh }),
    [cancel, connect, deviceAuthorization, disconnect, error, refresh, state]
  );

  return <ChatGptAuthContext.Provider value={value}>{children}</ChatGptAuthContext.Provider>;
}

export function useChatGptAuth(): ChatGptAuthContextValue {
  const context = useContext(ChatGptAuthContext);
  if (context === null) throw new Error('useChatGptAuth must be used within ChatGptAuthProvider.');
  return context;
}
