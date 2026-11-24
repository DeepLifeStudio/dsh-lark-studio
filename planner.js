/**
 * Turns one sentence into a Base blueprint.
 *
 * The model designs the schema; this module only constrains what it may say.
 * A model reply is untrusted input: everything is sanitized into the small,
 * documented subset of Base field definitions that `lark-cli base` accepts,
 * because an invalid field object fails the whole table creation.
 */

const MAX_TABLES = 4
const MAX_FIELDS = 15
const MAX_RECORDS = 20
const MAX_NAME = 60

const FIELD_TYPES = new Set(['text', 'number', 'select', 'datetime', 'user', 'checkbox'])
const TEXT_STYLES = new Set(['plain', 'url', 'phone', 'email', 'barcode'])
const DATE_FORMATS = new Set([
  'yyyy/MM/dd',
  'yyyy/MM/dd HH:mm',
  'yyyy-MM-dd',
  'yyyy-MM-dd HH:mm',
  'MM-dd',
  'MM/dd/yyyy',
  'dd/MM/yyyy',
])
const PROGRESS_COLORS = new Set([
  'Blue', 'Purple', 'DarkGreen', 'Green', 'Cyan', 'Orange', 'Red', 'Gray',
])

const SYSTEM_PROMPT = `你在帮一个用户设计飞书多维表格（Bitable Base）。

【重要意图判断】：
如果用户的输入明显不是想要创建、管理、跟踪或统计某类业务数据/表格（例如用户只是日常打招呼“你好”、致谢“谢谢”、询问日常问题“今天天气”、“现在几点”、提出办公查询“查日程/看邮件/搜群聊”等），绝对不要生搬硬套编造表格结构！
此时你必须且只能返回如下 JSON：
{
  "isTable": false,
  "reason": "非多维表格设计需求"
}

【建表需求响应】：
当用户明确描述了需要记录、管理、跟踪的事情（例如"我想记一下客户"、"帮我管管任务"、"想整理一下读书笔记"、"建一张项目进度表"）：
你的任务：只输出合法的 JSON，不要解释、不要 Markdown 代码块、不要问问题。

输出格式：
{
  "isTable": true,
  "baseName": "整个表的名字（用日常说法，例如「客户台账」）",
  "intro": "一句话告诉他这张表是干嘛用的，不要出现任何技术词",
  "tables": [
    {
      "name": "表名",
      "kanbanField": "用于看板分组的单选字段名（可选）",
      "fields": [
        {
          "type": "text",
          "name": "字段名",
          "description": "一句话解释这一列填什么，用大白话"
        }
      ],
      "records": [ { "字段名": "示例值" } ]
    }
  ]
}

字段 type 只能是这六种，其他配置按需追加：
- "text"：可加 "style": {"type": "plain"|"url"|"phone"|"email"}
- "number"：可加 "style": {"type":"plain","precision":0-4} 或 {"type":"currency","currency_code":"CNY","precision":2} 或 {"type":"progress","color":"Blue"}
- "select"：必须写 "options": [{"name":"选项"}]，可加 "multiple": false
- "datetime"：可加 "style": {"format": "yyyy-MM-dd"}
- "user"：人员字段
- "checkbox"：勾选字段

硬性要求：
1. 第一个字段是主字段，必须是 text，放这件事的名字。
2. 每张表 5 到 10 个字段，不要重名。
3. 字段名必须是规范的业务名词：2 到 6 个字，名词或名词短语，像真实公司表头那样，给同事看也不掉价。
   不要照抄他口语里的问法和动词短句，不加问号，不带「了/吗/呢/啊」，不出现「怎么/什么/哪/多少」。
   对照这个风格取名（必须遵循）：
     多少钱 → 预计金额        谈到哪一步 → 销售阶段      下次什么时候联系 → 下次跟进时间
     这次聊了什么 → 沟通记录    谁负责 → 跟进人          什么时候加的微信 → 建联日期
     有没有回复 → 客户反馈      能不能成 → 成交概率        哪天开始 → 开始日期
4. 每个字段都写 description。这段是给他看的引导，不是术语解释：一句话告诉他这一列该填什么、怎么填，必要时带一个具体提示。
   例："这个客户现在推进到哪一步了，选一个最接近的""下次约好什么时候联系，忘了就回来看一眼""谁负责跟这单，写名字就行"。
   字段名和选项要正式，description 可以口语、可以带"比如"，两者不要混。不要出现 type/字段/属性 这类技术词。
5. 状态、阶段、来源、优先级这类只能是几个固定选项的，一律用 select，并把选项写全（3 到 6 个）。
   选项也要用行业通用的说法，同一个字段里的选项风格要统一，例如「初步接洽 / 需求确认 / 方案报价 / 商务谈判 / 已成交 / 已流失」，
   不要写「刚认识」「谈细节」这种随口说法。
6. 如果某个 select 字段适合分栏展示（如状态、阶段），把它写进 kanbanField。
7. records 必须给 2 到 3 条：只写 text、select、number 三种字段的值；select 的值必须是该字段 options 里出现过的名字，且写成数组，例如 "状态": ["进行中"]。
   不要给 datetime、user、checkbox 写值。
   示例值要像真实公司的真实数据：公司名像公司名，人名像人名，金额是合理数字，一句话备注像真的备注过的话。
   不要占位符（"待定""test""示例A"），也不要太口语。
8. intro 不超过 40 个字，说明这张表帮他解决什么问题，例如"记录每个客户推进到哪一步，别忘了下次联系"。
9. 一张表能表达清楚就只给一张表；确实需要主子表关系时最多 4 张，且不要编造关联字段。
10. baseName 不超过 20 个字。`

