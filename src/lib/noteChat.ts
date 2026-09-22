import { createContext } from 'react';
import type { Workspace } from './types';

export const NoteChatHost = createContext<{
  workspace: Workspace;
  noteId: string | null;
  save: () => Promise<boolean>;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
} | null>(null);
export interface ChatOwner {
  path: string;
  pluginId: string;
  pluginDigest: string;
}
export interface ChatSettings {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  revision: string;
}
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  mode: 'chat' | 'rewrite';
  sourceRevision: string;
  createdAt: string;
}
export interface NoteConversation {
  note: { id: string; title: string; revision: string };
  messages: ChatMessage[];
  revision: string;
}
