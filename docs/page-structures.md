# 白梦写作 (baimengxiezuo.com) 页面结构文档

技术栈: Next.js (App Router, RSC), Tailwind CSS, shadcn/ui 组件库, dark mode 支持

## 全局组件

### 导航栏 (Header)

```html
<header>
  <div class="flex w-full items-center justify-between gap-4">
    <!-- 左侧: Logo + 导航 -->
    <div class="flex min-w-0 items-center gap-10">
      <a class="flex flex-row items-center gap-2" href="/zh-Hans/">
        <img alt="logo" class="h-9 w-9 rounded-xl" src="/logo.jpg">
        <span class="text-lg font-bold theme-text-primary">白梦写作</span>
      </a>
      <nav class="hidden items-center gap-6 sm:flex">
        <!-- 导航项 -->
      </nav>
    </div>
    <!-- 右侧: 操作按钮 -->
    <div class="flex shrink-0 items-center gap-2">
      <!-- 主题切换、充值、领字数、返现、登录 -->
    </div>
  </div>
</header>
```

导航项 (顺序):
| 文案 | 链接 | 样式 |
|------|------|------|
| 首页 | /zh-Hans/ | 活跃: text-blue-600 |
| 作品 | /zh-Hans/library/ | 非活跃: text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 |
| 工具箱 | /zh-Hans/generator/ | 同上 |
| 工作流 | /zh-Hans/workflow/ | 同上 |
| 价格 | /zh-Hans/pricing/ | 同上 |
| 教程 + `<sup class="ml-[-2px] text-[10px] font-bold text-red-500">推荐</sup>` | /zh-Hans/tutorials/ | 同上 |

导航项链接样式:
```
a.relative.font-medium.transition-colors
活跃: text-blue-600
非活跃: text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100
```

右侧操作按钮:
- 主题切换图标按钮: `h-9 w-9 surface-hover theme-text-primary`
- 充值: `flex items-center justify-center gap-1 h-8 px-1 rounded-md hover:bg-zinc-100 cursor-pointer text-zinc-700`
- 领字数: 同上
- 返现: 同上 (带 badge 动画)
- 注册/登录: `rounded-md bg-blue-500 py-1.5 text-sm font-medium text-white hover:bg-blue-700 px-5`

### Footer

```html
<footer class="bg-black px-6 py-4 text-white md:px-12">
  <div class="mx-auto max-w-6xl">
    <div class="flex flex-col items-center space-y-3 md:flex-row md:items-center md:justify-between md:space-y-0">
      <!-- Logo -->
      <div class="md:mb-0">
        <img alt="Logo" class="h-12 w-auto brightness-0 invert filter" src="/logo.jpg">
      </div>
      <!-- 备案信息 + 链接 -->
      <div class="flex flex-col items-center space-y-2 md:flex-row md:space-x-2 md:space-y-0">
        <a href="https://beian.miit.gov.cn/" class="text-sm text-gray-400 hover:text-white text-nowrap">粤ICP备2025419009号-1</a>
        <span class="text-gray-600">|</span>
        <a href="..." class="text-sm text-gray-400 hover:text-white text-nowrap">粤公网安备44030002007644号</a>
        <span class="text-gray-600">|</span>
        <a href="..." class="text-sm text-gray-400 hover:text-white text-nowrap">网信算备440305703068901250019号</a>
        <span class="text-gray-600">|</span>
        <a href="/zh-Hans/terms/" class="text-nowrap text-sm text-zinc-400 hover:text-white">服务条款</a>
        <span class="text-zinc-600">|</span>
        <a href="/zh-Hans/privacy/" class="text-nowrap text-sm text-zinc-400 hover:text-white">隐私政策</a>
        <span class="text-sm text-zinc-400 text-center md:ml-6">© 2026 深圳白梦网络科技有限公司</span>
      </div>
    </div>
  </div>
</footer>
```

---

## 1. 首页 (/zh-Hans/)

页面标题: 白梦写作-专业AI小说写作助手
Meta Description: 白梦写作-专业AI小说写作助手

