export interface Work {
  id: string;
  userId: string;
  title: string;
  description: string;
  category: 'novel' | 'script' | 'essay' | 'other';
  coverUrl: string;
  folderId: string;
  wordCount: number;
  status: 'normal' | 'deleted';
  publishStatus: 'unpublished' | 'published' | 'rejected';
  content: any;
  themes: string[];
  roles: string[];
  plots: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Folder {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
}
