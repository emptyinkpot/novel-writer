// 审稿阶段 prompt：Reviewer 只出意见，Revision Agent 统一改正文。
// 这里只拼 prompt，不调用模型；执行入口在 agents/review-agents.ts。
import { CONTINUOUS_PROSE_FORMAT_CONTRACT, FORMAT_REVIEW_CHECKLIST, PUNCTUATION_REVIEW_CHECKLIST, PUNCTUATION_STYLE_CONTRACT } from '../shared/format-contract.mjs';
import { AUTHOR_VOICE_CONTRACT } from '../shared/system-prompt.mjs';

export function buildFormatReviewerPrompt({ topic, targetWordCount, body, styleSummary, deterministicStyleHits }) {
  const lengthWindow = resolveLengthWindow(targetWordCount);
  return [
    '[角色] Format Reviewer',
    '你只审产品格式，不审思想，不查事实，不润色，不重写正文。',
    '',
    `[主题] ${topic}`,
    `目标正文长度窗口：约 ${targetWordCount} 字，允许范围 ${lengthWindow.minChars}-${lengthWindow.maxChars} 字。`,
    '',
    '[审查重点]',
    '- 是否违反连续散文格式。',
    '- 是否残留 Markdown 标题、小标题、章节号、内部结构标签、列表、表格、JSON 或 prompt 痕迹。',
    '- 是否存在破坏阅读的段落布局、孤立序号、项目符号、过密冒号解释、破折号插入语和不自然标点。',
    '- 是否因为后处理或修订造成残句、断裂句、重复空行或不通顺拼接。',
    '- 只给格式问题和位置提示，不评价文章好坏，不提出新结构。',
    '',
    CONTINUOUS_PROSE_FORMAT_CONTRACT,
    '',
    FORMAT_REVIEW_CHECKLIST,
    '',
    PUNCTUATION_STYLE_CONTRACT,
    '',
    PUNCTUATION_REVIEW_CHECKLIST,
    '',
    '[STYLE_SCAN_SUMMARY]',
    JSON.stringify(styleSummary || {}, null, 2),
    '',
    '[DETERMINISTIC_STYLE_HITS]',
    deterministicStyleHits || '无。',
    '',
    '[输出]',
    '只输出可执行格式审查意见。按“必须改 / 建议改 / 可保留”组织。',
    '',
    '[DRAFT]',
    body,
  ].join('\n');
}

export function buildFactReviewerPrompt({ topic, targetWordCount, writingBrief, body }) {
  const factBrief = extractBriefSection(writingBrief.text, 'FACT_NOTES') || writingBrief.factNotes || writingBrief.text;
  const draftForFactReview = compactDraftForFactReview(body);
  const lengthWindow = resolveLengthWindow(targetWordCount);
  return [
    '[角色] Fact Reviewer',
    '你只审事实风险，不润色，不重写正文。',
    '你只回答一个问题：是真的吗。不要评价文章写得好不好，不要提出风格、结构或文学性意见。',
    '',
    `[主题] ${topic}`,
    `目标正文长度窗口：约 ${targetWordCount} 字，允许范围 ${lengthWindow.minChars}-${lengthWindow.maxChars} 字。`,
    '',
    '[审查重点]',
    '- 精确数字、日期、金额、人数、地名、机构、条约、战役是否缺来源支撑。',
    '- 当前年份、近未来年份、尚未发布的报告、政策预告、技术部署和趋势预测是否缺来源支撑。只要 [FACT_NOTES] 没有明确来源、机构、日期和动作，必须列为必须改，并要求删除而不是降级发挥。',
    '- “第一次、没有一个、一直持续到今天、全部、必然、注定、超过”等绝对化表达是否需要降级。',
    '- 因果是否从材料中自然推出，还是作者越界推断。',
    '- 来源主体是否误归属。系列、合集、出版社、文件名、总书名加序章/导论/第几章但无具体作者或子册信息，不得写成“指出、认为、提出”的观点主体。',
    '- 类比材料是否被升格为直接证据。跨文明类比、概论性判断、概念旁照只能局部从属使用；如果它反复出现、进入结尾或支撑中心论证，必须列为必须改。',
    '- 文风、美学、词汇、名著旁照和作者偏好材料是否被误写成事实来源、主论据或历史证据。Divergence Agent 的材料只提供写法和气息，不能提供事实承重。',
    '- 是否存在正确废话。句子看似成立，但没有新增主体、动作、时间、地点、机制、承受者、后果或证据，只是在复述中心义、抽象概念或价值判断，必须列为必须改。',
    '- 是否出现万能解释框架。若草稿把多个缺少事实桥的领域都归入同一个中心概念，必须要求压回有直接证据的事实链，删除无桥延伸。',
    '',
    '[输出]',
    '只输出可执行审稿意见。按“必须改 / 建议改 / 可保留”组织。',
    '',
    '[FACT_NOTES]',
    factBrief,
    '',
    '[DRAFT_FOR_FACT_REVIEW]',
    draftForFactReview,
  ].join('\n');
}

