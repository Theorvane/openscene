import type { LlmCompletionRequest, LlmCompletionResponse } from './llmAdapter';

type LlmCompletionAdapter = {
  readonly executeCompletion: (request: LlmCompletionRequest) => Promise<LlmCompletionResponse>;
};

type LlmPromptRouterDependencies = {
  readonly apiKeyAdapter: LlmCompletionAdapter;
  readonly chatGptAdapter: LlmCompletionAdapter;
};

export class LlmPromptRouter {
  private readonly apiKeyAdapter: LlmCompletionAdapter;
  private readonly chatGptAdapter: LlmCompletionAdapter;

  constructor(dependencies: LlmPromptRouterDependencies) {
    this.apiKeyAdapter = dependencies.apiKeyAdapter;
    this.chatGptAdapter = dependencies.chatGptAdapter;
  }

  executeCompletion(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    return request.openAiAuthMode === 'chatgpt'
      ? this.chatGptAdapter.executeCompletion(request)
      : this.apiKeyAdapter.executeCompletion(request);
  }
}
