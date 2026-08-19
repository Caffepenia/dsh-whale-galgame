export const ACTIVITY_LOOKBACK_MS = 72 * 60 * 60 * 1000
export const ACTIVITY_MENTION_COOLDOWN_MS = 30 * 60 * 1000
const MAX_SEEN_ACTIVITIES = 256

export type ActivityCategory =
  | 'code-debug'
  | 'code-development'
  | 'document-summary'
  | 'document-writing'
  | 'literary-creation'
  | 'research'
  | 'data-analysis'
  | 'visual-design'
  | 'presentation'
  | 'translation'
  | 'planning'

export type ActivityStatus = 'active' | 'completed' | 'paused' | 'blocked'

export interface HarnessActivity {
  fingerprint: string
  category: ActivityCategory
  label: string
  status: ActivityStatus
  time: number
  chatHint: string
  cgHint: string
}

export interface ActivityMemory {
  seen: string[]
  lastMentionedAt: number
}

interface ActivityDefinition {
  id: ActivityCategory
  label: string
  strong: RegExp
  standaloneStrong?: RegExp
  strongRequiresWeak?: boolean
  requireStrongSignal?: boolean
  weak?: RegExp
  tools?: RegExp
  chatHint: string
  cgHint: string
}

interface TurnBucket {
  sessionId: string
  turnKey: string
  texts: string[]
  tools: string[]
  userSeq: number
  time: number
  status: ActivityStatus
}