const REFINE_SYSTEM_PROMPT = `你在帮用户微调一张已经设计好的飞书多维表格草稿（JSON）。

【第一原则：严格增量修改，禁止推倒重来】
你会收到「当前草稿 JSON」和用户的「本次修改意见」。
1. 如果用户的话是在表达满意、认可或确认（例如「不错」「挺好」「可以」「就这样」），没有提出具体修改要求，请只返回：
   {"action": "keep"}
   如果用户明确要求立刻创建/建表（例如「确认建表」「就按这个建吧」「开始生成」），请只返回：
   {"action": "build"}
2. 如果用户提出了局部修改（例如「加一列负责人」「去掉预计金额」「状态加上已流失」「把公司名称改成客户名称」）：
   - 必须**原封不动保留**未涉及的 baseName、intro、表名、kanbanField、所有未改动字段（名称、类型、选项、description 均保持一致）以及所有已有示例记录的值！
   - 严禁编造新的公司名/人名/金额去替换原有示例数据！
   - 若新增了一列（text/select/number 类型），只需在原有每条示例记录中补上这一新列的值，原有列的值一个字都不要改。
   - 若删除了一列，只删除该字段及示例记录中对应的 key。
   - 只有当用户明确要求「补充示例」「多加几条数据」或「换一批数据」时，才追加或替换示例记录（字段结构仍保持不变）。
3. 只输出合法的 JSON 对象，不要解释、不要 Markdown 代码块。修改时返回完整的表格 JSON（结构与当前草稿一致，包含 "isTable": true, "baseName", "intro", "tables"）。`

const PURE_BUILD_RE = /^(?:(?:不错|挺好(?:的)?|很好|可以(?:的)?|行(?:的)?|好的|没问题|就这样(?:吧)?|就这个(?:吧)?|满意)[，,\s]*)?(?:确认(?:并)?建表|确认创建|确认生成|确认|开始建表|直接建(?:表)?|建表吧?|建吧|创建吧|生成吧|就(?:按|用)这个建(?:表)?|帮我建(?:表)?吧?|confirm|create(?:\s+base)?|build(?:\s+it)?)[！!。.~～\s]*$/i
const PURE_KEEP_RE = /^(?:不错|挺好(?:的)?|很好|蛮好(?:的)?|好(?:的|呀|啊|滴)?|可以(?:的|呀|啊)?|行(?:的|呀|啊)?|没问题|就这样(?:吧)?|就这个(?:吧)?|很满意|满意|太棒了|棒|赞|ok|okay|nice|great|good|looks\s+good|lgtm)[！!。.~～\s]*$/i

