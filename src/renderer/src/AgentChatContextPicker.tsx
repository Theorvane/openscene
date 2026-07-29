import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

import type { EditAgentContextAsset } from '../../shared/editAgentContext';
import { useAgentChat } from './AgentChatContext';
import { useProjectResultImport } from './ProjectResultImportContext';

const POPOVER_WIDTH_PX = 300;

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined || durationMs <= 0) return '';
  const totalSeconds = Math.round(durationMs / 1000);
  return `${Math.floor(totalSeconds / 60)}:${`${totalSeconds % 60}`.padStart(2, '0')}`;
}

/**
 * Attaches project assets to the next message. The agent already receives the
 * open project as scope; this narrows a turn to specific clips so "this one"
 * is something the user can point at instead of describe.
 */
export function AgentChatContextPicker(): ReactElement {
  const { activeProject, contextAssets, attachContextAsset, detachContextAsset, isBusy } = useAgentChat();
  const { assets } = useProjectResultImport();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [anchorStyle, setAnchorStyle] = useState<CSSProperties>({});

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

  const attached = new Set(contextAssets.map((asset) => asset.assetId));
  const popover = (
    <div
      id="agent-chat-context-popover"
      ref={popoverRef}
      className="agent-chat-context-picker__popover"
      role="listbox"
      aria-label="Project assets to attach"
      style={anchorStyle}
    >
      {assets.map((asset) => {
        const isAttached = attached.has(asset.id);
        const contextAsset: EditAgentContextAsset = {
          projectId: activeProject?.projectId ?? '',
          assetId: asset.id,
          label: asset.displayName,
          mediaKind: asset.kind,
          ...(asset.metadata?.durationMs === undefined ? {} : { durationMs: asset.metadata.durationMs })
        };
        return (
          <button
            key={asset.id}
            type="button"
            role="option"
            aria-selected={isAttached}
            className={`agent-chat-context-picker__option${isAttached ? ' agent-chat-context-picker__option--attached' : ''}`}
            onClick={() => (isAttached ? detachContextAsset(asset.id) : attachContextAsset(contextAsset))}
          >
            <span className="agent-chat-context-picker__option-label">{asset.displayName}</span>
            <span className="agent-chat-context-picker__option-meta">
              {asset.kind}
              {formatDuration(asset.metadata?.durationMs) === '' ? '' : ` · ${formatDuration(asset.metadata?.durationMs)}`}
            </span>
          </button>
        );
      })}
      {assets.length === 0 && (
        <p className="agent-chat-context-picker__hint">
          {activeProject === null ? 'Open a project to attach its media.' : 'This project has no media yet.'}
        </p>
      )}
    </div>
  );

  return (
    <div className="agent-chat-context-picker">
      <button
        type="button"
        ref={triggerRef}
        className="agent-chat-context-picker__trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls="agent-chat-context-popover"
        title="Attach project media to this message"
        disabled={isBusy || activeProject === null}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span aria-hidden="true">@</span>
        <span className="agent-chat-context-picker__trigger-label">
          {contextAssets.length === 0 ? 'Context' : `Context · ${contextAssets.length}`}
        </span>
      </button>
      {isOpen && createPortal(popover, document.body)}
    </div>
  );
}