const ACTIVITY_DEFINITIONS: readonly ActivityDefinition[] = [
  {
    id: 'code-debug',
    label: '代码调试',
    strong: /\bdebug(?:ging)?\b|\bbug\b|traceback|stack\s*trace|test(?:s|ing)?\s+(?:fail|error)|ci\s+(?:fail|error)|报错|错误|异常|崩溃|闪退|失败|修复|排查|诊断|没反应|不工作|无法运行|報錯|錯誤|異常|崩潰|閃退|失敗|修復|診斷|沒反應|無法運行|當掉|當機|掛掉|壞掉|沒作用|無法執行|跑不起來|跑不動|例外|修正/i,
    standaloneStrong: /\bdebug(?:ging)?\b|\bbug\b|traceback|stack\s*trace|调试|調試|除錯|偵錯/i,
    strongRequiresWeak: true,
    requireStrongSignal: true,
    weak: /代码|程序|接口|函数|组件|前端|后端|typescript|javascript|python|react|vue|node|构建|测试|\bci\b|代碼|程式|介面|函數|函式|組件|元件|後端|構建|建置|編譯|測試/i,
    tools: /exec_command|write_stdin|apply_patch|terminal|shell|git/i,
    chatHint: '主人刚才似乎又在排查棘手的代码问题；自然表示你注意到了这件事，并用符合角色性格的方式关心一句，尤其提醒不要熬得太晚。',
    cgHint: '画面用抽象的程序结构、调试光点与理顺的逻辑线呼应代码调试，不出现可读文字或真实代码',
  },
  {
    id: 'literary-creation',
    label: '文学创作',
    strong: /小说|诗歌?|剧本|故事|散文|文学创作|续写|世界观|角色设定|剧情|fiction|novel|poem|screenplay|story|小說|詩歌?|劇本|文學創作|續寫|世界觀|角色設定|劇情|同人|連載|番外|人設/i,
    weak: /创作|写作|文风|叙事|人物|情节|灵感|創作|寫作|文風|敘事|情節|靈感|文筆|橋段|伏筆/i,
    chatHint: '主人最近在进行文学创作；主动好奇地问一句故事或灵感进展，也可以温柔称赞主人仍在认真编织那个世界。',
    cgHint: '画面用翻开的无字书页、灵感微光与叙事丝线呼应文学创作',
  },
  {
    id: 'document-summary',
    label: '文档总结',
    strong: /总结|摘要|概括|梳理|提炼|要点|纪要|summari[sz](?:e|ing|ation)|tl;?dr|總結|提煉|要點|紀要|統整|彙整|歸納|摘錄|節錄|重點整理|懶人包/i,
    weak: /文档|论文|文章|报告|pdf|docx|材料|会议|文檔|論文|報告|會議|文件|逐字稿|講義|資料/i,
    chatHint: '主人最近在整理或总结一份文档；主动关心一下长内容是否让人疲惫，或夸主人把杂乱信息理清了。',
    cgHint: '画面用整齐归拢的无字纸页、书签与柔和索引光点呼应文档总结',
  },
  {
    id: 'presentation',
    label: '演示文稿',
    strong: /pptx?|幻灯片|演示文稿|presentation|slides?|speaker\s*notes?|幻燈片|簡報|投影片/i,
    weak: /汇报|答辩|讲稿|路演|展示|彙報|答辯|講稿|口試|口頭報告|演講|上台/i,
    chatHint: '主人最近在准备演示或汇报；主动问一句是不是又在反复调整页面，并给一点轻松的陪伴。',
    cgHint: '画面用层叠的无字光幕、舞台灯与整齐构图呼应演示准备',
  },
  {
    id: 'data-analysis',
    label: '数据分析',
    strong: /数据分析|统计|回归|显著性|可视化|图表|仪表盘|spreadsheet|excel|csv|dataset|data\s+analysis|數據分析|統計|迴歸|顯著性|可視化|視覺化|圖表|儀表盤|儀表板|資料分析|試算表|樞紐分析|長條圖|折線圖|圓餅圖|散佈圖/i,
    weak: /数据|指标|表格|趋势|均值|中位数|样本|數據|指標|趨勢|中位數|樣本|資料|平均值|欄位|報表/i,
    chatHint: '主人最近在和数据、表格或图表打交道；主动关心一下盯数字太久会不会累，并认可主人耐心找规律。',
    cgHint: '画面用抽象星点、曲线与有序光格呼应数据分析，不出现具体数值',
  },
  {
    id: 'visual-design',
    label: '视觉设计',
    strong: /视觉设计|界面设计|ui\s*design|ux\s*design|截图|配色|排版|布局|立绘|图像生成|image\s+generation|design|視覺設計|界面設計|介面設計|截圖|佈局|立繪|圖像生成|影像生成|版面配置|版型|主視覺|去背/i,
    weak: /界面|视觉|图片|图像|美术|颜色|字体|组件样式|視覺|圖片|圖像|影像|美術|顏色|字體|字型|組件樣式|元件樣式|介面|色票|圖層|素材|圖檔/i,
    tools: /imagegen|view_image|screenshot|figma|canva/i,
    chatHint: '主人最近在调整界面或视觉素材；主动留意主人对细节的认真，也可以俏皮地问是不是又在纠结一个像素。',
    cgHint: '画面用色板、构图光框与细腻装饰呼应视觉设计，不出现软件界面文字',
  },
  {
    id: 'translation',
    label: '翻译校对',
    strong: /翻译|英译|中译|日译|韩译|双语|多语|translate|translation|locali[sz]ation|校对|翻譯|英譯|中譯|日譯|韓譯|雙語|多語|校對|在地化|中翻英|英翻中|日翻中|譯文|譯稿/i,
    weak: /中文|英文|日文|韩文|措辞|术语|语言|韓文|措辭|術語|語言|用詞|語感|原文|譯名|繁體|簡體/i,
    chatHint: '主人最近在翻译或校对文字；主动关心一下在不同语言间来回切换是不是很费神。',
    cgHint: '画面用交错的无字符号光带与相互映照的书页呼应翻译校对',
  },
  {
    id: 'research',
    label: '资料调研',
    strong: /调研|检索|查资料|文献综述|相关工作|资料搜集|research|literature\s+review|survey|search\s+for|調研|檢索|查資料|文獻綜述|相關工作|資料搜集|資料蒐集|蒐集資料|找資料|文獻回顧|查文獻|爬文/i,
    weak: /论文|来源|证据|引用|网页|仓库|资料|論文|來源|證據|網頁|倉庫|資料|出處|文獻|網站|儲存庫|期刊/i,
    tools: /web|browser|search|open_url|fetch/i,
    chatHint: '主人最近在做资料调研；主动关心一下是不是看了很多材料，并提醒偶尔让眼睛休息。',
    cgHint: '画面用星图般的线索、无字资料页与汇聚光点呼应资料调研',
  },
  {
    id: 'document-writing',
    label: '文档写作',
    strong: /readme|文档|报告|论文|提案|方案书|申请书|说明书|稿件|撰写|润色|改写|documentation|report|manuscript|proposal|文檔|報告|論文|方案書|申請書|說明書|撰寫|潤色|改寫|文件|企劃書|計畫書|手冊|潤稿|草稿/i,
    weak: /章节|段落|措辞|结构|标题|编辑|写|章節|措辭|結構|標題|編輯|寫|篇幅|用字|文句/i,
    tools: /document|docx|pdf|apply_patch/i,
    chatHint: '主人最近在写或修改文档；主动关心一下反复斟酌措辞是否辛苦，也可以肯定主人的认真。',
    cgHint: '画面用无字文稿、羽笔与被月光整理好的段落光带呼应文档写作',
  },
  {
    id: 'code-development',
    label: '代码开发',
    strong: /写代码|编程|开发|实现|重构|加功能|新功能|接口|前端|后端|组件|函数|类|typescript|javascript|python|react|vue|node|api\b|coding|implement|refactor|寫代碼|寫程式|編程|程式設計|開發|實現|實作|重構|後端|組件|元件|函數|函式|類別|串接/i,
    weak: /代码|程序|仓库|构建|依赖|插件|模型|服务|代碼|程式|倉庫|儲存庫|構建|建置|依賴|相依|套件|外掛|服務|專案|需求|介面/i,
    tools: /exec_command|write_stdin|apply_patch|terminal|shell|git|npm|pnpm/i,
    chatHint: '主人最近在写代码或搭建功能；主动提到主人又在和复杂逻辑打交道，并用角色自己的方式关心一下休息。',
    cgHint: '画面用有序的逻辑丝线、模块光块与完成的结构呼应代码开发，不出现真实代码',
  },
  {
    id: 'planning',
    label: '任务规划',
    strong: /计划|规划|路线图|roadmap|里程碑|拆分任务|排期|待办|todo|project\s+plan|計劃|計畫|規劃|路線圖|拆分任務|待辦|時程|排程|甘特圖/i,
    weak: /步骤|优先级|下一步|方案|安排|步驟|優先級|優先順序|期限|截止|分工|進度/i,
    chatHint: '主人最近在规划任务；主动关心一下是不是同时惦记着太多事情，并提醒可以一步一步来。',
    cgHint: '画面用有序星轨、路标光点与逐步点亮的路径呼应任务规划',
  },
]

