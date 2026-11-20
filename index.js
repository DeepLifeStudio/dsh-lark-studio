/**
 * Lark Workbench — Host half.
 *
 * One sentence in, one Base out. The same two operations serve the agent tool
 * and the Workbench panel:
 *   plan(sentence)  -> a validated table blueprint
 *   build(plan)     -> a real Feishu Base with fields, views and sample rows
 */

import { createOperations, destructiveChanges } from './ops.js'
import { createAdjustPlanner } from './adjust-planner.js'
import { createPlanner, sanitizePlan } from './planner.js'

export const inject = ['tools', 'subprocess', 'webServer', 'llm', 'agentDefaultModel', 'commands', 'sessions']

const MAX_BODY_BYTES = 256 * 1024

/**
 * Validates request Host, Origin, and DSH Session identity for all incoming API calls.
 */
export function verifyApiSecurity(req, url, ctx) {
  // 1. Host Fence (DNS Rebinding Defense) on ALL methods
  const host = req.headers.host
  if (!host) {
    return { ok: false, status: 403, error: 'host header required' }
  }
  let expectedOrigin = undefined
  try {
    expectedOrigin = ctx?.webServer?.getOrigin?.()
  } catch {}
  const isLoopbackHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)
  if (!isLoopbackHost && expectedOrigin) {
    try {
      const expHost = new URL(expectedOrigin).host
      if (host !== expHost) {
        return { ok: false, status: 403, error: 'host not allowed' }
      }
    } catch {}
  }

  // 2. Cross-site fence
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    return { ok: false, status: 403, error: 'cross-site request forbidden' }
  }

  // 3. Origin check on ALL methods (GET, POST, etc.)
  const origin = req.headers.origin
  let isLocalOrigin = false
  if (origin) {
    if (expectedOrigin && origin === expectedOrigin) {
      isLocalOrigin = true
    } else {
      try {
        const oUrl = new URL(origin)
        if ((oUrl.hostname === 'localhost' || oUrl.hostname === '127.0.0.1') && (oUrl.host === host || isLoopbackHost)) {
          isLocalOrigin = true
        }
      } catch {}
    }
    if (!isLocalOrigin) {
      return { ok: false, status: 403, error: 'origin not allowed' }
    }
  } else {
    isLocalOrigin = isLoopbackHost
  }

  // 4. DSH Session Identity check on ALL methods and ALL routes.
  // Setup/status reads are not exempt: /state and /active expose the active
  // Feishu Base token and connection state, so every /dsh-lark/api route must
  // carry a DSH session identity (or the explicit desktop-workbench mode below).
  const sessionId = req.headers['x-dsh-session-id']
    || req.headers['x-session-id']
    || url.searchParams.get('sessionId')
    || url.searchParams.get('session_id')

  // Requests from the DSH desktop workbench UI on local loopback are authenticated
  if (sessionId === 'desktop-workbench' && isLoopbackHost && isLocalOrigin) {
    return { ok: true }
  }

  if (ctx?.sessions) {
    let sessionValid = false
    if (sessionId) {
      try {
        const session = typeof ctx.sessions.get === 'function' ? ctx.sessions.get(sessionId) : null
        if (session) {
          sessionValid = true
        } else if (typeof ctx.sessions.list === 'function') {
          const list = ctx.sessions.list() || []
          sessionValid = list.some((s) => s && s.id === sessionId)
        }
      } catch {}
    }
    if (!sessionValid) {
      return {
        ok: false,
        status: 401,
        error: 'DSH 会话鉴权失败：请求未提供有效的 DSH 会话身份 (x-dsh-session-id)，拒绝访问飞书工作台服务。',
      }
    }
  }

  return { ok: true }
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let received = 0
    const chunks = []
    req.on('data', (chunk) => {
      received += chunk.length
      if (received > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function readJsonBody(req) {
  const text = await readBody(req)
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

/** Turn a technical failure into the next thing the user should do. */
function failureHint(message) {
  const text = String(message ?? '')
  if (/auth|授权|登录|token/i.test(text)) {
    return '提示：飞书授权可能过期了。打开侧边栏「飞书工作台」，那里有重新授权的按钮；或在终端运行 lark-cli auth login。'
  }
  if (/找不到 lark-cli|没找到 lark-cli|lark-cli 不可用/i.test(text)) {
    return '提示：这台机器还没装连接飞书的小工具，装好后再试。'
  }
  return undefined
}

/** One shared answer to "why can't I create anything yet", from any entrance. */
function connectMessage(connection) {
  if (!connection || connection.stage === 'no-cli') {
    return [
      '还差一步：这台机器还没装连接飞书的小工具。',
      '在终端运行：npm i -g @larksuite/cli',
      '装好后回来说一声就行。',
    ].join('\n')
  }
  if (connection.stage === 'no-app') {
    return [
      '还差一步：还没让工具认识你的飞书。',
      '打开侧边栏「飞书工作台」，点「打开创建页面」，跟着提示点完（约 1 分钟）就配好了。',
    ].join('\n')
  }
  return [
    '还差一步：需要你在浏览器里点一次同意。',
    '打开侧边栏「飞书工作台」，点「去授权」，在打开的页面点同意就好。',
  ].join('\n')
}

function describe(result) {
  if (!result.ok) {
    const lines = [`没建成：${result.message}`]
    if (result.hint) lines.push(result.hint)
    const hint = failureHint(result.message)
    if (hint) lines.push(hint)
    if (result.raw) lines.push(`原始输出：${result.raw}`)
    return lines.join('\n')
  }
  const lines = [`建好了：${result.baseName}`]
  if (result.url) lines.push(result.url)
  for (const table of result.tables) {
    const bits = [`${table.fields} 个字段`]
    if (table.kanban) bits.push('看板视图')
    if (table.records) bits.push(`${table.records} 条示例数据`)
    lines.push(`- ${table.name}：${bits.join('，')}`)
  }
  lines.push('打开后：最上面几行是我放的示例，直接改成你自己的第一条就行；点空格能打字，表头最右边「+」加列，右上角「分享」拉人。')
  lines.push('以后想加列、改选项、换视图、加记录，直接在这个对话里说；也可以在「飞书工作台」里打开这张表继续改。')
  if (result.warnings && result.warnings.length > 0) {
    lines.push('需要注意：')
    for (const warning of result.warnings) lines.push(`- ${warning}`)
  }
  return lines.join('\n')
}

function describePlan(plan) {
  const tbl = plan.tables?.[0]
  const fields = tbl?.fields || []
  const records = tbl?.records || []
  const fieldNames = fields.map((f) => f.name)
  const headerRow = `| ${fieldNames.join(' | ')} |`
  const alignRow = `| ${fieldNames.map(() => '---').join(' | ')} |`
  const sampleRows = records
    .map((r) => `| ${fieldNames.map((fn) => (Array.isArray(r[fn]) ? r[fn].join(', ') : (r[fn] ?? '-'))).join(' | ')} |`)
    .join('\n')

  const lines = [
    `### 📋 多维表格结构规划：「${plan.baseName}」`,
    `> ${plan.intro || '已为您规划标准字段结构与示例数据'}`,
    ``,
    `**字段清单 (${fields.length} 列)**: ${fields.map((f) => `\`${f.name}\` (${f.type})`).join(' · ')}`,
    ...(tbl?.kanbanField ? [`**看板视图**: 按「${tbl.kanbanField}」泳道分栏`] : []),
    ``,
    headerRow,
    alignRow,
    sampleRows || `| ${fieldNames.map(() => '-').join(' | ')} |`,
    ``,
    `💡 **在下方原生输入框继续完成**：`,
    `- 需要微调？直接说：*“再加一列来源”*、*“把优先级改成高/中/低”*`,
    `- 确认无误？直接说：*“确认建表”*，我将直接在您的飞书空间生成此表！`,
  ]
  return lines.join('\n')
}

export function apply(ctx, config = {}) {
  let latestActive = null
  const planner = createPlanner({ ctx, config })
  const adjustPlanner = createAdjustPlanner({ ctx, config })
  const ops = createOperations({ ctx, config, planner })

  ctx.effect(() =>
    ctx.tools.register({
      name: 'lark_base_build',
      description:
        '用一句话直接创建一个真实的飞书多维表格：自动设计每一列、选项、看板视图，并写入示例数据。'
        + '当用户说「帮我建个客户管理表 / 项目跟踪 / 排期表 / 需求池 / 报销记录」时，把用户原话作为 sentence 传进来即可，'
        + '不要自己设计字段，也不要先读 lark-base 技能。'
        + '\n注意用户很可能不懂什么叫"多维表格"、也不知道该有哪些列。'
        + '如果他的描述太笼统（例如只说「我想建个表」），先用一句人话给他 3-4 个日常场景选项（记客户 / 记任务 / 记内容排期 / 记招聘）让他挑，再调用本工具；'
        + '不要一上来就要求他说字段。'
        + '\n建好后用一句话说清怎么用：点空格就能打字、表头右边「+」加列、右上角「分享」拉人。'
        + '\n建好后如果用户要继续改这张表（加列、改选项、换视图、加记录），用 lark_base_adjust，不要重建成新表。'
        + 'preview=true 时只返回表结构不创建，适合先给用户确认。',
      parameters: {
        type: 'object',
        properties: {
          sentence: {
            type: 'string',
            description: '用户原话（中文即可），一句话描述想要的表。原样传入，不要自己改写或补充字段清单。',
          },
          preview: {
            type: 'boolean',
            description: '只解析并返回表结构，不创建。默认 false。',
          },
          plan: {
            type: 'object',
            description: '上一次 preview 返回的 plan 对象。传入它可跳过重新解析，保证最终建出的结构与预览完全一致。',
          },
          name: {
            type: 'string',
            description: '自定义多维表格名称；省略则使用解析出的名字。',
          },
          kanban: {
            type: 'boolean',
            description: '是否为状态类字段创建看板视图。默认 true。',
          },
          sample: {
            type: 'boolean',
            description: '是否写入 2-3 条示例数据。默认 true。',
          },
        },
        required: ['sentence'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            preview: { type: 'boolean' },
            baseName: { type: 'string' },
            url: { type: 'string' },
            message: { type: 'string' },
          },
        },
        render(_args, value) {
          const text = value && typeof value === 'object' && typeof value.summary === 'string'
            ? value.summary
            : String(value)
          return [{ type: 'text', text }]
        },
      },
      timeoutMs: 180000,
      async execute(args, exec) {
        const options = (args && typeof args === 'object') ? args : {}

        let plan
        if (options.plan && typeof options.plan === 'object' && Array.isArray(options.plan.tables)) {
          const checked = sanitizePlan(options.plan)
          if (!checked.ok) throw new Error(checked.message)
          plan = checked.plan
        } else {
          const planned = await planner.plan(options.sentence, exec.signal)
          if (!planned.ok) throw new Error(planned.message)
          plan = planned.plan
        }

        if (options.preview === true) {
          latestActive = {
            preview: true,
            plan,
            name: plan.baseName,
            baseName: plan.baseName,
            summary: describePlan(plan),
            updatedAt: Date.now(),
          }
          return {
            ok: true,
            preview: true,
            baseName: plan.baseName,
            plan,
            summary: describePlan(plan),
          }
        }

        const result = await ops.build(
          plan,
          { name: options.name, kanban: options.kanban, sample: options.sample },
          exec.signal,
        )
        latestActive = {
          name: result.baseName ?? plan.baseName,
          baseName: result.baseName ?? plan.baseName,
          url: result.url,
          token: result.token,
          updatedAt: Date.now(),
        }
        return {
          ok: result.ok === true,
          preview: false,
          baseName: result.baseName ?? plan.baseName,
          url: result.url,
          token: result.token,
          tables: result.tables,
          warnings: result.warnings,
          summary: describe(result),
        }
      },
    }),
  )

  // The second half of the promise: a table is never finished after one shot.
  // Adjustments stay conversational — "再加一列" is a tool call, not a rebuild.
  ctx.effect(() =>
    ctx.tools.register({
      name: 'lark_base_adjust',
      description:
        '修改一张已经建好的飞书多维表格：加/改/删列、增删选项、加/改视图（看板等）、增删改记录、改表名、加表。'
        + '当用户对已经建好的表提出改动时使用，例如「再加一列负责人」「状态选项加个已取消」「按优先级做个看板」「把张三那条改成已完成」。'
        + '不要为了一个改动重新建一张表，也不要让用户自己去飞书里改。'
        + '\nbase 传创建时返回的表格链接或 token，也接受表名（搜索可能要等几秒）；table 可省略，表里只有一张表时自动使用。'
        + '\n优先把用户原话放进 instruction；已经明确要做什么时，也可以直接给结构化的 ops。'
        + '\n删除列、删除记录、删除视图、删除选项不可恢复：工具会先返回 needsConfirm，把要删的东西告诉用户，用户同意后再带 confirm=true 调一次。',
      parameters: {
        type: 'object',
        properties: {
          base: {
            type: 'string',
            description: '表格链接（https://…/base/…）、创建时返回的 token，或表名。',
          },
          table: {
            type: 'string',
            description: '默认操作哪张表；表里只有一张时可省略。',
          },
          instruction: {
            type: 'string',
            description: '用户原话（中文即可）：想怎么改。例如「再加一列负责人，状态选项加个已取消」。',
          },
          ops: {
            type: 'array',
            items: { type: 'object' },
            description: '结构化改动（可选）：给了 ops 就不再解析 instruction。',
          },
          confirm: {
            type: 'boolean',
            description: '删除类改动已经跟用户确认过时传 true；没传会用 needsConfirm 返回，不会动手。',
          },
        },
        required: ['base'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            baseName: { type: 'string' },
            url: { type: 'string' },
            summary: { type: 'string' },
          },
        },
        render(_args, value) {
          const text = value && typeof value === 'object' && typeof value.summary === 'string'
            ? value.summary
            : String(value)
          return [{ type: 'text', text }]
        },
      },
      timeoutMs: 120000,
      async execute(args, exec) {
        const options = (args && typeof args === 'object') ? args : {}
        const instruction = String(options.instruction ?? '').trim()
        let planned = Array.isArray(options.ops) && options.ops.length > 0 ? options.ops : undefined

        const base = await ops.resolveBase(options.base, exec.signal)
        if (!planned) {
          if (!instruction) throw new Error('说一下想怎么改，例如「再加一列负责人」。')
          const schema = await ops.readSchema(base.token, exec.signal)
          let liveRecords = await ops.peek(base.token, options.table || '', '50', exec.signal)
          if (!liveRecords.ok) liveRecords = await ops.peek(base.token, '', '50', exec.signal)
          const result = await adjustPlanner.plan(instruction, schema, liveRecords, exec.signal)
          if (!result.ok) throw new Error(result.message)
          planned = result.ops
        }

        const risky = destructiveChanges(planned)
        if (risky.length > 0 && options.confirm !== true) {
          return {
            ok: true,
            needsConfirm: true,
            destructive: risky,
            ops: planned,
            summary: [
              '这几处改了没法撤销：',
              ...risky.map((line) => `· ${line}`),
              '确认后我再动手。',
            ].join('\n'),
            hint: '用户确认后，带 confirm=true 再调用一次即可执行。',
          }
        }

        const adjusted = await ops.adjust(base.token, planned, { table: options.table }, exec.signal)
        latestActive = {
          name: adjusted.baseName,
          baseName: adjusted.baseName,
          url: adjusted.url,
          token: adjusted.token,
          summary: adjusted.summary,
          updatedAt: Date.now(),
        }
        return {
          ok: adjusted.ok,
          baseName: adjusted.baseName,
          url: adjusted.url,
          token: adjusted.token,
          results: adjusted.results,
          warnings: adjusted.warnings,
          summary: adjusted.summary,
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'lark_collab',
      description:
        '飞书全域协同助手：管理和查询飞书日历与会议日程、管理飞书待办任务、搜索飞书群聊、发送飞书消息、查阅与收发飞书邮件、检索企业通讯录同事、查询审批等。'
        + '\n当用户在原生对话中提出任何飞书日常协同需求时调用，例如：'
        + '「查一下我今天的日程安排与会议」「帮我查一下我的待办任务」「搜索项目群聊」「给张三发一条飞书消息」「查一下最新邮件」「搜索通讯录技术部同事」。',
      parameters: {
        type: 'object',
        properties: {
          instruction: {
            type: 'string',
            description: '用户的飞书协同指令，例如查今天日程、查看待办任务、搜索群聊、发消息等',
          },
        },
        required: ['instruction'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            reply: { type: 'string' },
            summary: { type: 'string' },
          },
        },
        render(_args, value) {
          const text = value && typeof value === 'object' && (value.reply || value.summary)
            ? (value.reply || value.summary)
            : String(value)
          return [{ type: 'text', text }]
        },
      },
      timeoutMs: 60000,
      async execute(args, exec) {
        const options = (args && typeof args === 'object') ? args : {}
        const instruction = String(options.instruction ?? '').trim()
        if (!instruction) throw new Error('请提供具体的飞书协同指令。')
        const result = await ops.dispatchCollab({
          instruction,
        }, exec.signal)
        if (!result.ok) {
          if (result.type === 'missing_scope') {
            const scopeNames = (result.requiredScopes || []).join('、')
            return {
              ok: false,
              summary: `⚠️ 缺少飞书「${result.domainTitle || '相关'}」权限。\n需要开通权限：${scopeNames}\n请在飞书开放平台开通：${result.consoleUrl}`,
              reply: `⚠️ 缺少飞书「${result.domainTitle || '相关'}」权限。\n需要开通权限：${scopeNames}\n请在飞书开放平台开通：${result.consoleUrl}`,
            }
          }
          throw new Error(result.error || result.message || '执行飞书协同操作失败')
        }
        return {
          ok: true,
          reply: result.reply,
          summary: result.reply,
          action: result.action,
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: '/dsh-lark/api',
      async handler(req, res) {
        // Preflight OPTIONS support
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.setHeader('access-control-allow-origin', req.headers.origin || '*')
          res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
          res.setHeader('access-control-allow-headers', 'content-type, x-dsh-session-id, x-session-id')
          res.end()
          return
        }

        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const route = url.pathname.replace(/^\/dsh-lark\/api/, '') || '/'

        // Complete Host, Origin & DSH Session Security Check on ALL methods
        const check = verifyApiSecurity(req, url, ctx)
        if (!check.ok) {
          sendJson(res, check.status, { ok: false, error: check.error })
          return
        }

        try {
          if (req.method === 'GET' && route === '/state') {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), 20000)
            try {
              const state = await ops.connectStatus(controller.signal)
              sendJson(res, 200, { ok: true, ...state, active: latestActive })
            } finally {
              clearTimeout(timer)
            }
            return
          }

          if (req.method === 'GET' && route === '/active') {
            sendJson(res, 200, { ok: true, active: latestActive })
            return
          }

          if (req.method === 'GET' && route === '/models') {
            let current = { provider: 'deepseek-account', model: 'deepseek-flash' }
            try {
              current = adjustPlanner.route()
            } catch {}

            const models = []
            const seen = new Set()

            function addModel(id, name, provider) {
              if (!id) return
              const key = `${provider}:${id}`
              if (seen.has(key)) return
              seen.add(key)
              models.push({
                id,
                name: name || id,
                provider,
              })
            }

            try {
              const providers = ctx.llm?.listProviders?.() || []
              for (const p of providers) {
                const providerId = p.id || p.provider || p
                try {
                  let list = []
                  if (typeof ctx.llm?.listModels === 'function') {
                    list = await ctx.llm.listModels(providerId)
                  } else {
                    const reg = ctx.llm?.adapters?.get?.(providerId)
                    if (reg?.adapter?.listModels) {
                      list = await reg.adapter.listModels(providerId)
                    }
                  }
                  if (Array.isArray(list)) {
                    for (const m of list) {
                      addModel(m.id, m.name, providerId)
                    }
                  }
                } catch (e) {
                  try {
                    const reg = ctx.llm?.adapters?.get?.(providerId)
                    if (reg?.adapter?.listModels) {
                      const list = await reg.adapter.listModels(providerId)
                      if (Array.isArray(list)) {
                        for (const m of list) {
                          addModel(m.id, m.name, providerId)
                        }
                      }
                    }
                  } catch {}
                }
              }
            } catch (err) {
              console.warn('[dsh-lark] Failed to query ctx.llm models:', err)
            }

            // Ensure current active model is included if not already found
            if (current.model && !seen.has(`${current.provider}:${current.model}`)) {
              addModel(current.model, current.model, current.provider)
            }

            sendJson(res, 200, { ok: true, current, models })
            return
          }

          if (req.method === 'GET' && route === '/records') {
            const result = await ops.peek(
              url.searchParams.get('token') || '',
              url.searchParams.get('table') || '',
              url.searchParams.get('limit') || '6',
              undefined,
            )
            sendJson(res, result.ok ? 200 : 422, result)
            return
          }

          if (req.method === 'POST' && route === '/connect/app/start') {
            const result = await ops.startAppInit(undefined)
            sendJson(res, result.ok ? 200 : 500, result)
            return
          }

          if (req.method === 'GET' && route === '/connect/app/poll') {
            const result = await ops.pollAppInit()
            sendJson(res, 200, result)
            return
          }

          if (req.method === 'POST' && route === '/connect/app/manual') {
            const body = await readJsonBody(req)
            const result = await ops.bindApp(body.appId, body.appSecret, undefined)
            sendJson(res, result.ok ? 200 : 422, result)
            return
          }

          if (req.method === 'POST' && route === '/connect/login/start') {
            const body = await readJsonBody(req).catch(() => ({}))
            const result = await ops.startLogin(undefined, body?.domain)
            sendJson(res, result.ok ? 200 : 500, result)
            return
          }

          if (req.method === 'POST' && route === '/connect/login/finish') {
            const body = await readJsonBody(req)
            const result = await ops.finishLogin(body.deviceCode, undefined)
            sendJson(res, result.ok ? 200 : 422, result)
            return
          }

          if (req.method === 'GET' && route === '/connect/login/state') {
            sendJson(res, 200, ops.exchangeState())
            return
          }

          if (req.method === 'POST' && route === '/connect/logout') {
            const result = await ops.logout(undefined)
            sendJson(res, result.ok ? 200 : 422, result)
            return
          }

          if (req.method === 'POST' && route === '/connect/unbind') {
            const result = await ops.unbindApp(undefined)
            sendJson(res, result.ok ? 200 : 422, result)
            return
          }

          if (req.method === 'GET' && route === '/connect/scopes') {
            const result = await ops.getScopes(undefined)
            sendJson(res, 200, result)
            return
          }

          if (req.method === 'POST' && route === '/plan') {
            const body = await readJsonBody(req)
            const planned = await planner.plan(body.sentence, undefined, undefined, {
              model: body.model,
              provider: body.provider,
            })
            sendJson(res, 200, planned)
            return
          }

          if (req.method === 'POST' && route === '/build') {
            const body = await readJsonBody(req)
            let plan = body.plan
            if (!plan || typeof plan !== 'object') {
              const planned = await planner.plan(body.sentence, undefined)
              if (!planned.ok) {
                sendJson(res, 422, planned)
                return
              }
              plan = planned.plan
            }
            const result = await ops.build(plan, {
              name: body.name,
              kanban: body.kanban,
              sample: body.sample,
            })
            sendJson(res, result.ok ? 200 : 500, result)
            return
          }

          // "再加一列" or natural questions from the panel: conversational in, Ops or Answer out.
          if (req.method === 'POST' && route === '/adjust') {
            const body = await readJsonBody(req)
            const token = String(body.token ?? '').trim()
            const instruction = String(body.instruction ?? '').trim()
            const isCollab = body.type === 'collab' || !token

            if (isCollab) {
              if (body.stream) {
                res.writeHead(200, {
                  'content-type': 'text/event-stream; charset=utf-8',
                  'cache-control': 'no-cache, no-transform',
                  'connection': 'keep-alive',
                })
                const onDelta = (event) => {
                  try {
                    res.write(`data: ${JSON.stringify(event)}\n\n`)
                  } catch {}
                }
                const collabRes = await ops.dispatchCollab({
                  instruction,
                  history: body.history,
                  model: body.model,
                  provider: body.provider,
                  onDelta,
                })
                try {
                  res.write(`data: ${JSON.stringify({ type: 'done', payload: collabRes })}\n\n`)
                  res.end()
                } catch {}
                return
              }

              const collabRes = await ops.dispatchCollab({
                instruction,
                history: body.history,
                model: body.model,
                provider: body.provider,
              })
              sendJson(res, 200, collabRes)
              return
            }

            let planned = Array.isArray(body.ops) && body.ops.length > 0 ? body.ops : undefined
            let aiReply = undefined
            if (!planned) {
              const schema = await ops.readSchema(token)
              let liveRecords = await ops.peek(token, body.table || '', '50')
              if (!liveRecords.ok) liveRecords = await ops.peek(token, '', '50')
              const result = await adjustPlanner.plan({
                instruction,
                history: body.history,
                model: body.model,
                provider: body.provider,
                table: body.table,
              }, schema, liveRecords)
              if (!result.ok) {
                sendJson(res, 422, result)
                return
              }
              // Answer/Query mode without table changes
              if (result.type === 'answer' || (!result.ops || result.ops.length === 0)) {
                sendJson(res, 200, {
                  ok: true,
                  type: 'answer',
                  summary: result.reply || '已为您查询完成。',
                  reply: result.reply || '已为您查询完成。',
                })
                return
              }
              planned = result.ops
              aiReply = result.reply
            }

            // Deleting a column or records is not undoable from here, so the
            // panel asks first and re-posts the exact same ops after a yes.
            const risky = destructiveChanges(planned)
            if (risky.length > 0 && body.confirm !== true) {
              sendJson(res, 200, {
                ok: true,
                needsConfirm: true,
                destructive: risky,
                ops: planned,
                summary: ['这几处改了没法撤销：', ...risky.map((line) => `· ${line}`)].join('\n'),
              })
              return
            }

            const adjusted = await ops.adjust(token, planned, { table: body.table })
            // The table may just have been renamed, so fall back to the base's
            // first table when the remembered name no longer resolves.
            let live = await ops.peek(token, body.table || '', '12')
            if (!live.ok) live = await ops.peek(token, '', '12')

            sendJson(res, 200, {
              ...adjusted,
              type: 'ops',
              planned,
              reply: aiReply,
              summary: aiReply ? `${aiReply}\n${adjusted.summary}` : adjusted.summary,
              live: live.ok
                ? { ok: true, fields: live.fields, rows: live.rows, more: live.more, table: live.table }
                : { ok: false, message: live.message },
            })
            return
          }

          sendJson(res, 404, { ok: false, error: 'unknown route' })
        } catch (error) {
          sendJson(res, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
    }),
  )

  // The most discoverable entrance: `/lark <一句话>` right in the composer.
  ctx.effect(() =>
    ctx.commands.register({
      name: 'lark',
      description: '一句话建张表：不用懂表格、不用想有哪些列，说完就有。',
      input: {
        hint: '你最想记的是什么事？例如：客户往来，谁在跟、谈到哪一步',
      },
      recordInput: true,
      async handler(invocation) {
        const sentence = String(invocation.rawInput ?? '').trim()
        if (sentence.length < 2) {
          return {
            kind: 'success',
            text: [
              '你想记点什么？挑一个说给我就行：',
              '· 客户和生意：谁在跟、谈到哪一步、下次什么时候联系',
              '· 工作任务：谁负责、什么时候交、做完没有',
              '· 内容排期：写什么、发哪里、什么时候发',
              '· 招聘进度：候选人面到第几轮、开多少',
              '· 花钱报销：花在哪、多少钱、报了没有',
              '',
              '用法：/lark 我想记一下客户往来，公司、联系人、谈到哪一步',
              '或者干脆用你自己的话，不用管格式。',
              '建好之后想改，直接说「在客户台账里加一列负责人」这类就行。',
            ].join('\n'),
          }
        }
        try {
          // Fail on the real blocker first, so a missing connection never looks
          // like a broken feature and never burns a model call.
          const connection = await ops.connectStatus(invocation.signal)
          if (connection.stage !== 'ready') {
            return { kind: 'error', text: connectMessage(connection) }
          }
          const planned = await planner.plan(sentence, invocation.signal)
          if (!planned.ok) return { kind: 'error', text: planned.message }
          const result = await ops.build(planned.plan, {}, invocation.signal)
          return { kind: result.ok ? 'success' : 'error', text: describe(result) }
        } catch (error) {
          return {
            kind: 'error',
            text: `没建成：${error instanceof Error ? error.message : String(error)}`,
          }
        }
      },
    }),
  )
}
