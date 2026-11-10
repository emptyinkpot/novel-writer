import type { FanqiePublicReaderClient } from '../../infrastructure/reader/FanqiePublicReaderClient.js';
import type {
  ReaderBookDetail,
  ReaderBookSummary,
  ReaderBookComments,
  ReaderBookTextExport,
  ReaderBookTextExportChapter,
  ReaderBookTextExportInput,
  ReaderBookTextExportSkippedChapter,
  ReaderChapterDetail,
  ReaderChapterTextExport,
  ReaderChapterTextExportInput,
  ReaderSearchBooksInput,
} from '../../sdk/types.js';
import { FanqieServiceError } from '../../sdk/errors.js';

export class PublicReaderService {
  constructor(private readonly reader: FanqiePublicReaderClient) {}

  searchBooks(input: ReaderSearchBooksInput): Promise<ReaderBookSummary[]> {
    if (!String(input.query).trim()) {
      throw new FanqieServiceError('reader_search_invalid', 'query is required', 400);
    }
    return this.reader.searchBooks(input);
  }

  getBookDetail(bookIdOrUrl: string): Promise<ReaderBookDetail> {
    if (!String(bookIdOrUrl).trim()) {
      throw new FanqieServiceError('reader_book_invalid', 'bookId is required', 400);
    }
    return this.reader.getBookDetail(bookIdOrUrl);
  }

  getChapterDetail(itemIdOrUrl: string): Promise<ReaderChapterDetail> {
    if (!String(itemIdOrUrl).trim()) {
      throw new FanqieServiceError('reader_chapter_invalid', 'itemId is required', 400);
    }
    return this.reader.getChapterDetail(itemIdOrUrl);
  }

  getBookComments(bookIdOrUrl: string, limit?: number): Promise<ReaderBookComments> {
    if (!String(bookIdOrUrl).trim()) {
      throw new FanqieServiceError('reader_book_invalid', 'bookId is required', 400);
    }
    return this.reader.getBookComments(bookIdOrUrl, limit);
  }

  async exportChapterText(input: ReaderChapterTextExportInput): Promise<ReaderChapterTextExport> {
    const detail = await this.getChapterDetail(input.itemId);
    return {
      format: 'txt',
      filename: buildChapterFilename(detail),
      itemId: detail.itemId,
      bookId: detail.bookId,
      title: detail.title,
      bookTitle: detail.bookTitle,
      author: detail.author,
      wordCount: detail.wordCount,
      content: renderChapterText(detail, input.includeMeta !== false),
    };
  }

  async exportBookText(input: ReaderBookTextExportInput): Promise<ReaderBookTextExport> {
    const detail = await this.getBookDetail(input.bookId);
    const chapterOutlines = selectChapterOutlines(detail, input.itemIds);
    if (chapterOutlines.length === 0) {
      throw new FanqieServiceError('reader_book_export_empty', 'no chapters matched export input', 404);
    }

    const chapters: ReaderBookTextExportChapter[] = [];
    const skippedChapters: ReaderBookTextExportSkippedChapter[] = [];
    const sections: string[] = [];

    for (const outline of chapterOutlines) {
      try {
        const chapter = await this.reader.getChapterDetail(outline.itemId);
        chapters.push({
          itemId: chapter.itemId,
          title: chapter.title,
          chapterNumber: outline.chapterNumber,
          wordCount: chapter.wordCount,
        });
        sections.push(renderChapterText(chapter, input.includeMeta !== false));
      } catch (error) {
        skippedChapters.push({
          itemId: outline.itemId,
          title: outline.title,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (chapters.length === 0) {
      throw new FanqieServiceError('reader_book_export_failed', 'all chapter exports failed', 502, {
        skippedChapters,
      });
    }

    return {
      format: 'txt',
      filename: buildBookFilename(detail),
      bookId: detail.bookId,
      title: detail.title,
      author: detail.author,
      chapterCount: chapterOutlines.length,
      exportedChapterCount: chapters.length,
      skippedChapters,
      chapters,
      content: renderBookText(detail, sections, input.includeMeta !== false),
    };
  }
}

function selectChapterOutlines(detail: ReaderBookDetail, itemIds: string[] | undefined) {
  if (!itemIds || itemIds.length === 0) return detail.chapters;
  const allowed = new Set(itemIds.map((itemId) => String(itemId).trim()).filter(Boolean));
  return detail.chapters.filter((chapter) => allowed.has(chapter.itemId));
}

function renderBookText(detail: ReaderBookDetail, chapterSections: string[], includeMeta: boolean): string {
  const sections: string[] = [];
  if (includeMeta) {
    sections.push([
      detail.title,
      detail.author ? `作者：${detail.author}` : undefined,
      detail.category ? `分类：${detail.category}` : undefined,
      detail.status ? `状态：${detail.status}` : undefined,
      Number.isFinite(detail.chapterTotal) ? `章节数：${detail.chapterTotal}` : undefined,
      detail.abstract ? `简介：${detail.abstract}` : undefined,
    ].filter(Boolean).join('\n'));
  }
  sections.push(...chapterSections);
  return sections.join('\n\n');
}

function renderChapterText(detail: ReaderChapterDetail, includeMeta: boolean): string {
  if (!includeMeta) return detail.contentText.trim();
  return [
    detail.bookTitle || detail.bookId,
    detail.author ? `作者：${detail.author}` : undefined,
    detail.title,
    detail.updatedAtText ? `更新时间：${detail.updatedAtText}` : undefined,
    '',
    detail.contentText.trim(),
  ].filter((line) => line != null).join('\n');
}

function buildChapterFilename(detail: ReaderChapterDetail): string {
  return sanitizeFilename(`${detail.bookTitle || detail.bookId}-${detail.title}-${detail.itemId}.txt`);
}

function buildBookFilename(detail: ReaderBookDetail): string {
  return sanitizeFilename(`${detail.title}-${detail.bookId}.txt`);
}

function sanitizeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
}
