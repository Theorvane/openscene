import { getMcpServerDefinition, McpResource, McpServer, McpTool } from '@theorvane/type-mcp';
import { z } from 'zod';
import {
  createSpeechGenerationJob,
  createVideoGenerationJob,
  getSpeechGenerationJob,
  getVideoGenerationJob
} from './aiJobManager';

@McpServer({ name: 'openvideo-mcp-server', version: '0.1.0' })
export class OpenVideoMcpServer {
  @McpTool({
    description: 'Create an AI video generation job using local diffusion models or cloud APIs (Gemini Veo, OpenAI Sora).',
    input: z.object({
      prompt: z.string().min(1, 'Prompt is required'),
      aspectRatio: z.enum(['16:9', '9:16', '1:1']).default('16:9'),
      durationSeconds: z.number().min(1).max(10).default(5),
      stylePreset: z.string().optional().default('Cinematic'),
      mode: z.enum(['local', 'api']).default('local'),
      provider: z.enum(['local_video', 'gemini_veo', 'openai_sora']).optional(),
      apiKey: z.string().optional()
    })
  })
  async createVideoJob(params: {
    prompt: string;
    aspectRatio?: '16:9' | '9:16' | '1:1';
    durationSeconds?: number;
    stylePreset?: string;
    mode?: 'local' | 'api';
    provider?: 'local_video' | 'gemini_veo' | 'openai_sora';
    apiKey?: string;
  }) {
    const job = await createVideoGenerationJob({
      prompt: params.prompt,
      aspectRatio: params.aspectRatio ?? '16:9',
      durationSeconds: params.durationSeconds ?? 5,
      stylePreset: params.stylePreset ?? 'Cinematic',
      mode: params.mode ?? 'local',
      ...(params.provider !== undefined ? { provider: params.provider } : {}),
      ...(params.apiKey !== undefined ? { apiKey: params.apiKey } : {})
    });

    return {
      success: true,
      jobId: job.id,
      status: job.status,
      mode: job.mode,
      provider: job.provider,
      message: `AI video job created: ${job.id}`
    };
  }

  @McpTool({
    description: 'Create an AI voiceover/speech synthesis job using local Qwen TTS or ElevenLabs cloud API.',
    input: z.object({
      script: z.string().min(1, 'Script is required'),
      voiceId: z.string().default('qwen-neutral'),
      mode: z.enum(['local', 'api']).default('local'),
      apiKey: z.string().optional()
    })
  })
  async createSpeechJob(params: {
    script: string;
    voiceId?: string;
    mode?: 'local' | 'api';
    apiKey?: string;
  }) {
    const job = await createSpeechGenerationJob({
      script: params.script,
      voiceId: params.voiceId ?? 'qwen-neutral',
      mode: params.mode ?? 'local',
      ...(params.apiKey !== undefined ? { apiKey: params.apiKey } : {})
    });

    return {
      success: true,
      jobId: job.id,
      status: job.status,
      mode: job.mode,
      provider: job.provider,
      message: `AI speech job created: ${job.id}`
    };
  }

  @McpTool({
    description: 'Check status of an AI video or speech generation job.',
    input: z.object({
      jobId: z.string().min(1),
      kind: z.enum(['video', 'speech'])
    })
  })
  async getJobStatus(params: { jobId: string; kind: 'video' | 'speech' }) {
    const job = params.kind === 'video' ? getVideoGenerationJob(params.jobId) : getSpeechGenerationJob(params.jobId);
    if (!job) {
      return { success: false, error: `Job ${params.jobId} not found.` };
    }
    return {
      success: true,
      jobId: job.id,
      status: job.status,
      outputFilePath: job.outputFilePath,
      error: job.error
    };
  }

  @McpResource({
    uri: 'openvideo://mcp-capabilities',
    mimeType: 'application/json',
    description: 'OpenVideo MCP Server Capability Descriptor'
  })
  readCapabilities() {
    return {
      server: 'openvideo-mcp-server',
      version: '0.1.0',
      tools: ['createVideoJob', 'createSpeechJob', 'getJobStatus']
    };
  }
}

export function getOpenVideoMcpDefinition() {
  return getMcpServerDefinition(OpenVideoMcpServer);
}
