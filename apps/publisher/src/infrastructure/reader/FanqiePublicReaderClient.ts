import { chromium } from 'playwright';
import { FanqieServiceError } from '../../sdk/errors.js';
import type {
  ReaderBookDetail,
  ReaderBookSummary,
  ReaderBookComments,
  ReaderComment,
  ReaderChapterDetail,
  ReaderChapterOutline,
  ReaderSearchBooksInput,
} from '../../sdk/types.js';

const FANQIE_ORIGIN = 'https://fanqienovel.com';
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';
const BROWSER_PATH = process.platform === 'win32'
  ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  : undefined;

export class FanqiePublicReaderClient {
  async searchBooks(input: ReaderSearchBooksInput): Promise<ReaderBookSummary[]> {
    const query = String(input.query || '').trim(); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    if (!query) {
      throw new FanqieServiceError('reader_search_invalid', 'query is required', 400);
    }

    const directBookId = extractBookId(query);
    if (directBookId) {
      const detail = await this.getBookDetail(directBookId);
      return [toSummary(detail)];
    }

    const browser = await chromium.launch({
      headless: true,
      executablePath: BROWSER_PATH,
    });
    try {
      const page = await browser.newPage({
        userAgent: DEFAULT_UA,
        viewport: { width: 1440, height: 1200 },
      });
      await page.goto(`${FANQIE_ORIGIN}/search/${encodeURIComponent(query)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await page.waitForTimeout(5000);
      const results = await page.evaluate((limit) => {
        const anchors = Array.from(document.querySelectorAll('a[href*="/page/"]'));
        const seen = new Set<string>();
        const output: Array<{
          bookId: string;
          title: string;
          author?: string;
          description?: string;
          coverUrl?: string;
          pageUrl: string;
        }> = [];

        const extractText = (element: Element | null | undefined) => (element?.textContent || '').replace(/\s+/g, ' ').trim(); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.

        for (const anchor of anchors) {
          const href = anchor.getAttribute('href') || ''; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
          const match = href.match(/\/page\/(\d+)/);
          if (!match) continue;
          const bookId = match[1];
          if (seen.has(bookId)) continue;
          seen.add(bookId);

          const card = anchor.closest('li, article, [class*="book"], [class*="search"]') || anchor.parentElement;
          const title = extractText(anchor);
          const image = card?.querySelector('img') as HTMLImageElement | null; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
          const authorNode = card?.querySelector('[class*="author"]'); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
          const descriptionNode = card?.querySelector('[class*="desc"], [class*="intro"], p'); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
          output.push({
            bookId,
            title,
            author: extractText(authorNode) || undefined,
            description: extractText(descriptionNode) || undefined,
            coverUrl: image?.src || undefined, // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
            pageUrl: href.startsWith('http') ? href : `https://fanqienovel.com${href}`,
          });
          if (output.length >= limit) break;
        }
        return output;
      }, Math.min(Math.max(Number(input.limit || 10), 1), 20));
      return results;
    } finally {
      await browser.close().catch(() => {});
    }
  }

  async getBookDetail(bookIdOrUrl: string): Promise<ReaderBookDetail> {
    const bookId = requiredBookId(bookIdOrUrl);
    const html = await fetchHtml(`${FANQIE_ORIGIN}/page/${bookId}`);
    const state = parseInitialState(html);
    const page = state?.page; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    if (!page || !page.hasFetch) {
      throw new FanqieServiceError('reader_book_not_found', `book detail not found: ${bookId}`, 404);
    }

    const chapters = flattenChapterList(page.chapterListWithVolume || page.chapterList || []); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    return {
      bookId: String(page.bookId || bookId),
      title: String(page.bookName || ''), // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      author: String(page.author || ''), // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      description: String(page.description || '') || undefined, // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      coverUrl: String(page.thumbUrl || page.thumbUri || '') || undefined, // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      pageUrl: `${FANQIE_ORIGIN}/page/${bookId}`,
      category: String(page.category || page.categoryV2 || '') || undefined, // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      status: toBookStatus(page.status, page.creationStatus),
      wordCount: toNumber(page.wordNumber),
      chapterTotal: toNumber(page.chapterTotal),
      lastChapterItemId: String(page.lastChapterItemId || '') || undefined, // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      lastChapterTitle: String(page.lastChapterTitle || '') || undefined, // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      abstract: String(page.abstract || '') || undefined, // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      chapters,
    };
  }

  async getChapterDetail(itemIdOrUrl: string): Promise<ReaderChapterDetail> {
    const itemId = requiredItemId(itemIdOrUrl);
    const html = await fetchHtml(`${FANQIE_ORIGIN}/reader/${itemId}`);
    const state = parseInitialState(html);
    const readerData = state?.reader?.chapterData || {}; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    const rawContent = String(readerData.content || ''); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    if (!rawContent) {
      throw new FanqieServiceError('reader_chapter_not_found', `chapter detail not found: ${itemId}`, 404);
    }
    const contentHtml = extractArticleHtml(rawContent);
    return {
      itemId: String(readerData.itemId || itemId),
      bookId: String(readerData.bookId || ''), // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      title: String(readerData.title || ''), // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      bookTitle: String(readerData.bookName || '') || undefined, // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      author: String(readerData.author || '') || undefined, // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      contentHtml,
      contentText: decodeFanqieReaderText(htmlToText(contentHtml)),
      wordCount: toNumber(readerData.chapterWordNumber),
      prevItemId: String(readerData.preItemId || '') || undefined, // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      nextItemId: String(readerData.nextItemId || '') || undefined, // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      updatedAtText: extractUpdatedAtText(html),
      isLocked: toBoolean(readerData.isChapterLock),
    };
  }

  async getBookComments(bookIdOrUrl: string, limit = 30): Promise<ReaderBookComments> {
    const bookId = requiredBookId(bookIdOrUrl);
    const browser = await chromium.launch({ headless: true, executablePath: BROWSER_PATH });
    try {
      const page = await browser.newPage({ userAgent: DEFAULT_UA, viewport: { width: 1440, height: 1200 } });
      // Try the public comment page pattern: /comment/{bookId}-{commentId}
      // First try to get comments from the book detail page's __INITIAL_STATE__
      const html = await fetchHtml(`${FANQIE_ORIGIN}/page/${bookId}`);
      const state = parseInitialState(html);
      const comments: Array<{ username: string; content: string; likes?: number; timestamp?: string }> = [];

      // Extract comments from initial state if available
      const commentList = state?.page?.commentList || state?.page?.bookComment?.list || state?.comment?.list || [];
      for (const item of Array.isArray(commentList) ? commentList : []) {
        const username = String(item?.user?.nick_name || item?.user?.name || item?.userName || '匿名');
        const content = String(item?.info?.text || item?.content || item?.text || '');
        if (!content || content.length < 2) continue;
        comments.push({
          username,
          content,
          likes: Number(item?.info?.digg_count || item?.likeCount || 0),
          timestamp: item?.info?.create_time ? new Date(Number(item.info.create_time) * 1000).toISOString() : undefined,
        });
        if (comments.length >= limit) break;
      }

      await browser.close().catch(() => {});
      return { bookId, comments, total: comments.length };
    } finally {
      await browser.close().catch(() => {});
    }
  }
}