export function buildStyleReviewerPrompt({ topic, targetWordCount, writingBrief, body, styleSummary, deterministicStyleHits }) {
  const lengthWindow = resolveLengthWindow(targetWordCount);
  return [
    '[角色] Style Reviewer',
    '你只审文风、义理贯通、二分转折、AI味和结构跑偏，不查新资料，不重写正文。',
    '你只回答一个问题：这篇正文哪里像 AI 或结构跑偏。不要判断历史观点是否成立，不要替 Fact Reviewer 审事实真伪。',
    '',
    `[主题] ${topic}`,
    `目标正文长度窗口：约 ${targetWordCount} 字，允许范围 ${lengthWindow.minChars}-${lengthWindow.maxChars} 字。`,
    '',
    '[审查重点]',
    '- 只抓真正影响文章完成度的三类问题：结构模板化、重复复述、局部机械/突兀。不要把审稿扩散成句法训练或审美碎片清单。',
    '- 结构模板化：正文是否把理论工具排成一级骨架，是否反复出现“用某理论看某对象”的过渡，是否把材料填进框架表格。',
    '- 重复复述：同一事件、同一判断、同一理论词或同一句话是否在不同段落换包装出现，尤其是甲午、日俄、海权、国家机器等骨干材料是否被多次承重。',
    '- 局部机械/突兀：是否有“不是……而是……”“事实是……”等高频机械强调，是否有材料突然跳入、结尾突然换话题、段落承接断裂。',
    '- 二分转折和伪二分强调句。',
    '- 模板化总结、独立金句段、评论腔连接词、过度顺滑结尾。',
    '- 是否写成课堂讲义、百科说明或理论提纲：理论、概念和框架是否站到前台，材料只是被填进格子里。',
    '- 开头是否从材料里已有的物、地点、文件、制度动作、军队、港口、账簿、条约、身体或承受者进入，而不是先解释题目或宣布方法。',
    '- 如果正文要使用理论，理论必须像刀一样进入历史现场；不能让理论本身成为正文主角，不能把事实平均分配给理论小节。',
    '- 作者解释权是否成立：正文是否被一个中心义统摄，还是把材料平均铺成知识地图。',
    '- 作者政治光谱是否真正激活：它是否在材料支持处转化为压力、自洽、反噬、承受者或余寒，而不是停留在中性制度兴趣；不要求五项齐全。',
    '- 是否只是中性制度解剖：如果全文只剩制度、标准、空间、秩序等抽象主语，并且阻断了事实主体、制度动作和代价落点，才列为必须改。',
    '- 文学性是否被事实承载。好的文学句应贴着已有物、动作、身体、文件、工具、边界、债务、军队、道路、房屋或制度现场；如果全文只有硬解释、没有可见承载物，并且影响叙事推进，才列为必须改。',
    '- 中心概念是否越权。核心词、隐喻或制度线索如果跨到新领域却没有具体主体、制度动作、时间地点、钱权流向或承受者作桥，必须列为必须改。',
    '- 是否出现同源公式：具体锚点、抽象机制、暴力揭露、哲学闭环如果像固定坡道一样顺滑重复，应要求从材料压力重新生成认识路径。',
    '- 认知动作是否成立：压力、自洽、反噬、承受者、余寒是否由材料自然推出。不是要求五项平均出现，也不是要求五项都出现，而是看文章有没有自己的判断过程。',
    '- 六经注我是否成立：事实是否成为证词，还是只是按时间线陈列。',
    '- 春秋笔法是否成立：褒贬是否藏在主语、动词、事实顺序和后果落点里，还是靠空泛评语或安全中立语气。',
    '- 事实轻重是否合理：骨干事实是否展开，旁证和背景是否从属，是否出现为了显得全面而拖慢中心义的材料。',
    '- 来源调度是否合理：是否把归属不足的系列/合集当成观点主体，是否把类比材料写成主论据，是否用漂亮旁证替代题目真正需要的直接事实。',
    '- 构思继承是否成立：正文是否继承 Outline Agent 的主问题、材料排序、理论用法和舍弃建议，还是重新滑回理论框架复读。',
    '- 发散材料使用是否自然：Divergence Agent 的文风、美学、词汇、比喻和旁照材料是否低频服务正文，还是出现词库堆砌、旁照喧宾夺主或漂亮材料抢主线。',
    '- 照应链是否存在：开头的物、地点、文件、动作或制度是否在中段和结尾回响。',
    '- 术语中文化是否完成：正文是否把材料里的外文制度术语、技术术语和行政单位转成自然中文，是否让可中文化外文词反复充当主语。',
    '- 抽象判断是否脱离事实主体、制度动作和后果。',
    '- 是否出现概念自转：同一抽象词反复当段落主语，段落没有具体机构、文件、土地、铁路、银行、家庭、城市或人群。',
    '- 是否出现正确废话：单句看起来深刻，段落却没有新增信息；判断频率过高，导致每段都在总结；相邻段落只换词复述同一中心义。',
    '- 是否出现比较矩阵腔：连续段落用同一种“某对象的命运/财政/教育/军事/领导层/制度设计……”句式逐项填表。比较可以存在，但必须被压回一个历史过程中的因果、转折、代价和后果。',
    '- 段落准入是否成立：每个自然段至少应有一个新增主体、制度动作、地点时间、钱权流向、承受者、后果、反噬机制或证据来源。',
    '- 后半段是否滑成论文式总结、对称排比或替读者升华。',
    '- 结尾是否重复回收同一个母题、同一句事实后果或同一串题目词，形成回环。重复回扣必须压缩成一次，不能靠复述制造余韵。',
    '- 结尾是否用面向读者的口号式提问、动员句或“准备好了吗”式封口。结尾应停在正文已经展开的事实后果、制度困境或未解决代价上。',
    '- 结尾是否引入新年份、新机构、新政策、新技术、新预测或新类比。结尾只能回收已展开事实；如果出现无来源近未来段，必须要求删除。',
    '- 正文格式是否违反连续散文合同：Markdown 标题、小标题、章节号、内部结构标签都必须删除或融入自然段。',
    '- 正文是否残留破折号和中文冒号解释腔。它们不是硬替换对象，但应优先改成自然句。',
    '- 风格扫描结果只是传感器，不是替换清单。不要要求机械删除所有命中词；只处理高密度、空泛、破坏事实推进的句子。',
    '- “不是……而是……”和欧化句的处理属于写作后中文语序修订规划，不属于 Author 生成约束，也不是 postprocess 正则替换。你要给 Revision Agent 一个局部计划。',
    '- 中文语序修订不是“去 AI 化”表演。像训读一样把欧化句读回中文：保事实，不换事实；保判断，不抢主线；改语序，少换词。',
    '- 对二分句必须先分类：保留、顺写、变体、删除/并入。保留用于真实必要对照；顺写用于多数可改成事实推进的句子；变体只低频用于必须保留的对照；删除/并入只用于空泛总结。',
    '- 顺写优先把句子改成“可命名主体 -> 具体动作 -> 后果/判断”。不要把“不是……而是……”机械替换成“并非……而是……”“表面上……真正……”这类换皮结构。',
    '- 对欧化句优先改语序和动词：让执行主体出场，把“进行了/通过实现/使得成为/作为一个/被……所……”读回自然中文。',
    '- 不要输出同义词替换清单，不要要求全文降 AI 味，不要把每个命中词都列成必须改；只挑会破坏事实推进和中文气味的局部句子。',
    '- 发现 AI 味时，给 Revision Agent 的建议必须是局部重构：改事实主体、动词、因果承接和段落节奏；不得建议同义词替换或随机改写。',
    '- 如果命中句承载了事实、年份、数字、机构或来源归属，必须保留事实，只改句法和段落位置。',
    '',
    CONTINUOUS_PROSE_FORMAT_CONTRACT,
    '',
    FORMAT_REVIEW_CHECKLIST,
    '',
    PUNCTUATION_STYLE_CONTRACT,
    '',
    PUNCTUATION_REVIEW_CHECKLIST,
    '',
    AUTHOR_VOICE_CONTRACT,
    '',
    '[输出]',
    '只输出可执行审稿意见。按“必须改 / 建议改 / 可保留”组织。',
    '必须改里优先列三类：结构模板化、重复复述、局部机械/突兀。每条都要说明：问题位置、为什么破坏文章、Revision Agent 能否局部修。',
    '涉及二分句或欧化句时，必须额外写“中文语序修订计划”，逐条标注：保留 / 顺写 / 变体 / 删除并入。能局部修的，给出自然中文方向；不能局部修的，明确说超出 Revision Agent 权限。',
    '如果问题是结构级，例如全文按理论分栏或同一案例被多框架反复承重，要明确写“超出 Revision Agent 局部 patch 权限，应回到 Outline/Author 重写路线”，不要要求 Revision Agent 大段重写。',
    '',
    '[STYLE_SCAN_SUMMARY]',
    JSON.stringify(styleSummary || {}, null, 2), // 确定性扫描结果作为 Style Reviewer 的传感器输入。
    '',
    '[DETERMINISTIC_STYLE_HITS]',
    deterministicStyleHits || '无。', // 具体命中句必须进入审稿，不只给统计数。
    '',
    '[WRITING_BRIEF]',
    writingBrief.text,
    '',
    '[DRAFT]',
    body,
  ].join('\n');
}