### Section 1: Hero

```html
<section>
  <h1>白梦写作</h1>
  <h2>专业的 AI 小说写作平台</h2>
  <p>AI 驱动的创作空间，帮助您轻松构思、写作与打磨您的小说作品。海量优质提示模板，顶尖大模型加持。</p>
  <a href="/zh-Hans/library/">免费开始创作 →</a>
  <!-- 统计数据 -->
  <div class="stats-row">
    <div><span>100万+</span><span>优质 AI 提示使用次数</span></div>
    <div><span>10万+</span><span>作者获取了正收益</span></div>
    <div><span>10亿+</span><span>累计生成字数</span></div>
  </div>
</section>
```

Hero 下方有 5 个场景轮播按钮 (Go to scene 1-5)。

### Section 2: Experience - 社区推广

文案:
- brand: 白梦写作
- rateValue: 95%
- rateLabel: 长篇小说签约率
- platforms: 涵盖所有平台：番茄、起点、七猫、纵横、飞卢、刺猬猫、书旗等
- title: 全品类大神陪跑训练营
- categories: 超短篇｜短篇｜长篇｜剧本
- guarantee: 保收益！
- contactPrompt: 新手小白离成为作家只差一个联系方式
- description: 数百位大神作者在线分享经验，帮助你从小白成长为新晋大神
- addWechat: 添加微信
- qrAlt: 白梦写作小助手二维码

### Section 3: Workspace 展示

- title: 高效创作
- subtitle: 功能强大而不失优雅的工作台
- fileTree: 文件树：自由管理您的小说章节、设定、角色卡
- editor: 编辑器：不只是码字，还拥有：章节摘要、AI高频词汇提示、角色卡关联、重要信息高亮等功能
- chat: 对话区：对话、代写、工作流等多种AI协作方式，高效完成您的写作任务
- imageAlt: 白梦写作编辑器工作台

### Section 4: Feature Cards (3张卡片)

| 卡片 | 标题 | 描述 |
|------|------|------|
| relation | 人物关系图谱 | 复杂人物，不该只靠脑子硬记。将角色关系、阵营变化与情感脉络可视化展开，让庞杂设定也能层次分明。 |
| poster | 作品海报 | 让你的小说世界，被一眼看见。基于设定、地图、人设与力量体系，智能生成专属海报，让作品气质跃然纸上。 |
| deai | AI 消痕 | 智能识别并优化 AI 生成内容中的机械感表达，降低检测痕迹，让文章更自然流畅，也更具人文温度。 |

### Section 5: Features (功能特色)

- title: 专为小说创作打造
- subtitle: 从构思到成稿，为您的创作之路提供全方位支持
- learnMore: 了解更多

5 个功能卡片 (tag + title + description + imageLabel):

| key | tag | title | description |
|-----|-----|-------|-------------|
| dialogue | 高效创作 | 对话快速生成 | 一键生成 1000 字以上的精彩对话内容，海量优质提示模板供您选择。无论是日常对白还是戏剧冲突，AI 都能帮您快速产出高质量文字。 |
| deai | 智能优化 | AI 消痕功能 | 独特的 AI 消痕模板，智能识别并优化 AI 生成内容中的机械感表达，显著降低文章的 AI 检测率，让您的作品更具人文温度，读起来更加自然流畅。 |
| chapter | 深度分析 | 小说章节拆解 | 智能分析优秀小说的章节结构，帮您深入理解书籍的设计思路。学习大师的创作技巧，让您的故事架构更加专业。 |
| generators | 创意工具 | 10+ 余款生成器 | 涵盖书名、人物、场景、道具、情节等创作要素的生成器集合。从零散灵感到完整设定，助您跨越创作瓶颈。 |
| proofread | 质量把控 | AI 智能审稿 | 专业的 AI 审稿功能，从情节逻辑、人物塑造、语言表达等多维度评估您的作品，提供针对性的优化建议。 |

### Section 6: Testimonials (作者证言)

