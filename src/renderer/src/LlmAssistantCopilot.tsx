import { useState, type ReactElement } from 'react';
import type { ImportProjectAssetsResult } from '../../shared/timelineTypes';
import { INTENT_SYSTEM_PROMPT, matchKeywordIntent, parseModelIntent, type CopilotTool } from './copilotIntent';
import { useLlmModel } from './LlmProviderContext';
import { useProjectResultImport } from './ProjectResultImportContext';

type CopilotStep = {
  id: string;
  action: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  detail?: string | undefined;
};

export function LlmAssistantCopilot(): ReactElement {
  const { selectedModel } = useLlmModel();
  let activeProject = null;

  try {
    const importContext = useProjectResultImport();
    activeProject = importContext.activeProject;
  } catch {
    // Rendered outside ProjectResultImportProvider fallback
  }

  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [steps, setSteps] = useState<readonly CopilotStep[]>([]);
  const [statusMessage, setStatusMessage] = useState<string>(
    'Describe what you want (e.g. "generate a video intro", "add a voiceover", "export the project").'
  );

  const pollJobCompletion = async (jobId: string, kind: 'video' | 'speech'): Promise<{ success: boolean; outputFilePath?: string | undefined; error?: string | undefined }> => {
    const maxRetries = 20;
    for (let i = 0; i < maxRetries; i++) {
      await new Promise((res) => setTimeout(res, 500));
      const resp = await window.videoTool.mcpExecuteTool('getJobStatus', { jobId, kind });
      if (resp.ok) {
        const val = resp.value as { success?: boolean; status?: string; outputFilePath?: string; error?: string };
        if (val.status === 'completed') {
          return val.outputFilePath ? { success: true, outputFilePath: val.outputFilePath } : { success: true };
        }
        if (val.status === 'failed') {
          return { success: false, error: val.error ?? 'Generation failed' };
        }
      }
    }
    return { success: false, error: 'AI generation job timed out.' };
  };

  const runCopilotCommand = async (inputPrompt: string): Promise<void> => {
    if (inputPrompt.trim().length === 0) return;

    setIsProcessing(true);
    const text = inputPrompt.toLowerCase();
    const newSteps: CopilotStep[] = [];

    setStatusMessage(`Consulting ${selectedModel.label}...`);

    const intentStepId = `step-intent-${Date.now()}`;
    newSteps.push({
      id: intentStepId,
      action: `Interpreting command via ${selectedModel.label}`,
      status: 'running'
    });
    setSteps([...newSteps]);

    let tool: CopilotTool | null = null;
    const llmResponse = await window.videoTool.executeLlmPrompt({
      modelId: selectedModel.id,
      prompt: inputPrompt,
      systemPrompt: INTENT_SYSTEM_PROMPT
    });

    if (llmResponse.ok && llmResponse.value.ok && llmResponse.value.completion) {
      const parsed = parseModelIntent(llmResponse.value.completion);
      if (parsed) {
        tool = parsed.tool;
        newSteps[0] = {
          id: intentStepId,
          action: `${selectedModel.label} interpreted command`,
          status: 'completed',
          detail: parsed.reason ?? llmResponse.value.completion
        };
      } else {
        tool = matchKeywordIntent(text);
        newSteps[0] = {
          id: intentStepId,
          action: `${selectedModel.label} response was not valid JSON, used keyword fallback`,
          status: 'failed',
          detail: llmResponse.value.completion
        };
      }
    } else {
      tool = matchKeywordIntent(text);
      const errorDetail = llmResponse.ok ? llmResponse.value.error : llmResponse.error.message;
      newSteps[0] = {
        id: intentStepId,
        action: `${selectedModel.label} unavailable, used keyword fallback`,
        status: 'failed',
        detail: errorDetail
      };
    }
    setSteps([...newSteps]);

    try {
      if (tool === 'createVideoJob') {
        if (!activeProject) {
          setStatusMessage('Please open or create a local project before generating and inserting video.');
          setIsProcessing(false);
          return;
        }

        const stepId = `step-video-${Date.now()}`;
        newSteps.push({
          id: stepId,
          action: '1. Executing MCP Tool: createVideoJob',
          status: 'running',
          detail: `Prompt: "${inputPrompt}" via ${selectedModel.providerLabel}`
        });
        setSteps([...newSteps]);

        const response = await window.videoTool.mcpExecuteTool('createVideoJob', {
          prompt: inputPrompt,
          aspectRatio: '16:9',
          durationSeconds: 5,
          mode: 'local'
        });

        if (response.ok) {
          const val = response.value as { success?: boolean; jobId?: string; error?: string };
          if (val.success && val.jobId) {
            const jobId = val.jobId;
            newSteps[1] = {
              id: stepId,
              action: '1. MCP createVideoJob Started',
              status: 'completed',
              detail: `Job ID: ${jobId}`
            };
            setSteps([...newSteps]);

            // Step 2: Poll completion
            const pollStepId = `step-poll-${Date.now()}`;
            newSteps.push({
              id: pollStepId,
              action: '2. Synthesizing AI Video Frames',
              status: 'running',
              detail: 'Waiting for model output...'
            });
            setSteps([...newSteps]);

            const pollResult = await pollJobCompletion(jobId, 'video');
            if (pollResult.success) {
              newSteps[2] = {
                id: pollStepId,
                action: '2. AI Video Generation Completed',
                status: 'completed',
                detail: 'Frames rendered successfully'
              };
              setSteps([...newSteps]);

              // Step 3: Import into project
              const importStepId = `step-import-${Date.now()}`;
              newSteps.push({
                id: importStepId,
                action: '3. Importing Media to Active Project',
                status: 'running',
                detail: `Project: ${activeProject.name}`
              });
              setSteps([...newSteps]);

              const importResp = await window.videoTool.importAiResultAsset({ projectId: activeProject.id, jobId });
              if (!importResp.ok || !importResp.value.assets || importResp.value.assets.length === 0) {
                const importErr = !importResp.ok ? importResp.error.message : 'No imported assets returned';
                newSteps[3] = {
                  id: importStepId,
                  action: '3. Media Import Failed',
                  status: 'failed',
                  detail: importErr
                };
                setSteps([...newSteps]);
                setStatusMessage(`Media import failed: ${importErr}`);
                setIsProcessing(false);
                return;
              }

              const importedAsset = importResp.value.assets[0]!;
              newSteps[3] = {
                id: importStepId,
                action: '3. Media Imported into Project',
                status: 'completed',
                detail: `Asset ID: ${importedAsset.id}`
              };
              setSteps([...newSteps]);

              // Step 4: Add clip to timeline
              const clipStepId = `step-clip-${Date.now()}`;
              newSteps.push({
                id: clipStepId,
                action: '4. Executing MCP Tool: addClipToTimeline',
                status: 'running',
                detail: `Inserting onto Track 1 in ${activeProject.name}`
              });
              setSteps([...newSteps]);

              const clipResp = await window.videoTool.mcpExecuteTool('addClipToTimeline', {
                projectId: activeProject.id,
                trackId: 'video-1',
                assetId: importedAsset.id,
                startOffsetSeconds: 0,
                durationSeconds: 5
              });

              if (clipResp.ok) {
                const clipVal = clipResp.value as { success?: boolean; clipId?: string; error?: string };
                if (clipVal.success) {
                  newSteps[4] = {
                    id: clipStepId,
                    action: '4. MCP addClipToTimeline Completed',
                    status: 'completed',
                    detail: `Added clip ${clipVal.clipId ?? ''} to timeline`
                  };
                  setSteps([...newSteps]);
                  setStatusMessage(`Successfully generated, imported, and added video to ${activeProject.name}!`);
                } else {
                  newSteps[4] = {
                    id: clipStepId,
                    action: '4. MCP addClipToTimeline Failed',
                    status: 'failed',
                    detail: clipVal.error ?? 'Failed to add clip'
                  };
                  setSteps([...newSteps]);
                  setStatusMessage(`Clip addition failed: ${clipVal.error ?? 'Unknown error'}`);
                }
              }
            } else {
              newSteps[2] = {
                id: pollStepId,
                action: '2. AI Video Generation Failed',
                status: 'failed',
                detail: pollResult.error ?? 'Generation failed'
              };
              setSteps([...newSteps]);
              setStatusMessage(`Video generation failed: ${pollResult.error ?? 'Unknown error'}`);
            }
          } else {
            newSteps[1] = {
              id: stepId,
              action: '1. MCP createVideoJob Failed',
              status: 'failed',
              detail: val.error ?? 'Failed to create video job'
            };
            setSteps([...newSteps]);
            setStatusMessage(`Generation failed: ${val.error ?? 'Unknown error'}`);
          }
        } else {
          newSteps[1] = {
            id: stepId,
            action: '1. MCP createVideoJob Failed',
            status: 'failed',
            detail: response.error.message
          };
          setSteps([...newSteps]);
          setStatusMessage(`Execution failed: ${response.error.message}`);
        }
      } else if (tool === 'createSpeechJob') {
        if (!activeProject) {
          setStatusMessage('Please open or create a local project before generating speech.');
          setIsProcessing(false);
          return;
        }

        const stepId = `step-voice-${Date.now()}`;
        newSteps.push({
          id: stepId,
          action: '1. Executing MCP Tool: createSpeechJob',
          status: 'running',
          detail: `Script: "${inputPrompt}"`
        });
        setSteps([...newSteps]);

        const response = await window.videoTool.mcpExecuteTool('createSpeechJob', {
          script: inputPrompt,
          voiceId: 'qwen-narrator',
          mode: selectedModel.defaultMode
        });

        if (response.ok) {
          const val = response.value as { success?: boolean; jobId?: string; error?: string };
          if (val.success && val.jobId) {
            newSteps[1] = {
              id: stepId,
              action: '1. MCP createSpeechJob Completed',
              status: 'completed',
              detail: `Job ID: ${val.jobId}`
            };
            setSteps([...newSteps]);
            setStatusMessage(`Speech synthesis initiated for ${activeProject.name}!`);
          } else {
            newSteps[1] = {
              id: stepId,
              action: '1. MCP createSpeechJob Failed',
              status: 'failed',
              detail: val.error ?? 'Failed to create speech job'
            };
            setSteps([...newSteps]);
            setStatusMessage(`Speech failed: ${val.error ?? 'Unknown error'}`);
          }
        } else {
          newSteps[1] = {
            id: stepId,
            action: '1. MCP createSpeechJob Failed',
            status: 'failed',
            detail: response.error.message
          };
          setSteps([...newSteps]);
          setStatusMessage(`Speech synthesis failed: ${response.error.message}`);
        }
      } else if (tool === 'exportProjectVideo') {
        if (!activeProject) {
          setStatusMessage('Please open or create a local project before exporting.');
          setIsProcessing(false);
          return;
        }

        const stepId = `step-export-${Date.now()}`;
        newSteps.push({
          id: stepId,
          action: 'Executing MCP Tool: exportProjectVideo',
          status: 'running',
          detail: `Target Project: ${activeProject.name}`
        });
        setSteps([...newSteps]);

        const response = await window.videoTool.mcpExecuteTool('exportProjectVideo', {
          projectId: activeProject.id,
          preset: 'high'
        });

        if (response.ok) {
          const val = response.value as { success?: boolean; exportJobId?: string; error?: string };
          if (val.success) {
            newSteps[1] = {
              id: stepId,
              action: 'MCP Tool exportProjectVideo Completed',
              status: 'completed',
              detail: `Export Job ID: ${val.exportJobId ?? 'started'}`
            };
            setSteps([...newSteps]);
            setStatusMessage(`FFmpeg MP4 export started for ${activeProject.name}!`);
          } else {
            newSteps[1] = {
              id: stepId,
              action: 'MCP Tool exportProjectVideo Failed',
              status: 'failed',
              detail: val.error ?? 'Export failed'
            };
            setSteps([...newSteps]);
            setStatusMessage(`Export failed: ${val.error ?? 'Unknown error'}`);
          }
        } else {
          newSteps[1] = {
            id: stepId,
            action: 'MCP Tool exportProjectVideo Failed',
            status: 'failed',
            detail: response.error.message
          };
          setSteps([...newSteps]);
          setStatusMessage(`Export failed: ${response.error.message}`);
        }
      } else {
        const stepId = `step-unsupported-${Date.now()}`;
        newSteps.push({
          id: stepId,
          action: 'Instruction Not Supported',
          status: 'failed',
          detail:
            `"${inputPrompt}" did not match any supported copilot operation. ` +
            'Supported commands: video/scene generation, voice/speech synthesis, export/render.'
        });
        setSteps([...newSteps]);
        setStatusMessage(
          `${selectedModel.label} found no matching operation. Try mentioning video, voice/speech, or export/render.`
        );
      }
    } catch (err) {
      setStatusMessage(`Copilot error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
      setPrompt('');
    }
  };

  return (
    <div className="llm-copilot-container" style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className="llm-copilot-trigger"
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          background: isOpen ? 'var(--primary)' : 'var(--surface-control)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xs)',
          color: isOpen ? 'var(--primary-foreground)' : 'var(--foreground)',
          cursor: 'pointer',
          fontSize: 'var(--text-micro)',
          fontWeight: 600,
          fontFamily: 'var(--font-mono)',
          transition: 'all 120ms ease'
        }}
      >
        <span>🤖 AI Copilot</span>
        <span
          style={{
            fontSize: 'var(--text-micro)',
            padding: '1px 4px',
            borderRadius: '2px',
            background: 'rgba(255,255,255,0.2)',
            color: 'inherit'
          }}
        >
          MCP
        </span>
      </button>

      {isOpen && (
        <div
          className="llm-copilot-drawer"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 1100,
            width: '340px',
            padding: '12px',
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-panel)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: 'var(--text-body)' }}>⚡</span>
              <span style={{ fontSize: 'var(--text-small)', fontWeight: 700 }}>Timeline Command Panel</span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              style={{ background: 'none', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: 'var(--text-small)' }}
            >
              ✕
            </button>
          </div>

          <div style={{ fontSize: 'var(--text-micro)', color: 'var(--muted-foreground)' }}>
            Routed by <strong style={{ color: 'var(--foreground)' }}>{selectedModel.label}</strong> (falls back to
            keyword matching if the model is unavailable). Supports{' '}
            <strong style={{ color: 'var(--foreground)' }}>video</strong>,{' '}
            <strong style={{ color: 'var(--foreground)' }}>voice/speech</strong>, or{' '}
            <strong style={{ color: 'var(--foreground)' }}>export/render</strong>.
            {activeProject && <div style={{ color: 'var(--primary)', marginTop: '2px' }}>Active Project: {activeProject.name}</div>}
          </div>

          {/* Quick Actions */}
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => runCopilotCommand('Create a 5s cinematic video intro of Seoul skyline')}
              style={{
                fontSize: 'var(--text-caption)',
                padding: '3px 7px',
                borderRadius: 'var(--radius-xs)',
                border: '1px solid var(--border)',
                background: 'var(--surface-inset)',
                color: 'var(--foreground)',
                cursor: 'pointer'
              }}
            >
              🎬 Generate Intro Video
            </button>
            <button
              type="button"
              onClick={() => runCopilotCommand('Synthesize voiceover saying "Welcome to OpenVideo editor"')}
              style={{
                fontSize: 'var(--text-caption)',
                padding: '3px 7px',
                borderRadius: 'var(--radius-xs)',
                border: '1px solid var(--border)',
                background: 'var(--surface-inset)',
                color: 'var(--foreground)',
                cursor: 'pointer'
              }}
            >
              🎙️ Generate Voiceover
            </button>
            <button
              type="button"
              onClick={() => runCopilotCommand('Export project as 1080p MP4 video')}
              style={{
                fontSize: 'var(--text-caption)',
                padding: '3px 7px',
                borderRadius: 'var(--radius-xs)',
                border: '1px solid var(--border)',
                background: 'var(--surface-inset)',
                color: 'var(--foreground)',
                cursor: 'pointer'
              }}
            >
              📦 Export MP4 Video
            </button>
          </div>

          {/* Input Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runCopilotCommand(prompt);
            }}
            style={{ display: 'flex', gap: '6px' }}
          >
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the command (video / voice / export)..."
              disabled={isProcessing}
              style={{
                flex: 1,
                padding: '6px 8px',
                borderRadius: 'var(--radius-xs)',
                border: '1px solid var(--border)',
                background: 'var(--input)',
                color: 'var(--foreground)',
                fontSize: 'var(--text-micro)'
              }}
            />
            <button
              type="submit"
              disabled={isProcessing || prompt.trim().length === 0}
              style={{
                padding: '6px 10px',
                borderRadius: 'var(--radius-xs)',
                border: 'none',
                background: 'var(--primary)',
                color: 'var(--primary-foreground)',
                cursor: 'pointer',
                fontSize: 'var(--text-micro)',
                fontWeight: 600
              }}
            >
              {isProcessing ? '...' : 'Run'}
            </button>
          </form>

          {/* Status & Execution Steps */}
          <div style={{ fontSize: 'var(--text-micro)', color: 'var(--muted-foreground)' }}>{statusMessage}</div>

          {steps.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '140px', overflowY: 'auto' }}>
              {steps.map((step) => (
                <div
                  key={step.id}
                  style={{
                    padding: '4px 6px',
                    borderRadius: 'var(--radius-xs)',
                    background: 'var(--surface-inset)',
                    fontSize: 'var(--text-caption)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                    <span>{step.action}</span>
                    <span style={{ color: step.status === 'completed' ? 'var(--success)' : step.status === 'failed' ? 'var(--danger)' : 'var(--primary)' }}>
                      {step.status.toUpperCase()}
                    </span>
                  </div>
                  {step.detail && <span style={{ opacity: 0.7 }}>{step.detail}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
