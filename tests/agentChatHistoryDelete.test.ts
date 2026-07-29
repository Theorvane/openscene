import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentChatHistoryStore } from '../src/main/agentChatHistoryStore';
import { ProjectStore } from '../src/main/projectStore';

describe('agent chat history deletion', () => {
  let tempDir: string;
  let projects: ProjectStore;
  let history: AgentChatHistoryStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openvideo-chat-delete-'));
    projects = new ProjectStore(tempDir);
    history = new AgentChatHistoryStore(projects);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('removes one conversation and leaves the rest of the project history intact', async () => {
    const project = await projects.create({ name: 'Delete Test' });
    await history.record({
      projectId: project.id,
      conversationId: 'c1',
      messages: [{ id: 'm0', role: 'user', text: 'first conversation' }]
    });
    await history.record({
      projectId: project.id,
      conversationId: 'c2',
      messages: [{ id: 'm0', role: 'user', text: 'second conversation' }]
    });

    expect(await history.delete(project.id, 'c1')).toBe(true);

    const remaining = await history.list(project.id);
    expect(remaining.map((conversation) => conversation.id)).toEqual(['c2']);
    expect(await history.get(project.id, 'c1')).toBeNull();
  });

  it('reports false when the conversation is already gone instead of throwing', async () => {
    const project = await projects.create({ name: 'Delete Test' });

    expect(await history.delete(project.id, 'never-existed')).toBe(false);
  });
});