- title: 作者们怎么说
- subtitle: 来自真实用户的声音

7 条用户证言 (author + role + content):

1. **择日生_** (老福特大神): 自从开始使用白梦写作，我的创作灵感简直源源不断。它不仅仅是一个强大的AI工具，更像一个与我心有灵犀的写作伙伴，总能在我思路枯竭时，给出恰到好处的启发和建议。无论是构思宏大框架还是雕琢字句细节，它都表现得相当专业，极大地提升了我的写作效率与作品质量。有它在，写作从不是孤军奋战。

2. **阿甜甜** (七猫短剧作者): 白梦真的太好用了，以前我的很多东西都记在本子上，想要找资料都要去找本子翻开找了半天才能找到，现在我都记录在白梦上，只需要打开左边的设定，就可以直接找到我要的资料，然后关联下这个资料就能完整插入到大纲和细纲里面了。而且我以前手写正文都要将近两个小时才能写满4000多字，现在我的效率提高了至少3倍以上，感谢白梦！

3. **小果** (番茄热门作者): 身为一名网文作者，我是通过AI消痕了解到白梦写作的，然后经过深入的了解才发现，这个网站功能十分齐全，不仅有生成器、AI审稿、章节解析、拆书、生成正文。本来一天很费劲才能写4000字，现在比较轻松就能写1~2万字。

4. **柚子** (提示词创作者): 价格便宜，功能丰富，可开发性高，对于新人与老手都能用，新人不踩坑，不割韭菜，老手可以更好的使用，没有太多限制，调整也更方便。

5. **清欢** (提示词作者): 最良心的写作软件，在功能强大的同时，还兼具了简约派的界面风格。看起来养眼，用起来舒心。

6. **李玄** (番茄热门作者): 根据概要定制修改章节内容很合理，随时改动剧情，方便作者和读者互动修改剧情能让作者为读者定制角色。

7. **tivial** (剧本签约作者): 内容很精炼，生成的内容能够很好衔接，而且还能解决卡文，能够反复根据关联的前文修改章纲和大纲。

### Section 7: Tutorial 视频教程

- title: 入门教程
- subtitle: 观看视频教程，快速上手白梦写作的各项功能
- watchVideo: 观看教程视频
- viewMore: 查看更多教程

4 个视频卡片:
1. 快速入门指南
2. AI 对话生成教程
3. 消痕功能详解
4. 生成器使用技巧

### Section 8: Pricing 概览 (首页内嵌)

- tag: 定价方案
- title: 选择最适合您的方案
- subtitle: 无论是个人创作还是专业需求，我们都有合适的计划
- monthly: 月付
- yearly: 年付
- save: 省
- billed_yearly: 按年结算
- includes_free: 包含所有免费版功能，以及：

特性条目:
- dialogue: 对话模式 / dialogue_free_note: 消耗字数包和积分 / dialogue_unlimited: 无限输入输出字数
- workflow: 工作流模式 / workflow_free_note: 无赠送积分 / workflow_credits: 每月赠送{{credits}}积分
- devices: 设备限制 / devices_limit: 1台设备 / devices_limit_pro: 1台电脑端 + 1台移动端
- advanced: 高级模型 / advanced_free_note: 消耗字数包和积分
- speed: 生成速度 / speed_normal: 标准 / speed_fast: 极速
- support: 优先客服支持

### Section 9: FAQ

- tag: 支持
- title: 您的疑问，我们来解答

4 条 FAQ:

1. **Q:** 白梦写作使用什么 AI 模型？
   **A:** 我们结合了业界领先的多种大语言模型，并针对小说创作进行了专门的微调和优化，以确保生成的内容在逻辑性、创造性和文学性上都达到专业水准。

2. **Q:** 生成的内容易被判定为抄袭吗？
   **A:** 不会。我们的 AI 根据您的输入实时生成原创内容。虽然生成的文本是独一无二的，但我们始终建议您像对待任何创作一样，对最终作品负责。

