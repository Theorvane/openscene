import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';

import type { LlmProviderInfo } from '../../shared/llmProviders';
import { Button } from './ui';

/**
 * Optional second sign-in method for a provider (the "Select login
 * method" step). Today only OpenAI has one: ChatGPT Pro/Plus sign-in, which
 * unlocks the Codex model family alongside the API key.
 */
export type ProviderOAuthMethod = {
  readonly label: string;
  readonly description: string;
  readonly isConnecting: boolean;
  readonly error?: string | undefined;
  readonly onSignIn: () => Promise<boolean>;
  readonly onCancel: () => Promise<void>;
};

type ProviderConnectDialogProps = {
  readonly provider: LlmProviderInfo;
  readonly onConnect: (apiKey: string) => Promise<boolean>;
  readonly onClose: () => void;
  readonly oauthMethod?: ProviderOAuthMethod | undefined;
};

type ConnectState = 'idle' | 'saving' | 'error' | 'required';
type DialogStep = 'method' | 'api-key' | 'oauth';

/**
 * Connect dialog. Providers with a single method go straight to
 * the API-key form; providers that also support a sign-in method first show the
 * method picker. The key is write-only — it goes straight to main-process safe
 * storage and is never rendered back.
 */
export function ProviderConnectDialog({ provider, onConnect, onClose, oauthMethod }: ProviderConnectDialogProps): ReactElement {
  const [apiKey, setApiKey] = useState('');
  const [state, setState] = useState<ConnectState>('idle');
  const [step, setStep] = useState<DialogStep>(oauthMethod === undefined ? 'api-key' : 'method');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (step === 'api-key') inputRef.current?.focus();
  }, [step]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (apiKey.trim().length === 0) {
      setState('required');
      return;
    }
    setState('saving');
    const saved = await onConnect(apiKey.trim());
    if (saved) {
      onClose();
      return;
    }
    setState('error');
  };

  const startSignIn = async (): Promise<void> => {
    if (oauthMethod === undefined) return;
    setStep('oauth');
    const connected = await oauthMethod.onSignIn();
    if (connected) {
      onClose();
      return;
    }
    setStep('method');
  };

  return (
    <div className="provider-connect-dialog__backdrop" role="presentation" onClick={onClose}>
      <div
        className="provider-connect-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-connect-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="provider-connect-dialog-title" className="provider-connect-dialog__title">Connect {provider.label}</h3>

        {step === 'method' && oauthMethod !== undefined && (
          <>
            <p className="provider-connect-dialog__description">Select a login method for {provider.label}.</p>
            <div className="provider-connect-dialog__methods" role="list">
              <button type="button" role="listitem" className="provider-connect-dialog__method" onClick={() => void startSignIn()}>
                <span className="provider-connect-dialog__method-label">{oauthMethod.label}</span>
                <span className="provider-connect-dialog__method-note">{oauthMethod.description}</span>
              </button>
              <button type="button" role="listitem" className="provider-connect-dialog__method" onClick={() => setStep('api-key')}>
                <span className="provider-connect-dialog__method-label">API key</span>
                <span className="provider-connect-dialog__method-note">
                  Paste a {provider.label} API key for the public API.
                </span>
              </button>
            </div>
            {oauthMethod.error !== undefined && (
              <p role="alert" className="provider-connect-dialog__error">{oauthMethod.error}</p>
            )}
            <div className="provider-connect-dialog__actions">
              <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}

        {step === 'oauth' && oauthMethod !== undefined && (
          <>
            <p className="provider-connect-dialog__description">
              Finish signing in to {oauthMethod.label} in your browser. This window updates automatically.
            </p>
            <div className="provider-connect-dialog__actions">
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  void oauthMethod.onCancel();
                  setStep('method');
                }}
              >
                Cancel sign-in
              </Button>
            </div>
          </>
        )}

        {step === 'api-key' && (
          <>
            <p className="provider-connect-dialog__description">
              Paste your {provider.label} API key. It is stored in main-process safe storage and never shown again.
            </p>
            <form className="provider-connect-dialog__form" onSubmit={(event) => void submit(event)}>
              <label className="field-label" htmlFor="provider-connect-api-key">
                {provider.label} API key
                <input
                  id="provider-connect-api-key"
                  ref={inputRef}
                  type="password"
                  placeholder={provider.keyPlaceholder ?? 'API key'}
                  value={apiKey}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    if (state === 'required') setState('idle');
                  }}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              {state === 'required' && <p role="alert" className="provider-connect-dialog__error">API key is required</p>}
              {state === 'error' && <p role="alert" className="provider-connect-dialog__error">The key could not be saved. Try again.</p>}
              <div className="provider-connect-dialog__actions">
                {oauthMethod !== undefined && (
                  <Button variant="ghost" type="button" onClick={() => setStep('method')} disabled={state === 'saving'}>Back</Button>
                )}
                <Button variant="ghost" type="button" onClick={onClose} disabled={state === 'saving'}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={state === 'saving'}>
                  {state === 'saving' ? 'Connecting…' : 'Connect'}
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
