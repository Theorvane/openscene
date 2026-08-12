import { Directory, File, Paths } from 'expo-file-system';

import { forStorage, parseHistory, type ChatMessage } from './chatMemory';

/**
 * The assistant's conversation, kept with the project it is about.
 *
 * It was component state, and the AI tab is mounted only while it is the
 * selected tab — so glancing at the timeline to check what the assistant had
 * just described threw the conversation away. That is not a session ending; it
 * is the user looking at the thing they were talking about.
 *
 * Per project, beside the project's own snapshot, because that is the scope the
 * conversation already has: the tools read this project's timeline, and a
 * transcript about one cut is noise in another.
 *
 *   projects/<id>/chat.json
 *
 * Deliberately not encrypted and deliberately not synced. It holds what the user
 * typed and what the model replied, and it lives exactly as long as the project
 * does — deleting the project takes its directory, and this with it.
 */

const ROOT = new Directory(Paths.document, 'projects');

function chatFile(projectId: string): File {
  return new File(new Directory(ROOT, projectId), 'chat.json');
}

export function readChat(projectId: string | null): readonly ChatMessage[] {
  if (projectId === null) return [];
  try {
    const file = chatFile(projectId);
    if (!file.exists) return [];
    return parseHistory(JSON.parse(file.textSync()));
  } catch {
    // A transcript that will not parse is not worth failing the screen over.
    // The conversation starts again; nothing else in the project depends on it.
    return [];
  }
}

export function writeChat(projectId: string | null, messages: readonly ChatMessage[]): void {
  if (projectId === null) return;
  try {
    const directory = new Directory(ROOT, projectId);
    if (!directory.exists) return;
    chatFile(projectId).write(JSON.stringify(forStorage(messages)));
  } catch {
    // Losing the transcript is survivable; taking the screen down with it is not.
  }
}

export function clearChat(projectId: string | null): void {
  if (projectId === null) return;
  try {
    const file = chatFile(projectId);
    if (file.exists) file.delete();
  } catch {
    // Same reasoning as above.
  }
}
