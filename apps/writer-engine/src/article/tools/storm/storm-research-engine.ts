// 内置 STORM 研究规划器：在没有外部 STORM 服务 URL 时，仍把研究规划作为正式阶段产出。
// 它只生成视角、问题、提纲和候选检索线索；事实权威仍属于 EvidencePack / RAGFlow。
import type { StormResearchResult } from '../../contracts.ts';

export function buildLocalStormResearch(input: {
  topic: string;
  target?: string;
}): StormResearchResult {
  const topic = String(input.topic || '').trim();
  const target = String(input.target || '').trim();
  const subject = target || topic;
  const perspectives = [
    { role: '事实档案员', focus: `确认「${subject}」中的关键时间、地点、制度文件、人物和统计口径。` },
    { role: '制度分析者', focus: `追问「${subject}」背后的财政、土地、军事、交通、法律和行政机制。` },
    { role: '结构史作者', focus: `把「${subject}」放回空间秩序、权力边界和社会性格的长期形成过程。` },
    { role: '文风审稿者', focus: `寻找能让论证落在事实后果上的场景、动作和收束方式。` },
  ];
  const questionTemplates = [
    '有哪些可核查的一手或权威材料能支撑这个主题的基本事实？',
    '哪些制度动作把空间安排转化为人的日常位置和政治性格？',
    '这个主题里哪些常见二分判断需要被事实链拆开？',
    '哪些年份、文件、地名、机构、人物和统计口径必须谨慎处理？',
    '哪些材料能说明权力如何通过道路、边界、账册、军队或土地制度进入生活？',
    '文章结尾应回到哪个可见后果，而不是停在抽象概念上？',
    '哪些反例或争议可以防止文章写成单线决定论？',
    '哪些文学化意象必须从材料里长出来，而不是外加修辞？',
  ];
  const questions = perspectives.flatMap((perspective, pIndex) => questionTemplates.slice(pIndex * 2, pIndex * 2 + 3).map((question) => ({
    perspective: perspective.role,
    question: `${subject}：${question}`,
  })));
  const outline = [
    `研究对象：${subject}`,
    '一、先建立事实底盘：时间、地点、制度文件、关键主体和可核查数字。',
    '二、再写空间秩序如何被制度化：土地、边界、交通、军事、财政、司法或行政技术。',
    '三、继续写制度如何落到人的位置：迁徙、劳动、自治、暴力、身份和日常服从。',
    '四、处理争议和反例，避免把复杂历史压成单一因果。',
    '五、结尾回到可见后果，让事实动作承担判断，不用口号收束。',
  ].join('\n');
  return {
    perspectives,
    questions,
    outline,
    citations: [
      {
        title: `${subject} 权威资料检索线索`,
        url: '',
        snippet: `围绕「${subject}」优先检索政府档案、学术著作、统计口径、地图资料和制度文件；该条只是 STORM 候选线索，必须由 EvidencePack/RAGFlow 再确认。`,
        score: 0.5,
      },
    ],
    elapsed_ms: 0,
  };
}
