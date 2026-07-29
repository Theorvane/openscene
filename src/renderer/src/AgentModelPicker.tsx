import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

import type { ReasoningEffort } from '../../shared/openAiAuth';
import { agentModelGroupStatus, buildAgentModelGroups } from './agentModelPickerModel';
import { useAiDomainModel } from './AiDomainModelContext';
import { useChatGptAuth } from './ChatGptAuthContext';
import { useLlmModel } from './LlmProviderContext';
import { useModelVisibility } from './ModelVisibilityContext';

type AgentModelPickerProps = {
  /** Stored effort for the active model, or undefined for the provider default. */
  readonly reasoningEffort: ReasoningEffort | undefined;
  readonly onReasoningEffortChange: (effort: ReasoningEffort | undefined) => void;
};

const POPOVER_WIDTH_PX = 300;

/**
 * Model selector for the Edit Agent prompt bar: models grouped
 * by provider, connection state per provider, and cloud models listed only once
 * their provider is connected in Settings. The popover renders through a portal
 * because the chat panel and the prompt card both clip overflow.
 */
export function AgentModelPicker({ reasoningEffort, onReasoningEffortChange }: AgentModelPickerProps): ReactElement {
  const { selectedModel, setSelectedModelId } = useAiDomainModel();
  const { credentialStatus } = useLlmModel();
  const { isModelVisible } = useModelVisibility();
  const chatGptAuth = useChatGptAuth();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [anchorStyle, setAnchorStyle] = useState<CSSProperties>({});

  const activeModel = selectedModel('edit-agent');
  // The variant control is offered only for models that list effort levels.
  const efforts = activeModel.efforts ?? [];
  const groups = buildAgentModelGroups({
    activeModelId: activeModel.id,
    credentialStatus,
    chatGptConnected: chatGptAuth.isConnected,
    isModelVisible
  });

  // Anchor the portal popover above the trigger, clamped into the viewport.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setAnchorStyle({
      position: 'fixed',
      bottom: `${Math.max(8, window.innerHeight - rect.top + 8)}px`,
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

  const popover = (
    <div
      id="agent-model-picker-popover"
      ref={popoverRef}
      className="agent-model-picker__popover"
      role="listbox"
      aria-label="Edit Agent models by provider"
      style={anchorStyle}
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
  );

  return (
    <div className="agent-model-picker">
      <button
        type="button"
        ref={triggerRef}
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
      {efforts.length > 0 && (
        <select
          className="agent-model-picker__effort"
          aria-label="Thinking effort"
          title="Thinking effort"
          value={reasoningEffort ?? 'default'}
          onChange={(event) => onReasoningEffortChange(event.target.value === 'default' ? undefined : event.target.value)}
        >
          <option value="default">default</option>
          {efforts.map((effort) => (
            <option key={effort} value={effort}>{effort}</option>
          ))}
        </select>
      )}
      {isOpen && createPortal(popover, document.body)}
    </div>
  );
}