3. **Q:** 我的作品内容安全吗？
   **A:** 绝对安全。您的所有创作内容都经过加密存储，未经您的明确许可，我们绝不会将其用于公共模型的训练或泄露给第三方。

4. **Q:** 免费版有什么限制？
   **A:** 新注册用户赠送300000字数和200积分，并可以使用基础的写作辅助功能。这足以让您充分体验白梦写作的强大能力。

### Section 10: Final CTA

- title: 开始您的创作之旅
- subtitle: 加入万名作者的行列，用 AI 释放您的创作潜能
- cta: 免费开始

---

## 2. 定价页 (/zh-Hans/pricing/)

页面标题: 白梦写作-专业AI小说写作助手

### 布局结构

```html
<section class="bg-white dark:bg-zinc-950 px-4 py-10 text-gray-800 dark:text-zinc-200 sm:px-6 sm:py-14 md:px-12 md:py-20">
  <div class="mx-auto max-w-6xl text-center">
    <h1 class="mb-3 text-3xl font-bold leading-tight md:mb-6 md:text-6xl">选择最适合你的计划</h1>
    <!-- Tab 切换 -->
    <div class="tab-group">
      <button class="rounded-full px-4 py-1.5 text-xs font-medium sm:px-5 sm:text-sm md:px-6 md:py-2">会员计划</button>
      <button>额外字数包</button>
      <button>积分购买</button>
    </div>
    <!-- 价格卡片网格 -->
  </div>
</section>
```

Tab 按钮样式:
- 非活跃: `rounded-full px-4 py-1.5 text-xs font-medium sm:px-5 sm:text-sm md:px-6 md:py-2 text-gray-600 dark:text-zinc-400`
- 活跃: 追加 `bg-white shadow-sm dark:bg-zinc-700 dark:text-zinc-100`

### Tab 1: 会员计划

4 种方案卡片 (水平排列 4 列):

| 方案 | 有效期 | 原价 | 现价 | 赠送积分 |
|------|--------|------|------|----------|
| 周卡 | 7天 | 59.9元 | 49.99元 | 500 积分 |
| 月卡 | 30天 | 119元 | 89.99元 | 每月赠送 3,000 积分 |
| 季卡 | 90天 | 349元 | 254.99元 | 每月赠送 3,500 积分 |
| 年卡 | 365天 | 999元 | 949.99元 | 每月赠送 5,000 积分 |

所有方案共同特性:
- 对话模式: 无限输入输出字数
- 会员福利: 会员专属群
- 积分可用于: 封面生成、工作流模式、至强模型
- 设备限制: 最多仅限一台电脑端设备，一台移动端设备同时使用

卡片结构 (以推荐卡为例):
```html
<div class="relative flex flex-col rounded-xl border-2 border-blue-600 dark:border-blue-500 bg-blue-50 dark:bg-blue-950/30 p-3 sm:p-4 md:rounded-lg md:p-8 text-left shadow-lg">
  <span class="absolute right-2 md:right-3 top-1 md:top-2 rounded-full bg-blue-600 px-2 py-1 text-xs text-white">最受欢迎</span>
  <div class="min-h-[64px] sm:min-h-[72px] md:min-h-28">
    <h2 class="mb-1 text-lg sm:text-xl md:mb-2 md:text-2xl font-bold">...</h2>
    <p class="text-xs leading-5 sm:text-sm md:text-base">...</p>
  </div>
  <div class="h-14 sm:h-16 md:h-24">
    <span class="text-xs sm:text-sm text-gray-500 line-through">原价</span>
    <h3 class="text-2xl sm:text-[28px] md:text-3xl font-bold">现价</h3>
  </div>
  <button class="w-full h-10 sm:h-11 md:py-6 bg-blue-600 hover:bg-blue-700 shadow-md text-white rounded-md text-sm md:text-base font-semibold">购买</button>
  <ul class="mt-3 md:mt-8 space-y-2.5 md:space-y-4 text-xs text-gray-600 md:text-sm">
    <li class="flex gap-x-3 items-start">
      <div class="mt-0.5 rounded-full bg-blue-100 p-0.5">
        <CheckIcon class="h-3.5 w-3.5 text-blue-600"/>
      </div>
      <span>特性文案</span>
    </li>
  </ul>
</div>
```

