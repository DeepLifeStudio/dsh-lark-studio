/**
 * Turns conversational instructions into validated table changes or natural language explanations.
 * Supports full multi-turn conversation history and dynamic model routing.
 */

import { collectText, parsePlanText, withTimeout } from './planner.js'

const MAX_OPS = 8
const PLAN_TIMEOUT_MS = 45000

const OPS = new Set([
  'add_field', 'rename_field', 'add_options', 'remove_options', 'delete_field',
  'add_view', 'rename_view', 'delete_view',
  'add_records', 'update_records', 'delete_records',
  'rename_table', 'add_table',
  'enable_adv_perm', 'disable_adv_perm', 'create_role', 'update_role', 'delete_role',
  'set_field_ai_extension', 'trigger_field_ai',
  'set_view_visible_fields',
  'add_dashboard', 'add_form',
])

const ALLOWED_TYPES = new Set([
  'text', 'number', 'select', 'datetime', 'user', 'group_chat', 'checkbox',
  'attachment', 'location', 'auto_number', 'formula', 'link', 'lookup',
  'created_at', 'updated_at', 'created_by', 'updated_by', 'button',
])

const SYSTEM_PROMPT = `你是一个专业的飞书多维表格 AI 助手。用户会与你进行多轮对话，可能要求对表格结构、权限、高级设置或数据进行增删改，或者对当前表格数据内容、上一轮操作进行提问、分析和追问。
你的任务：只输出一个合法的 JSON 对象，不要输出 Markdown 代码块，不要输出多余解释。

输出 JSON 必须符合以下两种格式之一：

【格式一：修改表格（当用户明确要求对表格结构、权限、AI 插件、视图设置或数据记录进行改动时）】：
{
  "type": "ops",
  "reply": "用一句简短友好的人话告诉用户你改了什么（例如：已为您添加一列「负责人」或已开启高级权限并创建角色）",
  "ops": [
    // 具体的改动操作列表，见下方说明
  ]
}

【格式二：问答/数据查询/统计分析/权限说明/追问（当用户提问、查询数据、统计分析或闲聊时）】：
当用户提问（例如：“表里现在有哪些数据”、“有哪些任务未开始”、“权限是怎么设置的”、“刚刚加了什么”、“这张表现在有哪些列”等），绝对不要返回空 ops，而是输出：
{
  "type": "answer",
  "reply": "结合上下文提供的表格结构、字段定义以及当前表的前 50 条真实数据记录，直接进行计算、汇总、分析，用清晰自然、有条理的人话详细回答用户的疑问。"
}

可用的改动操作（用于 ops 数组）：
一、基础表格与视图结构操作：
1. 加一列（add_field）：
   {"op":"add_field","table":"表名","field":{"name":"列名","type":"text","description":"说明"}}
   支持字段类型：text（普通/phone/url/email）、number、select（options、multiple）、datetime、user（multiple）、formula（expression）、link（link_table）、lookup（from/select）、auto_number、attachment 等
2. 改列名（rename_field）：{"op":"rename_field","table":"表名","field":"旧列名","name":"新列名"}
3. 加选项（add_options）：{"op":"add_options","table":"表名","field":"状态","options":["已完成","已取消"]}
4. 删选项（remove_options）：{"op":"remove_options","table":"表名","field":"状态","options":["已废弃"]}
5. 删一列（delete_field）：{"op":"delete_field","table":"表名","field":"备注"}
6. 加视图（add_view）：{"op":"add_view","table":"表名","name":"状态看板","type":"kanban","group_by":"状态"}（类型：grid/kanban/gallery/calendar/gantt）
7. 改视图名（rename_view）：{"op":"rename_view","table":"表名","view":"旧视图名","name":"新视图名"}
8. 删视图（delete_view）：{"op":"delete_view","table":"表名","view":"视图名"}
9. 设置视图显隐列（set_view_visible_fields）：{"op":"set_view_visible_fields","table":"表名","view":"表格","visible_fields":["任务名称","状态","负责人"]}

二、数据记录批量增删改：
10. 批量加记录（add_records）：{"op":"add_records","table":"表名","records":[{"任务名称":"写周报","优先级":["高"]}]}
11. 批量改记录（update_records）：
    - 按条件改：{"op":"update_records","table":"表名","where":{"负责人":"张三"},"fields":{"优先级":["高"]}}
    - 按 ID 改：{"op":"update_records","table":"表名","records":[{"record_id":"recXXX","fields":{"状态":["已完成"]}}]}
12. 批量删记录（delete_records）：
    - 按条件删：{"op":"delete_records","table":"表名","where":{"状态":"已废弃"}}
    - 按 ID 删：{"op":"delete_records","table":"表名","record_ids":["recXXX"]}
13. 改表名（rename_table）：{"op":"rename_table","table":"旧表名","name":"新表名"}
14. 加新表（add_table）：{"op":"add_table","name":"新表名","fields":[{"name":"名称","type":"text"}]}

三、多维表格高级权限与安全设置：
15. 开启高级权限（enable_adv_perm）：{"op":"enable_adv_perm"}
16. 关闭高级权限（disable_adv_perm）：{"op":"disable_adv_perm"}
17. 创建自定义角色（create_role）：
    {"op":"create_role","role_name":"外包人员","table_perm":{"工作任务":"read_only"},"field_perm":{"底价":"no_perm"},"copy":false,"download":false}
18. 删除自定义角色（delete_role）：{"op":"delete_role","role_name":"外包人员"}

四、字段 AI 插件与高级设置：
19. 配置字段 AI 插件（set_field_ai_extension）：
    {"op":"set_field_ai_extension","table":"表名","field":"总结列名","prompt":"根据「需求描述」输出简短结论","ref_fields":["需求描述"]}
20. 触发整列 AI 计算回填（trigger_field_ai）：
    {"op":"trigger_field_ai","table":"表名","field":"总结列名"}
21. 创建统计仪表盘（add_dashboard）：{"op":"add_dashboard","name":"项目数据看板"}
22. 创建数据收集表单（add_form）：{"op":"add_form","table":"表名","name":"需求征集问卷"}

硬性规则：
1. 当用户询问数据内容、统计指标、权限情况时，绝对不要伪造 ops，务必使用 {"type":"answer", "reply":"..."} 亲切回答。
2. table 使用现状中的真实表名，只有一张表时可省略。
3. 一次最多 8 条改动。`

