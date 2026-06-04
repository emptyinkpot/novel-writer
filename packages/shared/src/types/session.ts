export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  createdAt?: string;
}

export interface ChatSession {
  id: string;
  userId: string;
  category: 'chat' | 'agent';
  workId: string;
  title: string;
  content: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}