普通卡片样式:
- border: `border border-gray-200 dark:border-zinc-700`
- bg: `bg-white dark:bg-zinc-900`
- button: `bg-black text-white dark:bg-slate-100 dark:text-slate-900`

推荐卡片(月卡)额外标记: `特别折扣` badge

### Tab 2: 额外字数包

3 种方案:

| 方案 | 字数 | 原价 | 现价 | 标记 |
|------|------|------|------|------|
| 小型字数包 | 100万字数 | 50元 | 16.99元 | - |
| 中型字数包 | 200万字数 | 100元 | 29.99元 | 最受欢迎 |
| 大型字数包 | 500万字数 | 200元 | 54.99元 | - |

共同说明: 永久有效

### Tab 3: 积分购买

3 种方案:

| 方案 | 积分 | 原价 | 现价 | 标记 |
|------|------|------|------|------|
| 小型积分包 | 5000积分 | 139.99元 | 54.99元 | - |
| 中型积分包 | 10000积分 | 269.99元 | 104.99元 | 最受欢迎 |
| 大型积分包 | 50000积分 | 1299.99元 | 499.99元 | - |

特性说明:
- 永久有效
- 可直接用于工作流消耗
- 中型: 比小型包更划算
- 大型: 适合高频工作流用户

底部链接: 《虚拟商品购买协议》 (`text-blue-600 underline-offset-4 hover:underline`)

---

## 3. 教程页 (/zh-Hans/tutorials/)

页面标题: 白梦写作-专业AI小说写作助手

注: 该页为客户端组件 (TutorialsPageClient)，匿名访问会触发错误状态;实际内容由客户端渲染。错误页结构如下:

```html
<section class="relative flex min-h-full items-center justify-center px-6 py-16 text-gray-800 md:px-12">
  <div class="mx-auto max-w-6xl text-center">
    <h1 class="mb-6 text-5xl font-bold leading-tight tracking-tight text-gray-900 md:text-7xl">哎呀，页面出现了错误</h1>
    <p class="mx-auto mb-12 max-w-3xl text-xl leading-relaxed text-gray-600">
      你可以返回首页、打开资料库或前往工具箱继续使用。如果问题仍然存在，请联系我们 support@daydreamwriter.com。
    </p>
    <button>清缓存并刷新</button>
    <a href="/zh-Hans/">返回首页</a>
    <a href="/zh-Hans/library/">打开资料库</a>
    <a href="/zh-Hans/generator/">前往工具箱</a>
  </div>
</section>
```

教程页正常渲染时由 React 客户端组件加载视频列表 (内容通过 API 拉取)，文案模板包含: `practical_tutorial`: 使用教程

预期布局: 标题 "使用教程" + 视频卡片网格，每张卡片包含视频缩略图 + 标题 + 描述 + 时长。复刻时请参考首页 Tutorial 视频区结构 (4 张卡片网格)。

---

## 4. 作品库页 (/zh-Hans/library/)

页面标题: 白梦写作-专业AI小说写作助手

### 布局