export function buildRevisionPrompt({ topic, targetWordCount, writingBrief, reviewReport, body, lengthWindow: providedLengthWindow, inputEffectiveLength }) {
  const lengthWindow = providedLengthWindow || resolveLengthWindow(targetWordCount);
  const effectiveLength = Number(inputEffectiveLength) > 0 ? Math.floor(Number(inputEffectiveLength)) : null;
  const inputRawLength = String(body || '').length;
  const revisionTarget = resolveRevisionTargetBand(targetWordCount, lengthWindow);
  const inputInsideWindow = effectiveLength && effectiveLength >= lengthWindow.minChars && effectiveLength <= lengthWindow.maxChars;
  const safeTarget = inputInsideWindow
    ? resolvePreserveTargetBand(effectiveLength, lengthWindow)
    : revisionTarget;
  const rawTarget = resolveRevisionRawTargetBand({ inputRawLength, effectiveLength, lengthWindow, safeTarget, inputInsideWindow });
  return [
    '[角色] Revision Agent',
    '你是写作后文字编辑，像审稿人拿红笔改稿。你不是第二作者，不是压缩器，不是机械替换器。',
    '你只回答一个问题：怎样把审稿人已经点名的文字纰漏改顺。你必须输出修订后的完整正文，不输出 JSON，不输出解释。',
    '',
    `[主题] ${topic}`,
    `目标正文有效长度窗口：约 ${targetWordCount} 字，允许范围 ${lengthWindow.minChars}-${lengthWindow.maxChars} 有效字。`,
    `本次修订有效长度目标带：${safeTarget.minChars}-${safeTarget.maxChars} 有效字。`,
    effectiveLength ? `输入草稿当前有效长度：${effectiveLength} 有效字。` : '',
    inputRawLength ? `输入草稿当前字符串长度：${inputRawLength} 字符。` : '',
    `本次修订字符串长度保护带：${rawTarget.minChars}-${rawTarget.maxChars} 字符。`,
    '',
    '[输出协议]',
    '- 只输出修订后的完整正文。',
    '- 不要 Markdown 代码块，不要 JSON，不要修订说明，不要修改摘要，不要列出操作。',
    '- 正文必须仍是连续中文散文。不得出现标题、小标题、章节号、项目符号、表格、内部标签或 prompt 痕迹。',
    '- 如果审稿报告没有明确必须改问题，也要原样输出正文；不能输出空内容、JSON 或解释。',
    '',
    '[执行边界]',
    '- 只改审稿报告和确定性扫描点名的问题；未被点名且没有明显硬伤的段落尽量保持。',
    '- 你可以按段落批量修改二分句、欧化句、总结腔、冒号解释腔、破折号插入语、重复短句和均匀铺陈造成的局部拖沓。',
    '- 如果 REVIEW_REPORT 里出现 [REVISION_EFFECT_FEEDBACK]，说明上一轮编辑没有让命中指标下降。这一轮必须优先处理反馈里列出的当前命中句样例，不能只是保守返回原文。',
    '- 如果 REVIEW_REPORT 或 [DETERMINISTIC_STYLE_HITS] 里出现 [MANDATORY_REVISION_DOCKET]，它是逐条处置清单，不是建议。你必须处理清单里的每个非必要命中句；确实保留时，要在正文中自然保留原判断，但不能输出解释或报告。',
    '- 对 docket 中的二分/反题句，默认处置是顺写或并入，不是保留。只有真实必要对照、原文引语、书名标题或删改会破坏事实判断时才保留。',
    '- 指标反馈不是正则替换命令。你仍然要保证每一句通顺，保留事实和判断，把句子读回自然中文。',
    '- 如果 REVIEW_REPORT 里出现 [REVISION_LENGTH_FEEDBACK]，说明上一轮修订过度压缩。你必须从 DRAFT 中恢复必要事实链和承接句，让正文回到有效长度窗口内；不要机械补字，不要追加尾巴。',
    '- 你不能新增事实、年份、数字、人物心理、现场细节、类比、机构、政策或预测。',
    '- 保留原文的事实顺序、主要段落顺序、中心主线和作者声部。不得全文重写、不得重排结构、不得把正文压缩成摘要。',
    '- 审稿报告说结构级失败时，只能做局部文字编辑，不能伪装成重构全文；但已经能局部改顺的二分句、欧化句和总结腔必须尽量处理。',
    '- 如果 [DETERMINISTIC_STYLE_HITS] 中列出“确定性重复长句命中”，删除后一次重复或并入相邻事实句；不能把重复句改写成新观点。',
    '- 二分句修订属于中文语序修订，不是同义词替换。把多数“不是 A，而是 B”顺写成“主体做了什么，结果把 B 推到前台”；只有真实必要对照才保留或低频变体。不得批量替换成“并非……而是……”“表面上……真正……”。',
    '- 欧化句修订像训读回中文：把名词堆叠、被动、介词结构和身份垫片读回“谁做了什么，谁承受了什么，后果是什么”。少换词，不新增事实。',
    '- 总结腔修订要少用“这就是……”“重要的是……”“换句话说……”。能藏进事实动作和后果里的判断，就不要单独摆成教师式总结。',
    '- 信息密度过于均匀时，只能在局部层面压缩重复解释和弱旁证，不能新造详略结构；保留承重材料，删薄空泛回环。',
    '- 可参考的修订方向：把“海权论在东亚的传播，构成了日本国家机器重组的重要条件”改成“日本重组国家机器时，海权论提供了一套新的说法”；把“日本通过控制朝鲜半岛实现了对大陆通道的掌握”改成“日本先控制朝鲜半岛，再把这条半岛通道接到大陆上”。',
    '- 可参考的修订方向：把“英国对中国沿海进行了军事压迫”改成“英国舰队压到中国沿海”；把“这使得海洋成为国家竞争的核心空间”改成“海洋于是被推到国家竞争的中心”。',
    '- 可参考的修订方向：把“国家机器的财政汲取能力决定了战争持续能力”改成“国家能不能继续打，先看它能不能把钱收上来”。例子只说明语序，不得照抄进正文。',
    '- 删除只能用于无来源事实、重复空话、格式残留、结尾新增材料、完全复现或明显同义复述。承载事实、年份、机构、钱权流向、承受者和后果的句子必须保留或局部改顺。',
    '- 如果删改导致句子断裂，必须在原位置附近用同一句上下文已有的主体、动作、因果或后果补足通顺。补足不是新增事实。',
    '- 不新增来源、年份、数字、引语、人物心理、现场细节、类比、政策、机构或预测。',
    '- 有效字不是普通 chars。修订后有效长度必须落在目标带，普通字符串长度也应留在保护带；不要输出贴着下限的短稿。',
    `- 有效长度目标带：${safeTarget.minChars}-${safeTarget.maxChars}；普通字符串保护带：${rawTarget.minChars}-${rawTarget.maxChars}。`,
    '- 修订后有效长度必须落在目标带，普通字符串长度也应留在保护带；不要输出贴着下限的短稿。',
    '',
    '[格式合同]',
    '修订后的最终正文必须是连续中文散文。不得保留 Markdown 标题、小标题、章节号、独立序号行、内部结构标签、列表、表格、JSON 或 prompt 痕迹。',
    '保留书名、年份范围、URL、时间和原文引语中必要的符号；其他中文冒号解释腔和破折号插入语优先由你改成自然句，不交给 postprocess 机械替换。',
    '',
    '[WRITING_BRIEF]',
    trimBriefForRevision(writingBrief.text),
    '',
    '[REVIEW_REPORT]',
    trimReviewReportForRevision(reviewReport.text),
    '',
    '[DETERMINISTIC_STYLE_HITS]',
    reviewReport.deterministicStyleHits || '无。',
    '',
    '[DRAFT]',
    body,
  ].join('\n');
}