function toSummary(detail: ReaderBookDetail): ReaderBookSummary {
  return {
    bookId: detail.bookId,
    title: detail.title,
    author: detail.author,
    description: detail.description,
    coverUrl: detail.coverUrl,
    pageUrl: detail.pageUrl,
  };
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': DEFAULT_UA,
    },
  });
  const html = await response.text();
  if (!response.ok) {
    throw new FanqieServiceError('reader_http_failed', `fetch html failed: ${response.status}`, response.status, { url });
  }
  return html;
}

function parseInitialState(html: string): any {
  const match = html.match(/window\.__INITIAL_STATE__=(\{[\s\S]*?\});/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function flattenChapterList(source: any[]): ReaderChapterOutline[] {
  const chapters: ReaderChapterOutline[] = [];
  for (const entry of source) {
    const volumeName = String(entry?.volume_name || entry?.volumeName || ''); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    const list = Array.isArray(entry?.chapterList) ? entry.chapterList : Array.isArray(entry) ? entry : []; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    for (const chapter of list) {
      const itemId = String(chapter?.itemId || ''); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      if (!itemId) continue;
      chapters.push({
        itemId,
        title: String(chapter?.title || ''), // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
        chapterNumber: toNumber(chapter?.realChapterOrder || chapter?.chapterNumber), // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
        volumeName: volumeName || undefined,
        isLocked: toBoolean(chapter?.isChapterLock), // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      });
    }
  }
  return chapters;
}

function toBookStatus(status: unknown, creationStatus: unknown): string | undefined {
  const statusNumber = toNumber(status);
  const creationNumber = toNumber(creationStatus);
  if (creationNumber === 2 || statusNumber === 2) return '已完结';
  if (creationNumber === 1 || statusNumber === 1) return '连载中';
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  if (value == null) return undefined;
  return Boolean(value);
}

function requiredBookId(value: string): string {
  const bookId = extractBookId(value);
  if (!bookId) throw new FanqieServiceError('reader_book_invalid', 'bookId is required', 400);
  return bookId;
}

function requiredItemId(value: string): string {
  const itemId = extractItemId(value);
  if (!itemId) throw new FanqieServiceError('reader_chapter_invalid', 'itemId is required', 400);
  return itemId;
}

function extractBookId(value: string): string | null {
  const text = String(value || '').trim(); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  if (/^\d{10,}$/.test(text)) return text;
  return text.match(/\/page\/(\d+)/)?.[1] || null; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
}

function extractItemId(value: string): string | null {
  const text = String(value || '').trim(); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  if (/^\d{10,}$/.test(text)) return text;
  return text.match(/\/reader\/(\d+)/)?.[1] || null; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
}

function extractArticleHtml(rawHtml: string): string {
  const match = rawHtml.match(/<article>([\s\S]*?)<\/article>/i);
  return match?.[1] || rawHtml; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
}

function htmlToText(html: string): string {
  return html
    .replace(/<p>/gi, '')
    .replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const FANQIE_READER_FONT_MAP: Record<string, string> = {
  58670: '0', 58413: '1', 58678: '2', 58371: '3', 58353: '4', 58480: '5', 58359: '6', 58449: '7',
  58540: '8', 58692: '9', 58712: 'a', 58542: 'b', 58575: 'c', 58626: 'd', 58691: 'e', 58561: 'f',
  58362: 'g', 58619: 'h', 58430: 'i', 58531: 'j', 58588: 'k', 58440: 'l', 58681: 'm', 58631: 'n',
  58376: 'o', 58429: 'p', 58555: 'q', 58498: 'r', 58518: 's', 58453: 't', 58397: 'u', 58356: 'v',
  58435: 'w', 58514: 'x', 58482: 'y', 58529: 'z', 58515: 'A', 58688: 'B', 58709: 'C', 58344: 'D',
  58656: 'E', 58381: 'F', 58576: 'G', 58516: 'H', 58463: 'I', 58649: 'J', 58571: 'K', 58558: 'L',
  58433: 'M', 58517: 'N', 58387: 'O', 58687: 'P', 58537: 'Q', 58541: 'R', 58458: 'S', 58390: 'T',
  58466: 'U', 58386: 'V', 58697: 'W', 58519: 'X', 58511: 'Y', 58634: 'Z', 58611: '的', 58590: '一',
  58398: '是', 58422: '了', 58657: '我', 58666: '不', 58562: '人', 58345: '在', 58510: '他', 58496: '有',
  58654: '这', 58441: '个', 58493: '上', 58714: '们', 58618: '来', 58528: '到', 58620: '时', 58403: '大',
  58461: '地', 58481: '为', 58700: '子', 58708: '中', 58503: '你', 58442: '说', 58639: '生', 58506: '国',
  58663: '年', 58436: '着', 58563: '就', 58391: '那', 58357: '和', 58354: '要', 58695: '她', 58372: '出',
  58696: '也', 58551: '得', 58445: '里', 58408: '后', 58599: '自', 58424: '以', 58394: '会', 58348: '家',
  58426: '可', 58673: '下', 58417: '而', 58556: '过', 58603: '天', 58565: '去', 58604: '能', 58522: '对',
  58632: '小', 58622: '多', 58350: '然', 58605: '于', 58617: '心', 58401: '学', 58637: '么', 58684: '之',
  58382: '都', 58464: '好', 58487: '看', 58693: '起', 58608: '发', 58392: '当', 58474: '没', 58601: '成',
  58355: '只', 58573: '如', 58499: '事', 58469: '把', 58361: '还', 58698: '用', 58489: '第', 58711: '样',
  58457: '道', 58635: '想', 58492: '作', 58647: '种', 58623: '开', 58521: '美', 58609: '总', 58530: '从',
  58665: '无', 58652: '情', 58676: '已', 58456: '面', 58581: '最', 58509: '女', 58488: '但', 58363: '现',
  58685: '前', 58396: '些', 58523: '所', 58471: '同', 58485: '日', 58613: '手', 58533: '又', 58589: '行',
  58527: '意', 58593: '动', 58699: '方', 58707: '期', 58414: '它', 58596: '头', 58570: '经', 58660: '长',
  58364: '儿', 58526: '回', 58501: '位', 58638: '分', 58404: '爱', 58677: '老', 58535: '因', 58629: '很',
  58577: '给', 58606: '名', 58497: '法', 58662: '间', 58479: '斯', 58532: '知', 58380: '世', 58385: '什',
  58405: '两', 58644: '次', 58578: '使', 58505: '身', 58564: '者', 58412: '被', 58686: '高', 58624: '己',
  58667: '亲', 58607: '其', 58616: '进', 58368: '此', 58427: '话', 58423: '常', 58633: '与', 58525: '活',
  58543: '正', 58418: '感', 58597: '见', 58683: '明', 58507: '问', 58621: '力', 58703: '理', 58438: '尔',
  58536: '点', 58384: '文', 58484: '几', 58539: '定', 58554: '本', 58421: '公', 58347: '特', 58569: '做',
  58710: '外', 58574: '孩', 58375: '相', 58645: '西', 58592: '果', 58572: '走', 58388: '将', 58370: '月',
  58399: '十', 58651: '实', 58546: '向', 58504: '声', 58419: '车', 58407: '全', 58672: '信', 58675: '重',
  58538: '三', 58465: '机', 58374: '工', 58579: '物', 58402: '气', 58702: '每', 58553: '并', 58360: '别',
  58389: '真', 58560: '打', 58690: '太', 58473: '新', 58512: '比', 58653: '才', 58704: '便', 58545: '夫',
  58641: '再', 58475: '书', 58583: '部', 58472: '水', 58478: '像', 58664: '眼', 58586: '等', 58568: '体',
  58674: '却', 58490: '加', 58476: '电', 58346: '主', 58630: '界', 58595: '门', 58502: '利', 58713: '海',
  58587: '受', 58548: '听', 58351: '表', 58547: '徳', 58443: '少', 58460: '克', 58636: '代', 58585: '员',
  58625: '许', 58694: '稜', 58428: '先', 58640: '口', 58628: '由', 58612: '死', 58446: '安', 58468: '写',
  58410: '性', 58508: '马', 58594: '光', 58483: '白', 58544: '或', 58495: '住', 58450: '难', 58643: '望',
  58486: '教', 58406: '命', 58447: '花', 58669: '结', 58415: '乐', 58444: '色', 58549: '更', 58494: '拉',
  58409: '东', 58658: '神', 58557: '记', 58602: '处', 58559: '让', 58610: '母', 58513: '父', 58500: '应',
  58378: '直', 58680: '字', 58352: '场', 58383: '平', 58454: '报', 58671: '友', 58668: '关', 58452: '放',
  58627: '至', 58400: '张', 58455: '认', 58416: '接', 58552: '告', 58614: '入', 58582: '笑', 58534: '内',
  58701: '英', 58349: '军', 58491: '侯', 58467: '民', 58365: '岁', 58598: '往', 58425: '何', 58462: '度',
  58420: '山', 58661: '觉', 58615: '路', 58648: '带', 58470: '万', 58377: '男', 58520: '边', 58646: '风',
  58600: '解', 58431: '叫', 58715: '任', 58524: '金', 58439: '快', 58566: '原', 58477: '吃', 58642: '妈',
  58437: '变', 58411: '通', 58451: '师', 58395: '立', 58369: '象', 58706: '数', 58705: '四', 58379: '失',
  58567: '满', 58373: '战', 58448: '远', 58659: '格', 58434: '士', 58679: '音', 58432: '轻', 58689: '目',
  58591: '条', 58682: '呢',
};

function decodeFanqieReaderText(text: string): string {
  let output = '';
  for (const char of text) {
    output += FANQIE_READER_FONT_MAP[char.charCodeAt(0)] || char;
  }
  return output;
}

function extractUpdatedAtText(html: string): string | undefined {
  const match = html.match(/<span class="title">更新时间：<\/span>([^<]+)</);
  return match?.[1]?.trim() || undefined; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
}
