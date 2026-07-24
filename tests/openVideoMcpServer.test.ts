import { describe, expect, it } from 'vitest';
import { getOpenVideoMcpDefinition, OpenVideoMcpServer } from '../src/main/openVideoMcpServer';

describe('OpenVideo TypeMCP Server and Tool declarations', () => {
  it('extracts server metadata and declared MCP tools using getMcpServerDefinition', () => {
    const definition = getOpenVideoMcpDefinition();
    expect(definition).toBeDefined();
    expect(definition?.name).toBe('openvideo-mcp-server');
    expect(definition?.version).toBe('0.1.0');

    const toolNames = definition?.tools.map((t) => t.name);
    expect(toolNames).toContain('createVideoJob');
    expect(toolNames).toContain('createSpeechJob');
    expect(toolNames).toContain('getJobStatus');
  });

  it('executes createVideoJob MCP tool and returns job metadata', async () => {
    const server = new OpenVideoMcpServer();
    const result = await server.createVideoJob({
      prompt: 'Cinematic intro shot of Seoul skyline',
      aspectRatio: '16:9',
      durationSeconds: 5,
      mode: 'local'
    });

    expect(result.success).toBe(true);
    expect(result.jobId.length).toBeGreaterThan(0);
    expect(result.mode).toBe('local');
    expect(result.provider).toBe('local_video');
  });

  it('executes createSpeechJob MCP tool and returns speech job metadata', async () => {
    const server = new OpenVideoMcpServer();
    const result = await server.createSpeechJob({
      script: 'Welcome to OpenVideo desktop suite',
      voiceId: 'qwen-narrator',
      mode: 'local'
    });

    expect(result.success).toBe(true);
    expect(result.jobId.length).toBeGreaterThan(0);
    expect(result.mode).toBe('local');
  });
});
