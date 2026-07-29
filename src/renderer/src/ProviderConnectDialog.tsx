import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';

import type { LlmProviderInfo } from '../../shared/llmProviders';
import { Button } from './ui';

type ProviderConnectDialogProps = {
  readonly provider: LlmProviderInfo;
  readonly onConnect: (apiKey: string) => Promise<boolean>;
  readonly onClose: () => void;
};

type ConnectState = 'idle' | 'saving' | 'error' | 'required';

/**
 * opencode-style connect dialog: "Connect {Provider}", a paste-your-API-key
 * description, one password field, and Connect/Cancel. The key is write-only —
 * it goes straight to main-process safe storage and is never rendered back.
 */
export function ProviderConnectDialog({ provider, onConnect, onClose }: ProviderConnectDialogProps): ReactElement {
  const [apiKey, setApiKey] = useState('');
  const [state, setState] = useState<ConnectState>('idle');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
            <Button variant="ghost" type="button" onClick={onClose} disabled={state === 'saving'}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={state === 'saving'}>
              {state === 'saving' ? 'Connecting…' : 'Connect'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
