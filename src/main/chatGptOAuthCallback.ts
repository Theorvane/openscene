import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

type CallbackFailureReason =
  | 'authorization_failed'
  | 'cancelled'
  | 'invalid_callback'
  | 'invalid_state'
  | 'replayed_state'
  | 'server_failed'
  | 'timed_out';

export class ChatGptOAuthCallbackError extends Error {
  override readonly name = 'ChatGptOAuthCallbackError';

  constructor(readonly reason: CallbackFailureReason, message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

type ReceiveAuthorizationCodeInput = {
  readonly redirectUri: string;
  readonly expectedState: string;
  readonly authorizationUrl: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly openExternal: (url: string) => Promise<void>;
};

function stateMatches(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
}

export function receiveAuthorizationCode(input: ReceiveAuthorizationCodeInput): Promise<string> {
  if (input.signal.aborted) {
    return Promise.reject(new ChatGptOAuthCallbackError('cancelled', 'ChatGPT authorization was cancelled.'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let consumed = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const redirect = new URL(input.redirectUri);

    const server = createServer((request, response) => {
      response.setHeader('connection', 'close');
      if (request.method !== 'GET' || request.url === undefined) {
        response.writeHead(405).end('Method not allowed');
        return;
      }

      const callback = new URL(request.url, input.redirectUri);
      if (callback.pathname === '/cancel') {
        consumed = true;
        response.writeHead(200).end('Authorization cancelled');
        finish({ kind: 'error', error: new ChatGptOAuthCallbackError('cancelled', 'ChatGPT authorization was cancelled.') });
        return;
      }
      if (callback.pathname !== redirect.pathname) {
        response.writeHead(404).end('Not found');
        return;
      }
      if (consumed) {
        response.writeHead(409).end('Authorization callback already used');
        finish({ kind: 'error', error: new ChatGptOAuthCallbackError('replayed_state', 'Authorization callback was replayed.') });
        return;
      }

      const receivedState = callback.searchParams.get('state');
      if (receivedState === null || !stateMatches(receivedState, input.expectedState)) {
        response.writeHead(400).end('Invalid authorization state');
        finish({ kind: 'error', error: new ChatGptOAuthCallbackError('invalid_state', 'ChatGPT authorization state did not match.') });
        return;
      }

      const authorizationError = callback.searchParams.get('error');
      if (authorizationError !== null) {
        consumed = true;
        response.writeHead(400).end('Authorization failed');
        finish({ kind: 'error', error: new ChatGptOAuthCallbackError('authorization_failed', 'ChatGPT authorization was rejected.') });
        return;
      }

      const code = callback.searchParams.get('code');
      if (code === null || code.length === 0) {
        response.writeHead(400).end('Authorization code missing');
        finish({ kind: 'error', error: new ChatGptOAuthCallbackError('invalid_callback', 'ChatGPT authorization code was missing.') });
        return;
      }

      consumed = true;
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('Authorization complete. You may close this window.');
      finish({ kind: 'success', code });
    });

    type Outcome =
      | { readonly kind: 'success'; readonly code: string }
      | { readonly kind: 'error'; readonly error: ChatGptOAuthCallbackError };

    function settle(outcome: Outcome): void {
      switch (outcome.kind) {
        case 'success':
          resolve(outcome.code);
          return;
        case 'error':
          reject(outcome.error);
          return;
      }
    }

    function finish(outcome: Outcome): void {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      input.signal.removeEventListener('abort', cancel);
      if (!server.listening) {
        settle(outcome);
        return;
      }
      server.close((error) => {
        if (error !== undefined) {
          reject(new ChatGptOAuthCallbackError('server_failed', 'Could not close the ChatGPT callback server.', { cause: error }));
          return;
        }
        settle(outcome);
      });
    }

    function cancel(): void {
      finish({ kind: 'error', error: new ChatGptOAuthCallbackError('cancelled', 'ChatGPT authorization was cancelled.') });
    }

    server.once('error', (error) => {
      finish({ kind: 'error', error: new ChatGptOAuthCallbackError('server_failed', 'Could not run the ChatGPT callback server.', { cause: error }) });
    });
    server.listen(Number(redirect.port), redirect.hostname, () => {
      timeout = setTimeout(() => {
        finish({ kind: 'error', error: new ChatGptOAuthCallbackError('timed_out', 'ChatGPT authorization timed out.') });
      }, input.timeoutMs);
      input.signal.addEventListener('abort', cancel, { once: true });
      void input.openExternal(input.authorizationUrl).catch((error: unknown) => {
        finish({ kind: 'error', error: new ChatGptOAuthCallbackError('server_failed', 'Could not open ChatGPT authorization in the browser.', { cause: error }) });
      });
    });
  });
}
