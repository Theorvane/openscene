import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AgentChatHistoryStore } from '../src/main/agentChatHistoryStore';
import { ProjectStore } from '../src/main/projectStore';
import type { AgentChatDisplayMessage } from '../src/shared/agentChat';

async function withTempDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'video-agent-chat-history-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const TRANSCRIPT: readonly AgentChatDisplayMessage[] = [
  { id: 'msg-0', role: 'user', text: 'Trim the intro clip to five seconds.' },
  { id: 'msg-1', role: 'tool', text: 'Trimmed clip-1.', toolName: 'trim_clip' },
  { id: 'msg-2', role: 'assistant', text: 'Done — the intro now runs five seconds.' }
];

describe('agent chat history store', () => {
  it('given a recorded conversation, when listed and fetched, then the transcript round-trips from the project folder', async () => {
    await withTempDirectory(async (root) => {
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Chat project' });
      const history = new AgentChatHistoryStore(projects);

      await history.record(
        { projectId: project.id, conversationId: 'conv-1', messages: TRANSCRIPT },
        new Date('2026-07-29T10:00:00.000Z')
      );

      const conversations = await history.list(project.id);
      expect(conversations).toHaveLength(1);
      expect(conversations[0]).toMatchObject({
        id: 'conv-1',
        title: 'Trim the intro clip to five seconds.',
        createdAt: '2026-07-29T10:00:00.000Z',
        updatedAt: '2026-07-29T10:00:00.000Z'
      });
      expect(conversations[0]?.messages).toHaveLength(3);
      expect(conversations[0]?.messages[1]).toMatchObject({ role: 'tool', toolName: 'trim_clip' });
      await expect(history.get(project.id, 'conv-1')).resolves.toMatchObject({ id: 'conv-1' });
      await expect(readFile(join(root, project.id, 'chats.json'), 'utf8')).resolves.toContain('Trim the intro clip');
    });
  });

  it('given the same conversation recorded again, when listed, then it is upserted with a preserved createdAt and moved first', async () => {
    await withTempDirectory(async (root) => {
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Chat project' });
      const history = new AgentChatHistoryStore(projects);

      await history.record({ projectId: project.id, conversationId: 'conv-1', messages: TRANSCRIPT }, new Date('2026-07-29T10:00:00.000Z'));
      await history.record(
        { projectId: project.id, conversationId: 'conv-2', messages: [{ id: 'msg-0', role: 'user', text: 'Add a title card.' }] },
        new Date('2026-07-29T11:00:00.000Z')
      );
      await history.record(
        { projectId: project.id, conversationId: 'conv-1', messages: [...TRANSCRIPT, { id: 'msg-3', role: 'user', text: 'Now fade it out.' }] },
        new Date('2026-07-29T12:00:00.000Z')
      );

      const conversations = await history.list(project.id);
      expect(conversations.map((conversation) => conversation.id)).toEqual(['conv-1', 'conv-2']);
      expect(conversations[0]).toMatchObject({
        createdAt: '2026-07-29T10:00:00.000Z',
        updatedAt: '2026-07-29T12:00:00.000Z'
      });
      expect(conversations[0]?.messages).toHaveLength(4);
    });
  });

  it('given a hostile chats.json, when listed, then it degrades to an empty history and recording rewrites it', async () => {
    await withTempDirectory(async (root) => {
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Chat project' });
      const history = new AgentChatHistoryStore(projects);
      await writeFile(join(root, project.id, 'chats.json'), '{"schemaVersion":1,"conversations":[{"id":1}]}', 'utf8');

      await expect(history.list(project.id)).resolves.toEqual([]);

      await history.record({ projectId: project.id, conversationId: 'conv-1', messages: TRANSCRIPT }, new Date('2026-07-29T10:00:00.000Z'));
      await expect(history.list(project.id)).resolves.toHaveLength(1);
    });
  });

  it('given turns without any user message, when recorded, then nothing is written', async () => {
    await withTempDirectory(async (root) => {
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Chat project' });
      const history = new AgentChatHistoryStore(projects);

      await history.record({
        projectId: project.id,
        conversationId: 'conv-1',
        messages: [{ id: 'msg-0', role: 'assistant', text: 'Hello.' }]
      });

      await expect(history.list(project.id)).resolves.toEqual([]);
      await expect(readFile(join(root, project.id, 'chats.json'), 'utf8')).rejects.toThrow();
    });
  });

  it('given chats across projects, when the home list is built, then rows carry project names and sort newest first', async () => {
    await withTempDirectory(async (root) => {
      const projects = new ProjectStore(root);
      const first = await projects.create({ name: 'First reel' });
      const second = await projects.create({ name: 'Second reel' });
      const history = new AgentChatHistoryStore(projects);

      await history.record(
        { projectId: first.id, conversationId: 'conv-a', messages: [{ id: 'msg-0', role: 'user', text: 'Cut the outro.' }] },
        new Date('2026-07-29T09:00:00.000Z')
      );
      await history.record(
        { projectId: second.id, conversationId: 'conv-b', messages: [{ id: 'msg-0', role: 'user', text: 'Add narration.' }] },
        new Date('2026-07-29T10:30:00.000Z')
      );

      const entries = await history.listAllProjects();

      expect(entries.map((entry) => entry.conversationId)).toEqual(['conv-b', 'conv-a']);
      expect(entries[0]).toMatchObject({ projectName: 'Second reel', title: 'Add narration.', messageCount: 1 });
      expect(JSON.stringify(entries)).not.toContain(root);
    });
  });
});