```html
<section class="px-6 py-8 md:px-12">
  <div class="mx-auto max-w-6xl">
    <!-- 标题区 -->
    <div class="mx-auto max-w-4xl text-center">
      <h1 class="mb-3 bg-gradient-to-r bg-clip-text text-4xl font-extrabold dark:text-slate-100">我的作品</h1>
      <p>管理您的创作，继续编写您的故事，或开始一个全新的创作</p>
    </div>
    
    <!-- 搜索框 -->
    <div class="mx-auto mb-8 max-w-md">
      <input placeholder="搜索作品..." />
    </div>
    
    <!-- Tab 与排序 -->
    <div class="mb-6 grid grid-cols-2 items-center gap-4 md:flex md:items-start md:justify-between">
      <!-- 视图切换 (网格/列表) -->
      <div class="relative w-full rounded-xl bg-slate-100 p-1 backdrop-blur-[20px] backdrop-saturate-[180%] dark:bg-slate-800/80 md:w-fit md:max-w-[920px]">
        <div class="grid h-[38px] w-full grid-cols-2 gap-2 bg-transparent p-0 md:inline-flex md:w-auto z-20">
          <!-- 视图按钮带图标 (lucide-layout-grid) -->
        </div>
      </div>
      <!-- 排序方式下拉 -->
      <div>排序方式</div>
    </div>
    
    <!-- 作品标签栏 (横向滚动) -->
    <div class="min-w-0 max-w-full overflow-x-auto overflow-y-hidden scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <!-- 分组标签: 作品(0), 回收站(0), 未分组(0) + "新建分组" 按钮 -->
    </div>
    
    <!-- 作品网格 / 加载态 -->
    <div>
      <h3 class="mb-2 text-xl font-semibold text-gray-900 dark:text-slate-100">加载作品中...</h3>
    </div>
  </div>
</section>
```

文案 (来自 i18n library 命名空间):
- my_works: 我的作品
- my_works_description: 管理您的创作，继续编写您的故事，或开始一个全新的创作
- total_works: 总作品数
- total_words: 总字数
- search_works: 搜索作品...
- sort_by: 排序方式
- sort_last_updated: 最近更新
- sort_created: 创建时间
- sort_title: 书名
- sort_word_count: 字数
- no_works_found: 未找到作品
- try_different_search: 尝试不同的搜索条件
- untitled: 未命名
- empty_description: 未描述
- update_work: 编辑作品
- close: 关闭
- update_work_description: 修改作品信息
- work_title: 作品标题
- enter_title: 输入作品标题
- work_description: 作品简介
- enter_description: 输入作品简介
- cancel: 取消
- update: 更新
- edit: 编辑
- publish: 发布为社区模板
- publish_submitted_review: 作品已提交审核
- publish_failed: 发布作品失败

未登录访问时会弹出登录对话框: "微信登录 / 注册" / "请使用微信扫描二维码登录 / 注册" / "扫码后将在微信中完成授权"

---

## 5. 工具箱页 (/zh-Hans/generator/)

页面标题: 白梦写作-专业AI小说写作助手

### 布局

全高度 App 布局 (非公开落地页样式):

```html
<div class="flex h-screen-dynamic flex-col">
  <!-- Header (全局导航) -->
  <!-- Main Content -->
  <div class="flex flex-1 flex-col overflow-auto bg-white dark:bg-zinc-900">
    <div class="container mx-auto flex-1 px-3 py-6 sm:px-4 sm:py-8 lg:px-6">
      <!-- Page Title -->
      <h1 class="mb-3 bg-gradient-to-r bg-clip-text text-4xl font-extrabold dark:text-zinc-100">白梦写作工坊</h1>
      <p>AI赋能创作，让灵感永不枯竭</p>
      
      <!-- Section: 实用工具箱 -->
      <div class="mb-4 flex items-center px-2 sm:mb-6">
        <h2 class="text-2xl font-semibold text-slate-900 dark:text-zinc-100 sm:text-3xl lg:text-4xl">实用工具箱</h2>
      </div>
      <!-- 卡片网格 (grid) -->
      
      <!-- Section: AI 生成器 -->
      <h2 class="text-2xl font-semibold text-slate-900 dark:text-zinc-100 sm:text-3xl lg:text-4xl">AI 生成器</h2>
      <!-- 卡片网格 (grid) -->
    </div>
  </div>
  <!-- Footer -->
</div>
```

### 工具卡片组件

两组卡片，颜色分别为 orange (实用工具箱) 和 blue (AI 生成器):