function normalizePath(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() : ''
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function eventType(event: any): string {
  return String(event && (event.type || (event.data && event.data.type)) || '').toLowerCase()
}

function sourceKind(node: any): string {
  return String(
    (node && node.source && node.source.kind)
    || (node && node.message && node.message.source && node.message.source.kind)
    || (node && node.data && node.data.source && node.data.source.kind)
    || '',
  ).toLowerCase()
}

export function isExplicitHarnessUserEvent(event: any): boolean {
  if (!event || typeof event !== 'object') return false
  const type = eventType(event)
  const kind = sourceKind(event)
  return type === 'user/message' && kind === 'user'
}

export function extractHarnessText(node: any): string {
  if (!node) return ''
  if (typeof node === 'string') return node
  if (typeof node !== 'object') return ''
  if (typeof node.text === 'string' && node.text) return node.text
  if (typeof node.content === 'string' && node.content) return node.content
  if (Array.isArray(node.content)) {
    const parts: string[] = []
    for (const block of node.content) {
      if (block && typeof block === 'object') {
        const blockType = String(block.type || '').toLowerCase()
        if (blockType && blockType !== 'text' && blockType !== 'input_text') continue
      }
      const text = extractHarnessText(block)
      if (text) parts.push(text)
    }
    return parts.join(' ')
  }
  if (node.message) return extractHarnessText(node.message)
  if (node.data && typeof node.data !== 'function') return extractHarnessText(node.data)
  return ''
}

export function sanitizeActivityText(raw: string): string {
  const internal = /\b(the user is asking|assistant analysis|analysis channel|reasoning|tool call|tool output|exec_command|apply_patch|rg --files|function call)\b|(?:工具调用|工具输出|内部分析|推理过程|工具調用|工具輸出|內部分析|推理過程|工具呼叫|思考過程)/i
  return String(raw || '')
    .replace(/\x60{3}[\s\S]*?\x60{3}/g, ' ')
    .replace(/\x60[^\x60\r\n]*\x60/g, ' ')
    .split(/\r?\n/)
    .filter((line) => !internal.test(line))
    .join(' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b[A-Za-z]:[\\/][^\s，。；！？,;]+/g, ' ')
    .replace(/(?:^|\s)\/(?:[\w.-]+\/)+[\w.-]+/g, ' ')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+)\b/gi, ' ')
    .replace(/[#>*_~\[\]{}|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600)
}

function bucketFor(buckets: Map<string, TurnBucket>, sessionId: string, turnKey: string): TurnBucket {
  const existing = buckets.get(turnKey)
  if (existing) return existing
  const bucket: TurnBucket = {
    sessionId,
    turnKey,
    texts: [],
    tools: [],
    userSeq: -1,
    time: 0,
    status: 'active',
  }
  buckets.set(turnKey, bucket)
  return bucket
}

function statusFromReason(reason: any): ActivityStatus {
  const kind = String(reason && reason.kind || '').toLowerCase()
  if (kind === 'completed') return 'completed'
  if (kind === 'blocked' || kind === 'error' || kind === 'max-tokens') return 'blocked'
  if (kind === 'aborted' || kind === 'interrupted') return 'paused'
  return 'active'
}

function classifyActivity(texts: string[], tools: string[]): ActivityDefinition | null {
  const text = texts.join(' ').toLowerCase()
  if (!text.trim()) return null
  const toolText = tools.join(' ').toLowerCase()
  let best: ActivityDefinition | null = null
  let bestScore = 0
  for (const definition of ACTIVITY_DEFINITIONS) {
    const weakHit = !!(definition.weak && definition.weak.test(text))
    const toolHit = !!(definition.tools && definition.tools.test(toolText))
    const standaloneHit = !!(definition.standaloneStrong && definition.standaloneStrong.test(text))
    const contextualStrongHit = definition.strong.test(text)
      && (!definition.strongRequiresWeak || weakHit)
    const strongHit = standaloneHit || contextualStrongHit
    let score = strongHit ? 5 : 0
    if (!definition.requireStrongSignal || strongHit) {
      if (weakHit) score += 2
      if (toolHit) score += 1
    }
    if (score > bestScore) {
      best = definition
      bestScore = score
    }
  }
  return bestScore >= 3 ? best : null
}

export function collectHarnessActivities(sessions: any, workspaceRoot: string, now = Date.now()): HarnessActivity[] {
  if (!Array.isArray(sessions) || !workspaceRoot) return []
  const wantedRoot = normalizePath(workspaceRoot)
  const candidates: HarnessActivity[] = []

  sessions.forEach((session: any, sessionIndex: number) => {
    const header = session && session.header && typeof session.header === 'object' ? session.header : {}
    if (normalizePath(header.cwd) !== wantedRoot || header.origin === 'subagent') return
    const allEvents = session && Array.isArray(session.events) ? session.events : []
    const seedLength = Number.isSafeInteger(header.seedLength) && header.seedLength > 0
      ? Math.min(header.seedLength, allEvents.length)
      : 0
    const events = seedLength > 0 ? allEvents.slice(seedLength) : allEvents
    const sessionId = String(session && (session.id || header.id) || 'session-' + sessionIndex)
    const buckets = new Map<string, TurnBucket>()
    let activeTurn = 'unscoped'

    for (const event of events) {
      if (!event || typeof event !== 'object') continue
      const type = eventType(event)
      const data = event.data && typeof event.data === 'object' ? event.data : {}
      const turnValue = Number.isFinite(data.turn) ? String(data.turn) : activeTurn
      const time = Number.isFinite(event.time) ? Number(event.time) : Number(header.createdAt || 0)
      if (type === 'turn/start') {
        activeTurn = Number.isFinite(data.turn) ? String(data.turn) : 'turn-' + String(event.seq ?? events.indexOf(event))
        const bucket = bucketFor(buckets, sessionId, activeTurn)
        bucket.time = Math.max(bucket.time, time)
        continue
      }

      const bucket = bucketFor(buckets, sessionId, turnValue)
      bucket.time = Math.max(bucket.time, time)
      if (isExplicitHarnessUserEvent(event)) {
        const cleaned = sanitizeActivityText(extractHarnessText(event))
        if (cleaned.length > 2) {
          bucket.texts.push(cleaned)
          if (Number.isFinite(event.seq)) bucket.userSeq = Math.max(bucket.userSeq, Number(event.seq))
        }
      } else if (type === 'tool/call') {
        const name = typeof data.name === 'string' ? data.name.trim().slice(0, 160) : ''
        if (name) bucket.tools.push(name)
      } else if (type === 'turn/end') {
        bucket.status = statusFromReason(data.reason)
      }
    }

    for (const bucket of buckets.values()) {
      if (bucket.texts.length === 0 || bucket.time <= 0 || now - bucket.time > ACTIVITY_LOOKBACK_MS) continue
      const definition = classifyActivity(bucket.texts, bucket.tools)
      if (!definition) continue
      const fingerprintSource = [bucket.sessionId, bucket.turnKey, bucket.userSeq, definition.id].join('|')
      candidates.push({
        fingerprint: 'activity-' + stableHash(fingerprintSource),
        category: definition.id,
        label: definition.label,
        status: bucket.status,
        time: bucket.time,
        chatHint: definition.chatHint,
        cgHint: definition.cgHint,
      })
    }
  })

  candidates.sort((a, b) => b.time - a.time || a.fingerprint.localeCompare(b.fingerprint))
  const newestByCategory = new Map<ActivityCategory, HarnessActivity>()
  for (const candidate of candidates) {
    if (!newestByCategory.has(candidate.category)) newestByCategory.set(candidate.category, candidate)
  }
  return [...newestByCategory.values()].sort((a, b) => b.time - a.time).slice(0, 8)
}

export function normalizeActivityMemory(raw: any): ActivityMemory {
  const validSeen = raw && Array.isArray(raw.seen)
    ? raw.seen.filter((value: any) => typeof value === 'string' && /^activity-[a-z0-9]+$/i.test(value))
    : []
  const seen = [...new Set<string>(validSeen)].slice(-MAX_SEEN_ACTIVITIES)
  return {
    seen,
    lastMentionedAt: raw && Number.isFinite(raw.lastMentionedAt) && raw.lastMentionedAt > 0
      ? Math.floor(raw.lastMentionedAt)
      : 0,
  }
}

export function nextUnseenActivity(
  activities: readonly HarnessActivity[],
  memoryLike: any,
  now = Date.now(),
): HarnessActivity | null {
  const memory = normalizeActivityMemory(memoryLike)
  const seen = new Set(memory.seen)
  const candidate = activities.find((activity) => activity && !seen.has(activity.fingerprint)) || null
  if (!candidate) return null
  if (memory.lastMentionedAt > 0
    && now - memory.lastMentionedAt < ACTIVITY_MENTION_COOLDOWN_MS) return null
  return candidate
}

export function rememberActivity(memoryLike: any, activity: HarnessActivity, now = Date.now()): ActivityMemory {
  const memory = normalizeActivityMemory(memoryLike)
  const seen = memory.seen.filter((fingerprint) => fingerprint !== activity.fingerprint)
  seen.push(activity.fingerprint)
  return { seen: seen.slice(-MAX_SEEN_ACTIVITIES), lastMentionedAt: Math.max(0, Math.floor(now)) }
}

export function activitySystemInstruction(activity: HarnessActivity): string {
  const status = activity.status === 'completed'
    ? '这项工作最近已经告一段落'
    : activity.status === 'blocked'
      ? '这项工作最近遇到了一点阻碍'
      : activity.status === 'paused'
        ? '这项工作最近暂停了'
        : '这项工作最近仍在进行'
  return '\nHarness 近期任务事件：类别是「' + activity.label + '」，' + status + '。'
    + activity.chatHint
    + ' 本轮必须自然带到一次，但只占一句话的一小部分；先接住主人当前情绪，不要给工作方案。'
    + ' 不要声称看过具体文件、代码或对话，不要提及路径、文件名、密钥、工具调用或内部过程。'
}

export function activityCgTheme(activity: HarnessActivity): string {
  return '近期任务类别「' + activity.label + '」：' + activity.cgHint
}