function clip(value, limit = 60) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ').slice(0, limit)
}

function list(value, limit = 30) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => (typeof entry === 'string' ? clip(entry, limit) : clip(entry && entry.name, limit)))
    .filter(Boolean)
}

function fieldDef(raw, where) {
  if (!raw || typeof raw !== 'object') return undefined
  const name = clip(raw.name, 40)
  const type = clip(raw.type, 20)
  if (!name || !type) return undefined
  if (!ALLOWED_TYPES.has(type)) return undefined

  const field = { name, type }

  if (type === 'select') {
    const options = [...new Set(list(raw.options))]
    if (options.length === 0) return undefined
    field.options = options.map((option) => ({ name: option }))
    field.multiple = raw.multiple === true
  }

  if (type === 'formula') {
    const expression = clip(raw.expression || raw.formula_expression || '', 300)
    if (expression) field.expression = expression
  }

  if (type === 'link') {
    if (raw.link_table) field.link_table = clip(raw.link_table, 60)
    if (raw.bidirectional != null) field.bidirectional = Boolean(raw.bidirectional)
    if (raw.bidirectional_link_field_name) field.bidirectional_link_field_name = clip(raw.bidirectional_link_field_name, 60)
  }

  if (type === 'lookup') {
    if (raw.from) field.from = clip(raw.from, 60)
    if (raw.select) field.select = clip(raw.select, 60)
    if (raw.where) field.where = clip(raw.where, 60)
    if (raw.aggregate) field.aggregate = clip(raw.aggregate, 40)
  }

  if (type === 'user' || type === 'group_chat') {
    if (raw.multiple != null) field.multiple = Boolean(raw.multiple)
  }

  if (typeof raw.style === 'object' && raw.style) field.style = raw.style
  const description = clip(raw.description, 100)
  if (description) field.description = description
  return field
}

function recordId(value) {
  return clip(value, 40)
}

