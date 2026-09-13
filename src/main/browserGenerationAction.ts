import type { BrowserGenerationAction } from '../shared/providerSeams';

/**
 * A browser provider deliberately paused because the account owner must act.
 * This is terminal for the local job: retrying automatically could repeat a
 * paid request or attempt to work around a provider challenge.
 */
export class BrowserGenerationActionRequiredError extends Error {
  override readonly name = 'BrowserGenerationActionRequiredError';

  constructor(
    readonly actionRequired: BrowserGenerationAction,
    message: string
  ) {
    super(message);
  }
}

export function browserGenerationActionFromError(error: unknown): BrowserGenerationAction | undefined {
  return error instanceof BrowserGenerationActionRequiredError ? error.actionRequired : undefined;
}