export function buildStyleRepairPrompt({ topic, targetWordCount, writingBrief, body, deterministicStyleHits }) {
  const lengthWindow = resolveLengthWindow(targetWordCount);
  return [
    '[角色] Style Repair Agent',
    '你是最终文风修复者，只处理确定性扫描列出的高置信机械句法、格式和标点问题。你的任务是把欧化句、二分转折、中文冒号解释腔和破折号插入语改成更自然的中文散文。',
    '',
    `[主题] ${topic}`,
    `目标正文长度窗口：约 ${targetWordCount} 字，允许范围 ${lengthWindow.minChars}-${lengthWindow.maxChars} 字。`,
    '',
    '[硬边界]',
    '- 只输出修复后的完整正文。',
    '- 不新增事实、年份、数字、地名、机构、引语、人物心理或现场细节。',
    '- 不改变原文的事实顺序和主要段落结构。',
    '- 不重写全文，不调整段落顺序，不复制已有句子填补空位。',
    '- 对命中句优先做局部句法重构，不做同义词替换表演。',
    '- 不要把承载事实的文学句洗成说明文。若句子贴着物、动作、身体、文件、工具、边界、债务、军队、道路、房屋或制度现场，只修掉硬伤，保留冷感和停顿。',
    '- 把“不是……而是……”“这不是……这是……”“问题不在于……而在于……”改成事实主体、制度动作、后果的顺序。',
    '- 把“被……所……”“进行了”“作为一个”“当……的时候”“之一”“不得不”“予以/给予”等翻译腔改成自然主动句或具体动作。',
    '- 把可中文化的外文制度术语、技术术语和行政单位按材料释义改成自然中文。不要改 URL、代码、模型名、原文书名或确需保留的专名。',
    '- 把中文冒号解释腔改成自然句，尽量不用“：”。',
    '- 把破折号插入语拆成自然句，尽量不用“——”或“—”。',
    '- 如果扫描输入里出现抽象概念自转、抽象主语段、结尾升华或对称排比，只把它当作上下文风险提示；没有同时命中机械句法、格式或标点问题时，不要凭这一类风险重写段落。',
    '- 如果扫描输入里出现 ending_repeated_sentence_loop 或 ending_repeated_motif_loop，允许只处理结尾重复：保留事实最具体的一次回扣，删除后续复述，不新增事实、不新增升华句。',
    '- 对看似深刻但没有新增信息的句子，不做审美裁判。只有它同时属于确定性命中句，且能从前后原文事实直接承接时，才做局部句法重构；不要为了保持字数补新的抽象判断。',
    '- 修复后正文长度应尽量接近输入正文。Style Repair 不是压缩器；除非命中句本身是重复或无来源，不能借修风格大量删减。',
    '- 如果某个命中句包含书名、年份范围、URL、时间或原文引语，保留必要符号，不要硬改坏事实。',
    '',
    CONTINUOUS_PROSE_FORMAT_CONTRACT,
    '',
    PUNCTUATION_STYLE_CONTRACT,
    '',
    '[WRITING_BRIEF]',
    trimBriefForRevision(writingBrief.text),
    '',
    '[DETERMINISTIC_STYLE_HITS]',
    deterministicStyleHits || '无。',
    '',
    '[DRAFT]',
    body,
  ].join('\n');
}

