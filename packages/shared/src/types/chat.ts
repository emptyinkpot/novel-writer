export interface ChatRequest {
  basicInfo: {
    bookTitle: string;
    bookType: string;
    bookDescription: string;
  };
  content: string;
  model: string;
  formValues: Record<string, any>;
  sessionId: string;
  workId: string;
  index: number;
  temperature: number;
  includeMessageCount: number;
  language: string;
  enableInternet: boolean;
}

export const AVAILABLE_MODELS: string[] = [
  'lite',
  'fast',
  'deepseek-v4-flash',
  'base',
  'minimax-2.7',
  'kimi-2.6',
  'deepseek-v4-pro',
  'grok',
  'ultra',
  'ultra-5.5',
  'plus',
  'claude',
  'max',
  'max-stable',
  'pro',
  'pro_3_1_preview',
];
