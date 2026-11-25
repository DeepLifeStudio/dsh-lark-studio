/**
 * Lark Workbench — Host half.
 *
 * One sentence in, one Base out. The same two operations serve the agent tool
 * and the Workbench panel:
 *   plan(sentence)  -> a validated table blueprint
 *   build(plan)     -> a real Feishu Base with fields, views and sample rows
 */

import z from '@deepseek-ai/schemastery'
import { createOperations, destructiveChanges } from './ops.js'
import { createAdjustPlanner } from './adjust-planner.js'
import { createPlanner, resolveLang, sanitizePlan } from './planner.js'

const PLUGIN_NAME = 'lark-workbench'
/** Lower priority than official @deepseek-ai/dsh-feishu (BUNDLED_SKILL_RANK = 600), so official feishu always wins when installed. */
const FEISHU_FALLBACK_SKILL_RANK = 700
const PROVIDER_NAME = 'dsh-lark-studio-feishu'

export const inject = ['tools', 'subprocess', 'llm', 'agentDefaultModel', 'commands', 'connection']

/** Declarative plugin configuration exposed in DSH Settings & Plugins pages. */
export const Config = z.object({
  larkCliPath: z.string().description('Custom lark-cli executable path / 自定义 lark-cli 可执行文件路径（留空则自动准备）'),
  binDir: z.string().description('Custom directory containing lark-cli / 自定义 lark-cli 所在目录（兼容官方飞书插件配置）'),
  identity: z.union(['auto', 'user', 'bot']).default('auto').description('Default Feishu API identity mode / 调用飞书 API 时的默认身份模式'),
  showInConversationTab: z.boolean().default(false).volatile().description('Show Lark Workbench tab in conversation header / 是否在对话顶部标签页显示飞书工作台'),
})

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
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
      '还差一步：飞书连接组件还在准备中。',
      '打开右侧边栏「飞书工作台」，会自动帮你下载并配置好，无需手动安装终端工具。',
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

function describe(result, lang = 'zh') {
  const isEn = resolveLang(lang) === 'en'
  if (!result.ok) {
    const lines = [isEn ? `Creation failed: ${result.message}` : `没建成：${result.message}`]
    if (result.hint) lines.push(result.hint)
    const hint = failureHint(result.message)
    if (hint) lines.push(hint)
    if (result.raw) lines.push(`${isEn ? 'Raw output' : '原始输出'}：${result.raw}`)
    return lines.join('\n')
  }
  const lines = [isEn ? `Created: ${result.baseName}` : `建好了：${result.baseName}`]
  if (result.url) lines.push(result.url)
  for (const table of result.tables) {
    const bits = [isEn ? `${table.fields} fields` : `${table.fields} 个字段`]
    if (table.kanban) bits.push(isEn ? 'Kanban view' : '看板视图')
    if (table.records) bits.push(isEn ? `${table.records} sample rows` : `${table.records} 条示例数据`)
    lines.push(`- ${table.name}: ${bits.join(isEn ? ', ' : '，')}`)
  }
  lines.push(
    isEn
      ? 'You can overwrite the sample rows with your first real record, click "+" on the right header to add columns, and use "Share" to invite teammates.'
      : '打开后：最上面几行是我放的示例，直接改成你自己的第一条就行；点空格能打字，表头最右边「+」加列，右上角「分享」拉人。',
  )
  lines.push(
    isEn
      ? 'To add columns, options, views, or records later, just ask here or open this table in Lark Workbench.'
      : '以后想加列、改选项、换视图、加记录，直接在这个对话里说；也可以在「飞书工作台」里打开这张表继续改。',
  )
  if (result.warnings && result.warnings.length > 0) {
    lines.push(isEn ? 'Notes:' : '需要注意：')
    for (const warning of result.warnings) lines.push(`- ${warning}`)
  }
  return lines.join('\n')
}