```html
<!-- Orange 实用工具卡片 -->
<div class="border-border group relative flex h-full min-h-[160px] cursor-pointer flex-col overflow-hidden rounded-2xl border bg-gradient-to-br from-white to-orange-50 dark:from-zinc-800 dark:to-orange-950/30 p-4 shadow-sm transition-all duration-300 hover:border-orange-300 dark:hover:border-orange-700 hover:shadow-lg sm:min-h-[180px] sm:p-5 lg:min-h-[200px] lg:p-6">
  <h3 class="text-foreground relative z-10 mb-2 line-clamp-2 transform-gpu text-lg font-bold sm:text-xl">工具名称</h3>
  <p>工具描述</p>
</div>

<!-- Blue AI生成器卡片 -->
<div class="border-border group relative flex h-full min-h-[160px] cursor-pointer flex-col overflow-hidden rounded-2xl border bg-gradient-to-br from-white to-blue-50 dark:from-zinc-800 dark:to-blue-950/30 p-4 shadow-sm transition-all duration-300 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-lg sm:min-h-[180px] sm:p-5 lg:min-h-[200px] lg:p-6">
  <h3 class="text-foreground relative z-10 mb-2 line-clamp-2 transform-gpu text-lg font-bold sm:text-xl">生成器名称</h3>
  <p>生成器描述</p>
</div>
```

会员专属工具带 badge: `<span>会员</span>` 显示在卡片顶部

### 实用工具箱 (8 个, orange 主题)

| 工具 | 描述 |
|------|------|
| 降AI率 | 粘贴原文，一键调用增强消痕，输出更自然的真人写作版本 |
| 拆书 | 将长篇内容拆分成关键情节和人物 |
| 名字生成器 | 传统的随机名字生成器，包含各种风格 |
| 封面生成器 (会员) | 输入提示词，自动生成精美的作品封面 |
| 海报生成器 (会员) | 上传小说，自动生成精美的作品海报 |
| 章节合并 | 上传多个 TXT 章节，按文件名排序后合并下载 |
| 章节拆分 | 输入完整 TXT，自动拆分为多个章节 TXT 导出 |
| 章节区间导出 | 上传完整小说后，用滑动条选择首尾章节导出 |

### AI 生成器 (10 个, blue 主题)

| 生成器 | 描述 |
|--------|------|
| 书名生成器 | 爆款书名一键生成，流量密码轻松拿捏 |
| 简介生成器 | 浓缩故事精华，勾住读者好奇心 |
| 金手指生成器 | 神转折引爆剧情，颠覆读者预期 |
| 大纲生成器 | 结构严谨层次清，故事发展一目了然 |
| 细纲生成器 | 分场景细化章节脉络，让情节推进更扎实 |
| 黄金开篇生成器 | 三秒抓住眼球，开篇即高能 |
| 角色生成器 | 鲜活人设一键生成，让每个角色跃然纸上 |
| 脑洞生成器 | 灵感乍现，一键生成意想不到的巧妙情节 |
| 正文生成器 | 生成丰富细节和生动描述的引人入胜的故事内容 |
| 通用写作助手 | 获得写作问题和挑战的帮助 |

---

## 6. 工作流页 (/zh-Hans/workflow/)

页面标题: 白梦写作-专业AI小说写作助手

### 布局

同 App 布局 (header + main + footer):

```html
<div class="flex h-screen-dynamic flex-col">
  <!-- Header -->
  <!-- Main Content -->
  <div class="flex flex-1 flex-col overflow-auto bg-white dark:bg-zinc-900">
    <h1 class="text-lg font-medium text-gray-900 dark:text-zinc-100">工作流模板</h1>
    
    <!-- 筛选栏 (grid 左右布局) -->
    <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-6 items-start">
      <!-- 左侧: 标签筛选 -->
      <!-- 右侧: 模板列表 -->
    </div>
  </div>
  <!-- Footer -->
</div>
```

### 筛选器结构

筛选条目 (label: value grid):
- 模板类型: 社区模板 | 收藏模板 | 自定义模板
- 篇幅类型: 全部 | 通用 | 超短篇 | 短篇 | 中篇 | 长篇 | 剧本
- 模板分类: 全部 | 通用 | 正文 | 书名 | 简介 | 金手指 | 大纲 | 细纲 | 开篇 | 角色 | 脑洞 | 审稿 | 拆书 | 消痕 | 其他 | 代写
- 内容排序: 综合 | 热门 | 最新
- 关键词搜索: 输入框