function resolveLengthWindow(targetWordCount) {
  const target = Math.max(1, Math.floor(Number(targetWordCount) || 1));
  const tolerance = Math.min(1000, Math.max(300, Math.floor(target * 0.125)));
  return {
    minChars: Math.max(1, target - tolerance),
    maxChars: target + tolerance,
  };
}

function resolveRevisionTargetBand(targetWordCount, lengthWindow) {
  const target = Math.max(1, Math.floor(Number(targetWordCount) || 1));
  const lowerBuffer = Math.max(300, Math.floor(target * 0.075));
  const upperBuffer = Math.max(300, Math.floor(target * 0.075));
  return {
    minChars: Math.min(lengthWindow.maxChars, Math.max(lengthWindow.minChars, target - lowerBuffer)),
    maxChars: Math.max(lengthWindow.minChars, Math.min(lengthWindow.maxChars, target + upperBuffer)),
  };
}

function resolvePreserveTargetBand(effectiveLength, lengthWindow) {
  const tolerance = 250;
  return {
    minChars: Math.max(lengthWindow.minChars, effectiveLength - tolerance),
    maxChars: Math.min(lengthWindow.maxChars, effectiveLength + tolerance),
  };
}

function resolveRevisionRawTargetBand({ inputRawLength, effectiveLength, lengthWindow, safeTarget, inputInsideWindow }) {
  const rawRatio = effectiveLength ? Math.max(1, inputRawLength / effectiveLength) : 1.15;
  const effectiveFloorAsRaw = Math.ceil(lengthWindow.minChars * rawRatio) + 250;
  const minFromInput = inputInsideWindow ? inputRawLength - 350 : effectiveFloorAsRaw;
  const minChars = Math.min(
    lengthWindow.maxChars,
    Math.max(lengthWindow.minChars + 900, safeTarget.minChars + 700, effectiveFloorAsRaw, minFromInput),
  );
  const maxChars = Math.min(
    lengthWindow.maxChars,
    Math.max(minChars, inputInsideWindow ? inputRawLength + 120 : safeTarget.maxChars + 900),
  );
  return { minChars, maxChars };
}