function diffChangedFields(prevPlan, nextPlan) {
  const changed = []
  const prevTables = Array.isArray(prevPlan?.tables) ? prevPlan.tables : []
  const nextTables = Array.isArray(nextPlan?.tables) ? nextPlan.tables : []
  const prevByTable = new Map(prevTables.map((t) => [t.name, t]))
  for (let i = 0; i < nextTables.length; i++) {
    const nt = nextTables[i]
    const pt = prevByTable.get(nt.name) || prevTables[i]
    const prevFieldMap = new Map((pt?.fields || []).map((f) => [f.name, f]))
    for (const f of nt.fields || []) {
      const old = prevFieldMap.get(f.name)
      if (!old) {
        changed.push(f.name)
      } else {
        const oldOpts = (old.options || []).map((o) => o.name).join('|')
        const newOpts = (f.options || []).map((o) => o.name).join('|')
        if (old.type !== f.type || oldOpts !== newOpts || old.description !== f.description) {
          changed.push(f.name)
        }
      }
    }
  }
  return [...new Set(changed)]
}

function clip(value, limit = MAX_NAME) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ').slice(0, limit)
}

const PLAN_TIMEOUT_MS = 60000

/** A bounded signal: the caller's cancellation still wins, but silence does not. */
export function withTimeout(signal, ms) {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new Error('plan timeout'))
  }, ms)
  const forward = () => controller.abort(signal.reason)
  if (signal) {
    if (signal.aborted) forward()
    else signal.addEventListener('abort', forward, { once: true })
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', forward)
    },
  }
}

function sanitizeStyle(field) {
  const style = field.style
  if (!style || typeof style !== 'object') return undefined
  if (field.type === 'text') {
    return TEXT_STYLES.has(style.type) ? { type: style.type } : undefined
  }
  if (field.type === 'number') {
    if (style.type === 'currency') {
      const code = typeof style.currency_code === 'string' ? style.currency_code.toUpperCase() : ''
      if (!/^[A-Z]{3}$/.test(code)) return { type: 'plain', precision: 2 }
      const precision = Number.isInteger(style.precision) ? Math.min(Math.max(style.precision, 0), 4) : 2
      return { type: 'currency', currency_code: code, precision }
    }
    if (style.type === 'progress') {
      const color = PROGRESS_COLORS.has(style.color) ? style.color : 'Blue'
      return { type: 'progress', percentage: true, color }
    }
    const precision = Number.isInteger(style.precision) ? Math.min(Math.max(style.precision, 0), 4) : 2
    return { type: 'plain', precision }
  }
  if (field.type === 'datetime') {
    const format = DATE_FORMATS.has(style.format) ? style.format : 'yyyy-MM-dd'
    return { format }
  }
  return undefined
}

function sanitizeField(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const type = typeof raw.type === 'string' ? raw.type.trim() : ''
  if (!FIELD_TYPES.has(type)) return undefined
  const name = clip(raw.name, 40)
  if (!name) return undefined

  const field = { type, name }
  // Every Base field type accepts a description; it becomes the column tooltip,
  // which is what makes the finished table understandable without instructions.
  const description = clip(raw.description, 60)
  if (description) field.description = description

  if (type === 'select') {
    const options = Array.isArray(raw.options) ? raw.options : []
    const seen = new Set()
    const names = []
    for (const option of options) {
      const optionName = clip(typeof option === 'string' ? option : option && option.name, 30)
      if (!optionName || seen.has(optionName)) continue
      seen.add(optionName)
      names.push({ name: optionName })
      if (names.length >= 30) break
    }
    if (names.length < 2) return undefined
    field.options = names
    field.multiple = raw.multiple === true
    return field
  }

  if (type === 'user') {
    field.multiple = true
    return field
  }

  const style = sanitizeStyle({ type, style: raw.style })
  if (style) field.style = style
  return field
}

function sanitizeRecords(raw, fields) {
  if (!Array.isArray(raw)) return []
  const byName = new Map(fields.map((field) => [field.name, field]))
  const records = []
  for (const entry of raw.slice(0, MAX_RECORDS)) {
    if (!entry || typeof entry !== 'object') continue
    const record = {}
    for (const [key, value] of Object.entries(entry)) {
      const field = byName.get(key)
      if (!field) continue
      if (field.type === 'text' && typeof value === 'string') {
        record[key] = value.slice(0, 200)
      } else if (field.type === 'number' && typeof value === 'number' && Number.isFinite(value)) {
        record[key] = value
      } else if (field.type === 'select') {
        const allowed = new Set(field.options.map((option) => option.name))
        const values = (Array.isArray(value) ? value : [value])
          .filter((item) => typeof item === 'string' && allowed.has(item))
        if (values.length > 0) record[key] = field.multiple ? values : [values[0]]
      } else if (field.type === 'datetime' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(value)) {
        record[key] = value
      }
    }
    if (Object.keys(record).length > 0) records.push(record)
  }
  return records
}

