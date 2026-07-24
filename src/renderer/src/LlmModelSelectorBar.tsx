import { useState, type ReactElement } from 'react';
import { DEFAULT_LLM_MODELS, type LlmModelConfig } from '../../shared/llmModels';
import { useLlmModel } from './LlmProviderContext';

export function LlmModelSelectorBar(): ReactElement {
  const { selectedModel, setSelectedModelId } = useLlmModel();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      className="llm-model-selector-bar"
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center'
      }}
    >
      <button
        type="button"
        className="llm-model-trigger"
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '4px 10px',
          background: 'var(--surface-control)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xs)',
          color: 'var(--foreground)',
          cursor: 'pointer',
          fontSize: 'var(--text-micro)',
          fontFamily: 'var(--font-mono)',
          transition: 'all 120ms ease'
        }}
      >
        <span style={{ color: 'var(--primary)', fontWeight: 700 }}>✨ AI Model:</span>
        <span style={{ fontWeight: 600 }}>{selectedModel.label}</span>
        <span
          style={{
            fontSize: '8px',
            fontWeight: 700,
            padding: '1px 5px',
            borderRadius: '3px',
            background: selectedModel.defaultMode === 'local' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(99, 102, 241, 0.2)',
            color: selectedModel.defaultMode === 'local' ? 'var(--success)' : 'var(--primary)'
          }}
        >
          {selectedModel.badge}
        </span>
        <span style={{ fontSize: '9px', opacity: 0.6 }}>▼</span>
      </button>

      {isOpen && (
        <div
          className="llm-model-dropdown"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 1000,
            width: '280px',
            padding: '8px',
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-panel)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
            <span style={{ fontSize: 'var(--text-micro)', fontWeight: 600, color: 'var(--muted-foreground)' }}>
              Select Active LLM Model
            </span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              style={{ background: 'none', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: '11px' }}
            >
              ✕
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '280px', overflowY: 'auto' }}>
            {/* Available local models */}
            <div style={{ fontSize: '8px', fontWeight: 700, color: 'var(--muted-foreground)', padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Available
            </div>
            {DEFAULT_LLM_MODELS.filter((m) => m.available).map((model: LlmModelConfig) => {
              const isSelected = model.id === selectedModel.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    setSelectedModelId(model.id);
                    setIsOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-xs)',
                    border: isSelected ? '1px solid var(--primary)' : '1px solid transparent',
                    background: isSelected ? 'var(--surface-control-selected)' : 'transparent',
                    color: 'var(--foreground)',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                    <span style={{ fontSize: 'var(--text-micro)', fontWeight: 600, flex: 1 }}>{model.label}</span>
                    <span style={{ fontSize: '8px', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)' }}>
                      {model.providerLabel}
                    </span>
                    <span
                      style={{
                        fontSize: '7px',
                        fontWeight: 700,
                        padding: '1px 4px',
                        borderRadius: '2px',
                        background: 'rgba(16, 185, 129, 0.15)',
                        color: 'var(--success)'
                      }}
                    >
                      {model.badge}
                    </span>
                  </div>
                  <span style={{ fontSize: '9px', color: 'var(--muted-foreground)', marginTop: '2px' }}>
                    {model.description}
                  </span>
                </button>
              );
            })}

            {/* Unavailable cloud models */}
            <div style={{ fontSize: '8px', fontWeight: 700, color: 'var(--muted-foreground)', padding: '6px 8px 2px', textTransform: 'uppercase', letterSpacing: '0.05em', borderTop: '1px solid var(--border)', marginTop: '2px' }}>
              Coming Soon — Provider adapters not yet implemented
            </div>
            {DEFAULT_LLM_MODELS.filter((m) => !m.available).map((model: LlmModelConfig) => (
              <button
                key={model.id}
                type="button"
                disabled
                title={model.unavailabilityReason}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-xs)',
                  border: '1px solid transparent',
                  background: 'transparent',
                  color: 'var(--muted-foreground)',
                  cursor: 'not-allowed',
                  textAlign: 'left',
                  opacity: 0.45
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                  <span style={{ fontSize: 'var(--text-micro)', fontWeight: 600, flex: 1 }}>{model.label}</span>
                  <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)' }}>{model.providerLabel}</span>
                  <span style={{ fontSize: '7px', fontWeight: 700, padding: '1px 4px', borderRadius: '2px', background: 'rgba(99,102,241,0.12)', color: 'var(--primary)' }}>
                    {model.badge}
                  </span>
                </div>
                <span style={{ fontSize: '9px', marginTop: '2px' }}>{model.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
