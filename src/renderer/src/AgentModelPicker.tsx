import { useState, type ReactElement } from 'react';

import { agentModelGroupStatus, buildAgentModelGroups, isAgentModelLinked } from './agentModelPickerModel';
import { useAiDomainModel } from './AiDomainModelContext';
import { useChatGptAuth } from './ChatGptAuthContext';
import { useLlmModel } from './LlmProviderContext';
import { useModelVisibility } from './ModelVisibilityContext';

/**
 * opencode-style model selector for the Edit Agent prompt bar: models grouped
 * by provider, connection state per provider, and cloud models disabled until
 * their provider is connected in Settings.
 */
export function AgentModelPicker(): ReactElement {
  const { selectedModel, setSelectedModelId } = useAiDomainModel();
  const { credentialStatus } = useLlmModel();
  const { isModelVisible } = useModelVisibility();
  const chatGptAuth = useChatGptAuth();
  const [isOpen, setIsOpen] = useState(false);

  const activeModel = selectedModel('edit-agent');
  const groups = buildAgentModelGroups({
    activeModelId: activeModel.id,
    credentialStatus,
    chatGptConnected: chatGptAuth.isConnected,
    isModelVisible
  });

  return (
    <div className="agent-model-picker">
      <button
        type="button"
        className="agent-model-picker__trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls="agent-model-picker-popover"
        title="Choose the Edit Agent model"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="agent-model-picker__trigger-label">{activeModel.label}</span>
        <span className="agent-model-picker__trigger-provider">{activeModel.providerLabel}</span>
        <span aria-hidden="true" className="agent-model-picker__trigger-caret">▾</span>
      </button>
      {isOpen && (
        <div
          id="agent-model-picker-popover"
          className="agent-model-picker__popover"
          role="listbox"
          aria-label="Edit Agent models by provider"
        >
          {groups.map((group) => {
            const status = agentModelGroupStatus(group, { credentialStatus, chatGptConnected: chatGptAuth.isConnected });
            const connected = status !== 'Not connected';
            return (
              <div key={group.providerId} className="agent-model-picker__group">
                <div className="agent-model-picker__group-header">
                  <span className="agent-model-picker__group-label">{group.providerLabel}</span>
                  <span
                    className={`agent-model-picker__group-status${connected ? ' agent-model-picker__group-status--connected' : ''}`}
                  >
                    {status}
                  </span>
                </div>
                {group.models.map((model) => {
                  const selectable = model.available && connected;
                  const isActive = model.id === activeModel.id;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      className={`agent-model-picker__option${isActive ? ' agent-model-picker__option--active' : ''}`}
                      disabled={!selectable}
                      title={selectable ? model.description : `Connect ${model.providerLabel} in Settings → Providers first.`}
                      onClick={() => {
                        setSelectedModelId('edit-agent', model.id);
                        setIsOpen(false);
                      }}
                    >
                      <span className="agent-model-picker__option-label">{model.label}</span>
                      <span className="agent-model-picker__option-meta">
                        {model.executionPath === 'local' ? model.precisionBit ?? 'Local' : model.contextWindow ?? 'Cloud'}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
          {groups.length === 0 ? (
            /* The local engine is always listed, so an empty list means the
               running build predates this code or the catalog failed to load. */
            <p className="agent-model-picker__hint">
              No models resolved — restart the app to pick up the current build.
            </p>
          ) : groups.every((group) => group.models[0]?.executionPath === 'local') ? (
            <p className="agent-model-picker__hint">
              Connect a provider in Settings → Providers to add its models here.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