/**
 * Constrain a model reply into a blueprint we can execute, or explain why it
 * is unusable. Returns `{ ok: true, plan }` or `{ ok: false, message }`.
 */
export function sanitizePlan(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, message: '模型没有返回 JSON 对象。' }
  if (raw.isTable === false) {
    return { ok: false, isNotTable: true, message: raw.reason || '该指令非多维表格设计需求' }
  }
  const rawTables = Array.isArray(raw.tables) ? raw.tables : []
  if (rawTables.length === 0) return { ok: false, message: '模型没有给出任何表。' }

  const tables = []
  const usedNames = new Set()
  for (const rawTable of rawTables.slice(0, MAX_TABLES)) {
    if (!rawTable || typeof rawTable !== 'object') continue
    let tableName = clip(rawTable.name, 30) || '表'
    while (usedNames.has(tableName)) tableName = `${tableName}2`
    usedNames.add(tableName)

    const fields = []
    const fieldNames = new Set()
    for (const rawField of Array.isArray(rawTable.fields) ? rawTable.fields : []) {
      if (fields.length >= MAX_FIELDS) break
      const field = sanitizeField(rawField)
      if (!field || fieldNames.has(field.name)) continue
      fieldNames.add(field.name)
      fields.push(field)
    }
    if (fields.length === 0) continue

    // The first field is the primary field and must be plain text.
    if (fields[0].type !== 'text') {
      const textish = fields.findIndex((field) => field.type === 'text')
      if (textish === -1) {
        fields.unshift({ type: 'text', name: '名称' })
      } else {
        const [promoted] = fields.splice(textish, 1)
        delete promoted.style
        fields.unshift(promoted)
      }
    }

    const selectNames = new Set(
      fields.filter((field) => field.type === 'select').map((field) => field.name),
    )
    const kanbanField = clip(rawTable.kanbanField, 40)
    tables.push({
      name: tableName,
      ...(selectNames.has(kanbanField) ? { kanbanField } : {}),
      fields,
      records: sanitizeRecords(rawTable.records, fields),
    })
  }

  if (tables.length === 0) return { ok: false, message: '模型给出的字段都不合法，没能组成一张表。' }
  return {
    ok: true,
    plan: {
      baseName: clip(raw.baseName, 20) || tables[0].name,
      intro: clip(raw.intro, 60),
      tables,
    },
  }
}

/** Pull the first JSON object out of a model reply (tolerates stray fences/prose). */
export function parsePlanText(text) {
  const trimmed = text.trim()
  const attempts = [trimmed]
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) attempts.push(fenced[1].trim())
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first !== -1 && last > first) attempts.push(trimmed.slice(first, last + 1))
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt)
    } catch {
      // try the next shape
    }
  }
  return undefined
}

export function collectText(stream, onDelta) {
  return (async () => {
    let text = ''
    let failure
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'reasoning-delta' || chunk.type === 'thinking-delta') {
        if (typeof onDelta === 'function') {
          onDelta({ type: 'reasoning', delta: chunk.text || chunk.delta || '' })
        }
      }
      else if (chunk.type === 'finish' && chunk.reason.kind === 'error') failure = chunk.reason.failure
      else if (chunk.type === 'finish' && chunk.reason.kind === 'aborted' && !text) {
        failure = chunk.reason.failure
      }
    }
    if (failure && !text) {
      throw new Error(failure.message || '模型调用失败')
    }
    return text
  })()
}