function describePlan(plan, lang = 'zh') {
  const isEn = resolveLang(lang) === 'en'
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
    isEn ? `### Base Blueprint: "${plan.baseName}"` : `### 多维表格结构规划：「${plan.baseName}」`,
    `> ${plan.intro || (isEn ? 'Standard fields and sample rows drafted' : '已为您规划标准字段结构与示例数据')}`,
    ``,
    isEn
      ? `**Fields (${fields.length})**: ${fields.map((f) => `\`${f.name}\` (${f.type})`).join(' · ')}`
      : `**字段清单 (${fields.length} 列)**: ${fields.map((f) => `\`${f.name}\` (${f.type})`).join(' · ')}`,
    ...(tbl?.kanbanField
      ? [isEn ? `**Kanban View**: grouped by "${tbl.kanbanField}"` : `**看板视图**: 按「${tbl.kanbanField}」泳道分栏`]
      : []),
    ``,
    headerRow,
    alignRow,
    sampleRows || `| ${fieldNames.map(() => '-').join(' | ')} |`,
    ``,
    ...(isEn
      ? [
          `**Next steps**:`,
          `- Want changes? Say e.g. *"Add a Source column"* or *"Change priority to P0/P1/P2"*`,
          `- Ready? Say *"Create Base"* to build it in your Feishu workspace.`,
        ]
      : [
          `**在下方输入框继续完成**：`,
          `- 需要微调？直接说：*“再加一列来源”*、*“把优先级改成高/中/低”*`,
          `- 确认无误？直接说：*“确认建表”*，我将直接在您的飞书空间生成此表！`,
        ]),
  ]
  return lines.join('\n')
}

const ACTIVE_STATE_DOMAIN = {
  name: 'dsh_lark_studio_state',
  version: 1,
  tables: {},
  global: {
    schema: {
      parse(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          throw new Error('Expected object for active workbench state')
        }
        return {
          name: typeof raw.name === 'string' ? raw.name : '',
          baseName: typeof raw.baseName === 'string' ? raw.baseName : '',
          url: typeof raw.url === 'string' ? raw.url : '',
          token: typeof raw.token === 'string' ? raw.token : '',
          updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
        }
      },
    },
    initial: { name: '', baseName: '', url: '', token: '', updatedAt: 0 },
  },
}

function firstJsonObjectSafe(text) {
  const raw = String(text ?? '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return undefined
  }
}

function buildCliAccountRegistration(ops) {
  const zh = {
    'section.title': '飞书工作台账号',
    'status.checking': '正在检查连接',
    'status.disconnected': '未连接',
    'status.unavailable': '暂时无法确认登录状态',
    'status.connected': '已连接',
    'step.downloading': '正在准备飞书连接组件',
    'step.configuring': '第 1 步：关联飞书应用',
    'step.authorizing': '第 2 步：登录飞书账号',
    'step.connecting': '正在连接',
    'step.signing-out': '正在退出登录',
    'detail.missing': '暂未完成飞书连接组件下载，请检查网络后重试。',
    'detail.no-app': '先关联一个飞书应用（可在打开的页面新建，或选用已有应用），再登录飞书账号。',
    'detail.signed-out': '已关联飞书应用，登录飞书账号后即可使用多维表格、日程、待办和消息协同。',
    'detail.unavailable': '已保留现有配置和登录，可以稍后重试。',
    'detail.connected': '已连接飞书，可在飞书工作台或对话中直接使用。',
    'detail.connectedAs': '已登录为 {name}，可在飞书工作台或对话中直接使用。',
    'detail.configuring': '在打开的飞书页面新建或选择应用，完成后回到这里。页面没打开时点击“打开飞书页面”。',
    'detail.authorizing': '在打开的飞书页面确认授权，完成后回到这里查看结果。页面没打开时点击“打开飞书页面”。',
    hint: '账号凭据安全保存在本机系统钥匙串中，与飞书工作台侧边栏自动同步。',
    'app.linked': '飞书应用：{id}',
    failed: '操作未完成，请重试',
    'action.connect': '连接飞书',
    'action.linkApp': '关联飞书应用',
    'action.signIn': '登录飞书账号',
    'action.open': '打开飞书页面',
    'action.cancel': '取消',
    'action.signOut': '退出登录',
    'action.retry': '重试',
    'badge.connected': '已连接',
    'badge.disconnected': '未连接',
    'badge.connecting': '连接中',
    'badge.unavailable': '待确认',
    'signOut.title': '退出飞书登录？',
    'signOut.body': '退出后需要重新扫码登录；已关联的飞书应用配置会保留。',
    'activation.title': '连接飞书工作台',
    'activation.body': '连接你的飞书账号后，即可生成多维表格并协同处理日程、待办、群聊和邮件。',
    'notice.app-linked': '飞书应用已关联，下一步请登录账号',
    'notice.connected': '飞书工作台已连接',
    'notice.signed-out': '已退出飞书登录',
  }

  const en = {
    'section.title': 'Lark Workbench account',
    'status.checking': 'Checking connection',
    'status.disconnected': 'Not connected',
    'status.unavailable': 'Cannot confirm sign-in right now',
    'status.connected': 'Connected',
    'step.downloading': 'Preparing Feishu component',
    'step.configuring': 'Step 1: Link a Feishu app',
    'step.authorizing': 'Step 2: Sign in to Feishu',
    'step.connecting': 'Connecting',
    'step.signing-out': 'Signing out',
    'detail.missing': 'Could not download the Feishu component. Check your network and retry.',
    'detail.no-app': 'Link a Feishu app first (create one or choose an existing app), then sign in to Feishu.',
    'detail.signed-out': 'Feishu app linked. Sign in to build Bases and run calendar, tasks, chat, and mail actions.',
    'detail.unavailable': 'Existing setup and login are preserved. Try again later.',
    'detail.connected': 'Connected to Feishu. Ready in Lark Workbench and chat.',
    'detail.connectedAs': 'Signed in as {name}. Ready in Lark Workbench and chat.',
    'detail.configuring': 'Create or select an app on the Feishu page, then return here. Click Open Feishu page if it did not open.',
    'detail.authorizing': 'Confirm authorization on the Feishu page, then return here. Click Open Feishu page if it did not open.',
    hint: 'Credentials stay in your system keychain and stay synced with the Lark Workbench sidebar.',
    'app.linked': 'Feishu app: {id}',
    failed: 'The action did not finish. Try again.',
    'action.connect': 'Connect Feishu',
    'action.linkApp': 'Link Feishu app',
    'action.signIn': 'Sign in to Feishu',
    'action.open': 'Open Feishu page',
    'action.cancel': 'Cancel',
    'action.signOut': 'Sign out',
    'action.retry': 'Retry',
    'badge.connected': 'Connected',
    'badge.disconnected': 'Not connected',
    'badge.connecting': 'Connecting',
    'badge.unavailable': 'Unconfirmed',
    'signOut.title': 'Sign out of Feishu?',
    'signOut.body': 'You will need to authorize again later. The linked Feishu app configuration is kept.',
    'activation.title': 'Connect Lark Workbench',
    'activation.body': 'Connect your Feishu account to generate Bases and manage calendar, tasks, chats, and mail.',
    'notice.app-linked': 'Feishu app linked. Sign in next.',
    'notice.connected': 'Lark Workbench connected',
    'notice.signed-out': 'Signed out of Feishu',
  }

  const URL_RE = /(https:\/\/[^\s"'<>]+)/
  const offerUrlFromLine = (control) => (_stream, line) => {
    const match = URL_RE.exec(String(line ?? ''))
    if (match) control.offer(match[1].replace(/[.,)]+$/, ''))
  }

  async function ensureCliForAccount(control, signal) {
    if (ops.resolveCliSync()) return
    control.stage('downloading')
    const installed = await ops.installCli(signal)
    if (!installed.ok) {
      control.publish({ state: 'not-installed' })
      throw new Error(installed.message || 'Feishu component installation failed')
    }
    control.stage('checking')
  }

  async function inspectAccount(control, signal) {
    await ensureCliForAccount(control, signal)
    const cfgRes = await control.run('config-show', ['config', 'show'], signal)
    const cfg = firstJsonObjectSafe(cfgRes.stdout)
    if (!cfg || !cfg.appId) {
      const next = { state: 'no-app' }
      control.publish(next)
      return next
    }
    const authRes = await control.run('auth-status', ['auth', 'status'], signal)
    const auth = firstJsonObjectSafe(authRes.stdout)
    if (authRes.exitCode !== 0 || !auth) {
      const next = { state: 'unverified', appId: cfg.appId }
      control.publish(next)
      return next
    }
    const userName = auth.userName || auth.user_name || auth.name
    const userReady = Boolean(auth.userReady ?? auth.user_ready ?? auth.authenticated ?? (auth.user && auth.user.ready))
    const next = userReady
      ? { state: 'connected', appId: cfg.appId, ...(userName ? { userName } : {}) }
      : { state: 'signed-out', appId: cfg.appId }
    control.publish(next)
    return next
  }

  return {
    name: PLUGIN_NAME,
    packageName: 'dsh-lark-studio',
    cli: {
      product: 'Feishu',
      program: 'lark-cli',
      executable: ops.resolveCliSync() || ops.getCanonicalBundledCliPath(),
      ready: () => Boolean(ops.resolveCliSync()),
    },
    account: { state: 'unchecked' },
    check: 'check',
    cancellable: ['downloading', 'configuring', 'authorizing'],
    authorizationHosts: ['feishu.cn', 'larksuite.com', 'open.feishu.cn', 'open.larksuite.com'],
    dictionaries: { zh, en },
    operations: (text) => [
      { kind: 'check' },
      { kind: 'link-app', notice: text('notice.app-linked') },
      { kind: 'sign-in', notice: text('notice.connected') },
      { kind: 'sign-out', notice: text('notice.signed-out') },
    ],
    copy: (text) => ({
      title: text('section.title'),
      hint: text('hint'),
      activation: {
        title: text('activation.title'),
        body: text('activation.body'),
        connect: text('action.connect'),
      },
    }),
    present: (view, text) => {
      const { account, operation, result } = view
      if (operation?.kind === 'check') {
        const key = operation.phase === 'downloading' ? 'step.downloading' : 'status.checking'
        return {
          phase: 'checking',
          status: text(key),
          buttons: operation.cancellable ? [{ label: text('action.cancel'), command: { kind: 'cancel' }, variant: 'ghost' }] : [],
          notes: [],
        }
      }
      if (operation) {
        const opKey = operation.kind === 'sign-out'
          ? 'step.signing-out'
          : operation.phase === 'configuring'
            ? 'step.configuring'
            : operation.phase === 'authorizing'
              ? 'step.authorizing'
              : 'step.connecting'
        const buttons = []
        if ((operation.phase === 'configuring' || operation.phase === 'authorizing') && operation.authorizationUrl) {
          buttons.push({ label: text('action.open'), command: { kind: 'open' }, variant: 'primary' })
        }
        if (operation.cancellable) {
          buttons.push({ label: text('action.cancel'), command: { kind: 'cancel' }, variant: 'ghost' })
        }
        return {
          phase: 'connecting',
          status: text(opKey),
          badge: text('badge.connecting'),
          buttons,
          notes: [],
          ...(operation.authorizationUrl ? { detail: text(operation.phase === 'configuring' ? 'detail.configuring' : 'detail.authorizing') } : {}),
        }
      }
      const failed = result?.outcome === 'failed' ? { failure: { text: text('failed') } } : {}
      const appNotes = account.appId ? [text('app.linked', { id: account.appId })] : []
      if (account.state === 'not-installed' || account.state === 'unverified') {
        return {
          phase: 'unavailable',
          status: text('status.unavailable'),
          badge: text('badge.unavailable'),
          buttons: [{ label: text('action.retry'), command: { kind: 'start', operation: 'check' } }],
          detail: text(account.state === 'not-installed' ? 'detail.missing' : 'detail.unavailable'),
          notes: appNotes,
          ...failed,
        }
      }
      if (account.state === 'no-app') {
        return {
          phase: 'disconnected',
          status: text('status.disconnected'),
          badge: text('badge.disconnected'),
          buttons: [{ label: text('action.linkApp'), command: { kind: 'start', operation: 'link-app' }, variant: 'primary' }],
          connect: { kind: 'start', operation: 'link-app' },
          detail: text('detail.no-app'),
          notes: [],
          ...failed,
        }
      }
      if (account.state === 'signed-out') {
        return {
          phase: 'disconnected',
          status: text('status.disconnected'),
          badge: text('badge.disconnected'),
          buttons: [
            { label: text('action.signIn'), command: { kind: 'start', operation: 'sign-in' }, variant: 'primary' },
            { label: text('action.linkApp'), command: { kind: 'start', operation: 'link-app' } },
          ],
          connect: { kind: 'start', operation: 'sign-in' },
          detail: text('detail.signed-out'),
          notes: appNotes,
          ...failed,
        }
      }
      if (account.state === 'connected') {
        return {
          phase: 'connected',
          status: text('status.connected'),
          badge: text('badge.connected'),
          buttons: [{
            label: text('action.signOut'),
            command: { kind: 'start', operation: 'sign-out' },
            confirm: { title: text('signOut.title'), body: text('signOut.body'), label: text('action.signOut') },
          }],
          detail: account.userName ? text('detail.connectedAs', { name: account.userName }) : text('detail.connected'),
          notes: appNotes,
          ...failed,
        }
      }
      return { phase: 'checking', status: text('status.checking'), buttons: [], notes: [] }
    },
    perform: async (kind, control, signal) => {
      if (kind === 'check') {
        await inspectAccount(control, signal)
        return
      }
      if (kind === 'link-app') {
        await ensureCliForAccount(control, signal)
        control.stage('configuring')
        const res = await control.run('config-init', ['config', 'init', '--new', '--brand', 'feishu'], signal, {
          awaitsUser: true,
          onLine: offerUrlFromLine(control),
        })
        if (res.exitCode !== 0) throw new Error(`config init exited ${res.exitCode}`)
        control.stage('checking')
        await inspectAccount(control, signal)
        return
      }
      if (kind === 'sign-in') {
        await ensureCliForAccount(control, signal)
        control.stage('authorizing')
        const res = await control.run('auth-login', ['auth', 'login', '--recommend'], signal, {
          awaitsUser: true,
          onLine: offerUrlFromLine(control),
        })
        if (res.exitCode !== 0) throw new Error(`auth login exited ${res.exitCode}`)
        control.stage('checking')
        await inspectAccount(control, signal)
        return
      }
      if (kind === 'sign-out') {
        control.stage('signing-out')
        const res = await control.run('auth-logout', ['auth', 'logout'], signal)
        if (res.exitCode !== 0) throw new Error(`auth logout exited ${res.exitCode}`)
        control.stage('checking')
        await inspectAccount(control, signal)
      }
    },
  }
}

function buildFallbackFeishuContent(ops, cliPath, catalog) {
  const guideLines = catalog.length > 0
    ? catalog.map((s) => `- \`${s.name}\`: ${s.description}`)
    : [
        '- `lark-base`: Feishu Base (bitable): tables, fields, records, views, formulas, and roles.',
        '- `lark-calendar`: Feishu Calendar: events, attendees, free/busy, and meeting rooms.',
        '- `lark-task`: Feishu Tasks: create and update tasks, subtasks, and lists.',
        '- `lark-im`: Feishu Messenger: send/reply messages and search chats.',
        '- `lark-mail`: Feishu Mail: draft, send, read, and search mail.',
        '- `lark-doc` / `lark-wiki` / `lark-drive`: Feishu Docs, Wiki spaces, and Drive files.',
      ]
  const cliNote = cliPath
    ? `Run the active \`lark-cli\` binary at \`${cliPath}\` (automatically managed and version-synced).`
    : 'Run `lark-cli` via Host Shell once auto-setup completes inside Lark Workbench.'

  return [
    '# Feishu in DSH',
    '',
    cliNote,
    'Never instruct end users to manually install Node.js, npm, or `@larksuite/cli`; direct them to the Lark Workbench sidebar or Plugins page if not yet connected.',
    'Do not install another `lark-cli` or run `lark-cli update`.',
    '',
    'For natural-language Feishu Base creation with live preview, safe destructive adjustment confirmation, or quick sidebar collaboration, prefer the structured tools `lark_base_build`, `lark_base_adjust`, and `lark_collab`.',
    '',
    '## Built-in `lark-cli` Domain Guides',
    '',
    ...guideLines,
    '',
    '## Opening a Guide',
    '',
    'These guides live inside the `lark-cli` binary (read dynamically so you always see the latest version): open any guide with `lark-cli skills read <name>`.',
  ].join('\n')
}

