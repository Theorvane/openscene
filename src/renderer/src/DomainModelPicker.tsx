import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

import type { AiDomain } from '../../shared/aiDomainModels';
import { agentModelGroupStatus, buildAgentModelGroups } from './agentModelPickerModel';
import { useAiDomainModel } from './AiDomainModelContext';
import { useLlmModel } from './LlmProviderContext';
import { useModelVisibility } from './ModelVisibilityContext';

type DomainModelPickerProps = {
  readonly domain: AiDomain;
  readonly ariaLabel: string;
};

const POPOVER_WIDTH_PX = 300;

/**
 * Model selector for the generation studios, built on the same rule and the
 * same popover as the Edit Agent picker: models grouped by provider, listed
 * only once their provider is connected, and the active selection always kept.
 * The popover renders through a body portal because the studio surface and the
 * workspace both clip overflow.
 */
export function DomainModelPicker({ domain, ariaLabel }: DomainModelPickerProps): ReactElement {
  const { selectedModel, setSelectedModelId } = useAiDomainModel();
  const { credentialStatus } = useLlmModel();
  const { isModelVisible } = useModelVisibility();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [anchorStyle, setAnchorStyle] = useState<CSSProperties>({});

  const activeModel = selectedModel(domain);
  const groups = buildAgentModelGroups({
    domain,
    activeModelId: activeModel.id,
    credentialStatus,
    // The ChatGPT sign-in only serves Edit Agent chat models.
    chatGptConnected: false,
    isModelVisible
  });

  useLayoutEffect(() => {
    if (!isOpen) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setAnchorStyle({
      position: 'fixed',
      top: `${rect.bottom + 6}px`,
      left: `${Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - POPOVER_WIDTH_PX - 8))}px`
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) === true || popoverRef.current?.contains(target) === true) return;
      setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  const popoverId = `${domain}-model-picker-popover`;
  const popover = (
    <div
      id={popoverId}
      ref={popoverRef}
      className="agent-model-picker__popover"
      role="listbox"
      aria-label={ariaLabel}
      style={anchorStyle}
    >
      {groups.map((group) => {
        const status = agentModelGroupStatus(group, { credentialStatus, chatGptConnected: false });
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
                  title={selectable ? model.description : model.unavailableReason ?? `Connect ${model.providerLabel} in Settings → Providers first.`}
                  onClick={() => {
                    setSelectedModelId(domain, model.id);
                    setIsOpen(false);
                  }}
                >
                  <span className="agent-model-picker__option-label">{model.label}</span>
                </button>
              );
            })}
          </div>
        );
      })}
      {groups.length === 0 && (
        <p className="agent-model-picker__hint">
          Connect a provider in Settings → Providers to add its models here.
        </p>
      )}
    </div>
  );

  return (
    <div className="agent-model-picker">
      <button
        type="button"
        ref={triggerRef}
        className="agent-model-picker__trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={popoverId}
        title={ariaLabel}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="agent-model-picker__trigger-label">{activeModel.label}</span>
        <span className="agent-model-picker__trigger-provider">{activeModel.providerLabel}</span>
        <span aria-hidden="true" className="agent-model-picker__trigger-caret">▾</span>
      </button>
      {isOpen && createPortal(popover, document.body)}
    </div>
  );
}
