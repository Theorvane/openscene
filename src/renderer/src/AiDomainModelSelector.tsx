import type { ReactElement } from 'react';

import { getDomainModels, type AiDomain } from '../../shared/aiDomainModels';
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

  return (
    <div className="ai-domain-model-selector">
      <div className="ai-domain-model-selector__header">
        <label className="field-label" htmlFor={`${domain}-model`}>
          {label}
        </label>
        <span className={`ai-domain-model-selector__badge ai-domain-model-selector__badge--${activeModel.executionPath}`}>
          <span className="ai-domain-model-selector__badge-dot" />
          {isLocal ? 'Local Engine' : 'API Adapter'}
        </span>
      </div>
      {description && <p id={descriptionId} className="ai-domain-model-selector__description">{description}</p>}
      
      <div className="ai-domain-model-selector__control">
        <select
          id={`${domain}-model`}
          className="ai-domain-model-selector__select"
          value={selectedModelId(domain)}
          onChange={(event) => setSelectedModelId(domain, event.target.value)}
          aria-describedby={description ? descriptionId : undefined}
        >
          {models.map((model) => (
            <option key={model.id} value={model.id} disabled={!model.available}>
              {model.label} — {model.providerLabel}{model.available ? '' : ' (Unavailable)'}
            </option>
          ))}
        </select>
      </div>

      <div className="ai-domain-model-selector__status" role="status">
        <span className="ai-domain-model-selector__status-tag">{activeModel.providerLabel}</span>
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