function sanitizeWhere(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  if (Array.isArray(raw)) {
    const conditions = raw.map((entry) => {
      if (!entry || typeof entry !== 'object') return undefined
      const field = clip(entry.field ?? entry.column, 40)
      if (!field) return undefined
      const op = clip(entry.op, 40)
      return { field, value: entry.value, ...(op ? { op } : {}) }
    }).filter(Boolean)
    return conditions.length > 0 ? conditions : undefined
  }
  const pairs = Object.entries(raw)
    .map(([field, value]) => ({ field: clip(field, 40), value }))
    .filter((pair) => pair.field)
  return pairs.length > 0 ? pairs : undefined
}

export function sanitizeOps(raw, instruction = '', history = []) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, message: '模型返回格式不对，请换一种说法再试。' }
  }

  const replyText = String(
    raw.reply || raw.text || raw.message || raw.answer || raw.explanation || raw.content || raw.desc || ''
  ).trim()

  // Answer mode: conversational reply without table mutation
  if (raw.type === 'answer' || (!Array.isArray(raw.ops) && replyText)) {
    return {
      ok: true,
      type: 'answer',
      reply: replyText || '已为您查询完成。',
      ops: [],
    }
  }

  const entries = Array.isArray(raw.ops) ? raw.ops : (Array.isArray(raw) ? raw : undefined)

  // Empty ops
  if (entries && entries.length === 0) {
    if (replyText) {
      return { ok: true, type: 'answer', reply: replyText, ops: [] }
    }
    // Intelligent fallback for query questions like "总结", "加了什么", "刚才"
    const isQuery = /总结|加了什么|刚才|刚刚|是什么|有哪些|列出|说明|为什么/i.test(instruction)
    if (isQuery && Array.isArray(history) && history.length > 0) {
      const lastAiMsg = [...history].reverse().find((m) => m && (m.role === 'assistant' || m.role === 'model') && m.text)
      if (lastAiMsg) {
        return {
          ok: true,
          type: 'answer',
          reply: `回顾上一轮操作结果：\n${lastAiMsg.text}`,
          ops: [],
        }
      }
    }
    return { ok: false, message: '没听出要改哪里，可以说得具体一点，例如「再加一列负责人」。' }
  }

  if (!entries) {
    return { ok: false, message: '模型没有返回改动方案，换一种说法再试。' }
  }

  if (entries.length > MAX_OPS) {
    return { ok: false, message: `一次改太多了，最多 ${MAX_OPS} 处，分几次说吧。` }
  }

  const ops = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') return { ok: false, message: '模型返回的改动格式不对。' }
    const op = clip(entry.op, 40)
    if (!OPS.has(op)) return { ok: false, message: `模型想执行不支持的改动「${op || '空'}」。` }
    const table = clip(entry.table, 40)

    if (op === 'add_field') {
      const rawFields = Array.isArray(entry.fields) ? entry.fields : [entry.field]
      const fields = rawFields.map((field) => fieldDef(field, op)).filter(Boolean)
      if (fields.length === 0) return { ok: false, message: '模型给的列定义不完整。' }
      ops.push({ op, ...(table ? { table } : {}), fields })
      continue
    }

    if (op === 'add_table') {
      const name = clip(entry.name, 40)
      const fields = (Array.isArray(entry.fields) ? entry.fields : [])
        .map((field) => fieldDef(field, op)).filter(Boolean)
      if (!name) return { ok: false, message: '新表没有表名。' }
      ops.push({ op, name, fields })
      continue
    }

    if (op === 'rename_table') {
      const name = clip(entry.name, 40)
      if (!name) return { ok: false, message: '没有给出新表名。' }
      ops.push({ op, ...(table ? { table } : {}), name })
      continue
    }

    if (op === 'rename_field') {
      const field = clip(entry.field ?? entry.old_name ?? entry.from, 40)
      const name = clip(entry.name ?? entry.new_name ?? entry.to, 40)
      if (!field || !name) return { ok: false, message: '改列名需要旧名字和新名字。' }
      ops.push({ op, ...(table ? { table } : {}), field, name })
      continue
    }

    if (op === 'add_options' || op === 'remove_options') {
      const field = clip(entry.field ?? entry.column, 40)
      const options = list(entry.options)
      if (!field || options.length === 0) return { ok: false, message: '改选项需要列名和选项列表。' }
      ops.push({ op, ...(table ? { table } : {}), field, options })
      continue
    }

    if (op === 'delete_field') {
      const field = clip(entry.field ?? entry.column, 40)
      if (!field) return { ok: false, message: '没有指明要删哪一列。' }
      ops.push({ op, ...(table ? { table } : {}), field })
      continue
    }

    if (op === 'add_view') {
      const name = clip(entry.name, 40)
      const type = clip(entry.type, 20)
      const group_by = clip(entry.group_by ?? entry.groupBy, 40)
      if (!name || !['grid', 'kanban', 'gallery', 'calendar', 'gantt'].includes(type)) {
        return { ok: false, message: '加视图需要视图名和合法类型。' }
      }
      ops.push({ op, ...(table ? { table } : {}), name, type, ...(group_by ? { group_by } : {}) })
      continue
    }

    if (op === 'rename_view') {
      const view = clip(entry.view ?? entry.old_name, 40)
      const name = clip(entry.name ?? entry.new_name, 40)
      if (!view || !name) return { ok: false, message: '改视图名需要旧名和新名。' }
      ops.push({ op, ...(table ? { table } : {}), view, name })
      continue
    }

    if (op === 'delete_view') {
      const view = clip(entry.view ?? entry.name, 40)
      if (!view) return { ok: false, message: '没有指明要删哪个视图。' }
      ops.push({ op, ...(table ? { table } : {}), view })
      continue
    }

    if (op === 'add_records') {
      const rawRecords = Array.isArray(entry.records) ? entry.records : [entry.record]
      const records = rawRecords.filter((rec) => rec && typeof rec === 'object' && Object.keys(rec).length > 0)
      if (records.length === 0) return { ok: false, message: '加记录需要至少一条具体数据。' }
      ops.push({ op, ...(table ? { table } : {}), records })
      continue
    }

    if (op === 'update_records') {
      const fields = entry.fields && typeof entry.fields === 'object' ? entry.fields : undefined
      const where = sanitizeWhere(entry.where)
      const rawRecords = Array.isArray(entry.records) ? entry.records : []
      const records = rawRecords.map((item) => {
        if (!item || typeof item !== 'object') return undefined
        const id = recordId(item.record_id ?? item.recordId ?? item.id)
        if (!id || !item.fields || typeof item.fields !== 'object') return undefined
        return { record_id: id, fields: item.fields }
      }).filter(Boolean)

      if (where && fields) {
        ops.push({ op, ...(table ? { table } : {}), where, fields })
        continue
      }
      if (records.length > 0) {
        ops.push({ op, ...(table ? { table } : {}), records })
        continue
      }
      return { ok: false, message: '改记录需要指明改哪条（按条件或给 ID）以及改成什么。' }
    }

    if (op === 'delete_records') {
      const where = sanitizeWhere(entry.where)
      const ids = list(entry.record_ids ?? entry.records).map(recordId).filter(Boolean)
      if (where) {
        ops.push({ op, ...(table ? { table } : {}), where })
        continue
      }
      if (ids.length > 0) {
        ops.push({ op, ...(table ? { table } : {}), record_ids: ids })
        continue
      }
      return { ok: false, message: '删记录需要指明删哪条（按条件或给 ID）。' }
    }

    if (op === 'enable_adv_perm' || op === 'disable_adv_perm') {
      ops.push({ op })
      continue
    }

    if (op === 'create_role') {
      const role_name = clip(entry.role_name || entry.name, 40)
      if (!role_name) return { ok: false, message: '创建角色需要角色名称。' }
      ops.push({
        op,
        role_name,
        table_perm: entry.table_perm && typeof entry.table_perm === 'object' ? entry.table_perm : {},
        field_perm: entry.field_perm && typeof entry.field_perm === 'object' ? entry.field_perm : {},
        copy: entry.copy === true,
        download: entry.download === true,
      })
      continue
    }

    if (op === 'update_role') {
      const role_name = clip(entry.role_name || entry.name, 40)
      if (!role_name) return { ok: false, message: '更新角色需要角色名称。' }
      ops.push({
        op,
        role_name,
        ...(entry.table_perm ? { table_perm: entry.table_perm } : {}),
        ...(entry.field_perm ? { field_perm: entry.field_perm } : {}),
        ...(entry.copy != null ? { copy: Boolean(entry.copy) } : {}),
        ...(entry.download != null ? { download: Boolean(entry.download) } : {}),
      })
      continue
    }

    if (op === 'delete_role') {
      const role_name = clip(entry.role_name || entry.name || entry.role, 40)
      if (!role_name) return { ok: false, message: '删除角色需要角色名称。' }
      ops.push({ op, role_name })
      continue
    }

    if (op === 'set_field_ai_extension') {
      const field = clip(entry.field, 40)
      if (!field) return { ok: false, message: '配置字段 AI 需要指定列名。' }
      const prompt = clip(entry.prompt || entry.instruction, 300)
      const ref_fields = list(entry.ref_fields || entry.refs)
      ops.push({ op, ...(table ? { table } : {}), field, prompt, ref_fields })
      continue
    }

    if (op === 'trigger_field_ai') {
      const field = clip(entry.field, 40)
      if (!field) return { ok: false, message: '触发 AI 计算需要指定列名。' }
      ops.push({ op, ...(table ? { table } : {}), field })
      continue
    }

    if (op === 'set_view_visible_fields') {
      const view = clip(entry.view, 40)
      const visible_fields = list(entry.visible_fields || entry.fields)
      if (!view || visible_fields.length === 0) return { ok: false, message: '设置视图显隐列需要视图名和列列表。' }
      ops.push({ op, ...(table ? { table } : {}), view, visible_fields })
      continue
    }

    if (op === 'add_dashboard') {
      const name = clip(entry.name, 40)
      if (!name) return { ok: false, message: '创建仪表盘需要名称。' }
      ops.push({ op, name })
      continue
    }

    if (op === 'add_form') {
      const name = clip(entry.name, 40)
      if (!name) return { ok: false, message: '创建表单需要名称。' }
      ops.push({ op, ...(table ? { table } : {}), name })
      continue
    }
  }

  return {
    ok: true,
    type: 'ops',
    reply: typeof raw.reply === 'string' ? raw.reply.trim() : undefined,
    ops,
  }
}

