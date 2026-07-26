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

  return (
    <div className="ai-domain-model-selector">
      <label className="field-label" htmlFor={`${domain}-model`}>
        {label}
      </label>
      {description && <p id={descriptionId} className="ai-domain-model-selector__description">{description}</p>}
      <select
        id={`${domain}-model`}
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
      <div className="ai-domain-model-selector__status" role="status">
        <strong>{activeModel.label}</strong>: {activeModel.description}
      </div>
      {models.filter((model) => !model.available).map((model) => (
        <p key={model.id} className="ai-domain-model-selector__unavailable">
          {model.label}: {model.unavailableReason}
        </p>
      ))}
    </div>
  );
}
