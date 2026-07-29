import { useState, type ReactElement } from 'react';

import { getDomainModels, type AiDomainModelConfig } from '../../shared/aiDomainModels';
import { isProviderConnected } from '../../shared/llmProviders';
import { useAiDomainModel } from './AiDomainModelContext';
import { useLlmModel } from './LlmProviderContext';
import { useModelVisibility } from './ModelVisibilityContext';

type ProviderGroup = {
  readonly providerId: string;
  readonly providerLabel: string;
  readonly models: readonly AiDomainModelConfig[];
};

function groupByProvider(models: readonly AiDomainModelConfig[]): readonly ProviderGroup[] {
  const groups: ProviderGroup[] = [];
  for (const model of models) {
    const existing = groups.find((group) => group.providerId === model.providerId);
    if (existing === undefined) {
      groups.push({ providerId: model.providerId, providerLabel: model.providerLabel, models: [model] });
    } else {
      (existing.models as AiDomainModelConfig[]).push(model);
    }
  }
  return groups;
}

/**
 * opencode-style model selector for the Edit Agent prompt bar: models grouped
 * by provider, connection state per provider, and cloud models disabled until
 * their provider is connected in Settings.
 */
export function AgentModelPicker(): ReactElement {
  const { selectedModel, setSelectedModelId } = useAiDomainModel();
  const { credentialStatus } = useLlmModel();
  const { isModelVisible } = useModelVisibility();
  const [isOpen, setIsOpen] = useState(false);

  const activeModel = selectedModel('edit-agent');
  // opencode behavior: the picker lists the local engine plus models from
  // connected providers only (the full catalog would be thousands of disabled
  // rows). Settings → Models visibility switches filter further; the active
  // model always stays listed so the current selection is never orphaned.
  const models = getDomainModels('edit-agent').filter((model) => {
    if (model.id === activeModel.id) return true;
    if (model.executionPath !== 'local' && !isProviderConnected(model.providerId, credentialStatus)) return false;
    return isModelVisible(model.providerId, model.id);
  });
  const groups = groupByProvider(models);

  const providerStatusLabel = (group: ProviderGroup): string => {
    if (group.models[0]?.executionPath === 'local') return 'Local';
    return isProviderConnected(group.providerId, credentialStatus) ? 'Connected' : 'Not connected';
  };

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
            const connected = group.models[0]?.executionPath === 'local' || isProviderConnected(group.providerId, credentialStatus);
            return (
              <div key={group.providerId} className="agent-model-picker__group">
                <div className="agent-model-picker__group-header">
                  <span className="agent-model-picker__group-label">{group.providerLabel}</span>
                  <span
                    className={`agent-model-picker__group-status${connected ? ' agent-model-picker__group-status--connected' : ''}`}
                  >
                    {providerStatusLabel(group)}
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
          <p className="agent-model-picker__hint">Connect providers in Settings → Providers to add their models here.</p>
        </div>
      )}
    </div>
  );
}