export function createAdjustPlanner({ ctx, config = {} }) {
  function route(override = {}) {
    let selection
    try {
      selection = ctx.agentDefaultModel.currentSelection()
    } catch {
      selection = undefined
    }
    const provider = override.provider
      || config.provider
      || (selection && (selection.provider || selection.providerId))
      || 'deepseek-account'
    const model = override.model
      || config.model
      || (selection && (selection.model || selection.modelId))
      || 'deepseek-flash'
    return { provider, model }
  }

  function formatLiveRecords(live) {
    if (!live || !live.ok || !Array.isArray(live.rows) || live.rows.length === 0) {
      return '当前数据表暂无行记录（空表）。'
    }
    const fields = Array.isArray(live.fields) ? live.fields.map((f) => f.name) : []
    const formatted = live.rows.map((row, index) => {
      const id = (live.ids && live.ids[index]) || `row_${index + 1}`
      let bag = {}
      if (row && typeof row === 'object') {
        bag = row.fields && typeof row.fields === 'object' ? row.fields : row
      } else if (Array.isArray(row)) {
        fields.forEach((fName, i) => {
          bag[fName] = row[i]
        })
      }
      return { record_id: id, fields: bag }
    })
    return JSON.stringify(formatted, null, 2)
  }

  function context(schema, live) {
    const tables = (schema && Array.isArray(schema.tables) ? schema.tables : []).map((table) => ({
      name: table.name,
      fields: table.fields.map((field) => ({
        name: field.name,
        type: field.type,
        ...(Array.isArray(field.options) && field.options.length > 0 ? { options: field.options } : {}),
        ...(field.multiple ? { multiple: true } : {}),
      })),
      views: table.views.map((view) => ({ name: view.name, type: view.type })),
    }))

    let liveRecordsText = ''
    if (live && live.ok) {
      const rowCount = Array.isArray(live.rows) ? live.rows.length : 0
      const tableName = live.table || '当前活动表'
      liveRecordsText = `\n\n【表「${tableName}」当前前 50 条真实数据记录（共 ${rowCount} 条）】：\n${formatLiveRecords(live)}`
    }

    return `表格结构定义：\n${JSON.stringify({ tables }, null, 2)}${liveRecordsText}`
  }

  async function ask(messages, signal, temperature = 0.2, customRoute) {
    const { provider, model } = route(customRoute)
    return collectText(
      ctx.llm.stream({
        provider,
        model,
        system: SYSTEM_PROMPT,
        messages,
        temperature,
        maxTokens: 1500,
        signal,
      }),
    )
  }

  /**
   * Instruction + multi-turn history + current schema + live records -> validated operations or answer.
   */
  async function plan(input, schema, liveOrSignal, maybeSignal, timeoutMs = PLAN_TIMEOUT_MS) {
    let live = undefined
    let signal = undefined
    let actualTimeout = timeoutMs
    if (liveOrSignal && (liveOrSignal.aborted !== undefined || typeof liveOrSignal.addEventListener === 'function')) {
      signal = liveOrSignal
      actualTimeout = typeof maybeSignal === 'number' ? maybeSignal : timeoutMs
    } else {
      live = liveOrSignal
      signal = maybeSignal
    }

    const options = typeof input === 'string' ? { instruction: input } : (input || {})
    const instruction = clip(options.instruction || '', 500)
    const history = Array.isArray(options.history) ? options.history : []
    const customRoute = {
      model: options.model,
      provider: options.provider,
    }

    if (instruction.length < 1) {
      return { ok: false, message: '说一下想改哪里或想问什么，例如「再加一列负责人」或「刚刚加了什么」。' }
    }

    const { provider, model } = route(customRoute)
    const assistantSource = { kind: 'model', provider, model }

    // Build multi-turn messages
    const messages = []
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: `表格当前结构与真实数据状态：\n${context(schema, live)}` }],
    })
    messages.push({
      role: 'assistant',
      source: assistantSource,
      content: [{ type: 'text', text: '{"type":"answer","reply":"已掌握当前飞书表格结构与真实数据内容。请告诉我你的改动要求或疑问。"}' }],
    })

    // Inject history (up to last 10 turns)
    for (const msg of history.slice(-10)) {
      if (!msg || !msg.text) continue
      const isAssistant = msg.role === 'assistant' || msg.role === 'model'
      messages.push({
        role: isAssistant ? 'assistant' : 'user',
        ...(isAssistant ? { source: assistantSource } : {}),
        content: [{ type: 'text', text: clip(msg.text, 500) }],
      })
    }

    // Current turn
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: instruction }],
    })

    const guard = withTimeout(signal, timeoutMs)
    try {
      const replyRawText = await ask(messages, guard.signal, 0.2, customRoute)
      let raw = parsePlanText(replyRawText)
      if (!raw && replyRawText && replyRawText.trim() && !replyRawText.trim().startsWith('{')) {
        return {
          ok: true,
          type: 'answer',
          reply: replyRawText.trim(),
          ops: [],
        }
      }
      if (!raw) {
        const retryText = await ask(
          [
            ...messages,
            { role: 'user', content: [{ type: 'text', text: '上一次回复无法解析为 JSON。请只输出合法的 JSON 对象，不要输出任何代码块或多余文字。' }] },
          ],
          guard.signal,
          0,
          customRoute,
        )
        raw = parsePlanText(retryText)
        if (!raw && retryText && retryText.trim() && !retryText.trim().startsWith('{')) {
          return {
            ok: true,
            type: 'answer',
            reply: retryText.trim(),
            ops: [],
          }
        }
      }
      if (!raw) return { ok: false, message: '模型没有返回有效结果，请换一种说法再试。' }
      return sanitizeOps(raw, instruction, history)
    } catch (error) {
      if (guard.timedOut()) {
        return { ok: false, message: '想太久了，没出结果。再试一次，或者说得更短一点。' }
      }
      throw error
    } finally {
      guard.dispose()
    }
  }

  return { plan, route }
}
