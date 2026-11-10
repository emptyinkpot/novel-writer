// 主生成 prompt：第一次写正文时使用。
// 调用位置：context/context-builder.ts 在检索并打包 EvidencePack / Corpus 后调用 buildWriterPrompt()。
// 输出去向：返回的大字符串会成为 context.prompt，再由 generation-runtime.ts 交给 callSingleWriter()。
// 注意：这里负责“生成阶段就约束格式”，不是润色阶段补救。

import { WRITER_SYSTEM_PROMPT } from '../shared/system-prompt.mjs';
import { CONTINUOUS_PROSE_FORMAT_CONTRACT, PUNCTUATION_STYLE_CONTRACT } from '../shared/format-contract.mjs';
import { buildSourceAuthoritySection } from '../shared/source-boundary.mjs';

export function buildWriterPrompt(input) {
  // input.sections 是 Context Synthesizer 已经按通道装箱后的材料；Writer 只负责一次成文。
  const lengthWindow = resolveLengthWindow(input.targetWordCount);
  const sectionText = [
    input.sections.reality ? `[REALITY]\n${input.sections.reality}` : '',
    input.sections.literary ? `[LITERARY]\n${input.sections.literary}` : '',
    input.sections.semantic ? `[SEMANTIC]\n${input.sections.semantic}` : '',
    input.sections.lexicon ? `[LEXICON]\n${input.sections.lexicon}` : '',
    input.sections.structure ? `[STRUCTURE]\n${input.sections.structure}` : '',
    input.sections.author ? `[AUTHOR]\n${input.sections.author}` : '',
  ].filter(Boolean).join('\n\n');
  const hasLiterary = Boolean(input.sections.literary);
  const hasAuthor = Boolean(input.sections.author);
  const sourceAuthority = buildSourceAuthoritySection();

  return [
    WRITER_SYSTEM_PROMPT,
    '',
    `主题：${input.topic}`,
    `目标字数：约 ${input.targetWordCount} 字，允许范围 ${lengthWindow.minChars}-${lengthWindow.maxChars} 字`,
    `上下文预算：${input.contextTokenBudget} tokens；已装入约 ${input.contextChars} 字符`,
    '',
    sourceAuthority,
    '',
    CONTINUOUS_PROSE_FORMAT_CONTRACT,
    '',
    PUNCTUATION_STYLE_CONTRACT,
    '',
    '[CONTEXT_PACKAGE]',
    '以下是规划阶段合成后的材料包。它只提供事实边界、语料、偏好、关联线索和可能问题，不是正文结构模板。不要按通道顺序、材料顺序或字段顺序组织文章。',
    '',
    sectionText,
    '',
    '写作要求：',
    '直接输出完整正文，不输出流程说明、检查报告、JSON、表格或项目符号。',
    '先在心里消化材料，再一次写成文章。不要输出提纲、标题层级、材料清单或通道标签。',
    '正文应由题目、本次上下文材料和事实轻重自然长出结构；不要把 [CONTEXT_PACKAGE]、[STRUCTURE]、STORM outline、mustCover、问题列表或 episode plan 逐条回答成清单。',
    '事实、年份、人物、机构、地点、数字、引语和因果关系只能来自 [REALITY]。没有 [REALITY] 依据时，不得凭模型常识补细节。',
    '当前年份、近未来年份、尚未发布的报告、政策预告、技术部署、人口预测和趋势推演，只有在 [REALITY] 里逐字出现并给出来源时才能写。没有来源时不得写“某年将发布、开始使用、宣布投资、显示趋势”这类句子，也不得用它们作结尾升华。',
    '所有精确数字、日期、编号、条款、金额、船名、人名、地名、机构名必须能在 [REALITY] 中逐字找到原文，否则只能用模糊表达。',
    '来源归属必须精确到上下文实际给出的层级。系列、合集、出版社、文件名、数据集名只能作来源容器，不能作观点主体；如果上下文给出系列中的具体子书名、卷名、章节名和具体作者或明确署名，正文就归属到子书名和作者，例如"某某在《某子书名》中指出"。如果只有系列/合集名而没有子书名或作者，不得写"某系列有学者指出"、"某出版社学者们"、"某系列反复强调"；只写事实和判断，不写出处主体。',
    hasLiterary
      ? '[LITERARY] 只提供句法、节奏、意象温度和段落呼吸；文学性必须附着在 [REALITY] 已有事实上，不能新增现场、天气、气味、私人独白、心理活动或无来源情节。'
      : '句法、节奏、转折方式保持克制清楚，不要用新闻腔或评论套话替代事实推进。',
    '[SEMANTIC] 只提供概念关系和解释方向；[LEXICON] 只提供偏好词和禁用词线索；[STRUCTURE] 只提供问题提示。它们都不能替代 [REALITY] 成为事实来源。',
    hasAuthor
      ? '[AUTHOR] 只代表用户长期偏好、近期反馈和禁用风格；它不能提供事实、年份、引文、人物或因果依据，也不要写成自我介绍或规则复述。'
      : '',
    '比喻、象征、类比和物象链只能基于上下文中已经出现的意象、动作、制度关系或概念关系。找不到来源时，少用比喻，直接写事实动作和判断。',
    '正文直接呈现事实、判断和来源归属。不要把阅读材料的动作写成元叙述。',
    '正文信息直接写进句子。专有名词首次出现时使用中文全称或原文，解释性补充另起一句。',
    '正文不得使用中文（）或英文()写解释性括号注释。括号里的年份、术语、译名、同位语、背景说明，必须改写进句子，删括号的同时调整语序让句子仍然通顺；不得直接删括号造成残句，也不得因此丢掉年份、人名、译名。示例：「战争结束（1945年）」写成「1945年战争结束」；「这套制度（即内地化）」写成「这套所谓内地化的制度」；「外相広田（时任）」写成「时任外相広田」。书名号《》和引号""照常保留。',
    '评论腔套话、内部通道标签、流程说明和提示语不进入正文。',
    '段落之间靠事实、主体、动作和判断承接，不靠提示语缝合。',
    '需要换层时，直接另起自然段，用新的事实主体或问题压力开头。',
    '允许短促、冷硬、有停顿的文学句，但它必须贴着事实，只承担论证功能，不做装饰。',
    '需要补充信息就另起一句，避免用插入式标点拖出说明段。',
    '段落长短服从论证和语气，不按固定功能、锚点密度、三段式或模板节奏组织。',
    '不要把材料平均铺开。具体人名、书名、年份、数字、地名、文件名、引文只在 [REALITY] 给出并且确实需要时出现。',
    '题目里的核心词、隐喻或制度线索只能解释由 [REALITY] 直接连接的事实链；每跨一个领域，必须有具体主体、制度动作、时间地点、钱权流向或承受者作桥。没有事实桥时，宁可停下，不要把所有议题都归入同一概念。',
    '不得写成“一个概念解释两百年全部问题”的全覆盖框架。文章必须保留多重压力：财政、军事、资本、种族、生态、地方治理、技术惯性等哪一项由材料支持就写哪一项，不把它们全部压成同一个词的副产品。',
    '不得机械串联"学者观点、历史事件、学者观点、历史事件"。学者和书名只在能改变判断力度时进入。',
    '不得把所有学者压成同一个 narrator。每个来源只能承担上下文实际给出的解释路径；找不到具体观点主体时，不要硬写归属。',
    '反事实压力只作为内部检验。正文用事实主体、制度动作和后果推进；结尾不连续发问。',
    '题目里的偶然/必然、传统/现代、帝国/民族国家、中心/边疆这类抽象轴，正文必须降解为事件、制度动作、财政流向、军队调度、命名变化和具体代价；不要把抽象词本身当作段落发动机。',
    '段落结尾停在事实、判断或未解决的张力上，意象只承担论证中的物象压力。',
    '宏观解释采用正向直陈：事实主体 -> 制度动作 -> 后果。概念张力压进材料选择、动词和名词，由相邻事实的落差自然显现。',
    '结尾不得引入新的年份、新机构、新政策、新技术、新预测或新类比。结尾只能回收正文已经展开过的事实链，停在材料中已经存在的未解决代价、事实张力或制度判断上。',
    `字数要求：正文应落在 ${lengthWindow.minChars}-${lengthWindow.maxChars} 字窗口内。目标长度是预算，不是最低线；不要为了“写长写透”反复复述框架、堆旁证、追加总结层或把同一判断换词说多遍。若材料不足以支撑更长表达，优先收束在窗口内的有效密度。`,
  ].filter((line) => line !== '').join('\n');
}

function resolveLengthWindow(targetWordCount) {
  const target = Math.max(1, Math.floor(Number(targetWordCount) || 1));
  const tolerance = Math.min(1000, Math.max(300, Math.floor(target * 0.125)));
  return {
    minChars: Math.max(1, target - tolerance),
    maxChars: target + tolerance,
  };
}