操作按钮:
- 添加私有模板
- + 新建模板

空态:
- title: 暂无模板数据
- hint: 请尝试调整筛选条件或搜索关键词

### 工作流文案 (i18n workflow 命名空间，选取关键条目):

运行相关:
- workflow_title: 工作流
- run_button: 运行工作流
- run_view_mode: 运行模式
- editor_mode: 画板模式
- input_section_title: 工作流指令
- input_placeholder: 描述该工作流应执行的操作或提供更多上下文…

状态:
- status_pending: 等待中
- status_running: 运行中
- status_completed: 已完成
- status_failed: 失败
- retry_step: 重试
- step_label: 步骤

结果操作:
- export_all_results: 导出所有结果
- export_as_txt: 导出为 TXT
- export_as_word: 导出为 Word
- insert_to_directory: 插入到目录

计费规则:
- billing_rules: 计费规则
- member_no_charge: 会员不扣除任何字数
- member_limit: 每天使用上限1000次（包含执行步骤调用次数）
- non_member_rules: 非会员扣费规则
- input_billing: 输入计费
- input_formula: 输入字数 = 关联字数 + 前文对话字数 + 用户输入内容字数
- input_free_limit: 2万字以下免费
- input_above_limit: 2万字以上超出的部分，按照 输入字数÷20 计算字数消耗
- output_billing: 输出计费
- output_formula: 输出字数 = 模型输出字数
- output_description: 根据模型倍率，进行输出字数扣费
- execution_deduction_note: 每次执行生成节点时，基础模型和Deepseek V4 Flash扣除 1 积分，专业模型扣除 3 积分，至强模型非会员固定扣除 30 积分、会员固定扣除 20 积分，其他高级模型扣除 4 积分
- upgrade_membership: 充值会员

---

## 全局 Tailwind 设计模式总结

### 颜色系统 (支持 dark mode)
- 主色: blue-500/600 (按钮、活跃状态、推荐卡片 border)
- 文本: gray-800 / zinc-200 (dark) | slate-900 / zinc-100 (dark)
- 背景: white / zinc-950 (dark) | gray-50 / zinc-900 (dark)
- 次级文本: gray-600 / zinc-300 (dark)
- 强调: orange (工具箱卡片) / blue (AI 生成器卡片)
- 自定义 CSS 变量: theme-text-primary, theme-text-secondary, theme-button-primary, theme-transition, surface-hover

### 布局模式
- 容器: `mx-auto max-w-6xl` (落地页) / `container mx-auto` (App 页)
- 响应式间距: `px-4 sm:px-6 md:px-12`, `py-10 sm:py-14 md:py-20`
- 卡片网格: 响应式 grid (具体列数未确定，通常 2-4 列)
- Full-height app: `flex h-screen-dynamic flex-col` + `flex flex-1 flex-col overflow-auto`

### 组件模式
- 按钮: shadcn/ui Button 变体，含 `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md transition-colors focus-visible:outline-none focus-visible:ring-1`
- 卡片: `rounded-2xl border p-4 shadow-sm transition-all duration-300 hover:shadow-lg`
- Badge: `rounded-full bg-blue-600 px-2 py-1 text-xs text-white`
- Tab Pills: `rounded-full px-4 py-1.5 text-xs font-medium`
- Dialog: `fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-white p-6 shadow-lg sm:rounded-lg sm:max-w-[425px]`

### 字体
- 预加载 2 个 woff2 字体文件 (中文+英文)
- 标题: font-extrabold / font-bold
- 正文: font-medium
- 次级: font-normal

### 动画
- 卡片 hover: `transition-all duration-300 hover:shadow-lg`
- Dialog: `data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95`
- 轮播: Hero 区有 5 个 scene 切换

### 图标
- 使用 Lucide React 图标库 (例: lucide-check, lucide-layout-grid)