function extractBriefSection(text, sectionName) {
  const source = String(text || '');
  const start = source.indexOf(`[${sectionName}]`);
  if (start < 0) return '';
  const after = source.slice(start + sectionName.length + 2);
  const next = after.search(/\n\[[A-Z_]+\]\n?/);
  return (next >= 0 ? after.slice(0, next) : after).trim();
}

function compactDraftForFactReview(body) {
  const text = String(body || '').trim();
  if (text.length <= 7000) return text;
  const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  if (paragraphs.length <= 8) {
    return [
      text.slice(0, 3000),
      '\n\n[中段省略，Fact Reviewer 只审风险类型，不逐句润色]\n\n',
      text.slice(-3000),
    ].join('');
  }
  const head = paragraphs.slice(0, 4);
  const middleIndex = Math.max(4, Math.floor(paragraphs.length / 2) - 2);
  const middle = paragraphs.slice(middleIndex, middleIndex + 4);
  const tail = paragraphs.slice(-4);
  return [
    '[草稿开头]',
    head.join('\n\n'),
    '',
    '[草稿中段抽样]',
    middle.join('\n\n'),
    '',
    '[草稿结尾]',
    tail.join('\n\n'),
  ].join('\n');
}

function trimReviewReportForRevision(text) {
  const source = String(text || '').trim();
  if (!source) return '无必须改问题。';
  const sections = [];
  for (const header of ['FORMAT_REVIEW', 'FACT_REVIEW', 'STYLE_REVIEW']) {
    const section = extractBriefSection(source, header);
    const mustFix = extractReviewBucket(section, '必须改');
    if (mustFix) sections.push(`[${header}_MUST_FIX]\n${mustFix}`);
  }
  if (sections.length === 0) {
    return [
      'REVIEW_REPORT 未列出明确“必须改”。',
      '只做格式残留、无来源事实和明显断句的局部修复；不要执行建议项，不要重写全文。',
    ].join('\n');
  }
  return sections.join('\n\n').slice(0, 5000);
}

function extractReviewBucket(text, bucketName) {
  const source = String(text || '').trim();
  if (!source) return '';
  const pattern = new RegExp(`${escapeRegExp(bucketName)}[：:\\s]*([\\s\\S]*?)(?=\\n\\s*(?:必须改|建议改|可保留)[：:\\s]|$)`);
  const match = source.match(pattern);
  return match ? match[1].trim() : '';
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trimBriefForRevision(text) {
  const source = String(text || '');
  const fact = extractBriefSection(source, 'FACT_NOTES').slice(0, 1600);
  const contextBrief = extractBriefSection(source, 'CONTEXT_BRIEF').slice(0, 3600);
  const contextSynthesis = extractBriefSection(source, 'CONTEXT_SYNTHESIS').slice(0, 1800);
  return [
    '[FACT_NOTES_EXCERPT]',
    fact,
    '',
    '[CONTEXT_BRIEF_EXCERPT]',
    contextBrief,
    '',
    '[CONTEXT_SYNTHESIS_EXCERPT]',
    contextSynthesis,
  ].join('\n').trim();
}