export function createPlanner({ ctx, config = {} }) {
  function route() {
    let selection
    try {
      selection = ctx.agentDefaultModel.currentSelection()
    } catch {
      selection = undefined
    }
    const provider = config.provider
      || (selection && (selection.provider || selection.providerId))
    const model = config.model
      || (selection && (selection.model || selection.modelId))
    if (!provider || !model) {
      throw new Error(
        '无法确定用于解析句子的模型。请在插件配置里设置 model 与 provider，或先在设置里选择默认模型。',
      )
    }
    return { provider, model }
  }

  async function ask(sentence, signal, opts = {}) {
    const routed = route()
    const provider = opts.provider || routed.provider
    const model = opts.model || routed.model
    const isRefine = Boolean(opts.currentPlan && typeof opts.currentPlan === 'object' && Array.isArray(opts.currentPlan.tables))
    const userPrompt = isRefine
      ? `当前多维表格草稿 JSON：\n${JSON.stringify(opts.currentPlan, null, 2)}\n\n用户的本次修改意见：${sentence}`
      : sentence
    const messages = [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }]
    const text = await collectText(
      ctx.llm.stream({
        provider,
        model,
        system: isRefine ? REFINE_SYSTEM_PROMPT : SYSTEM_PROMPT,
        messages,
        temperature: isRefine ? 0.1 : 0.2,
        maxTokens: 2000,
        signal,
      }),
      opts.onDelta,
    )
    return text
  }

  /**
   * Sentence -> validated blueprint. Supports both initial planning and
   * strict incremental refinement when `opts.currentPlan` is provided.
   *
   * The whole exchange is bounded: a model call that never settles would leave
   * the panel spinning forever with no way out.
   */
  async function plan(sentence, signal, timeoutMs = PLAN_TIMEOUT_MS, opts = {}) {
    const text = String(sentence ?? '').trim()
    const currentPlan = opts.currentPlan && typeof opts.currentPlan === 'object' && Array.isArray(opts.currentPlan.tables)
      ? opts.currentPlan
      : null

    if (currentPlan) {
      if (!text) return { ok: true, action: 'keep', plan: currentPlan, changedFields: [] }
      if (PURE_BUILD_RE.test(text)) {
        return { ok: true, action: 'build', plan: currentPlan, changedFields: [] }
      }
      if (PURE_KEEP_RE.test(text)) {
        return { ok: true, action: 'keep', plan: currentPlan, changedFields: [] }
      }
    }

    if (text.length < 2) {
      return { ok: false, message: '请先用一句话描述你想要的表，例如「客户管理，记录公司、联系人、阶段和下次联系时间」。' }
    }

    const guard = withTimeout(signal, timeoutMs)
    try {
      let raw = parsePlanText(await ask(text, guard.signal, opts))
      if (!raw) {
        const routed = route()
        const provider = opts.provider || routed.provider
        const model = opts.model || routed.model
        const retryPrompt = currentPlan
          ? `当前多维表格草稿 JSON：\n${JSON.stringify(currentPlan, null, 2)}\n\n用户的本次修改意见：${text}`
          : text
        const retry = await collectText(
          ctx.llm.stream({
            provider,
            model,
            system: currentPlan ? REFINE_SYSTEM_PROMPT : SYSTEM_PROMPT,
            messages: [
              { role: 'user', content: [{ type: 'text', text: retryPrompt }] },
              { role: 'user', content: [{ type: 'text', text: '上一次回复无法解析。请只输出一个 JSON 对象，不要任何其他文字。' }] },
            ],
            temperature: 0,
            maxTokens: 2000,
            signal: guard.signal,
          }),
          opts.onDelta,
        )
        raw = parsePlanText(retry)
      }
      if (!raw) return { ok: false, message: '模型没有返回可解析的表结构，请换一种说法再试。' }
      if (currentPlan && (raw.action === 'keep' || raw.action === 'build')) {
        return { ok: true, action: raw.action, plan: currentPlan, changedFields: [] }
      }
      const checked = sanitizePlan(raw)
      if (!checked.ok) return checked
      if (currentPlan) {
        return {
          ...checked,
          action: 'update',
          changedFields: diffChangedFields(currentPlan, checked.plan),
        }
      }
      return checked
    } catch (error) {
      if (guard.timedOut()) {
        return { ok: false, message: '想太久了，没出结果。再点一次试试，或者换一句更短的话。' }
      }
      throw error
    } finally {
      guard.dispose()
    }
  }

  return { plan, route }
}
