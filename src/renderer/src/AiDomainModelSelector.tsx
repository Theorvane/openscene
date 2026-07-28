import { useState, type ReactElement } from 'react';

import {
  formatAiModelOptionLabel,
  getDomainModels,
  type AiDomain,
  type AiDomainModelConfig
} from '../../shared/aiDomainModels';
import { useAiDomainModel } from './AiDomainModelContext';

type AiDomainModelSelectorProps = {
  readonly domain: AiDomain;
  readonly label: string;
  readonly description?: string;
};

export function AiDomainModelSelector({ domain, label, description }: AiDomainModelSelectorProps): ReactElement {
  const { selectedModelId, selectedModel, setSelectedModelId } = useAiDomainModel();
  const models = getDomainModels(domain);
  const activeModel = selectedModel(domain);
  const descriptionId = `${domain}-model-description`;
  const isLocal = activeModel.executionPath === 'local';
  const isZenModel = activeModel.id === 'qwen2.5-coder' || activeModel.id === 'local-video-runner' || activeModel.id === 'local-qwen-tts';

  const defaultSpecOptions = isLocal
    ? (activeModel.availablePrecisions ?? ['4-bit (Q4_K_M)', '8-bit (Q8_0)', '16-bit (FP16)'])
    : (activeModel.availableContexts ?? ['32k', '64k', '128k', '256k']);
  const defaultSpec = isLocal ? (activeModel.precisionBit ?? '4-bit (Q4_K_M)') : (activeModel.contextWindow ?? '128k');

  const [selectedSpec, setSelectedSpec] = useState<string>(defaultSpec);
  const activeSpec = defaultSpecOptions.includes(selectedSpec) ? selectedSpec : defaultSpec;

  const providerGroups = models.reduce<Record<string, AiDomainModelConfig[]>>((acc, model) => {
    const key = model.providerLabel;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(model);
    return acc;
  }, {});

  return (
    <div className="ai-domain-model-selector">
      <div className="ai-domain-model-selector__header">
        <label className="field-label" htmlFor={`${domain}-model`}>
          {label}
        </label>
        <div className="ai-domain-model-selector__badges">
          {isZenModel && <span className="ai-domain-model-selector__zen-badge">★ Zen</span>}
          <span className={`ai-domain-model-selector__badge ai-domain-model-selector__badge--${activeModel.executionPath}`}>
            <span className="ai-domain-model-selector__badge-dot" />
            {isLocal ? 'Local' : 'Cloud'}
          </span>
        </div>
      </div>
      {description && <p id={descriptionId} className="ai-domain-model-selector__description">{description}</p>}
      
      <div className="ai-domain-model-selector__controls">
        <div className="ai-domain-model-selector__control">
          <select
            id={`${domain}-model`}
            className="ai-domain-model-selector__select"
            value={selectedModelId(domain)}
            onChange={(event) => setSelectedModelId(domain, event.target.value)}
            aria-describedby={description ? descriptionId : undefined}
            title="Select Model"
          >
            {Object.entries(providerGroups).map(([providerLabel, providerModels]) => (
              <optgroup key={providerLabel} label={providerLabel}>
                {providerModels.map((model) => (
                  <option key={model.id} value={model.id} disabled={!model.available}>
                    {formatAiModelOptionLabel(model)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="ai-domain-model-selector__spec-control">
          <select
            id={`${domain}-context-spec`}
            className="ai-domain-model-selector__spec-select"
            value={activeSpec}
            onChange={(event) => setSelectedSpec(event.target.value)}
            title={isLocal ? 'Select Quantization / Bit Precision' : 'Select Context Window'}
          >
            {defaultSpecOptions.map((spec) => (
              <option key={spec} value={spec}>
                {isLocal ? `Bit: ${spec}` : `Ctx: ${spec}`}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="ai-domain-model-selector__status" role="status">
        <span className="ai-domain-model-selector__status-tag">{activeModel.providerLabel}</span>
        <span className="ai-domain-model-selector__status-spec">{activeSpec}</span>
        <div className="ai-domain-model-selector__status-info">
          <strong>{activeModel.label}</strong>: {activeModel.description}
        </div>
      </div>

      {models.filter((model) => !model.available).map((model) => (
        <p key={model.id} className="ai-domain-model-selector__unavailable">
          {model.label}: {model.unavailableReason}
        </p>
      ))}
    </div>
  );
}