export function apply(ctx, config = {}) {
  let latestActive = null
  let activeDomain = null
  let cliAccountHandle = null
  let skillsHostRef = null
  let skillControlRef = null
  const setLatestActive = (next) => {
    latestActive = next
    if (activeDomain && next && !next.preview && next.url) {
      activeDomain.global.set({
        name: String(next.name ?? next.baseName ?? ''),
        baseName: String(next.baseName ?? next.name ?? ''),
        url: String(next.url ?? ''),
        token: String(next.token ?? ''),
        updatedAt: typeof next.updatedAt === 'number' ? next.updatedAt : Date.now(),
      }).catch(() => {})
    }
  }
  const planner = createPlanner({ ctx, config })
  const adjustPlanner = createAdjustPlanner({ ctx, config })
  const ops = createOperations({
    ctx,
    config: {
      ...config,
      getHostFeishuSkill: () => (skillsHostRef && typeof skillsHostRef.get === 'function' ? skillsHostRef.get('feishu') : null),
      onCliReady: () => {
        try { ops.invalidateOfficialSkillsCache() } catch {}
        try { cliAccountHandle?.refresh?.() } catch {}
        try { skillControlRef?.invalidate?.() } catch {}
      },
    },
    planner,
  })

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
        const lang = resolveLang(options.lang, options.sentence || options.name || '')

        let plan
        if (options.plan && typeof options.plan === 'object' && Array.isArray(options.plan.tables)) {
          const checked = sanitizePlan(options.plan, lang)
          if (!checked.ok) throw new Error(checked.message)
          plan = checked.plan
        } else {
          const planned = await planner.plan(options.sentence, exec.signal, undefined, { lang })
          if (!planned.ok) throw new Error(planned.message)
          plan = planned.plan
        }

        if (options.preview === true) {
          setLatestActive({
            preview: true,
            plan,
            name: plan.baseName,
            baseName: plan.baseName,
            summary: describePlan(plan, lang),
            updatedAt: Date.now(),
          })
          return {
            ok: true,
            preview: true,
            baseName: plan.baseName,
            plan,
            summary: describePlan(plan, lang),
          }
        }

        const result = await ops.build(
          plan,
          { name: options.name, kanban: options.kanban, sample: options.sample },
          exec.signal,
        )
        setLatestActive({
          name: result.baseName ?? plan.baseName,
          baseName: result.baseName ?? plan.baseName,
          url: result.url,
          token: result.token,
          updatedAt: Date.now(),
        })
        return {
          ok: result.ok === true,
          preview: false,
          baseName: result.baseName ?? plan.baseName,
          url: result.url,
          token: result.token,
          tables: result.tables,
          warnings: result.warnings,
          summary: describe(result, lang),
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
        const lang = resolveLang(options.lang, instruction)
        const isEn = lang === 'en'
        let planned = Array.isArray(options.ops) && options.ops.length > 0 ? options.ops : undefined

        const base = await ops.resolveBase(options.base, exec.signal)
        if (!planned) {
          if (!instruction) throw new Error(isEn ? 'Describe what to change, e.g. "Add an Owner column".' : '说一下想怎么改，例如「再加一列负责人」。')
          const schema = await ops.readSchema(base.token, exec.signal)
          let liveRecords = await ops.peek(base.token, options.table || '', '50', exec.signal)
          if (!liveRecords.ok) liveRecords = await ops.peek(base.token, '', '50', exec.signal)
          const result = await adjustPlanner.plan({ instruction, lang }, schema, liveRecords, exec.signal)
          if (!result.ok) throw new Error(result.message)
          planned = result.ops
        }

        const risky = destructiveChanges(planned, lang)
        if (risky.length > 0 && options.confirm !== true) {
          return {
            ok: true,
            needsConfirm: true,
            destructive: risky,
            ops: planned,
            summary: isEn
              ? ['These changes cannot be undone:', ...risky.map((line) => `· ${line}`), 'Confirm before proceeding.'].join('\n')
              : ['这几处改了没法撤销：', ...risky.map((line) => `· ${line}`), '确认后我再动手。'].join('\n'),
            hint: isEn
              ? 'Once the user confirms, call this tool again with confirm=true.'
              : '用户确认后，带 confirm=true 再调用一次即可执行。',
          }
        }

        const adjusted = await ops.adjust(base.token, planned, { table: options.table, lang }, exec.signal)
        setLatestActive({
          name: adjusted.baseName,
          baseName: adjusted.baseName,
          url: adjusted.url,
          token: adjusted.token,
          summary: adjusted.summary,
          updatedAt: Date.now(),
        })
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
        const lang = resolveLang(options.lang, instruction)
        const isEn = lang === 'en'
        if (!instruction) throw new Error(isEn ? 'Please provide a Feishu request.' : '请提供具体的飞书协同指令。')
        const result = await ops.dispatchCollab({
          instruction,
          lang,
        }, exec.signal)
        if (!result.ok) {
          if (result.type === 'missing_scope') {
            const scopeNames = (result.requiredScopes || []).join(isEn ? ', ' : '、')
            const msg = isEn
              ? `Missing Feishu "${result.domainTitle || 'required'}" permissions.\nRequired scopes: ${scopeNames}\nAuthorize in Feishu Open Platform: ${result.consoleUrl}`
              : `缺少飞书「${result.domainTitle || '相关'}」权限。\n需要开通权限：${scopeNames}\n请在飞书开放平台开通：${result.consoleUrl}`
            return {
              ok: false,
              summary: msg,
              reply: msg,
            }
          }
          throw new Error(result.error || result.message || (isEn ? 'Feishu action failed' : '执行飞书协同操作失败'))
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

  // ── DSH Connection Fetch Routes ───────────────────────────────────────────
  // Registers all Lark Workbench endpoints with DSH's native Connection service.
  // When clients address 'api/dsh-lark/*', DSH Connection enforces native caller
  // peer authentication and Host/Origin boundary defense before dispatch.
  const connection = Reflect.get(ctx, 'connection') || ctx.connection
  if (connection && connection.fetch && typeof connection.fetch.register === 'function') {
    const connectionRoutes = [
      { path: '/api/dsh-lark/state', methods: ['GET'], requestBody: 'buffered' },
      { path: '/api/dsh-lark/models', methods: ['GET'], requestBody: 'buffered' },
      { path: '/api/dsh-lark/active', methods: ['GET'], requestBody: 'buffered' },
      { path: '/api/dsh-lark/records', methods: ['GET'], requestBody: 'buffered' },
      { path: '/api/dsh-lark/plan', methods: ['POST'], requestBody: 'buffered' },
      { path: '/api/dsh-lark/build', methods: ['POST'], requestBody: 'buffered' },
      { path: '/api/dsh-lark/adjust', methods: ['POST'], requestBody: 'buffered' },
      { path: '/api/dsh-lark/connect/scopes', methods: ['GET'], requestBody: 'buffered' },
      { path: '/api/dsh-lark/connect/cli/install', methods: ['POST'], requestBody: 'buffered' },
      { path: '/api/dsh-lark/connect/cli/state', methods: ['GET'], requestBody: 'buffered' },
      { path: '/api/dsh-lark/connect/app/start', methods: ['POST'], requestBody: 'buffered' },
      { path: '/api/dsh-lark/connect/app/poll', methods: ['GET'], requestBody: 'buffered' },
      { path: '/api/dsh-lark/connect/app/manual', methods: ['POST'], requestBody: 'buffered' },
      { path: '/api/dsh-lark/connect/login/start', methods: ['POST'], requestBody: 'buffered' },
      { path: '/api/dsh-lark/connect/login/finish', methods: ['POST'], requestBody: 'buffered' },
      { path: '/api/dsh-lark/connect/login/state', methods: ['GET'], requestBody: 'buffered' },
      { path: '/api/dsh-lark/connect/logout', methods: ['POST'], requestBody: 'buffered' },
      { path: '/api/dsh-lark/connect/unbind', methods: ['POST'], requestBody: 'buffered' },
    ]

    for (const r of connectionRoutes) {
      ctx.effect(() =>
        connection.fetch.register({
          path: r.path,
          methods: r.methods,
          requestBody: r.requestBody,
          fetch: async (request) => {
            const url = new URL(request.url, 'http://127.0.0.1')
            const route = url.pathname.replace(/^\/api\/dsh-lark/, '') || '/'
            const method = request.method

            try {
              if (method === 'GET' && route === '/state') {
                const controller = new AbortController()
                const timer = setTimeout(() => controller.abort(), 20000)
                try {
                  const state = await ops.connectStatus(controller.signal)
                  return jsonResponse(200, { ok: true, ...state, active: latestActive })
                } finally {
                  clearTimeout(timer)
                }
              }

              if (method === 'GET' && route === '/active') {
                return jsonResponse(200, { ok: true, active: latestActive })
              }

              if (method === 'GET' && route === '/models') {
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
                  models.push({ id, name: name || id, provider })
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
                        for (const m of list) addModel(m.id, m.name, providerId)
                      }
                    } catch (e) {
                      try {
                        const reg = ctx.llm?.adapters?.get?.(providerId)
                        if (reg?.adapter?.listModels) {
                          const list = await reg.adapter.listModels(providerId)
                          if (Array.isArray(list)) {
                            for (const m of list) addModel(m.id, m.name, providerId)
                          }
                        }
                      } catch {}
                    }
                  }
                } catch (err) {
                  console.warn('[dsh-lark] Failed to query ctx.llm models:', err)
                }

                if (current.model && !seen.has(`${current.provider}:${current.model}`)) {
                  addModel(current.model, current.model, current.provider)
                }

                return jsonResponse(200, { ok: true, current, models })
              }

              if (method === 'GET' && route === '/records') {
                const result = await ops.peek(
                  url.searchParams.get('token') || '',
                  url.searchParams.get('table') || '',
                  url.searchParams.get('limit') || '6',
                  undefined,
                )
                return jsonResponse(result.ok ? 200 : 422, result)
              }

              if (method === 'GET' && route === '/connect/scopes') {
                const result = await ops.getScopes(undefined)
                return jsonResponse(200, result)
              }

              if (method === 'POST' && route === '/connect/cli/install') {
                const result = await ops.installCli(undefined)
                const state = result.ok ? await ops.connectStatus(undefined).catch(() => null) : null
                return jsonResponse(result.ok ? 200 : 500, { ...result, ...(state ? { state } : {}) })
              }

              if (method === 'GET' && route === '/connect/cli/state') {
                return jsonResponse(200, {
                  ok: true,
                  ready: Boolean(ops.resolveCliSync()),
                  bootstrap: ops.getCliBootstrapState(),
                })
              }

              if (method === 'POST' && route === '/connect/app/start') {
                const result = await ops.startAppInit(undefined)
                return jsonResponse(result.ok ? 200 : 500, result)
              }

              if (method === 'GET' && route === '/connect/app/poll') {
                const result = await ops.pollAppInit()
                return jsonResponse(200, result)
              }

              if (method === 'POST' && route === '/connect/app/manual') {
                const body = await request.json().catch(() => ({}))
                const result = await ops.bindApp(body.appId, body.appSecret, undefined)
                return jsonResponse(result.ok ? 200 : 422, result)
              }

              if (method === 'POST' && route === '/connect/login/start') {
                const body = await request.json().catch(() => ({}))
                const result = await ops.startLogin(undefined, body?.domain)
                return jsonResponse(result.ok ? 200 : 500, result)
              }

              if (method === 'POST' && route === '/connect/login/finish') {
                const body = await request.json().catch(() => ({}))
                const result = await ops.finishLogin(body.deviceCode, undefined)
                return jsonResponse(result.ok ? 200 : 422, result)
              }

              if (method === 'GET' && route === '/connect/login/state') {
                return jsonResponse(200, ops.exchangeState())
              }

              if (method === 'POST' && route === '/connect/logout') {
                const result = await ops.logout(undefined)
                return jsonResponse(result.ok ? 200 : 422, result)
              }

              if (method === 'POST' && route === '/connect/unbind') {
                const result = await ops.unbindApp(undefined)
                return jsonResponse(result.ok ? 200 : 422, result)
              }

              if (method === 'POST' && route === '/plan') {
                const body = await request.json().catch(() => ({}))
                const lang = resolveLang(body.lang, body.sentence || '')
                const planned = await planner.plan(body.sentence, undefined, undefined, {
                  model: body.model,
                  provider: body.provider,
                  currentPlan: body.currentPlan,
                  lang,
                })
                return jsonResponse(200, planned)
              }

              if (method === 'POST' && route === '/build') {
                const body = await request.json().catch(() => ({}))
                const lang = resolveLang(body.lang, body.sentence || body.name || '')
                let plan = body.plan
                if (!plan || typeof plan !== 'object') {
                  const planned = await planner.plan(body.sentence, undefined, undefined, { lang })
                  if (!planned.ok) {
                    return jsonResponse(422, planned)
                  }
                  plan = planned.plan
                }
                const result = await ops.build(plan, {
                  name: body.name,
                  kanban: body.kanban,
                  sample: body.sample,
                })
                return jsonResponse(result.ok ? 200 : 500, result)
              }

              if (method === 'POST' && route === '/adjust') {
                const body = await request.json().catch(() => ({}))
                const token = String(body.token ?? '').trim()
                const instruction = String(body.instruction ?? '').trim()
                const lang = resolveLang(body.lang, instruction)
                const isEn = lang === 'en'
                const isCollab = body.type === 'collab' || !token

                if (isCollab) {
                  if (body.stream) {
                    const encoder = new TextEncoder()
                    const stream = new ReadableStream({
                      async start(controller) {
                        const onDelta = (event) => {
                          try {
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
                          } catch {}
                        }
                        try {
                          const collabRes = await ops.dispatchCollab({
                            instruction,
                            history: body.history,
                            model: body.model,
                            provider: body.provider,
                            lang,
                            onDelta,
                          })
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', payload: collabRes })}\n\n`))
                        } catch (err) {
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: String(err) })}\n\n`))
                        } finally {
                          controller.close()
                        }
                      },
                    })
                    return new Response(stream, {
                      status: 200,
                      headers: {
                        'content-type': 'text/event-stream; charset=utf-8',
                        'cache-control': 'no-cache, no-transform',
                      },
                    })
                  }

                  const collabRes = await ops.dispatchCollab({
                    instruction,
                    history: body.history,
                    model: body.model,
                    provider: body.provider,
                    lang,
                  })
                  return jsonResponse(200, collabRes)
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
                    lang,
                  }, schema, liveRecords)
                  if (!result.ok) {
                    return jsonResponse(422, result)
                  }
                  if (result.type === 'answer' || (!result.ops || result.ops.length === 0)) {
                    const fallback = isEn ? 'Done.' : '已为您查询完成。'
                    return jsonResponse(200, {
                      ok: true,
                      type: 'answer',
                      summary: result.reply || fallback,
                      reply: result.reply || fallback,
                    })
                  }
                  planned = result.ops
                  aiReply = result.reply
                }

                const risky = destructiveChanges(planned, lang)
                if (risky.length > 0 && body.confirm !== true) {
                  return jsonResponse(200, {
                    ok: true,
                    needsConfirm: true,
                    destructive: risky,
                    ops: planned,
                    summary: [
                      isEn ? 'These changes cannot be undone:' : '这几处改了没法撤销：',
                      ...risky.map((line) => `· ${line}`),
                    ].join('\n'),
                  })
                }

                const adjusted = await ops.adjust(token, planned, { table: body.table, lang })
                let live = await ops.peek(token, body.table || '', '12')
                if (!live.ok) live = await ops.peek(token, '', '12')

                return jsonResponse(200, {
                  ...adjusted,
                  type: 'ops',
                  planned,
                  reply: aiReply,
                  summary: aiReply ? `${aiReply}\n${adjusted.summary}` : adjusted.summary,
                  live: live.ok
                    ? { ok: true, fields: live.fields, rows: live.rows, more: live.more, table: live.table }
                    : { ok: false, message: live.message },
                })
              }

              return jsonResponse(404, { ok: false, error: 'unknown route' })
            } catch (error) {
              return jsonResponse(500, {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          },
        }),
        `dsh-lark: connection fetch ${r.path}`,
      )
    }
  }

  // The most discoverable entrance: `/lark <一句话>` right in the composer.
  ctx.effect(() =>
    ctx.commands.register({
      name: 'lark',
      description: 'Create a Feishu Base from one sentence / 一句话建飞书多维表格',
      input: {
        hint: 'What would you like to track? e.g. Customer leads / 你想记什么事？如：客户往来',
      },
      recordInput: true,
      async handler(invocation) {
        const sentence = String(invocation.rawInput ?? '').trim()
        const lang = resolveLang(undefined, sentence)
        const isEn = lang === 'en'
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
              'Usage / 用法: `/lark Customer leads with company, contact, deal stage` 或 `/lark 客户往来，谁在跟、谈到哪一步`',
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
          const planned = await planner.plan(sentence, invocation.signal, undefined, { lang })
          if (!planned.ok) return { kind: 'error', text: planned.message }
          const result = await ops.build(planned.plan, {}, invocation.signal)
          return { kind: result.ok ? 'success' : 'error', text: describe(result, lang) }
        } catch (error) {
          return {
            kind: 'error',
            text: `${isEn ? 'Creation failed' : '没建成'}：${error instanceof Error ? error.message : String(error)}`,
          }
        }
      },
    }),
  )

  // Optional native DSH capability integrations (never added to top-level inject so
  // lightweight/headless profiles and tests continue working seamlessly).
  if (typeof ctx.inject === 'function') {
    ctx.inject(['systemPrompt'], (scoped) => {
      if (!scoped.systemPrompt || typeof scoped.systemPrompt.section !== 'function') return
      const order = typeof scoped.systemPrompt.getSectionOrder === 'function'
        ? scoped.systemPrompt.getSectionOrder('TOOLS_SDK')
        : 600
      return scoped.systemPrompt.section({
        name: 'dsh-lark-studio',
        order,
        text: [
          'Lark Workbench (`dsh-lark-studio`) provides structured Feishu tools (`lark_base_build`, `lark_base_adjust`, `lark_collab`) and a `/lark` shortcut.',
          '- Use `lark_base_build` (supports `preview=true`) when the user wants to design and create a new Feishu Base from natural language.',
          '- Use `lark_base_adjust` to inspect or reshape an existing Base cleanly (always ask user confirmation before passing `confirm=true` for edits/deletions).',
          '- Use `lark_collab` for quick calendar, task, chat, mail, contact, doc, or wiki queries; for specialized Feishu domains (approval, OKR, sheets, slides, minutes), follow the official `feishu` skill and `lark-cli skills read <guide>`.',
          '- Never ask users to install Node.js, npm, or `@larksuite/cli`; the workbench auto-installs the component on first open.',
        ].join('\n'),
      })
    })

    ctx.inject(['skills'], (scoped) => {
      if (!scoped.skills) return
      skillsHostRef = scoped.skills
      // Register a fallback `feishu` provider at rank 700 (> official BUNDLED_SKILL_RANK 600)
      // so official @deepseek-ai/dsh-feishu ALWAYS wins when installed, while standalone
      // users still receive a single unified live `feishu` skill catalog from lark-cli.
      if (typeof scoped.skills.registerProvider === 'function') {
        return scoped.skills.registerProvider((control) => {
          skillControlRef = control
          const description = 'Feishu (飞书) and Lark through the active lark-cli: Base, docs, wiki, Drive, sheets, slides, calendar, tasks, chats, mail, approvals, meetings, and OKR.'
          const invocation = { modelInvocable: true, userInvocable: true }
          const resourceBase = { kind: 'opaque', description: 'Built-in guides inside active lark-cli (`lark-cli skills read <name>`).' }
          return {
            name: PROVIDER_NAME,
            list: async () => ({
              candidates: [{
                name: 'feishu',
                description,
                invocation,
                source: 'bundled',
                provider: PROVIDER_NAME,
                resourceBase,
                rank: FEISHU_FALLBACK_SKILL_RANK,
                locator: 'feishu',
              }],
              complete: true,
            }),
            get: async (candidate, options = {}) => {
              const cliPath = await ops.resolveCli(options.signal).catch(() => null)
              const catalog = await ops.readOfficialSkillsCatalog(options.signal).catch(() => [])
              return {
                name: candidate.name,
                description,
                invocation,
                source: 'bundled',
                provider: PROVIDER_NAME,
                resourceBase,
                content: buildFallbackFeishuContent(ops, cliPath, catalog),
              }
            },
          }
        })
      }
      if (typeof scoped.skills.register === 'function') {
        return scoped.skills.register({
          name: 'feishu',
          description: 'Feishu (飞书) and Lark through active lark-cli and Lark Workbench.',
          source: 'bundled',
          invocation: { modelInvocable: true, userInvocable: true },
          content: buildFallbackFeishuContent(ops, ops.resolveCliSync() || null, []),
        })
      }
    })

    ctx.inject(['storageDomain'], (scoped) => {
      if (!scoped.storageDomain || typeof scoped.storageDomain.open !== 'function') return
      let disposed = false
      let opened = null
      scoped.storageDomain.open(ACTIVE_STATE_DOMAIN).then((domain) => {
        if (disposed) {
          domain.close().catch(() => {})
          return
        }
        opened = domain
        activeDomain = domain
        const saved = domain.global.get()
        if (!latestActive && saved && saved.url) {
          latestActive = {
            name: saved.name || saved.baseName,
            baseName: saved.baseName || saved.name,
            url: saved.url,
            token: saved.token,
            updatedAt: saved.updatedAt,
          }
        }
      }).catch(() => {})
      return () => {
        disposed = true
        if (activeDomain === opened) activeDomain = null
        if (opened) opened.close().catch(() => {})
      }
    })

    ctx.inject(['cliAccounts'], (scoped) => {
      if (!scoped.cliAccounts || typeof scoped.cliAccounts.register !== 'function') return
      const reg = buildCliAccountRegistration(ops)
      let handle
      try {
        handle = scoped.cliAccounts.register(reg)
      } catch {
        return
      }
      cliAccountHandle = handle
      return () => {
        if (cliAccountHandle === handle) cliAccountHandle = null
        return handle.dispose()
      }
    })
  }
}
