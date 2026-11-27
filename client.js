/**
 * Lark Workbench — Client half.
 *
 * Design System: Radical Restraint & Spatial Clarity (Notion / Linear / Apple ethos)
 * ──────────────────────────────────────────────────────────────────────────────────
 * 1. Less, but better: generous whitespace, hairline borders, zero instructional walls.
 * 2. One focal action per screen; progressive disclosure hides what is not needed now.
 * 3. Unified Apple-calibrated motion grammar: GPU-only compositing, interruptible
 *    disclosure & overlay transitions, direct 0ms pointer-tracked resizing, full
 *    `prefers-reduced-motion` support.
 * 4. Precision 1.55px-stroke SVG icon system — zero emojis, zero raw Unicode glyphs.
 * 5. True Light/Dark parity synced with DSH host (`body[data-ds-dark-theme]`) and
 *    container-aware responsiveness (`ResizeObserver`) for mobile, right-sidebar,
 *    and wide split-screen layouts.
 * 6. Humane safeguards: IME-safe Enter, cancelable in-flight requests, non-destructive
 *    Undo toasts, explicit guards for irreversible mutations, and preserved chat history
 *    on live table sync.
 */

window.__ModuleLoader__.load({
  id: 'dsh-lark-studio',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React
    let NativeSwitch = null
    try {
      const uiPrimitives = require('@deepseek-ai/dsh-client-ui-primitives')
      if (uiPrimitives && typeof uiPrimitives.Switch === 'function') {
        NativeSwitch = uiPrimitives.Switch
      }
    } catch {}

    const API = 'api/dsh-lark'
    const NS = 'dsh-lark-studio'
    const RECENT_KEY = 'dsh-lark-recent'
    const DRAFT_KEY = 'dsh-lark-draft'
    const STYLE_ID = 'dsh-lark-studio-styles'

    let currentDshSessionId = ''
    let styleRefCount = 0

    function resolveDshSessionId(props, ctx) {
      if (props && props.sessionId) return String(props.sessionId)
      if (props && props.session && props.session.id) return String(props.session.id)
      try {
        const fromMounted =
          ctx && ctx.sidebarRight && ctx.sidebarRight.mounted && typeof ctx.sidebarRight.mounted.getSnapshot === 'function'
            ? ctx.sidebarRight.mounted.getSnapshot()
            : undefined
        if (fromMounted) return String(fromMounted)
      } catch {}
      try {
        const cur = localStorage.getItem('dsh.sessions.current')
        if (cur) return cur
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (k && k.startsWith('dsh.conversation.')) {
            const id = k.replace(/^dsh\.conversation\./, '')
            if (id) return id
          }
        }
      } catch {}
      return ''
    }

    async function authFetch(url, options = {}) {
      const sid = currentDshSessionId || resolveDshSessionId()
      let targetUrl = url
      if (sid && typeof targetUrl === 'string' && (targetUrl.includes('dsh-lark') || targetUrl.includes('/api/'))) {
        const sep = targetUrl.includes('?') ? '&' : '?'
        if (!targetUrl.includes('sessionId=')) {
          targetUrl = `${targetUrl}${sep}sessionId=${encodeURIComponent(sid)}`
        }
      }
      const headers = new Headers(options.headers || {})
      if (sid && !headers.has('x-dsh-session-id')) {
        headers.set('x-dsh-session-id', sid)
      }
      return fetch(targetUrl, { ...options, headers })
    }

    // ── Precision SVG Icon System (Zero Emojis, Zero Raw Unicode Glyphs) ───

    const ICONS = {
      table: [
        'M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2Z',
        'M4 10h16',
        'M10 10v10',
      ],
      checkSquare: [
        'M4.5 6.5A2 2 0 016.5 4.5h11a2 2 0 012 2v11a2 2 0 01-2 2h-11a2 2 0 01-2-2Z',
        'M8.5 12.2l2.3 2.3 4.8-4.8',
      ],
      calendar: [
        'M4.5 7.5A2 2 0 016.5 5.5h11a2 2 0 012 2v9a2 2 0 01-2 2h-11a2 2 0 01-2-2Z',
        'M4.5 10.5h15',
        'M8.5 3.8v3.4',
        'M15.5 3.8v3.4',
      ],
      people: [
        'M8.5 10a2.6 2.6 0 100-5.2 2.6 2.6 0 000 5.2Z',
        'M15.5 10.4a2.2 2.2 0 100-4.4 2.2 2.2 0 000 4.4Z',
        'M3.5 18.5c0-2.8 2.2-4.6 5-4.6s5 1.8 5 4.6',
        'M14.2 13.9c2.3.2 4.1 1.9 4.1 4.2',
      ],
      mail: [
        'M4 6.5A2 2 0 016 4.5h12a2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2Z',
        'M4.5 7l7.5 5.5L19.5 7',
      ],
      receipt: [
        'M6.5 3.8h11v15.4l-2.2-1.4-2.2 1.4-2.2-1.4-2.2 1.4-2.2-1.4Z',
        'M9.5 8.5h5',
        'M9.5 12h5',
      ],
      user: [
        'M12 11.4a3.1 3.1 0 100-6.2 3.1 3.1 0 000 6.2Z',
        'M5.6 19.4c0-3.4 2.9-5.4 6.4-5.4s6.4 2 6.4 5.4',
      ],
      book: [
        'M4.5 5.4c2.6-.9 5.2-.9 7.5.4 2.3-1.3 4.9-1.3 7.5-.4v12c-2.6-.9-5.2-.9-7.5.4-2.3-1.3-4.9-1.3-7.5-.4Z',
        'M12 5.8v12',
      ],
      refresh: [
        'M4.5 12a7.5 7.5 0 0113.8-4.1',
        'M19.5 4.5v4h-4',
        'M19.5 12a7.5 7.5 0 01-13.8 4.1',
        'M4.5 19.5v-4h4',
      ],
      arrowLeft: ['M18.5 12h-13', 'M11 6.5L5.5 12 11 17.5'],
      arrowUp: ['M12 18.5v-13', 'M6.5 11L12 5.5 17.5 11'],
      arrowUpRight: ['M7 17L17 7', 'M9 7h8v8'],
      chevronRight: ['M9.5 6.5L15 12l-5.5 5.5'],
      chevronDown: ['M6.5 9.5L12 15l5.5-5.5'],
      check: ['M5 12.5l4.5 4.5L19 7.5'],
      close: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
      copy: [
        'M9 9.5A1.5 1.5 0 0110.5 8h8A1.5 1.5 0 0120 9.5v9a1.5 1.5 0 01-1.5 1.5h-8A1.5 1.5 0 019 18.5Z',
        'M15 8V5.5A1.5 1.5 0 0013.5 4h-8A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H9',
      ],
      splitPane: [
        'M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2Z',
        'M12.5 4v16',
      ],
      stop: {
        filled: true,
        paths: ['M7.5 7.5h9a1 1 0 011 1v7a1 1 0 01-1 1h-9a1 1 0 01-1-1v-7a1 1 0 011-1Z'],
      },
      trash: [
        'M4.5 7h15',
        'M9.5 4h5',
        'M6.5 7l.8 11.2A1.8 1.8 0 009.1 20h5.8a1.8 1.8 0 001.8-1.8L17.5 7',
      ],
      alertCircle: [
        'M12 21a9 9 0 100-18 9 9 0 000 18Z',
        'M12 8.2v4.3',
        'M12 15.8h.01',
      ],
      shieldCheck: [
        'M12 21s7.5-3.6 7.5-9.5V5.8L12 3 4.5 5.8v5.7C4.5 17.4 12 21 12 21Z',
        'M9 12.2l2.1 2.1 4.2-4.2',
      ],
      chart: ['M18 19V10', 'M12 19V5', 'M6 19v-6'],
      layout: [
        'M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v13a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18.5Z',
        'M4 9.5h16',
        'M9.5 9.5V20',
      ],
      plus: ['M12 5.5v13', 'M5.5 12h13'],
      paperclip: [
        'M16.5 7.5l-7.2 7.2a2.5 2.5 0 01-3.5-3.5l7.8-7.8a4.2 4.2 0 016 6l-7.8 7.8a5.8 5.8 0 01-8.2-8.2l7.2-7.2',
      ],
      fileText: [
        'M7 3.8h6.8L18.5 8.5v11.7a1.5 1.5 0 01-1.5 1.5H7a1.5 1.5 0 01-1.5-1.5V5.3A1.5 1.5 0 017 3.8Z',
        'M13.5 3.8v4.8h5',
        'M8.8 13h6.4',
        'M8.8 16.5h4.5',
      ],
      image: [
        'M4.5 6.5A2 2 0 016.5 4.5h11a2 2 0 012 2v11a2 2 0 01-2 2h-11a2 2 0 01-2-2Z',
        'M8.5 10a1.3 1.3 0 100-2.6 1.3 1.3 0 000 2.6Z',
        'M4.8 17.2l4.4-4.2 3.1 2.9 2.6-2.4 4.3 3.7',
      ],
      moreHorizontal: [
        'M6 12h.01',
        'M12 12h.01',
        'M18 12h.01',
      ],
      spark: [
        'M12 3.5l1.6 5.2 5.2 1.6-5.2 1.6L12 17.1l-1.6-5.2-5.2-1.6 5.2-1.6Z',
      ],
      fieldText: ['M5 7.5h14', 'M5 12h10', 'M5 16.5h12.5'],
      fieldNumber: ['M9.6 4.6L8 19.4', 'M16 4.6l-1.6 14.8', 'M5 9.2h14', 'M4.4 14.8h14'],
      fieldSelect: ['M6.8 9.5l5.2 5.2 5.2-5.2'],
      fieldDate: [
        'M5.2 7.6a2 2 0 012-2h9.6a2 2 0 012 2v9.2a2 2 0 01-2 2H7.2a2 2 0 01-2-2Z',
        'M5.2 10.6h13.6',
        'M9 4.8v3.4',
        'M15 4.8v3.4',
      ],
      fieldUser: ['M12 11.4a3.1 3.1 0 100-6.2 3.1 3.1 0 000 6.2Z', 'M5.6 19.4c0-3.4 2.9-5.4 6.4-5.4s6.4 2 6.4 5.4'],
      fieldCheck: [
        'M5.6 6.3a1.8 1.8 0 011.8-1.8h9.2a1.8 1.8 0 011.8 1.8v11.4a1.8 1.8 0 01-1.8 1.8H7.4a1.8 1.8 0 01-1.8-1.8Z',
        'M8.7 12.1l2.3 2.3 4.5-4.5',
      ],
    }

    function Icon({ name, size = 15, strokeWidth = 1.6, className, style }) {
      const def = ICONS[name] ?? ICONS.checkSquare
      const isFilled = Boolean(def && !Array.isArray(def) && def.filled)
      const paths = Array.isArray(def) ? def : (def.paths || [])
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: isFilled ? 'currentColor' : 'none',
          stroke: isFilled ? 'none' : 'currentColor',
          strokeWidth,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          className,
          style: { display: 'block', flexShrink: 0, ...style },
        },
        paths.map((d, index) => h('path', { key: index, d })),
      )
    }

    function Mark({ size = 14 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: '#FFFFFF',
          strokeWidth: 1.9,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2.6 }),
        h('path', { d: 'M3.5 9.5h17' }),
        h('path', { d: 'M9.5 9.5v10' }),
        h('path', { d: 'M14.8 13.4h3.4' }),
        h('path', { d: 'M16.5 11.7v3.4' }),
      )
    }

    function PanelIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 20
      const color = props.active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)'
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: color,
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('rect', { x: 3.2, y: 4.4, width: 17.6, height: 15.2, rx: 2.6 }),
        h('path', { d: 'M3.2 9.4h17.6' }),
        h('path', { d: 'M9.2 9.4v10.2' }),
        h('path', { d: 'M14.6 13.2v3.4' }),
        h('path', { d: 'M12.9 14.9h3.4' }),
      )
    }

    // ── Scenarios (4 primary visible + 4 on-demand) ────────────────────────

    const SCENARIOS = [
      {
        id: 'crm',
        type: 'base',
        icon: 'table',
        titleKey: 'scene.crm',
        promptKey: 'scene.crm.prompt',
        primary: true,
      },
      {
        id: 'task',
        type: 'base',
        icon: 'checkSquare',
        titleKey: 'scene.task',
        promptKey: 'scene.task.prompt',
        primary: true,
      },
      {
        id: 'collab-calendar',
        type: 'collab',
        icon: 'calendar',
        titleKey: 'scene.calendar',
        promptKey: 'scene.calendar.prompt',
        primary: true,
      },
      {
        id: 'collab-todo',
        type: 'collab',
        icon: 'checkSquare',
        titleKey: 'scene.todo',
        promptKey: 'scene.todo.prompt',
        primary: true,
      },
      {
        id: 'content',
        type: 'base',
        icon: 'layout',
        titleKey: 'scene.content',
        promptKey: 'scene.content.prompt',
        primary: false,
      },
      {
        id: 'expense',
        type: 'base',
        icon: 'receipt',
        titleKey: 'scene.expense',
        promptKey: 'scene.expense.prompt',
        primary: false,
      },
      {
        id: 'collab-chat',
        type: 'collab',
        icon: 'people',
        titleKey: 'scene.chat',
        promptKey: 'scene.chat.prompt',
        primary: false,
      },
      {
        id: 'collab-mail',
        type: 'collab',
        icon: 'mail',
        titleKey: 'scene.mail',
        promptKey: 'scene.mail.prompt',
        primary: false,
      },
    ]

    // ── Complete Bilingual i18n Dictionaries (Zero Hardcoded UI Copy) ──────

    const ZH = {
      'app.name': '飞书工作台',
      'status.checking': '检查中',
      'status.ready': '已连接',
      'status.offline': '未连接服务',
      'status.recheck': '重新检查',
      'status.setup': '待连接',
      'status.manage': '连接与权限设置',

      'pick.title': '想建什么表，或查什么事？',
      'pick.placeholder': '想记什么事，或查日程、待办、群聊、邮件…',
      'pick.own': '输入建表需求或飞书协同指令',
      'pick.more': '更多',
      'pick.less': '收起',
      'pick.send': '发送 (↵)',
      'pick.stop': '停止',

      'scene.crm': '建客户表',
      'scene.crm.prompt': '我想记客户往来：公司、联系人、现在谈到哪一步、下次什么时候联系',
      'scene.task': '建任务表',
      'scene.task.prompt': '我想记工作任务：任务、负责人、做到哪一步了、截止时间',
      'scene.calendar': '今日日程',
      'scene.calendar.prompt': '查一下我今天的日程安排与会议',
      'scene.todo': '我的待办',
      'scene.todo.prompt': '列出我所有未完成的待办事项',
      'scene.content': '建排期表',
      'scene.content.prompt': '我想排内容：选题、发在哪个平台、什么状态、什么时候发',
      'scene.expense': '建报销表',
      'scene.expense.prompt': '我想记报销：花在什么事上、金额、日期、报销到哪一步',
      'scene.chat': '搜索群聊',
      'scene.chat.prompt': '搜索我加入的飞书群聊',
      'scene.mail': '近期邮件',
      'scene.mail.prompt': '查一下我最近收到的重要邮件',

      'recent.title': '最近',
      'recent.delete': '从最近移除',
      'recent.removed': '已移除「%s」',
      'draft.title': '草稿',
      'draft.delete': '丢弃草稿',
      'draft.discarded': '已丢弃草稿',

      'toast.undo': '撤销',
      'toast.copied': '已复制链接',
      'toast.copiedCmd': '已复制命令',
      'toast.synced': '已刷新表格数据',
      'toast.cleared': '已清空对话',
      'toast.stopped': '已停止',
      'toast.built': '表格已创建',
      'toast.refined': '已更新方案',
      'toast.kept': '已保留当前草稿，可点击右上角「确认建表」',
      'toast.draftCleared': '已收起刚才的设计草稿',

      'model.label': '切换模型',
      'model.loading': '加载模型…',

      'busy.planning': '构思中…',
      'busy.planningSub': '正在理解需求并准备方案',
      'busy.refining': '调整中…',
      'busy.building': '创建中…',
      'busy.thinking': '思考中…',

      'preview.title': '结构预览',
      'preview.draft': '预览草稿',
      'preview.empty': '建好后可直接填写',
      'preview.cols': '列',
      'preview.rows': '条示例',
      'preview.kanban': '含看板',
      'preview.detailsShow': '字段说明',
      'preview.detailsHide': '收起说明',
      'preview.tweakPlaceholder': '想怎么改？如：加一列来源，或去掉金额…',
      'preview.build': '确认建表',
      'preview.back': '返回',
      'preview.replyClose': '收起',

      'view.back': '返回',
      'view.collabTitle': '飞书协同',
      'view.sync': '刷新数据',
      'view.synced': '已刷新',
      'view.copy': '复制链接',
      'view.copied': '已复制',
      'view.tableShow': '分屏表格',
      'view.tableHide': '收起表格',
      'view.tabChat': '对话',
      'view.tabTable': '表格',
      'view.external': '外部打开',
      'view.clear': '清空',
      'view.clearTip': '清空当前对话',
      'view.emptyTable': '说一句就能改表，或直接问表里的数据',
      'view.emptyCollab': '随时查日程、待办、群聊、邮件与文档',
      'view.tablePlaceholder': '加列、改状态、建看板，或直接提问…',
      'view.collabPlaceholder': '查日程、待办、群聊或邮件…',
      'view.userRole': '你',
      'view.thinkingDone': '思考过程',
      'view.retry': '重试',
      'view.noToken': '无法识别表格链接，请从飞书打开',
      'view.confirmTitle': '确认删除',
      'view.confirmBody': '以下改动无法撤销：',
      'view.confirmYes': '确认删除',
      'view.confirmNo': '取消',
      'view.skillConfirm': '确认执行',
      'view.skillRunning': '正在执行…',
      'view.skillTitle': '待确认操作',
      'view.skillPending': '待确认',
      'view.skillDone': '已执行',
      'view.skillCancelled': '已取消',
      'view.skillCancel': '取消',
      'view.skillCmdShow': '查看命令详情',
      'view.skillCmdHide': '收起命令详情',
      'view.resizeTip': '拖拽调整宽度，双击恢复默认',
      'view.webviewLoading': '正在载入飞书多维表格…',
      'view.webviewError': '表格载入失败',
      'view.scopeNeed': '需要开通「%s」权限',
      'view.scopeAuth': '立即授权并继续',
      'view.scopeWaiting': '等待飞书确认…',
      'view.scopeConsole': '开放平台',

      'starter.analyze': '统计分析',
      'starter.analyze.prompt': '帮我对当前表格数据进行统计分析，提取关键洞察与数据分布',
      'starter.kanban': '创建看板',
      'starter.kanban.prompt': '为当前表创建一个按状态分组的看板视图',
      'starter.form': '收集表单',
      'starter.form.prompt': '针对当前表格搭建一个数据收集表单，方便录入数据',
      'starter.batch': '检查空缺项',
      'starter.batch.prompt': '帮我检查当前表格数据，列出缺失字段或需要补齐的记录',
      'starter.calendar': '今日日程',
      'starter.calendar.prompt': '查一下我今天的日程安排与会议',
      'starter.todo': '未完成待办',
      'starter.todo.prompt': '列出我所有未完成的待办事项',
      'starter.chat': '我的群聊',
      'starter.chat.prompt': '搜索我加入的飞书群聊',
      'starter.mail': '近期邮件',
      'starter.mail.prompt': '查一下我最近收到的重要邮件',

      'error.title': '操作未完成',
      'error.retry': '重试',
      'err.empty': '暂无响应，请重试',
      'err.noCli': '尚未完成飞书组件准备',
      'err.codeInvalid': '授权链接已失效，请重新获取',
      'err.codeExpired': '授权链接已过期，请重新获取',
      'err.pending': '授权正在等待管理员审批，通过后重试',
      'err.rateLimit': '请求过于频繁，请稍后再试',
      'err.scope': '飞书权限不足，请在连接设置中补充授权',
      'err.auth': '飞书登录已过期，请重新授权',
      'err.timeout': '飞书响应超时，请检查网络或重试',
      'err.network': '网络连接异常，请检查网络后重试',
      'err.plan': '未能理解需求，换个说法或点击下方场景试试',
      'err.incomplete': '缺少必要参数或信息不完整，请补充后再试',

      'file.attach': '添加文件或图片（支持拖拽 / 粘贴）',
      'file.dropHint': '松开以添加文件',
      'file.tooLarge': '单个文件不能超过 20 MB',
      'file.tooMany': '单次最多添加 5 个文件',
      'file.uploadFailed': '文件上传未完成，请重试',
      'file.uploadingWait': '文件正在上传，请稍候…',
      'file.visionUnsupported': '当前模型不支持识图，请切换支持视觉的模型或改传文档',
      'file.importBadge': '将导入 {n} 条真实数据',
      'file.defaultPrompt': '已上传 {n} 个文件',
      'busy.planningTable': '正在规划多维表格结构…',
      'busy.buildingPreview': '正在组装预览表与示例数据…',
      'busy.routingCollab': '正在进入飞书协同…',
      'busy.writing': '正在整理回复…',
      'composer.queued': '将在完成后发送：',
      'composer.cancelQueue': '取消',

      'gate.step.tool': '准备组件',
      'gate.step.app': '关联应用',
      'gate.step.auth': '授权',
      'gate.noTool.title': '正在准备飞书连接',
      'gate.noTool.body': '首次使用正在自动准备飞书连接，无需任何手动配置。',
      'gate.noTool.installing': '正在自动下载并配置连接组件…',
      'gate.noTool.retry': '重试自动准备',
      'gate.noTool.manualToggle': '网络受限？查看手动安装方式',
      'gate.noTool.manualHide': '收起手动安装',
      'gate.noTool.copy': '复制命令',
      'gate.noTool.copied': '已复制',
      'gate.noTool.done': '已手动装好，继续',
      'gate.noTool.hint': '组件自动下载完成后将直接进入下一步。',
      'gate.noApp.title': '关联你的飞书',
      'gate.noApp.body': '在飞书页面填个名称并确认默认权限（约 1 分钟）',
      'gate.noApp.cta': '前往飞书创建',
      'gate.noApp.done': '已完成，检测',
      'gate.noApp.reopen': '重新打开',
      'gate.brandLabel': '账号版本',
      'gate.brandFeishu': '飞书 (中国区)',
      'gate.brandLark': 'Lark (海外版)',
      'gate.team.toggle': '使用已有应用凭据',
      'gate.team.hide': '收起',
      'gate.team.appId': 'App ID（cli_ 开头）',
      'gate.team.secret': 'App Secret',
      'gate.team.save': '连接此应用',
      'gate.noAuth.title': '授权登录飞书',
      'gate.noAuth.body': '仅需一次性确认，数据直连你的个人飞书空间',
      'gate.noAuth.cta': '去授权',
      'gate.noAuth.done': '已授权，立即核验',
      'gate.noAuth.reopen': '重新打开',
      'gate.waiting': '正在确认',
      'gate.autoChecking': '正在自动检测连接状态…',
      'gate.pending': '尚未收到飞书确认，请在浏览器显示成功后重试',
      'gate.retryBody': '本地服务暂无响应，请稍后重试',

      'account.title': '飞书连接',
      'account.user': '账号',
      'account.app': '应用',
      'account.cli': '工具',
      'account.authed': '已授权',
      'account.notLogin': '未登录',
      'account.notConfigured': '未配置',
      'account.cliReady': '已就绪',
      'account.cliMissing': '不可用',
      'account.scopesTitle': '能力权限',
      'account.console': '开放平台',
      'account.scopeChecking': '核验中',
      'account.scopesCheckingLine': '正在核验飞书能力权限…',
      'account.scopeReady': '已开通',
      'account.scopeOff': '未开通',
      'account.scopeRetry': '重新核验',
      'account.scopeError': '权限核验失败，请检查网络或重试',
      'account.reauthBanner': '飞书授权已过期，重新授权后可继续操作（若频繁过期请在开放平台开启「刷新 user_access_token」）',
      'account.reauthCta': '重新授权',
      'account.allReady': '全域协同能力已就绪',
      'account.grantAll': '补充授权',
      'account.granting': '正在等待确认…',
      'account.logout': '退出登录',
      'account.unbind': '解绑应用',
      'account.logoutTitle': '退出当前飞书账号？',
      'account.logoutBody': '将清除「%s」的本地授权，可随时切换其他账号重新登录',
      'account.logoutConfirm': '确认退出',
      'account.unbindTitle': '解绑当前飞书应用？',
      'account.unbindBody': '将清除应用凭据 (%s)，之后可重新绑定其他企业应用',
      'account.unbindConfirm': '确认解绑',
      'account.working': '处理中…',
      'account.cancel': '取消',
      'account.close': '关闭',
      'settings.convTabLabel': '对话顶部标签页',
      'settings.convTabDesc': '在会话顶部「对话 / 轨迹」旁显示飞书工作台标签页',
      'settings.convTabSaving': '正在保存…',
      'scope.base': '多维表格',
      'scope.calendar': '日历日程',
      'scope.task': '任务待办',
      'scope.im': '消息群聊',
      'scope.mail': '飞书邮箱',
      'scope.contact': '通讯录',
      'scope.approval': '审批流程',
      'scope.docs': '云文档',
      'scope.drive': '飞书云盘',
      'scope.wiki': '知识库',
      'scope.sheets': '电子表格',
      'scope.slides': '幻灯片',
      'scope.markdown': 'Markdown',
      'scope.mindnotes': '思维笔记',
      'scope.whiteboard': '文档画板',
      'scope.vc': '视频会议',
      'scope.minutes': '会议妙记',
      'scope.note': '会议笔记',
      'scope.okr': '飞书 OKR',
      'scope.attendance': '考勤打卡',
      'scope.apps': '妙搭应用',
      'scope.event': '实时事件',
      'scope.application': '应用管理',
      'scope.defaultDomain': '飞书功能',

      'kind.text': '文本',
      'kind.number': '数字',
      'kind.select': '单选',
      'kind.datetime': '日期',
      'kind.user': '人员',
      'kind.checkbox': '勾选',
    }

    const EN = {
      'app.name': 'Lark Workbench',
      'status.checking': 'Checking',
      'status.ready': 'Connected',
      'status.offline': 'Offline',
      'status.recheck': 'Retry',
      'status.setup': 'Setup',
      'status.manage': 'Connection & permissions',

      'pick.title': 'What would you like to track or check?',
      'pick.placeholder': 'Track clients or tasks, or ask for agenda, chats, mail…',
      'pick.own': 'Describe what to track or ask Lark',
      'pick.more': 'More',
      'pick.less': 'Less',
      'pick.send': 'Send (↵)',
      'pick.stop': 'Stop',

      'scene.crm': 'Client Base',
      'scene.crm.prompt': 'Track customer leads with company, contact, deal stage, and next follow-up date',
      'scene.task': 'Task Base',
      'scene.task.prompt': 'Track team tasks with task name, owner, status, priority, and due date',
      'scene.calendar': 'Today Agenda',
      'scene.calendar.prompt': 'Check my agenda and meetings for today',
      'scene.todo': 'My Tasks',
      'scene.todo.prompt': 'List all my open tasks and to-dos',
      'scene.content': 'Content Base',
      'scene.content.prompt': 'Plan content calendar with topic, platform, status, and publish date',
      'scene.expense': 'Expense Base',
      'scene.expense.prompt': 'Track expense claims with item, amount, date, and approval status',
      'scene.chat': 'Group Chats',
      'scene.chat.prompt': 'Search the Feishu group chats I have joined',
      'scene.mail': 'Recent Mail',
      'scene.mail.prompt': 'Check my recent important emails',

      'recent.title': 'Recent',
      'recent.delete': 'Remove from recent',
      'recent.removed': 'Removed “%s”',
      'draft.title': 'Draft',
      'draft.delete': 'Discard draft',
      'draft.discarded': 'Draft discarded',

      'toast.undo': 'Undo',
      'toast.copied': 'Link copied',
      'toast.copiedCmd': 'Command copied',
      'toast.synced': 'Table data refreshed',
      'toast.cleared': 'Conversation cleared',
      'toast.stopped': 'Stopped',
      'toast.built': 'Base created',
      'toast.refined': 'Blueprint updated',
      'toast.kept': 'Draft kept as-is — click Create Base when ready',
      'toast.draftCleared': 'Draft closed',

      'model.label': 'Switch model',
      'model.loading': 'Loading…',

      'busy.planning': 'Designing…',
      'busy.planningSub': 'Understanding your request',
      'busy.refining': 'Refining…',
      'busy.building': 'Creating…',
      'busy.thinking': 'Thinking…',

      'preview.title': 'Structure Preview',
      'preview.draft': 'Draft preview',
      'preview.empty': 'Ready for your first row',
      'preview.cols': 'fields',
      'preview.rows': 'samples',
      'preview.kanban': 'Kanban',
      'preview.detailsShow': 'Field specs',
      'preview.detailsHide': 'Hide specs',
      'preview.tweakPlaceholder': 'Refine structure… e.g. add a Source column or remove Amount',
      'preview.build': 'Create Base',
      'preview.back': 'Back',
      'preview.replyClose': 'Dismiss',

      'view.back': 'Back',
      'view.collabTitle': 'Lark Assistant',
      'view.sync': 'Refresh',
      'view.synced': 'Refreshed',
      'view.copy': 'Copy link',
      'view.copied': 'Copied',
      'view.tableShow': 'Split Table',
      'view.tableHide': 'Hide Table',
      'view.tabChat': 'Chat',
      'view.tabTable': 'Table',
      'view.external': 'Open external',
      'view.clear': 'Clear',
      'view.clearTip': 'Clear conversation',
      'view.emptyTable': 'Reshape this Base or ask questions in one sentence',
      'view.emptyCollab': 'Check agenda, tasks, chats, mail, or docs',
      'view.tablePlaceholder': 'Add a column, update rows, or ask about data…',
      'view.collabPlaceholder': 'Ask about agenda, tasks, chats, or mail…',
      'view.userRole': 'You',
      'view.thinkingDone': 'Reasoning',
      'view.retry': 'Retry',
      'view.noToken': 'Could not read table token from link',
      'view.confirmTitle': 'Confirm deletion',
      'view.confirmBody': 'These changes cannot be undone:',
      'view.confirmYes': 'Delete',
      'view.confirmNo': 'Cancel',
      'view.skillConfirm': 'Confirm & run',
      'view.skillRunning': 'Running…',
      'view.skillTitle': 'Confirm action',
      'view.skillPending': 'Pending',
      'view.skillDone': 'Executed',
      'view.skillCancelled': 'Cancelled',
      'view.skillCancel': 'Cancel',
      'view.skillCmdShow': 'Command details',
      'view.skillCmdHide': 'Hide command',
      'view.resizeTip': 'Drag to resize, double-click to reset',
      'view.webviewLoading': 'Loading Feishu Base…',
      'view.webviewError': 'Failed to load table',
      'view.scopeNeed': 'Permission required: %s',
      'view.scopeAuth': 'Authorize & continue',
      'view.scopeWaiting': 'Waiting for Feishu…',
      'view.scopeConsole': 'Console',

      'starter.analyze': 'Analyze data',
      'starter.analyze.prompt': 'Analyze the current table data and summarize key insights and distributions',
      'starter.kanban': 'Create Kanban',
      'starter.kanban.prompt': 'Add a Kanban view grouped by the status column',
      'starter.form': 'Intake form',
      'starter.form.prompt': 'Create an intake form for this table to collect new entries',
      'starter.batch': 'Check gaps',
      'starter.batch.prompt': 'Check the current records and list rows with missing or incomplete fields',
      'starter.calendar': 'Today agenda',
      'starter.calendar.prompt': 'Check my agenda and meetings for today',
      'starter.todo': 'Open tasks',
      'starter.todo.prompt': 'List all my open tasks and to-dos',
      'starter.chat': 'Group chats',
      'starter.chat.prompt': 'Search the Feishu group chats I have joined',
      'starter.mail': 'Recent mail',
      'starter.mail.prompt': 'Check my recent important emails',

      'error.title': 'Something went wrong',
      'error.retry': 'Retry',
      'err.empty': 'No response received. Please try again.',
      'err.noCli': 'Feishu connector setup is incomplete.',
      'err.codeInvalid': 'Authorization link is invalid. Please request a new one.',
      'err.codeExpired': 'Authorization link expired. Please request a new one.',
      'err.pending': 'Waiting for workspace admin approval. Retry once approved.',
      'err.rateLimit': 'Too many requests. Please try again in a moment.',
      'err.scope': 'Missing Feishu permissions. Please grant access in settings.',
      'err.auth': 'Feishu sign-in expired. Please re-authorize.',
      'err.timeout': 'Request timed out. Check your network and try again.',
      'err.network': 'Network error. Check your connection and try again.',
      'err.plan': 'Could not understand the request. Try rephrasing or pick a starter.',
      'err.incomplete': 'Required details are missing. Please add them and retry.',

      'file.attach': 'Attach file or image (drag & drop / paste)',
      'file.dropHint': 'Drop to attach',
      'file.tooLarge': 'Each file must be 20 MB or smaller',
      'file.tooMany': 'Up to 5 files per message',
      'file.uploadFailed': 'File upload failed. Please try again.',
      'file.uploadingWait': 'Uploading file…',
      'file.visionUnsupported': 'Selected model does not support images. Switch model or attach a document.',
      'file.importBadge': 'Imports {n} real rows',
      'file.defaultPrompt': 'Attached {n} file(s)',
      'busy.planningTable': 'Designing Base structure…',
      'busy.buildingPreview': 'Assembling preview table and sample data…',
      'busy.routingCollab': 'Opening Lark Assistant…',
      'busy.writing': 'Drafting response…',
      'composer.queued': 'Queued: ',
      'composer.cancelQueue': 'Cancel',

      'gate.step.tool': 'Setup',
      'gate.step.app': 'Connect App',
      'gate.step.auth': 'Authorize',
      'gate.noTool.title': 'Preparing Feishu connection',
      'gate.noTool.body': 'Setting up your Feishu connection automatically — no manual steps required.',
      'gate.noTool.installing': 'Downloading and preparing component…',
      'gate.noTool.retry': 'Retry setup',
      'gate.noTool.manualToggle': 'Network restricted? Manual install',
      'gate.noTool.manualHide': 'Hide manual install',
      'gate.noTool.copy': 'Copy',
      'gate.noTool.copied': 'Copied',
      'gate.noTool.done': 'Installed, continue',
      'gate.noTool.hint': 'Proceeds automatically once download finishes.',
      'gate.noApp.title': 'Connect your Feishu app',
      'gate.noApp.body': 'Name your app and accept default permissions (~1 min).',
      'gate.noApp.cta': 'Open Feishu',
      'gate.noApp.done': 'Done, verify',
      'gate.noApp.reopen': 'Open again',
      'gate.brandLabel': 'Edition',
      'gate.brandFeishu': 'Feishu (China)',
      'gate.brandLark': 'Lark (Global)',
      'gate.team.toggle': 'Use existing app credentials',
      'gate.team.hide': 'Hide',
      'gate.team.appId': 'App ID (cli_…)',
      'gate.team.secret': 'App Secret',
      'gate.team.save': 'Connect app',
      'gate.noAuth.title': 'Authorize Feishu',
      'gate.noAuth.body': 'One-time confirmation. Data stays strictly in your Feishu space.',
      'gate.noAuth.cta': 'Authorize',
      'gate.noAuth.done': 'Authorized, verify',
      'gate.noAuth.reopen': 'Open again',
      'gate.waiting': 'Confirming',
      'gate.autoChecking': 'Auto-detecting authorization…',
      'gate.pending': 'Not confirmed yet. Finish authorization in the browser and retry.',
      'gate.retryBody': 'Local service did not respond. Please retry.',

      'account.title': 'Feishu Connection',
      'account.user': 'Account',
      'account.app': 'App',
      'account.cli': 'CLI',
      'account.authed': 'Authorized',
      'account.notLogin': 'Signed out',
      'account.notConfigured': 'Not set',
      'account.cliReady': 'Ready',
      'account.cliMissing': 'Unavailable',
      'account.scopesTitle': 'Capabilities',
      'account.console': 'Console',
      'account.scopeChecking': 'Checking',
      'account.scopesCheckingLine': 'Checking Feishu capability permissions…',
      'account.scopeReady': 'Active',
      'account.scopeOff': 'Inactive',
      'account.scopeRetry': 'Recheck',
      'account.scopeError': 'Could not verify capabilities. Check network and retry.',
      'account.reauthBanner': 'Feishu sign-in expired. Re-authorize to continue (enable "Refresh user_access_token" in Feishu Console to avoid 2-hour expiry).',
      'account.reauthCta': 'Re-authorize',
      'account.allReady': 'All capabilities ready',
      'account.grantAll': 'Grant permissions',
      'account.granting': 'Waiting…',
      'account.logout': 'Sign out',
      'account.unbind': 'Unbind app',
      'account.logoutTitle': 'Sign out of Feishu?',
      'account.logoutBody': 'Clears the local token for “%s”. You can sign in with another account anytime.',
      'account.logoutConfirm': 'Sign out',
      'account.unbindTitle': 'Unbind this Feishu app?',
      'account.unbindBody': 'Removes stored credentials (%s) so you can bind another enterprise app.',
      'account.unbindConfirm': 'Unbind',
      'account.working': 'Working…',
      'account.cancel': 'Cancel',
      'account.close': 'Close',
      'settings.convTabLabel': 'Conversation header tab',
      'settings.convTabDesc': 'Show Lark Workbench tab beside Chat / Trajectory in conversations',
      'settings.convTabSaving': 'Saving…',
      'scope.base': 'Base',
      'scope.calendar': 'Calendar',
      'scope.task': 'Tasks',
      'scope.im': 'Chats',
      'scope.mail': 'Mail',
      'scope.contact': 'Contacts',
      'scope.approval': 'Approvals',
      'scope.docs': 'Docs',
      'scope.drive': 'Drive',
      'scope.wiki': 'Wiki',
      'scope.sheets': 'Sheets',
      'scope.slides': 'Slides',
      'scope.markdown': 'Markdown',
      'scope.mindnotes': 'Mindnotes',
      'scope.whiteboard': 'Whiteboard',
      'scope.vc': 'Meetings',
      'scope.minutes': 'Minutes',
      'scope.note': 'Meeting Notes',
      'scope.okr': 'OKR',
      'scope.attendance': 'Attendance',
      'scope.apps': 'Miaoda Apps',
      'scope.event': 'Live Events',
      'scope.application': 'App Admin',
      'scope.defaultDomain': 'Feishu Feature',

      'kind.text': 'Text',
      'kind.number': 'Number',
      'kind.select': 'Select',
      'kind.datetime': 'Date',
      'kind.user': 'Person',
      'kind.checkbox': 'Check',
    }

    const KIND_ICON = {
      text: 'fieldText',
      number: 'fieldNumber',
      select: 'fieldSelect',
      datetime: 'fieldDate',
      user: 'fieldUser',
      checkbox: 'fieldCheck',
    }

    const PILL_TONES = ['blue', 'slate', 'teal', 'amber', 'emerald', 'rose']

    // ── Unified Design Tokens & Apple-Grade Motion Stylesheet ──────────────

    const CSS = `
.lw {
  /* Semantic Color Tokens — harmonized with DSH host + Notion/Linear restraint */
  --lw-bg: var(--dsw-alias-bg-base, #FFFFFF);
  --lw-surface: var(--dsw-alias-bg-layer-1, #FFFFFF);
  --lw-surface-2: var(--dsw-alias-bg-module-platform, #F6F7F8);
  --lw-surface-3: rgba(15, 17, 21, 0.045);
  --lw-ink: var(--dsw-alias-label-primary, #0F1115);
  --lw-ink-2: var(--dsw-alias-label-secondary, #5B616C);
  --lw-ink-3: var(--dsw-alias-label-tertiary, #8A909B);
  --lw-line: var(--dsw-alias-border-l2, rgba(15, 17, 21, 0.08));
  --lw-line-2: var(--dsw-alias-border-l3, rgba(15, 17, 21, 0.14));
  --lw-accent: #3370FF;
  --lw-accent-soft: rgba(51, 112, 255, 0.08);
  --lw-solid: var(--dsw-alias-button-primary-fill, #111318);
  --lw-solid-hover: var(--dsw-alias-button-primary-hover, #2A2E37);
  --lw-solid-ink: var(--dsw-alias-label-primary-foreground, #FFFFFF);
  --lw-ok: #16865A;
  --lw-warn: #B2680B;
  --lw-danger: #CC2B24;
  --lw-mask: rgba(15, 17, 21, 0.34);

  /* Elevation — single light source, whisper-quiet shadows */
  --lw-e1: 0 1px 2px rgba(15, 17, 21, 0.04);
  --lw-e2: 0 0 0 0.5px var(--lw-line-2), 0 4px 16px -4px rgba(15, 17, 21, 0.06);
  --lw-e3: 0 0 0 0.5px var(--lw-line-2), 0 8px 28px -8px rgba(15, 17, 21, 0.1), 0 2px 6px rgba(15, 17, 21, 0.03);
  --lw-e-modal: 0 0 0 0.5px var(--lw-line-2), 0 20px 56px -12px rgba(15, 17, 21, 0.18);

  /* Radii — aligned with DSH scale */
  --r-xs: var(--dsw-radius-xs, 4px);
  --r-sm: var(--dsw-radius-sm, 8px);
  --r-md: var(--dsw-radius-md, 12px);
  --r-lg: var(--dsw-radius-lg, 16px);
  --r-xl: var(--dsw-radius-xl, 20px);

  /* Unified Motion Grammar — Apple/Linear calibrated */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-spring: cubic-bezier(0.34, 1.4, 0.64, 1);
  --ease-io: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);
  --dur-press: 90ms;
  --dur-micro: 150ms;
  --dur-ui: 220ms;
  --dur-view: 260ms;

  --mono: var(--ds-font-family-code, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace);

  position: relative;
  height: 100%;
  width: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  justify-content: center;
  padding: 28px 32px 64px;
  box-sizing: border-box;
  background: var(--lw-bg);
  color: var(--lw-ink);
  font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif);
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

.lw[data-theme="dark"] {
  --lw-bg: var(--dsw-alias-bg-base, #151517);
  --lw-surface: var(--dsw-alias-bg-layer-1, #1C1C1F);
  --lw-surface-2: var(--dsw-alias-bg-layer-2, #232327);
  --lw-surface-3: rgba(255, 255, 255, 0.06);
  --lw-ink: var(--dsw-alias-label-primary, #F3F4F6);
  --lw-ink-2: var(--dsw-alias-label-secondary, #A1A6B2);
  --lw-ink-3: var(--dsw-alias-label-tertiary, #6F7582);
  --lw-line: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.08));
  --lw-line-2: var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.14));
  --lw-accent: #7AA7FF;
  --lw-accent-soft: rgba(122, 167, 255, 0.14);
  --lw-solid: var(--dsw-alias-button-primary-fill, #F3F4F6);
  --lw-solid-hover: var(--dsw-alias-button-primary-hover, #FFFFFF);
  --lw-solid-ink: var(--dsw-alias-label-primary-foreground, #111318);
  --lw-ok: #4AD295;
  --lw-warn: #F0B45A;
  --lw-danger: #F47A74;
  --lw-mask: rgba(0, 0, 0, 0.52);

  --lw-e1: 0 1px 2px rgba(0, 0, 0, 0.28);
  --lw-e2: 0 0 0 0.5px var(--lw-line-2), 0 8px 24px -8px rgba(0, 0, 0, 0.48);
  --lw-e3: 0 0 0 0.5px var(--lw-line-2), 0 14px 36px -10px rgba(0, 0, 0, 0.62);
  --lw-e-modal: 0 0 0 0.5px var(--lw-line-2), 0 24px 64px -12px rgba(0, 0, 0, 0.72);
}

.lw *, .lw *::before, .lw *::after { box-sizing: border-box; }
.lw ::selection { background: color-mix(in srgb, var(--lw-accent) 22%, transparent); }

/* ── Keyframes (GPU-only: transform & opacity) ────────────────────────── */
@keyframes lwStageIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes lwMsgUserIn {
  from { opacity: 0; transform: translateY(8px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes lwMsgAiIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes lwPopIn {
  from { opacity: 0; transform: scale(0.76); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes lwSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes lwPulse {
  0%, 100% { opacity: 0.3; transform: scale(0.92); }
  50% { opacity: 1; transform: scale(1); }
}
@keyframes lwShimmerSweep {
  from { transform: translateX(-100%); }
  to { transform: translateX(100%); }
}
@keyframes lwTextBreath {
  0%, 100% { opacity: 0.52; }
  50% { opacity: 1; }
}
@keyframes lwThinkDot {
  0%, 80%, 100% { opacity: 0.28; transform: translateY(0) scale(0.86); }
  40% { opacity: 1; transform: translateY(-1.5px) scale(1); }
}
@keyframes lwCheckDraw {
  from { stroke-dashoffset: 24; }
  to { stroke-dashoffset: 0; }
}

.lw-stage-in { animation: lwStageIn var(--dur-view) var(--ease-out) both; }
.lw-spin { animation: lwSpin 760ms linear infinite; }
.lw-pop-in { animation: lwPopIn 180ms var(--ease-spring) both; }
.lw-boot {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 180px;
}

/* ── Layout Shell ─────────────────────────────────────────────────────── */
.lw-col {
  width: 100%;
  max-width: 680px;
  min-width: 0;
  min-height: 100%;
  display: flex;
  flex-direction: column;
}
.lw-body {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  margin: auto 0;
  padding-bottom: 11vh;
}

/* ── Top Chrome (Whisper-Quiet) ───────────────────────────────────────── */
.lw-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 32px;
}
.lw-head-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.lw-mark {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  flex: none;
  background: linear-gradient(155deg, #3E6BF5 0%, #244DD1 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 2px rgba(36, 77, 209, 0.26), inset 0 0.5px 0 rgba(255, 255, 255, 0.32);
}
.lw-name {
  font-size: 13px;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: var(--lw-ink-2);
  white-space: nowrap;
}

.lw-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  height: 26px;
  padding: 0 9px;
  border-radius: 9999px;
  corner-shape: round;
  border: 0.5px solid transparent;
  background: transparent;
  color: var(--lw-ink-3);
  font: inherit;
  font-size: 12px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background var(--dur-micro) var(--ease-io), color var(--dur-micro) var(--ease-io),
    border-color var(--dur-micro) var(--ease-io), transform var(--dur-press) var(--ease-out);
}
.lw-status:active { transform: scale(0.97); }
.lw-status:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in srgb, var(--lw-accent) 40%, transparent); }

.lw-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  corner-shape: round;
  background: var(--lw-ink-3);
  flex: none;
  transition: background var(--dur-micro) var(--ease-io);
}
.lw-dot.is-ok { background: var(--lw-ok); }
.lw-dot.is-bad { background: var(--lw-danger); }
.lw-dot.is-busy { background: var(--lw-accent); animation: lwPulse 1.4s var(--ease-io) infinite; }

/* ── Home Stage (Radical Breathing Room) ──────────────────────────────── */
.lw-pick {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.lw-hero-title {
  margin: 0 0 4px;
  font-size: clamp(24px, 3vw, 30px);
  font-weight: 600;
  line-height: 1.28;
  letter-spacing: -0.025em;
  color: var(--lw-ink);
  text-wrap: balance;
}

/* ── Focal Composer ───────────────────────────────────────────────────── */
.lw-composer {
  position: relative;
  background: var(--lw-surface);
  border-radius: var(--r-xl);
  box-shadow: var(--lw-e3);
  transition: box-shadow var(--dur-ui) var(--ease-out);
}
.lw-composer:focus-within {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--lw-ink) 22%, transparent), 0 10px 30px -10px rgba(15, 17, 21, 0.12);
}
.lw[data-theme="dark"] .lw-composer:focus-within {
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.22), 0 14px 36px -10px rgba(0, 0, 0, 0.68);
}
.lw-composer-area {
  font: inherit;
  font-size: 14px;
  line-height: 1.6;
  color: var(--lw-ink);
  width: 100%;
  min-height: 48px;
  max-height: 168px;
  padding: 14px 16px 6px;
  border: 0;
  background: transparent;
  outline: none;
  resize: none;
  display: block;
  overflow-y: auto;
}
.lw-composer-area::placeholder { color: var(--lw-ink-3); }
.lw-composer.is-busy {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--lw-accent) 24%, transparent), 0 8px 28px -8px color-mix(in srgb, var(--lw-accent) 12%, rgba(15, 17, 21, 0.08));
}

.lw-composer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px 10px 12px;
}
.lw-composer-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.lw-composer-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

/* Composer Attach Button & Restrained File Pills */
.lw-attach-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--r-pill);
  border: 0;
  background: transparent;
  color: var(--lw-ink-3);
  cursor: pointer;
  transition: background var(--dur-micro) var(--ease-io), color var(--dur-micro) var(--ease-io), transform var(--dur-press) var(--ease-out);
}
.lw-attach-btn:hover:not(:disabled) {
  background: var(--lw-surface-2);
  color: var(--lw-ink);
}
.lw-attach-btn:active:not(:disabled) { transform: scale(0.93); }
.lw-attach-btn:disabled { opacity: 0.35; cursor: not-allowed; }

.lw-composer.is-drag {
  box-shadow: 0 0 0 1.5px var(--lw-ink), 0 12px 32px -10px rgba(15, 17, 21, 0.14);
}
.lw[data-theme="dark"] .lw-composer.is-drag {
  box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.72), 0 14px 36px -10px rgba(0, 0, 0, 0.72);
}

.lw-drop-overlay {
  position: absolute;
  inset: 4px;
  z-index: 6;
  border-radius: calc(var(--r-xl) - 4px);
  border: 1.5px dashed color-mix(in srgb, var(--lw-ink) 32%, transparent);
  background: color-mix(in srgb, var(--lw-surface) 88%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--lw-ink);
  font-size: 13px;
  font-weight: 500;
  pointer-events: none;
  animation: lw-fade-scale var(--dur-ui) var(--ease-out) both;
}

.lw-file-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 14px 0;
}

@keyframes lw-pill-in {
  from { opacity: 0; transform: translateY(4px) scale(0.95); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes lw-fade-scale {
  from { opacity: 0; transform: scale(0.985); }
  to { opacity: 1; transform: scale(1); }
}

.lw-file-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  height: 28px;
  padding: 0 6px 0 8px;
  border-radius: var(--r-pill);
  border: 1px solid var(--lw-line);
  background: var(--lw-surface-2);
  color: var(--lw-ink);
  font-size: 12px;
  line-height: 1;
  animation: lw-pill-in var(--dur-ui) var(--ease-spring) both;
  transition: border-color var(--dur-micro) var(--ease-io), background var(--dur-micro) var(--ease-io);
}
.lw-file-pill.is-error {
  border-color: color-mix(in srgb, var(--lw-danger) 45%, transparent);
  background: color-mix(in srgb, var(--lw-danger) 8%, var(--lw-surface));
  color: var(--lw-danger);
}
.lw-file-pill-ico {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--lw-ink-2);
}
.lw-file-pill-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.lw-file-pill-meta {
  flex: none;
  font-size: 11px;
  color: var(--lw-ink-3);
  font-variant-numeric: tabular-nums;
}
.lw-file-pill-rm {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 0;
  background: transparent;
  color: var(--lw-ink-3);
  cursor: pointer;
  transition: background var(--dur-micro) var(--ease-io), color var(--dur-micro) var(--ease-io), transform var(--dur-press) var(--ease-out);
}
.lw-file-pill-rm:hover {
  background: color-mix(in srgb, var(--lw-ink) 10%, transparent);
  color: var(--lw-ink);
}
.lw-file-pill-rm:active { transform: scale(0.88); }

.lw-file-warn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px 0;
  font-size: 11.5px;
  color: var(--lw-warn, #b45309);
  animation: lw-pill-in var(--dur-micro) var(--ease-out) both;
}

.lw-ring {
  transform: rotate(-90deg);
}
.lw-ring-track {
  stroke: color-mix(in srgb, var(--lw-ink) 16%, transparent);
}
.lw-ring-fill {
  stroke: var(--lw-ink);
  transition: stroke-dashoffset 140ms linear;
}

.lw-msg-files {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 5px;
  margin-bottom: 6px;
}
.lw-msg-file-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: var(--r-pill);
  background: var(--lw-surface-2);
  border: 1px solid var(--lw-line);
  font-size: 11.5px;
  color: var(--lw-ink-2);
  max-width: 210px;
}
.lw-msg-file-chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Circular Send / Stop Action */
.lw-send-btn {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  corner-shape: round;
  border: 0;
  background: var(--lw-solid);
  color: var(--lw-solid-ink);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: none;
  transition: background var(--dur-micro) var(--ease-io), transform var(--dur-press) var(--ease-out),
    opacity var(--dur-micro) var(--ease-io);
}
.lw-send-btn:active:not(:disabled) { transform: scale(0.92); }
.lw-send-btn:disabled {
  background: var(--lw-surface-3);
  color: var(--lw-ink-3);
  cursor: default;
}
.lw-send-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in srgb, var(--lw-accent) 45%, transparent); }
.lw-send-btn.is-stop {
  background: var(--lw-solid);
  color: var(--lw-solid-ink);
}

/* ── Custom Model Picker Popover (No Raw Browser <select>) ────────────── */
.lw-picker-wrap { position: relative; display: inline-flex; }
.lw-picker-trigger {
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  color: var(--lw-ink-2);
  height: 28px;
  max-width: 190px;
  padding: 0 8px 0 10px;
  border-radius: var(--r-sm);
  border: 0;
  background: transparent;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  transition: background var(--dur-micro) var(--ease-io), color var(--dur-micro) var(--ease-io),
    transform var(--dur-press) var(--ease-out);
}
.lw-picker-trigger:active:not(:disabled) { transform: scale(0.97); }
.lw-picker-trigger:disabled { opacity: 0.5; cursor: default; }
.lw-picker-trigger:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in srgb, var(--lw-accent) 40%, transparent); }
.lw-picker-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lw-picker-chev {
  color: var(--lw-ink-3);
  transition: transform var(--dur-micro) var(--ease-out);
}
.lw-picker-trigger[aria-expanded="true"] .lw-picker-chev { transform: rotate(180deg); }

.lw-popover {
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  min-width: 200px;
  max-width: 280px;
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;
  border-radius: var(--r-md);
  background: var(--lw-surface);
  box-shadow: var(--lw-e-modal);
  z-index: 400;
  transform-origin: bottom left;
  opacity: 0;
  transform: translateY(4px) scale(0.97);
  transition: opacity var(--dur-micro) var(--ease-out), transform var(--dur-ui) var(--ease-out);
}
.lw-popover.is-open {
  opacity: 1;
  transform: translateY(0) scale(1);
}
.lw-popover.is-closing {
  opacity: 0;
  transform: translateY(3px) scale(0.98);
  transition: opacity 120ms var(--ease-exit), transform 120ms var(--ease-exit);
}
.lw-popover-item {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--lw-ink);
  font: inherit;
  font-size: 12.5px;
  font-weight: 400;
  text-align: left;
  padding: 7px 9px;
  border-radius: var(--r-sm);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
  transition: background var(--dur-micro) var(--ease-io);
}
.lw-popover-item.is-selected {
  font-weight: 500;
  background: var(--lw-surface-3);
}
.lw-popover-item:focus-visible { outline: none; background: var(--lw-surface-3); }
.lw-popover-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lw-popover-check { color: var(--lw-accent); flex: none; }

/* ── Minimal Starter Chips & Animated Collapse ────────────────────────── */
.lw-scenes-wrap { display: flex; flex-direction: column; gap: 8px; }
.lw-scenes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.lw-chip {
  font: inherit;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 0.5px solid transparent;
  background: color-mix(in srgb, var(--lw-ink) 3.5%, transparent);
  color: var(--lw-ink-3);
  font-size: 12px;
  font-weight: 400;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--dur-micro) var(--ease-io), border-color var(--dur-micro) var(--ease-io),
    color var(--dur-micro) var(--ease-io), transform var(--dur-press) var(--ease-out);
}
.lw-chip:active:not(:disabled) { transform: scale(0.97); }
.lw-chip:focus-visible { outline: none; border-color: var(--lw-accent); box-shadow: 0 0 0 2px var(--lw-accent-soft); }
.lw-chip:disabled { opacity: 0.45; cursor: default; }
.lw-chip-ico { color: var(--lw-ink-3); opacity: 0.85; transition: color var(--dur-micro) var(--ease-io); }
.lw-chip.is-muted { border-color: transparent; background: transparent; color: var(--lw-ink-3); padding: 0 8px; }

/* Smooth Grid-Row Collapse (Interruptible, Zero Jitter, Non-Focusable When Closed) */
.lw-collapse {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition: grid-template-rows var(--dur-ui) var(--ease-out), opacity var(--dur-micro) var(--ease-out);
}
.lw-collapse.is-open {
  grid-template-rows: 1fr;
  opacity: 1;
}
.lw-collapse-inner {
  overflow: hidden;
  min-height: 0;
  visibility: hidden;
  transition: visibility 0ms linear var(--dur-ui);
}
.lw-collapse.is-open .lw-collapse-inner {
  visibility: visible;
  transition-delay: 0ms;
}

/* ── Recent Strip (Ultra-Quiet, Instant Remove + Undo Toast) ──────────── */
.lw-recent {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding-top: 4px;
}
.lw-recent-label {
  font-size: 11.5px;
  color: var(--lw-ink-3);
  flex: none;
  margin-right: 2px;
}
.lw-recent-list {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: wrap;
}
.lw-recent-item {
  display: inline-flex;
  align-items: center;
  border-radius: var(--r-sm);
  transition: background var(--dur-micro) var(--ease-io);
}
.lw-recent-open {
  font: inherit;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 4px 0 7px;
  border: 0;
  background: none;
  border-radius: var(--r-sm);
  color: var(--lw-ink-2);
  font-size: 12px;
  font-weight: 400;
  cursor: pointer;
  max-width: 200px;
  transition: color var(--dur-micro) var(--ease-io);
}
.lw-recent-open:disabled { opacity: 0.45; cursor: default; }
.lw-recent-open:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--lw-accent-soft); }
.lw-recent-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lw-recent-del {
  width: 18px;
  height: 18px;
  margin-right: 3px;
  border: 0;
  border-radius: var(--r-xs);
  background: none;
  color: var(--lw-ink-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--dur-micro) var(--ease-io), background var(--dur-micro) var(--ease-io),
    color var(--dur-micro) var(--ease-io);
}
.lw-recent-del:focus-visible { opacity: 1; outline: none; box-shadow: 0 0 0 2px var(--lw-accent-soft); }
@media (hover: none), (pointer: coarse) {
  .lw-recent-del { opacity: 0.65; }
}

/* ── Controls (Unified DSH Geometry) ──────────────────────────────────── */
.lw-btn {
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  height: 34px;
  padding: 0 14px;
  border-radius: var(--r-md);
  border: 0.5px solid var(--lw-line-2);
  background: var(--lw-surface);
  color: var(--lw-ink);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  white-space: nowrap;
  flex: none;
  transition: background var(--dur-micro) var(--ease-io), border-color var(--dur-micro) var(--ease-io),
    color var(--dur-micro) var(--ease-io), transform var(--dur-press) var(--ease-out),
    opacity var(--dur-micro) var(--ease-io);
}
.lw-btn:active:not(:disabled) { transform: scale(0.975); }
.lw-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in srgb, var(--lw-accent) 42%, transparent); }
.lw-btn:disabled { opacity: 0.42; cursor: default; }

.lw-btn.is-primary {
  background: var(--lw-solid);
  border-color: transparent;
  color: var(--lw-solid-ink);
}
.lw-btn.is-ghost {
  background: transparent;
  border-color: transparent;
  color: var(--lw-ink-2);
  padding: 0 9px;
}
.lw-btn.is-ghost.is-active {
  background: var(--lw-surface-3);
  color: var(--lw-ink);
}
.lw-btn.is-link {
  background: none;
  border: 0;
  height: auto;
  padding: 2px 0;
  font-size: 12px;
  color: var(--lw-ink-3);
}
.lw-btn.is-sm {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  border-radius: var(--r-sm);
}
.lw-btn.is-icon {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: var(--r-sm);
}
.lw-btn.is-danger {
  background: color-mix(in srgb, var(--lw-danger) 10%, transparent);
  border-color: color-mix(in srgb, var(--lw-danger) 28%, transparent);
  color: var(--lw-danger);
}
.lw-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.lw-input {
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border-radius: var(--r-md);
  border: 0.5px solid var(--lw-line-2);
  background: var(--lw-surface);
  color: var(--lw-ink);
  outline: none;
  transition: border-color var(--dur-micro) var(--ease-io), box-shadow var(--dur-micro) var(--ease-io);
}
.lw-input::placeholder { color: var(--lw-ink-3); }
.lw-input:focus {
  border-color: color-mix(in srgb, var(--lw-accent) 60%, transparent);
  box-shadow: 0 0 0 3px var(--lw-accent-soft);
}

/* ── Card, Banners & Skeletons ────────────────────────────────────────── */
.lw-card {
  background: var(--lw-surface);
  border: 0.5px solid var(--lw-line);
  border-radius: var(--r-xl);
  padding: 24px 26px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.lw-sect { display: flex; flex-direction: column; gap: 4px; }
.lw-h { font-size: 15px; font-weight: 600; line-height: 1.4; letter-spacing: -0.015em; color: var(--lw-ink); margin: 0; }
.lw-h-lg { font-size: 19px; letter-spacing: -0.02em; }
.lw-p { font-size: 13px; line-height: 1.65; color: var(--lw-ink-2); margin: 0; }
.lw-meta { font-size: 12px; line-height: 1.5; color: var(--lw-ink-3); margin: 0; }

.lw-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 13px;
  border-radius: var(--r-md);
  border: 0.5px solid color-mix(in srgb, var(--lw-danger) 26%, transparent);
  background: color-mix(in srgb, var(--lw-danger) 5%, var(--lw-surface));
  animation: lwStageIn var(--dur-ui) var(--ease-out) both;
}
.lw-banner.is-warn {
  border-color: color-mix(in srgb, var(--lw-warn) 28%, transparent);
  background: color-mix(in srgb, var(--lw-warn) 5%, var(--lw-surface));
}
.lw-banner-ico { color: var(--lw-danger); margin-top: 2px; flex: none; }
.lw-banner.is-warn .lw-banner-ico { color: var(--lw-warn); }
.lw-banner-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.lw-banner-title { font-size: 12.5px; font-weight: 500; color: var(--lw-ink); }
.lw-banner-text { font-size: 12px; line-height: 1.55; color: var(--lw-ink-2); word-break: break-word; }
.lw-banner-action { flex: none; align-self: center; }

/* GPU-Composited Shimmer Skeleton */
.lw-planning {
  display: flex;
  flex-direction: column;
  gap: 12px;
  animation: lwStageIn var(--dur-ui) var(--ease-out) both;
}
.lw-plan-status {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  align-self: center;
  padding: 6px 0;
  transition: opacity var(--dur-micro) var(--ease-out), transform var(--dur-ui) var(--ease-out);
}
.lw-plan-status.is-building {
  align-self: flex-start;
  padding: 2px 0 0;
}
.lw-think-dots {
  display: inline-flex;
  align-items: center;
  gap: 3.5px;
}
.lw-think-dots span {
  width: 4.5px;
  height: 4.5px;
  border-radius: 50%;
  background: var(--lw-accent);
  animation: lwThinkDot 1.2s var(--ease-io) infinite;
}
.lw-think-dots span:nth-child(2) { animation-delay: 160ms; }
.lw-think-dots span:nth-child(3) { animation-delay: 320ms; }
.lw-skel-table {
  border: 0.5px solid var(--lw-line);
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--lw-surface);
}
.lw-skel-row {
  display: grid;
  grid-template-columns: 1.3fr 1fr 1fr 1fr;
  gap: 14px;
  padding: 13px 16px;
  border-bottom: 0.5px solid var(--lw-line);
}
.lw-skel-row.is-head { background: var(--lw-surface-2); }
.lw-skel-row:last-child { border-bottom: 0; }
.lw-skel {
  position: relative;
  height: 9px;
  border-radius: var(--r-xs);
  background: var(--lw-surface-3);
  overflow: hidden;
}
.lw-skel::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--lw-ink) 8%, transparent), transparent);
  animation: lwShimmerSweep 1.5s var(--ease-io) infinite;
  will-change: transform;
}

/* ── Connection Gate ──────────────────────────────────────────────────── */
.lw-steps { display: flex; align-items: center; flex-wrap: wrap; row-gap: 8px; }
.lw-step { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--lw-ink-3); }
.lw-step-num {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  corner-shape: round;
  border: 0.5px solid var(--lw-line-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10.5px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  flex: none;
  color: var(--lw-ink-3);
  transition: background var(--dur-ui) var(--ease-out), border-color var(--dur-ui) var(--ease-out),
    color var(--dur-ui) var(--ease-out);
}
.lw-step.is-done .lw-step-num { background: var(--lw-ok); border-color: transparent; color: #FFFFFF; }
.lw-step.is-done { color: var(--lw-ink-2); }
.lw-step.is-current .lw-step-num { border-color: var(--lw-accent); color: var(--lw-accent); background: var(--lw-accent-soft); }
.lw-step.is-current { color: var(--lw-ink); font-weight: 500; }
.lw-step-bar { width: 20px; height: 0.5px; background: var(--lw-line-2); margin: 0 8px; flex: none; }

.lw-cmd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 8px 8px 13px;
  border-radius: var(--r-md);
  background: var(--lw-surface-2);
  border: 0.5px solid var(--lw-line);
}
.lw-cmd code {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--lw-ink);
  user-select: all;
  overflow-x: auto;
  white-space: nowrap;
}
.lw-url {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--lw-ink-3);
  word-break: break-all;
  text-decoration: none;
  transition: color var(--dur-micro) var(--ease-io);
}
.lw-wait {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--lw-ink-3);
  font-variant-numeric: tabular-nums;
}
.lw-field { display: flex; flex-direction: column; gap: 10px; }

/* ── Workspace & Preview Full-Bleed Shell ─────────────────────────────── */
.lw.is-workspace {
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}
.lw-workspace {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.lw-ws-header {
  height: 46px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 14px;
  border-bottom: 0.5px solid var(--lw-line);
  background: var(--lw-bg);
  z-index: 20;
}
.lw-ws-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.lw-ws-header-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}
.lw-back {
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--lw-ink-2);
  background: transparent;
  border: 0;
  height: 28px;
  padding: 0 8px 0 5px;
  margin-left: -4px;
  border-radius: var(--r-sm);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  flex: none;
  transition: background var(--dur-micro) var(--ease-io), color var(--dur-micro) var(--ease-io),
    transform var(--dur-press) var(--ease-out);
}
.lw-back:active:not(:disabled) { transform: scale(0.96); }
.lw-back:disabled { opacity: 0.42; cursor: default; }
.lw-back:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--lw-accent-soft); }

.lw-ws-sep {
  width: 0.5px;
  height: 14px;
  background: var(--lw-line-2);
  flex: none;
}
.lw-ws-title {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--lw-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

/* Segmented Switch (Compact Viewport: Chat | Table) */
.lw-seg {
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border-radius: var(--r-sm);
  background: var(--lw-surface-2);
  border: 0.5px solid var(--lw-line);
  gap: 2px;
}
.lw-seg-btn {
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  height: 24px;
  padding: 0 9px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--lw-ink-3);
  cursor: pointer;
  transition: background var(--dur-micro) var(--ease-io), color var(--dur-micro) var(--ease-io);
}
.lw-seg-btn.is-active {
  background: var(--lw-surface);
  color: var(--lw-ink);
  box-shadow: var(--lw-e1);
}

/* ── Preview Blueprint Stage ──────────────────────────────────────────── */
.lw-preview-scroll {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 28px 24px 32px;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.lw-preview-inner {
  width: 100%;
  max-width: 900px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.lw-preview-head {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.lw-preview-title {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--lw-ink);
  margin: 0;
  line-height: 1.3;
}
.lw-preview-meta {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--lw-ink-3);
  font-variant-numeric: tabular-nums;
}
.lw-preview-sep { opacity: 0.45; }

.lw-table-wrap {
  position: relative;
  border-radius: var(--r-md);
  overflow-x: auto;
  background: var(--lw-surface);
  border: 0.5px solid var(--lw-line);
  min-width: 0;
  max-width: 100%;
  transition: opacity var(--dur-ui) var(--ease-out);
}
.lw-table-wrap.is-refining {
  opacity: 0.62;
  pointer-events: none;
}
.lw-table-wrap.is-refining::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--lw-accent), transparent);
  animation: lwShimmerSweep 1.2s var(--ease-io) infinite;
  z-index: 2;
  will-change: transform;
}
@keyframes lwColFlash {
  0% { background: color-mix(in srgb, var(--lw-accent) 16%, transparent); }
  100% { background: transparent; }
}
.lw-preview-reply {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 13px 16px;
  border-radius: var(--r-md);
  border: 0.5px solid var(--lw-line-2);
  background: var(--lw-surface);
  box-shadow: var(--lw-e2);
  animation: lwStageIn var(--dur-ui) var(--ease-out) both;
}
.lw-preview-reply-ico {
  color: var(--lw-accent);
  margin-top: 4px;
  flex: none;
}
.lw-preview-reply-text {
  flex: 1;
  min-width: 0;
  max-height: 240px;
  overflow-y: auto;
  padding-right: 4px;
  font-size: 13.5px;
  line-height: 1.68;
  color: var(--lw-ink);
  word-break: break-word;
}
.lw-preview-reply-text > :first-child {
  margin-top: 0;
}
.lw-preview-reply-text > :last-child {
  margin-bottom: 0;
}
.lw-preview-reply-close {
  flex: none;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--lw-ink-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background var(--dur-micro) var(--ease-io), color var(--dur-micro) var(--ease-io);
}
.lw-preview-reply-close:hover {
  background: var(--lw-surface-3);
  color: var(--lw-ink);
}
@keyframes lwNudgePulse {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--lw-accent) 45%, transparent); }
  70% { box-shadow: 0 0 0 6px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
.lw-btn.is-nudge {
  animation: lwNudgePulse 750ms var(--ease-out) 2;
}
.lw-table th.is-changed,
.lw-table td.is-changed {
  animation: lwColFlash 1600ms var(--ease-out) forwards;
}
.lw-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  min-width: 480px;
}
.lw-table th {
  text-align: left;
  padding: 10px 14px;
  background: var(--lw-surface-2);
  border-bottom: 0.5px solid var(--lw-line);
  white-space: nowrap;
  font-weight: 500;
  font-size: 12px;
  color: var(--lw-ink-2);
}
.lw-th-inner { display: inline-flex; align-items: center; gap: 6px; }
.lw-th-glyph { color: var(--lw-ink-3); }
.lw-table td {
  padding: 11px 14px;
  border-bottom: 0.5px solid var(--lw-line);
  color: var(--lw-ink);
  white-space: nowrap;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lw-table tbody tr:last-child td { border-bottom: 0; }
.lw-table td.is-empty { color: var(--lw-ink-3); opacity: 0.55; }
.lw-table td.is-num { font-variant-numeric: tabular-nums; }

/* Restrained Low-Saturation Option Pills */
.lw-pills { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.lw-pill {
  display: inline-flex;
  align-items: center;
  height: 21px;
  padding: 0 7px;
  border-radius: 5px;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}
.lw-pill.tone-blue { background: #EDF2FF; color: #2D53D6; }
.lw-pill.tone-slate { background: #F1F2F4; color: #525864; }
.lw-pill.tone-teal { background: #E7F5F2; color: #0F6F63; }
.lw-pill.tone-amber { background: #FBF1DF; color: #8C5A0D; }
.lw-pill.tone-emerald { background: #E9F5EE; color: #166D49; }
.lw-pill.tone-rose { background: #FCECEB; color: #A62B24; }
.lw[data-theme="dark"] .lw-pill.tone-blue { background: rgba(122, 167, 255, 0.16); color: #A5C4FF; }
.lw[data-theme="dark"] .lw-pill.tone-slate { background: rgba(255, 255, 255, 0.08); color: #C5CAD4; }
.lw[data-theme="dark"] .lw-pill.tone-teal { background: rgba(74, 210, 149, 0.14); color: #7EE5C5; }
.lw[data-theme="dark"] .lw-pill.tone-amber { background: rgba(240, 180, 90, 0.15); color: #F2C98A; }
.lw[data-theme="dark"] .lw-pill.tone-emerald { background: rgba(74, 210, 149, 0.14); color: #86E3B7; }
.lw[data-theme="dark"] .lw-pill.tone-rose { background: rgba(244, 122, 116, 0.15); color: #F9ABA6; }

.lw-details-toggle {
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  color: var(--lw-ink-3);
  background: none;
  border: 0;
  padding: 2px 0;
  cursor: pointer;
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: color var(--dur-micro) var(--ease-io);
}
.lw-details-chevron { transition: transform var(--dur-ui) var(--ease-out); }
.lw-details-chevron.is-open { transform: rotate(90deg); }

.lw-legend {
  display: flex;
  flex-direction: column;
  border-top: 0.5px solid var(--lw-line);
  margin-top: 6px;
}
.lw-legend-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 0.5px solid var(--lw-line);
  font-size: 12px;
  line-height: 1.5;
}
.lw-legend-row:last-child { border-bottom: 0; }
.lw-legend-key { flex: none; min-width: 92px; font-weight: 500; color: var(--lw-ink); }
.lw-legend-kind { flex: none; min-width: 34px; font-size: 11px; color: var(--lw-ink-3); }
.lw-legend-val { flex: 1; color: var(--lw-ink-2); min-width: 0; }
.lw-legend-opts { color: var(--lw-ink-3); font-size: 11px; margin-left: 6px; }

/* ── Split Workspace & Resizer ────────────────────────────────────────── */
.lw-ws-layout {
  display: flex;
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  overflow: hidden;
  position: relative;
}
.lw-ws-left {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: var(--lw-bg);
}
.lw-ws-left.is-full { flex: 1 1 auto; width: 100%; }
.lw-ws-left.is-split { flex: none; }
.lw-ws-left.is-easing { transition: width var(--dur-view) var(--ease-out); }

.lw-resizer {
  width: 10px;
  margin: 0 -5px;
  height: 100%;
  cursor: col-resize;
  position: relative;
  z-index: 25;
  flex: none;
  background: transparent;
  user-select: none;
  touch-action: none;
}
.lw-resizer::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 4.75px;
  width: 0.5px;
  background: var(--lw-line);
  transition: background var(--dur-micro) var(--ease-io), width var(--dur-micro) var(--ease-io), left var(--dur-micro) var(--ease-io);
}
.lw-resizer::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 3.5px;
  width: 3px;
  height: 28px;
  border-radius: 9999px;
  corner-shape: round;
  background: var(--lw-ink-3);
  opacity: 0;
  transform: translateY(-50%) scaleY(0.8);
  transition: opacity var(--dur-micro) var(--ease-io), transform var(--dur-ui) var(--ease-out), background var(--dur-micro) var(--ease-io);
}
.lw-resizer.is-active::before { background: var(--lw-accent); width: 1.5px; left: 4.25px; }
.lw-resizer.is-active::after { opacity: 1; transform: translateY(-50%) scaleY(1); background: var(--lw-accent); }

.lw-ws-right {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: var(--lw-bg);
  position: relative;
}
.lw-ws-right.is-hidden { display: none; }
.lw-ws-left.is-hidden { display: none; }

/* Webview Loading Veil (Eliminates Dark-Mode White Flash) */
.lw-wv-wrap {
  width: 100%;
  height: 100%;
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  background: var(--lw-bg);
}
.lw-wv-mount {
  width: 100%;
  height: 100%;
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}
.lw-wv-veil {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: var(--lw-bg);
  color: var(--lw-ink-3);
  font-size: 12.5px;
  z-index: 4;
  transition: opacity var(--dur-ui) var(--ease-out);
  pointer-events: none;
}
.lw-wv-veil.is-ready { opacity: 0; }
.lw-wv-veil.is-slow { pointer-events: auto; }
.lw-wv-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  background: var(--lw-bg);
  z-index: 5;
  text-align: center;
}

/* ── Chat Stream (Weightless Empty State + Clean Bubbles) ─────────────── */
.lw-chat-stream {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px 20px 16px;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
}
.lw-ws-left.is-split .lw-chat-stream {
  max-width: 100%;
  padding: 16px 16px 12px;
}

.lw-empty-stage {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 16px;
  padding: 24px 12px 40px;
  max-width: 440px;
  animation: lwStageIn var(--dur-view) var(--ease-out) both;
}
.lw-empty-mark {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--lw-surface-2);
  border: 0.5px solid var(--lw-line);
  color: var(--lw-ink-2);
  display: flex;
  align-items: center;
  justify-content: center;
}
.lw-empty-copy {
  font-size: 14px;
  font-weight: 400;
  color: var(--lw-ink-2);
  margin: 0;
  line-height: 1.5;
}
.lw-empty-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}

.lw-msg {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.lw-msg-user {
  align-self: flex-end;
  align-items: flex-end;
  max-width: 84%;
  animation: lwMsgUserIn var(--dur-ui) var(--ease-out) both;
}
.lw-msg-user .lw-msg-text {
  background: var(--lw-surface-2);
  border: 0.5px solid var(--lw-line);
  color: var(--lw-ink);
  padding: 9px 14px;
  border-radius: var(--r-lg) var(--r-lg) 4px var(--r-lg);
  font-size: 13.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.lw-msg-ai {
  align-self: flex-start;
  align-items: flex-start;
  width: 100%;
  max-width: 100%;
  animation: lwMsgAiIn var(--dur-ui) var(--ease-out) both;
}
.lw-msg-ai .lw-msg-text {
  color: var(--lw-ink);
  font-size: 13.5px;
  line-height: 1.65;
  width: 100%;
  min-width: 0;
}
.lw-msg.is-error .lw-msg-text {
  padding: 12px 14px;
  border-radius: var(--r-md);
  border: 0.5px solid color-mix(in srgb, var(--lw-danger) 28%, var(--lw-line-2));
  border-left: 2.5px solid var(--lw-danger);
  background: var(--lw-surface-2);
  color: var(--lw-ink);
}
.lw-msg.is-warn .lw-msg-text {
  padding: 12px 14px;
  border-radius: var(--r-md);
  border: 0.5px solid color-mix(in srgb, var(--lw-warn) 28%, var(--lw-line-2));
  border-left: 2.5px solid var(--lw-warn);
  background: var(--lw-surface-2);
  color: var(--lw-ink);
}
.lw-action-card {
  width: 100%;
  padding: 14px 16px;
  border-radius: var(--r-lg);
  border: 0.5px solid var(--lw-line-2);
  background: var(--lw-surface-2);
  box-shadow: var(--lw-e1);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lw-action-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.lw-action-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  color: var(--lw-ink);
  min-width: 0;
}
.lw-action-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  flex: none;
  background: var(--lw-surface-3);
  color: var(--lw-ink-2);
}
.lw-action-pill.is-pending {
  background: color-mix(in srgb, var(--lw-warn) 12%, transparent);
  color: var(--lw-warn);
}
.lw-action-pill.is-done {
  background: color-mix(in srgb, var(--lw-ok) 12%, transparent);
  color: var(--lw-ok);
}
.lw-action-pill.is-done svg path,
.lw-step.is-done .lw-step-num svg path {
  stroke-dasharray: 24;
  animation: lwCheckDraw 240ms var(--ease-out) both;
}
.lw-queue-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--r-sm);
  border: 0.5px solid var(--lw-line);
  background: var(--lw-surface-2);
  font-size: 12px;
  color: var(--lw-ink-2);
  animation: lwStageIn var(--dur-micro) var(--ease-out) both;
}
.lw-queue-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--lw-ink);
}
.lw-queue-cancel {
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--lw-ink-2);
  background: transparent;
  border: 0;
  padding: 2px 6px;
  border-radius: var(--r-xs);
  cursor: pointer;
  flex: none;
  transition: background var(--dur-micro) var(--ease-io), color var(--dur-micro) var(--ease-io);
}
.lw-queue-cancel:hover {
  background: var(--lw-surface-3);
  color: var(--lw-ink);
}
.lw-action-body {
  font-size: 13px;
  line-height: 1.65;
  color: var(--lw-ink-2);
}
.lw-action-cmd {
  margin-top: 2px;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  border: 0.5px solid var(--lw-line);
  background: var(--lw-surface);
  font-family: var(--mono);
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--lw-ink-2);
  word-break: break-all;
}
.lw-action-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 2px;
}
.lw-msg-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

/* Thinking State & Disclosure (Calm, Restrained, Zero Spinning Lightbulb) */
.lw-thinking-live {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0;
}
.lw-thinking-head {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--lw-ink-3);
}
.lw-thinking-label {
  animation: lwTextBreath 1.8s var(--ease-io) infinite;
}
.lw-thinking-toggle {
  font: inherit;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 0;
  border: 0;
  background: none;
  color: var(--lw-ink-3);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: color var(--dur-micro) var(--ease-io);
}
.lw-thinking-content {
  padding: 8px 12px;
  margin: 4px 0 8px;
  border-left: 1.5px solid var(--lw-line-2);
  font-size: 12px;
  color: var(--lw-ink-3);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow-y: auto;
}
.lw-stream-cursor {
  display: inline-block;
  width: 2px;
  height: 13px;
  margin-left: 2px;
  vertical-align: -2px;
  border-radius: 1px;
  background: var(--lw-ink-2);
  animation: lwTextBreath 0.9s var(--ease-io) infinite;
}

/* Scope Authorization Card */
.lw-scope-card {
  padding: 13px 15px;
  border-radius: var(--r-md);
  border: 0.5px solid color-mix(in srgb, var(--lw-accent) 26%, transparent);
  background: color-mix(in srgb, var(--lw-accent) 4%, var(--lw-surface));
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lw-scope-head {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 500;
  color: var(--lw-ink);
}

/* Markdown Typography */
.lw-md-p { margin: 4px 0; line-height: 1.65; }
.lw-md-h { font-weight: 600; color: var(--lw-ink); margin: 10px 0 4px; line-height: 1.4; }
.lw-md-h1 { font-size: 15px; }
.lw-md-h2 { font-size: 14px; }
.lw-md-h3 { font-size: 13.5px; }
.lw-md-ul, .lw-md-ol { margin: 6px 0 8px 18px; padding: 0; }
.lw-md-li { margin: 3px 0; line-height: 1.6; }
.lw-md-quote {
  margin: 6px 0;
  padding: 2px 12px;
  border-left: 2px solid var(--lw-line-2);
  color: var(--lw-ink-2);
}
.lw-md-code {
  background: var(--lw-surface-2);
  border: 0.5px solid var(--lw-line);
  border-radius: var(--r-sm);
  padding: 10px 12px;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.55;
  overflow-x: auto;
  margin: 8px 0;
  color: var(--lw-ink);
}
.lw-inline-code {
  background: var(--lw-surface-2);
  border: 0.5px solid var(--lw-line);
  border-radius: var(--r-xs);
  padding: 1px 5px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--lw-ink);
}
.lw-md-link {
  color: var(--dsw-alias-link, var(--lw-accent));
  font-weight: 500;
  text-decoration: none;
  text-underline-offset: 3px;
}
.lw-md-table-wrap {
  overflow-x: auto;
  margin: 8px 0;
  border: 0.5px solid var(--lw-line);
  border-radius: var(--r-sm);
  background: var(--lw-surface);
}
.lw-md-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  text-align: left;
}
.lw-md-table th {
  padding: 8px 12px;
  font-weight: 500;
  color: var(--lw-ink-2);
  background: var(--lw-surface-2);
  border-bottom: 0.5px solid var(--lw-line);
  white-space: nowrap;
}
.lw-md-table td {
  padding: 8px 12px;
  color: var(--lw-ink);
  border-bottom: 0.5px solid var(--lw-line);
  line-height: 1.5;
}
.lw-md-table tbody tr:last-child td { border-bottom: 0; }

/* ── Docked Composer Area (Preview & Workspace) ───────────────────────── */
.lw-ws-dock {
  flex: none;
  padding: 10px 16px 14px;
  background: var(--lw-bg);
  border-top: 0.5px solid color-mix(in srgb, var(--lw-line) 75%, transparent);
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 10;
}
.lw-composer-wrap {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lw-ws-left.is-split .lw-composer-wrap { max-width: 100%; }

/* Destructive Confirmation Guard */
.lw-confirm-card {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border-radius: var(--r-lg);
  border: 0.5px solid color-mix(in srgb, var(--lw-danger) 28%, transparent);
  background: color-mix(in srgb, var(--lw-danger) 4%, var(--lw-surface));
  animation: lwStageIn var(--dur-ui) var(--ease-out) both;
}
.lw-confirm-head {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 500;
  color: var(--lw-ink);
}
.lw-confirm-list {
  margin: 0;
  padding-left: 18px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--lw-ink-2);
}

/* ── Account Modal (Animated Enter + Exit, DSH Scrim Discipline) ──────── */
.lw-modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--lw-mask);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 1000;
  opacity: 0;
  transition: opacity var(--dur-ui) var(--ease-io);
}
.lw-modal-overlay.is-open { opacity: 1; }
.lw-modal-overlay.is-closing { opacity: 0; transition-duration: 150ms; }

.lw-modal-box {
  background: var(--lw-surface);
  border-radius: var(--r-xl);
  width: 100%;
  max-width: 440px;
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  padding: 20px 22px;
  box-shadow: var(--lw-e-modal);
  display: flex;
  flex-direction: column;
  gap: 16px;
  opacity: 0;
  transform: translateY(8px) scale(0.97);
  transition: opacity var(--dur-ui) var(--ease-out), transform var(--dur-view) var(--ease-out);
}
.lw-modal-overlay.is-open .lw-modal-box {
  opacity: 1;
  transform: translateY(0) scale(1);
}
.lw-modal-overlay.is-closing .lw-modal-box {
  opacity: 0;
  transform: translateY(4px) scale(0.98);
  transition: opacity 140ms var(--ease-exit), transform 140ms var(--ease-exit);
}
.lw-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.lw-modal-title {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--lw-ink);
}
.lw-modal-close {
  width: 28px;
  height: 28px;
  border-radius: var(--r-sm);
  border: 0;
  background: transparent;
  color: var(--lw-ink-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background var(--dur-micro) var(--ease-io), color var(--dur-micro) var(--ease-io);
}
.lw-modal-close:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--lw-accent-soft); }

.lw-kv-list {
  display: flex;
  flex-direction: column;
  border-radius: var(--r-md);
  background: var(--lw-surface-2);
  border: 0.5px solid var(--lw-line);
  padding: 4px 12px;
}
.lw-kv-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  font-size: 12.5px;
  border-bottom: 0.5px solid var(--lw-line);
}
.lw-kv-row:last-child { border-bottom: 0; }
.lw-kv-key { color: var(--lw-ink-3); }
.lw-kv-val {
  color: var(--lw-ink);
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lw-mono { font-family: var(--mono); font-size: 11.5px; }

.lw-switch {
  box-sizing: border-box;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  flex: 0 0 auto;
  appearance: none;
  -webkit-appearance: none;
  width: 36px;
  height: 20px;
  padding: 2px;
  border: 0;
  border-radius: 999px;
  background: var(--dsw-alias-border-l3, #D4D7DD);
  cursor: pointer;
}
.lw-switch[aria-checked="true"] {
  background: var(--dsw-alias-brand-primary, #111318);
}
.lw-switch:disabled {
  cursor: default;
  opacity: 0.5;
}
.lw-switch-thumb {
  display: block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--dsw-alias-label-primary-foreground, #FFFFFF);
  transition: transform 120ms ease;
  pointer-events: none;
}
.lw-switch[aria-checked="false"] .lw-switch-thumb {
  background: var(--dsw-alias-switch-thumb, #FFFFFF);
}
.lw-switch[aria-checked="true"] .lw-switch-thumb {
  transform: translateX(16px);
}
.lw-plugin-cfg {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(15, 17, 21, 0.08));
  border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-bg-layer-1, #FFFFFF);
}
.lw-plugin-cfg[data-theme="dark"] {
  border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.08));
  background: var(--dsw-alias-bg-layer-1, #1C1C1F);
}
.lw-plugin-cfg-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.lw-plugin-cfg-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.lw-plugin-cfg-title {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary, #111318);
}
.lw-plugin-cfg[data-theme="dark"] .lw-plugin-cfg-title {
  color: var(--dsw-alias-label-primary, #F3F4F6);
}
.lw-plugin-cfg-desc {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary, #7D8494);
  line-height: 1.45;
}
.lw-plugin-cfg[data-theme="dark"] .lw-plugin-cfg-desc {
  color: var(--dsw-alias-label-tertiary, #8E95A5);
}

.lw-scope-loading-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--r-md);
  background: var(--lw-surface-2);
  border: 0.5px solid var(--lw-line);
  font-size: 12px;
  color: var(--lw-ink-3);
}
.lw-scope-groups {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lw-scope-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lw-scope-group-head {
  font-size: 11px;
  font-weight: 500;
  color: var(--lw-ink-3);
}
.lw-scope-flow {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.lw-scope-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 999px;
  background: var(--lw-surface-2);
  border: 0.5px solid var(--lw-line);
  font-size: 11.5px;
  line-height: 1.35;
  color: var(--lw-ink);
  white-space: nowrap;
}
.lw-scope-chip.is-off {
  color: var(--lw-ink-3);
  opacity: 0.85;
}

.lw-modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 12px;
  border-top: 0.5px solid var(--lw-line);
}
.lw-modal-confirm {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--r-md);
  background: color-mix(in srgb, var(--lw-danger) 5%, var(--lw-surface));
  border: 0.5px solid color-mix(in srgb, var(--lw-danger) 24%, transparent);
  animation: lwStageIn var(--dur-micro) var(--ease-out) both;
}

/* ── Non-Blocking Floating Toast Stack (Top-Center, Never Covers Composer) */
.lw-toast-host {
  position: fixed;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1200;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  max-width: calc(100vw - 32px);
}
.lw-toast {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-radius: var(--r-md);
  background: var(--dsw-alias-toast-bg, #1D1F24);
  color: var(--dsw-alias-toast-label, #F5F6F8);
  font-size: 12.5px;
  font-weight: 400;
  line-height: 1.4;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  opacity: 0;
  transform: translateY(-8px) scale(0.96);
  transition: opacity var(--dur-ui) var(--ease-out), transform var(--dur-ui) var(--ease-out);
}
.lw-toast.is-open { opacity: 1; transform: translateY(0) scale(1); }
.lw-toast.is-closing { opacity: 0; transform: translateY(-5px) scale(0.97); transition-duration: 140ms; }
.lw-toast-undo {
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  color: var(--dsw-alias-toast-action, #8BB4FF);
  background: transparent;
  border: 0;
  padding: 2px 4px;
  cursor: pointer;
  border-radius: var(--r-xs);
}
.lw-toast-undo:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(139, 180, 255, 0.45); }

/* ── Hover Rules (Strictly Gated for Hover-Capable Pointers) ──────────── */
@media (hover: hover) {
  .lw-status:hover { background: var(--lw-surface-3); color: var(--lw-ink); }
  .lw-back:hover:not(:disabled) { background: var(--lw-surface-3); color: var(--lw-ink); }
  .lw-btn:hover:not(:disabled) { background: var(--lw-surface-2); border-color: color-mix(in srgb, var(--lw-ink) 20%, transparent); }
  .lw-btn.is-primary:hover:not(:disabled) { background: var(--lw-solid-hover); border-color: transparent; }
  .lw-btn.is-ghost:hover:not(:disabled) { background: var(--lw-surface-3); color: var(--lw-ink); border-color: transparent; }
  .lw-btn.is-link:hover:not(:disabled) { color: var(--lw-ink); background: none; }
  .lw-btn.is-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--lw-danger) 15%, transparent); }
  .lw-send-btn:hover:not(:disabled) { background: var(--lw-solid-hover); }
  .lw-picker-trigger:hover:not(:disabled) { background: var(--lw-surface-3); color: var(--lw-ink); }
  .lw-popover-item:hover { background: var(--lw-surface-3); }
  .lw-chip:hover:not(:disabled) { background: var(--lw-surface-2); border-color: var(--lw-line-2); color: var(--lw-ink); }
  .lw-chip:hover:not(:disabled) .lw-chip-ico { color: var(--lw-ink); }
  .lw-chip.is-muted:hover:not(:disabled) { border-color: transparent; background: var(--lw-surface-3); }
  .lw-recent-item:hover { background: var(--lw-surface-3); }
  .lw-recent-item:hover .lw-recent-open { color: var(--lw-ink); }
  .lw-recent-item:hover .lw-recent-del { opacity: 0.72; }
  .lw-recent-del:hover { opacity: 1 !important; color: var(--lw-danger); background: color-mix(in srgb, var(--lw-danger) 12%, transparent); }
  .lw-details-toggle:hover, .lw-thinking-toggle:hover { color: var(--lw-ink); }
  .lw-modal-close:hover { background: var(--lw-surface-3); color: var(--lw-ink); }
  .lw-url:hover { color: var(--lw-accent); text-decoration: underline; text-underline-offset: 3px; }
  .lw-md-link:hover { text-decoration: underline dotted; }
  .lw-table tbody tr:hover td, .lw-md-table tbody tr:hover td { background: var(--lw-surface-2); }
  .lw-resizer:hover::before { background: var(--lw-line-2); width: 1px; left: 4.5px; }
  .lw-resizer:hover::after { opacity: 0.7; transform: translateY(-50%) scaleY(1); }
  .lw-toast-undo:hover { background: rgba(255, 255, 255, 0.1); }
}

/* ── Container-Aware & Viewport Responsiveness ────────────────────────── */
.lw.is-compact { padding: 20px 18px 48px; }
.lw.is-compact .lw-hide-compact { display: none; }
.lw.is-compact .lw-ws-header { padding: 0 10px; }
.lw.is-compact .lw-ws-dock { padding: 6px 10px 10px; }
.lw.is-compact .lw-preview-scroll { padding: 18px 14px 24px; }
.lw.is-compact .lw-card { padding: 18px; border-radius: var(--r-lg); }

.lw.is-narrow .lw-hero-title { font-size: 22px; }
.lw.is-narrow .lw-picker-trigger { max-width: 132px; }

@media (max-width: 640px) {
  .lw { padding: 18px 16px 44px; }
}

@media (prefers-reduced-motion: reduce) {
  .lw *, .lw *::before, .lw *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* ── Hide host conversation bottom composer when Workbench is active ── */
body:has(.lw) [data-composer-seat],
body:has(.lw) [data-conversation-region="composer"],
body:has(.lw) [class*="composerSeat"],
body:has(.lw) [class*="composerStack"] {
  display: none !important;
}
body:has(.lw) [data-conversation-scroll] {
  overflow-y: hidden !important;
}
body:has(.lw) [data-slot="conversation.session"],
body:has(.lw) [class*="viewArea"] {
  height: 100% !important;
  flex: 1 1 100% !important;
  min-height: 0 !important;
  display: flex !important;
  flex-direction: column !important;
}
`

    // ── Utilities & Hooks ──────────────────────────────────────────────────

    function ensureStyles() {
      if (typeof document === 'undefined') return () => {}
      styleRefCount += 1
      let el = document.getElementById(STYLE_ID)
      if (!el) {
        el = document.createElement('style')
        el.id = STYLE_ID
        el.textContent = CSS
        document.head.appendChild(el)
      }
      return () => {
        styleRefCount = Math.max(0, styleRefCount - 1)
        if (styleRefCount === 0) {
          const cur = document.getElementById(STYLE_ID)
          if (cur && cur.parentNode) cur.parentNode.removeChild(cur)
        }
      }
    }

    function detectFallbackDict() {
      try {
        const docLang = typeof document !== 'undefined' ? document.documentElement?.lang : ''
        const navLang = typeof navigator !== 'undefined' ? navigator.language : ''
        const candidate = String(docLang || navLang || '').trim().toLowerCase()
        if (candidate.startsWith('en')) return EN
      } catch {}
      return ZH
    }

    function translator(props) {
      const fallbackDict = detectFallbackDict()
      if (typeof props.t === 'function') {
        return (key) => {
          const value = props.t(key)
          return value === key ? (fallbackDict[key] ?? ZH[key] ?? key) : value
        }
      }
      return (key) => fallbackDict[key] ?? ZH[key] ?? key
    }

    function humanize(message, t) {
      const pick = (key, fallback) => (typeof t === 'function' ? t(key) : fallback)
      const text = String(message ?? '').trim()
      if (!text) return pick('err.empty', '暂无响应，请重试')
      if (/找不到 lark-cli|没找到 lark-cli|lark-cli 不可用/i.test(text)) return pick('err.noCli', '尚未完成飞书组件准备')
      if (/device_code is invalid|device code.*invalid/i.test(text)) return pick('err.codeInvalid', '授权链接已失效，请重新获取')
      if (/expired|过期/i.test(text) && /device|code|授权/i.test(text)) return pick('err.codeExpired', '授权链接已过期，请重新获取')
      if (/pending|audit|审核|审批|not approved/i.test(text)) return pick('err.pending', '授权正在等待管理员审批，通过后重试')
      if (/429|too many|rate limit|frequency|限流|频率/i.test(text)) return pick('err.rateLimit', '请求过于频繁，请稍后再试')
      if (/forbidden|permission|scope|403|权限/i.test(text)) return pick('err.scope', '飞书权限不足，请在连接设置中补充授权')
      if (/auth|授权|登录|token .*(expired|invalid)|needs_refresh/i.test(text)) return pick('err.auth', '飞书登录已过期，请重新授权')
      if (/timeout|超时|aborted|ETIMEDOUT|想太久了/i.test(text)) return pick('err.timeout', '飞书响应超时，请检查网络或重试')
      if (/ENOTFOUND|ECONNREFUSED|network|网络/i.test(text)) return pick('err.network', '网络连接异常，请检查网络后重试')
      if (/模型没有|无法解析|没能组成/.test(text)) return pick('err.plan', '未能理解需求，换个说法或点击下方场景试试')
      if (/required flag|missing required|is required/i.test(text)) return pick('err.incomplete', '缺少必要参数或信息不完整，请补充后再试')
      return text
    }

    function parseLuminance(color) {
      if (!color) return null
      const hex = color.match(/^#([0-9a-f]{6})$/i)
      if (hex) {
        const r = parseInt(hex[1].slice(0, 2), 16)
        const g = parseInt(hex[1].slice(2, 4), 16)
        const b = parseInt(hex[1].slice(4, 6), 16)
        return 0.299 * r + 0.587 * g + 0.114 * b
      }
      const rgb = color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
      if (rgb) {
        return 0.299 * Number(rgb[1]) + 0.587 * Number(rgb[2]) + 0.114 * Number(rgb[3])
      }
      return null
    }

    function detectTheme() {
      try {
        if (document.body && document.body.hasAttribute('data-ds-dark-theme')) return 'dark'
        if (document.body && document.body.classList.contains('dark')) return 'dark'
        const roots = [document.body, document.documentElement].filter(Boolean)
        for (const node of roots) {
          const probe = getComputedStyle(node).getPropertyValue('--dsw-alias-bg-base').trim()
          const lum = parseLuminance(probe)
          if (lum !== null) return lum < 128 ? 'dark' : 'light'
        }
      } catch {}
      try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      } catch {
        return 'light'
      }
    }

    function useHostTheme() {
      const [theme, setTheme] = useState(detectTheme)
      useEffect(() => {
        const sync = () => setTheme(detectTheme())
        const observer = new MutationObserver(sync)
        if (document.documentElement) {
          observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })
        }
        if (document.body) {
          observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-ds-dark-theme', 'data-theme', 'style'] })
        }
        const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
        if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', sync)
        return () => {
          observer.disconnect()
          if (mq && typeof mq.removeEventListener === 'function') mq.removeEventListener('change', sync)
        }
      }, [])
      return theme
    }

    /** Two-phase mount/exit animation hook so overlays animate both in AND out. */
    function useAnimatedPresence(open, exitMs = 160) {
      const [mounted, setMounted] = useState(Boolean(open))
      const [phase, setPhase] = useState(open ? 'open' : 'closed')

      useEffect(() => {
        if (open) {
          setMounted(true)
          let raf2 = 0
          const raf1 = requestAnimationFrame(() => {
            raf2 = requestAnimationFrame(() => setPhase('open'))
          })
          return () => {
            cancelAnimationFrame(raf1)
            cancelAnimationFrame(raf2)
          }
        }
        setPhase('closing')
        const timer = setTimeout(() => {
          setMounted(false)
          setPhase('closed')
        }, exitMs)
        return () => clearTimeout(timer)
      }, [open, exitMs])

      return { mounted, phase }
    }

    function useContainerSize(ref) {
      const [width, setWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1024))
      useEffect(() => {
        const el = ref.current
        if (!el) return undefined
        const update = () => {
          const w = el.clientWidth
          if (w > 0) setWidth(w)
        }
        update()
        if (typeof ResizeObserver !== 'undefined') {
          const ro = new ResizeObserver(update)
          ro.observe(el)
          return () => ro.disconnect()
        }
        window.addEventListener('resize', update)
        return () => window.removeEventListener('resize', update)
      }, [ref])
      return width
    }

    // ── Primitives ─────────────────────────────────────────────────────────

    function Button({ variant = 'default', size, iconOnly = false, active = false, className = '', children, ...rest }) {
      const mod =
        variant === 'primary' ? ' is-primary'
          : variant === 'ghost' ? ' is-ghost'
            : variant === 'link' ? ' is-link'
              : variant === 'danger' ? ' is-danger'
                : ''
      const sizeMod = size === 'sm' ? ' is-sm' : ''
      const iconMod = iconOnly ? ' is-icon' : ''
      const activeMod = active ? ' is-active' : ''
      return h(
        'button',
        { type: 'button', ...rest, className: `lw-btn${mod}${sizeMod}${iconMod}${activeMod}${className ? ` ${className}` : ''}` },
        children,
      )
    }

    function AnimatedCollapse({ open, children }) {
      return h(
        'div',
        { className: `lw-collapse${open ? ' is-open' : ''}`, 'aria-hidden': !open },
        h('div', { className: 'lw-collapse-inner' }, children),
      )
    }

    function Banner({ tone = 'error', title, children, action }) {
      const warn = tone === 'warn'
      return h(
        'div',
        { className: `lw-banner${warn ? ' is-warn' : ''}`, role: 'alert' },
        h(Icon, { name: 'alertCircle', size: 15, className: 'lw-banner-ico' }),
        h(
          'div',
          { className: 'lw-banner-body' },
          title ? h('div', { className: 'lw-banner-title' }, title) : null,
          h('div', { className: 'lw-banner-text' }, children),
        ),
        action ? h('div', { className: 'lw-banner-action' }, action) : null,
      )
    }

    function Steps({ labels, current }) {
      return h(
        'div',
        { className: 'lw-steps', role: 'list' },
        labels.map((label, index) =>
          h(
            React.Fragment,
            { key: label },
            index > 0 ? h('span', { className: 'lw-step-bar', 'aria-hidden': true }) : null,
            h(
              'span',
              {
                className: `lw-step${index < current ? ' is-done' : ''}${index === current ? ' is-current' : ''}`,
                role: 'listitem',
                'aria-current': index === current ? 'step' : undefined,
              },
              h(
                'span',
                { className: 'lw-step-num' },
                index < current ? h(Icon, { name: 'check', size: 11, strokeWidth: 2.4, className: 'lw-pop-in' }) : String(index + 1),
              ),
              h('span', null, label),
            ),
          ),
        ),
      )
    }

    function TableSkeleton() {
      return h(
        'div',
        { className: 'lw-skel-table', 'aria-hidden': true },
        h(
          'div',
          { className: 'lw-skel-row is-head' },
          h('div', { className: 'lw-skel', style: { width: '62%' } }),
          h('div', { className: 'lw-skel', style: { width: '48%' } }),
          h('div', { className: 'lw-skel', style: { width: '54%' } }),
          h('div', { className: 'lw-skel', style: { width: '44%' } }),
        ),
        [0, 1, 2].map((row) =>
          h(
            'div',
            { className: 'lw-skel-row', key: row },
            h('div', { className: 'lw-skel', style: { width: `${76 - row * 10}%` } }),
            h('div', { className: 'lw-skel', style: { width: `${56 + row * 8}%` } }),
            h('div', { className: 'lw-skel', style: { width: `${44 + row * 10}%` } }),
            h('div', { className: 'lw-skel', style: { width: `${52 - row * 6}%` } }),
          ),
        ),
      )
    }

    function ToastStack({ toast, onDismiss, t }) {
      const { mounted, phase } = useAnimatedPresence(Boolean(toast), 150)
      const [shown, setShown] = useState(toast)
      useEffect(() => {
        if (toast) setShown(toast)
      }, [toast])

      if (!mounted || !shown) return null
      return h(
        'div',
        { className: 'lw-toast-host', role: 'status', 'aria-live': 'polite' },
        h(
          'div',
          {
            className: `lw-toast${phase === 'open' ? ' is-open' : phase === 'closing' ? ' is-closing' : ''}`,
          },
          h('span', null, shown.message),
          shown.onUndo
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'lw-toast-undo',
                  onClick: () => {
                    shown.onUndo()
                    onDismiss()
                  },
                },
                shown.undoLabel || t('toast.undo'),
              )
            : null,
        ),
      )
    }

    function ModelPicker({ models, selectedModel, modelKey, onSelect, disabled, t }) {
      const [open, setOpen] = useState(false)
      const wrapRef = useRef(null)
      const { mounted, phase } = useAnimatedPresence(open, 130)

      useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (e) => {
          if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
        }
        const onKeyDown = (e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            setOpen(false)
          }
        }
        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [open])

      const activeKey = modelKey(selectedModel)
      const label = selectedModel ? selectedModel.name : (models && models.length > 0 ? models[0].name : t('model.loading'))

      return h(
        'div',
        { className: 'lw-picker-wrap', ref: wrapRef },
        h(
          'button',
          {
            type: 'button',
            className: 'lw-picker-trigger',
            disabled: Boolean(disabled) || !models || models.length === 0,
            'aria-haspopup': 'listbox',
            'aria-expanded': open,
            'aria-label': t('model.label'),
            title: t('model.label'),
            onClick: () => setOpen((v) => !v),
          },
          h('span', { className: 'lw-picker-label' }, label),
          h(Icon, { name: 'chevronDown', size: 12, className: 'lw-picker-chev' }),
        ),
        mounted
          ? h(
              'div',
              {
                className: `lw-popover${phase === 'open' ? ' is-open' : phase === 'closing' ? ' is-closing' : ''}`,
                role: 'listbox',
                'aria-label': t('model.label'),
              },
              (models || []).map((m) => {
                const k = modelKey(m)
                const isSelected = k === activeKey
                return h(
                  'button',
                  {
                    key: k,
                    type: 'button',
                    role: 'option',
                    'aria-selected': isSelected,
                    className: `lw-popover-item${isSelected ? ' is-selected' : ''}`,
                    onClick: () => {
                      onSelect(k)
                      setOpen(false)
                    },
                  },
                  h('span', { className: 'lw-popover-name' }, m.name + (m.kind ? ` ${m.kind}` : '')),
                  isSelected ? h(Icon, { name: 'check', size: 13, className: 'lw-popover-check' }) : null,
                )
              }),
            )
          : null,
      )
    }

    function fileKindIcon(kind, name) {
      if (kind === 'image' || /\.(png|jpe?g|webp|gif)$/i.test(name || '')) return 'image'
      if (kind === 'table' || /\.(csv|tsv|xlsx?)$/i.test(name || '')) return 'table'
      return 'fileText'
    }

    function formatBytes(bytes) {
      if (!bytes || bytes < 1024) return `${bytes || 0} B`
      if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }

    function UploadProgressRing({ progress = 0 }) {
      const r = 5.5
      const c = 2 * Math.PI * r
      const offset = c * (1 - Math.min(100, Math.max(0, progress)) / 100)
      return h(
        'svg',
        { className: 'lw-ring', width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': true },
        h('circle', { className: 'lw-ring-track', cx: 7, cy: 7, r, fill: 'none', strokeWidth: 1.6 }),
        h('circle', {
          className: 'lw-ring-fill',
          cx: 7,
          cy: 7,
          r,
          fill: 'none',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeDasharray: c,
          strokeDashoffset: offset,
        }),
      )
    }

    function UnifiedComposer({
      value = '',
      onChange = () => {},
      onSubmit = () => {},
      onQueue = null,
      onStop = null,
      placeholder = '',
      busy = false,
      disabled = false,
      models = [],
      selectedModel = null,
      modelKey = (m) => (m ? `${m.provider || ''}:${m.id || ''}` : ''),
      changeModel = () => {},
      files = [],
      onAddFiles = null,
      onRemoveFile = null,
      visionWarning = false,
      minHeight = 48,
      id = 'lw-composer-input',
      ariaLabel = '',
      inputRef = null,
      t,
    }) {
      const innerRef = useRef(null)
      const areaRef = inputRef || innerRef
      const fileInputRef = useRef(null)
      const dragDepthRef = useRef(0)
      const [dragging, setDragging] = useState(false)

      useEffect(() => {
        const el = areaRef.current
        if (!el) return
        el.style.height = 'auto'
        const next = Math.min(Math.max(el.scrollHeight, minHeight), 168)
        el.style.height = `${next}px`
      }, [value, minHeight, areaRef])

      const hasUploading = files.some((f) => f.status === 'uploading')
      const hasReadyFile = files.some((f) => f.status === 'ready')
      const canSend = !busy && !disabled && !hasUploading && !visionWarning && (value.trim().length > 0 || hasReadyFile)

      const handleFiles = (fileList) => {
        if (!onAddFiles || !fileList || fileList.length === 0) return
        onAddFiles(fileList)
      }

      return h(
        'div',
        {
          className: `lw-composer${busy ? ' is-busy' : ''}${dragging ? ' is-drag' : ''}`,
          onDragEnter: (e) => {
            if (!onAddFiles || !e.dataTransfer?.types?.includes('Files')) return
            e.preventDefault()
            dragDepthRef.current += 1
            if (dragDepthRef.current === 1) setDragging(true)
          },
          onDragOver: (e) => {
            if (!onAddFiles || !e.dataTransfer?.types?.includes('Files')) return
            e.preventDefault()
          },
          onDragLeave: (e) => {
            if (!onAddFiles) return
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
            if (dragDepthRef.current === 0) setDragging(false)
          },
          onDrop: (e) => {
            if (!onAddFiles) return
            e.preventDefault()
            dragDepthRef.current = 0
            setDragging(false)
            if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files)
          },
        },
        dragging
          ? h(
              'div',
              { className: 'lw-drop-overlay', 'aria-hidden': true },
              h(Icon, { name: 'paperclip', size: 15 }),
              h('span', null, t('file.dropHint')),
            )
          : null,
        onAddFiles
          ? h('input', {
              ref: fileInputRef,
              type: 'file',
              multiple: true,
              style: { display: 'none' },
              onChange: (e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleFiles(e.target.files)
                }
                e.target.value = ''
              },
            })
          : null,
        files.length > 0
          ? h(
              'div',
              { className: 'lw-file-strip' },
              files.map((f) => {
                const isUploading = f.status === 'uploading'
                const isError = f.status === 'error'
                const meta = isUploading
                  ? `${f.progress || 0}%`
                  : isError
                    ? (f.error || t('file.uploadFailed'))
                    : (f.previewMeta || formatBytes(f.size))
                return h(
                  'div',
                  { key: f.localId, className: `lw-file-pill${isError ? ' is-error' : ''}`, title: f.error || f.name },
                  h(
                    'span',
                    { className: 'lw-file-pill-ico' },
                    isUploading
                      ? h(UploadProgressRing, { progress: f.progress })
                      : h(Icon, { name: isError ? 'alertCircle' : fileKindIcon(f.kind, f.name), size: 13 }),
                  ),
                  h('span', { className: 'lw-file-pill-name' }, f.name),
                  h('span', { className: 'lw-file-pill-meta' }, meta),
                  onRemoveFile
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'lw-file-pill-rm',
                          'aria-label': `Remove ${f.name}`,
                          onClick: () => onRemoveFile(f.localId),
                        },
                        h(Icon, { name: 'close', size: 10 }),
                      )
                    : null,
                )
              }),
            )
          : null,
        visionWarning
          ? h(
              'div',
              { className: 'lw-file-warn', role: 'status' },
              h(Icon, { name: 'alertCircle', size: 12 }),
              h('span', null, t('file.visionUnsupported')),
            )
          : null,
        h('textarea', {
          id,
          ref: areaRef,
          className: 'lw-composer-area',
          style: { minHeight: `${minHeight}px` },
          rows: 1,
          value,
          placeholder,
          'aria-label': ariaLabel || placeholder,
          'aria-busy': busy ? 'true' : undefined,
          spellCheck: false,
          onChange: (event) => onChange(event.target.value),
          onPaste: (event) => {
            if (!onAddFiles) return
            const pastedFiles = event.clipboardData?.files
            if (pastedFiles && pastedFiles.length > 0) {
              event.preventDefault()
              handleFiles(pastedFiles)
            }
          },
          onKeyDown: (event) => {
            // Never misfire during CJK IME composition
            if (event.isComposing || (event.nativeEvent && event.nativeEvent.isComposing) || event.keyCode === 229) {
              return
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey || !event.shiftKey)) {
              event.preventDefault()
              if (canSend) {
                onSubmit(value)
              } else if (busy && onQueue && !disabled && !hasUploading && !visionWarning && (value.trim().length > 0 || hasReadyFile)) {
                onQueue(value)
              }
            }
          },
        }),
        h(
          'div',
          { className: 'lw-composer-bar' },
          h(
            'div',
            { className: 'lw-composer-left' },
            onAddFiles
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'lw-attach-btn',
                    title: t('file.attach'),
                    'aria-label': t('file.attach'),
                    onClick: () => fileInputRef.current?.click(),
                  },
                  h(Icon, { name: 'paperclip', size: 14 }),
                )
              : null,
            h(ModelPicker, {
              models,
              selectedModel,
              modelKey,
              onSelect: changeModel,
              disabled: Boolean(busy),
              t,
            }),
          ),
          h(
            'div',
            { className: 'lw-composer-right' },
            busy && onStop
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'lw-send-btn is-stop',
                    title: t('pick.stop'),
                    'aria-label': t('pick.stop'),
                    onClick: onStop,
                  },
                  h(Icon, { name: 'stop', size: 12 }),
                )
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'lw-send-btn',
                    disabled: !canSend,
                    title: hasUploading ? t('file.uploadingWait') : t('pick.send'),
                    'aria-label': t('pick.send'),
                    onClick: () => {
                      if (canSend) onSubmit(value)
                    },
                  },
                  busy
                    ? h(Icon, { name: 'refresh', size: 13, className: 'lw-spin' })
                    : h(Icon, { name: 'arrowUp', size: 15, strokeWidth: 2 }),
                ),
          ),
        ),
      )
    }

    // ── Host Browser Helper (Preserves Sidebar Tab Cleanup) ────────────────

    function hostBrowser(ctx) {
      const read = (name) => {
        try {
          return typeof ctx.get === 'function' ? ctx.get(name) : undefined
        } catch {
          return undefined
        }
      }
      return {
        closeSidebarBrowserTabs(sessionId) {
          try {
            const right = read('sidebarRight')
            if (!right || typeof right.closeIn !== 'function') return
            const tabs =
              right.openTabs && typeof right.openTabs.getSnapshot === 'function'
                ? right.openTabs.getSnapshot()
                : []
            for (const tab of tabs) {
              if (
                (!sessionId || tab.sessionId === sessionId) &&
                (tab.kind === 'browser' || (tab.tabId && String(tab.tabId).includes('browser')))
              ) {
                right.closeIn(tab.sessionId, tab.tabId)
              }
            }
          } catch {}
        },
      }
    }

    // ── Preview Table & Field Legend ───────────────────────────────────────

    const cellText = (value) => {
      if (value == null) return ''
      if (Array.isArray(value)) return value.map(cellText).filter(Boolean).join('、')
      if (typeof value === 'object') {
        if (typeof value.text === 'string') return value.text
        if (typeof value.name === 'string') return value.name
        if (typeof value.link === 'string') return value.link
        return ''
      }
      return String(value)
    }

    const baseTokenFrom = (url) => {
      const match = String(url || '').match(/\/base\/([A-Za-z0-9]+)/)
      return match ? match[1] : ''
    }

    function pillToneFor(field, optionName) {
      const options = Array.isArray(field.options) ? field.options : []
      const idx = options.findIndex((o) => o && o.name === optionName)
      return PILL_TONES[(idx >= 0 ? idx : 0) % PILL_TONES.length]
    }

    function PreviewTable({ table, t, refining = false, changedSet = null }) {
      const columns = table.fields || []
      const rows = (table.records ?? []).slice(0, 4)
      return h(
        'div',
        { className: `lw-table-wrap${refining ? ' is-refining' : ''}` },
        h(
          'table',
          { className: 'lw-table' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              columns.map((field) => {
                const changed = Boolean(changedSet && changedSet.has(field.name))
                return h(
                  'th',
                  {
                    key: field.name,
                    scope: 'col',
                    className: changed ? 'is-changed' : undefined,
                    title: field.description || t(`kind.${field.type}`) || '',
                  },
                  h(
                    'span',
                    { className: 'lw-th-inner' },
                    h(Icon, { name: KIND_ICON[field.type] ?? 'fieldText', size: 12, className: 'lw-th-glyph' }),
                    h('span', null, field.name),
                  ),
                )
              }),
            ),
          ),
          h(
            'tbody',
            null,
            rows.length > 0
              ? rows.map((record, index) =>
                  h(
                    'tr',
                    { key: index },
                    columns.map((field) => {
                      const changed = Boolean(changedSet && changedSet.has(field.name))
                      const raw = record[field.name]
                      if (field.type === 'select' && raw != null) {
                        const list = (Array.isArray(raw) ? raw : [String(raw)]).filter(Boolean)
                        if (list.length > 0) {
                          return h(
                            'td',
                            { key: field.name, className: changed ? 'is-changed' : undefined },
                            h(
                              'span',
                              { className: 'lw-pills' },
                              list.map((val, optIndex) =>
                                h('span', { key: `${val}-${optIndex}`, className: `lw-pill tone-${pillToneFor(field, val)}` }, val),
                              ),
                            ),
                          )
                        }
                      }
                      const isNum = field.type === 'number' && typeof raw === 'number' && Number.isFinite(raw)
                      const value = isNum ? raw.toLocaleString() : cellText(raw)
                      return h(
                        'td',
                        {
                          key: field.name,
                          className: `${value ? '' : 'is-empty'}${field.type === 'number' ? ' is-num' : ''}${changed ? ' is-changed' : ''}`.trim(),
                        },
                        value || '—',
                      )
                    }),
                  ),
                )
              : h('tr', null, h('td', { colSpan: columns.length || 1, className: 'is-empty' }, t('preview.empty'))),
          ),
        ),
      )
    }

    function Legend({ table, t }) {
      return h(
        'div',
        { className: 'lw-legend' },
        (table.fields || []).map((field) =>
          h(
            'div',
            { className: 'lw-legend-row', key: field.name },
            h('span', { className: 'lw-legend-key' }, field.name),
            h('span', { className: 'lw-legend-kind' }, t(`kind.${field.type}`) || ''),
            h(
              'span',
              { className: 'lw-legend-val' },
              field.description || '',
              field.type === 'select' && Array.isArray(field.options) && field.options.length > 0
                ? h('span', { className: 'lw-legend-opts' }, `(${field.options.map((o) => o.name).join(' / ')})`)
                : null,
            ),
          ),
        ),
      )
    }

    // ── Recent Storage & Strip ─────────────────────────────────────────────

    function readRecent() {
      try {
        const list = JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]')
        return Array.isArray(list) ? list.filter((item) => item && item.name && item.url).slice(0, 5) : []
      } catch {
        return []
      }
    }

    function rememberRecent(entry) {
      if (!entry || !entry.url) return readRecent()
      try {
        const list = [entry, ...readRecent().filter((item) => item.url !== entry.url)].slice(0, 5)
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(list))
        return list
      } catch {
        return readRecent()
      }
    }

    function readSavedDraft() {
      try {
        const raw = window.localStorage.getItem(DRAFT_KEY)
        const parsed = raw ? JSON.parse(raw) : null
        return parsed && parsed.plan && Array.isArray(parsed.plan.tables) ? parsed : null
      } catch {
        return null
      }
    }

    function saveSavedDraft(draft) {
      if (!draft || !draft.plan) return null
      try {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
      } catch {}
      return draft
    }

    function clearSavedDraft() {
      try { window.localStorage.removeItem(DRAFT_KEY) } catch {}
    }

    function DraftEntry({ draft, t, onResume, onDiscard, disabled }) {
      if (!draft || !draft.plan) return null
      const title = draft.plan.baseName || t('preview.title')
      return h(
        'div',
        { className: 'lw-recent' },
        h('span', { className: 'lw-recent-label' }, t('draft.title')),
        h(
          'div',
          { className: 'lw-recent-list' },
          h(
            'div',
            { className: 'lw-recent-item' },
            h(
              'button',
              {
                type: 'button',
                className: 'lw-recent-open',
                disabled: Boolean(disabled),
                title,
                onClick: () => onResume(draft),
              },
              h(Icon, { name: 'table', size: 12, style: { color: 'var(--lw-accent)' } }),
              h('span', { className: 'lw-recent-name' }, title),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'lw-recent-del',
                'aria-label': `${t('draft.delete')} ${title}`,
                title: t('draft.delete'),
                onClick: onDiscard,
              },
              h(Icon, { name: 'close', size: 11, strokeWidth: 1.8 }),
            ),
          ),
        ),
      )
    }

    function Recent({ items, t, onOpen, onForget, disabled }) {
      if (!items || items.length === 0) return null
      const visible = items.slice(0, 3)
      return h(
        'div',
        { className: 'lw-recent' },
        h('span', { className: 'lw-recent-label' }, t('recent.title')),
        h(
          'div',
          { className: 'lw-recent-list' },
          visible.map((item) =>
            h(
              'div',
              { key: item.url, className: 'lw-recent-item' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'lw-recent-open',
                  disabled: Boolean(disabled),
                  title: item.name,
                  onClick: () => onOpen(item),
                },
                h(Icon, { name: 'table', size: 12, style: { color: 'var(--lw-ink-3)' } }),
                h('span', { className: 'lw-recent-name' }, item.name),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'lw-recent-del',
                  'aria-label': `${t('recent.delete')} ${item.name}`,
                  title: t('recent.delete'),
                  onClick: () => onForget(item),
                },
                h(Icon, { name: 'close', size: 11, strokeWidth: 1.8 }),
              ),
            ),
          ),
        ),
      )
    }

    // ── Connection Gate (Progressive Disclosure: 1 Clear Step at a Time) ───

    function ConnectGate({ health, t, onRecheck, onToast }) {
      const stage = health.stage === 'ready' && (!health.auth || !health.auth.userReady) ? 'no-auth' : health.stage
      const current = stage === 'no-cli' ? 0 : stage === 'no-app' ? 1 : 2
      const [busyAction, setBusyAction] = useState(null)
      const [waited, setWaited] = useState(0)
      const [error, setError] = useState(null)
      const [link, setLink] = useState(null)
      const [deviceCode, setDeviceCode] = useState(null)
      const [copied, setCopied] = useState(false)
      const [showManualCli, setShowManualCli] = useState(false)
      const [showTeam, setShowTeam] = useState(false)
      const [teamId, setTeamId] = useState('')
      const [teamSecret, setTeamSecret] = useState('')
      const [brand, setBrand] = useState(() => (health?.app?.brand === 'lark' ? 'lark' : 'feishu'))
      const [autoChecking, setAutoChecking] = useState(false)
      const autoInstallStartedRef = useRef(false)

      const busy = Boolean(busyAction)

      useEffect(() => {
        if (!busy) {
          setWaited(0)
          return undefined
        }
        const startedAt = Date.now()
        const timer = setInterval(() => setWaited(Math.round((Date.now() - startedAt) / 1000)), 500)
        return () => clearInterval(timer)
      }, [busy])

      const post = useCallback(async (path, body) => {
        const response = await authFetch(`${API}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        })
        const data = await response.json().catch(() => ({ ok: false, message: `HTTP ${response.status}` }))
        if (data && !data.message && data.error) data.message = data.error
        return data
      }, [])

      const triggerAutoInstall = useCallback(async () => {
        setBusyAction('install')
        setError(null)
        try {
          const payload = await post('/connect/cli/install')
          if (payload.ok) {
            onRecheck()
          } else {
            setError(humanize(payload.message || payload.error || t('error.title'), t))
          }
        } catch (failure) {
          setError(humanize(String(failure), t))
        } finally {
          setBusyAction(null)
        }
      }, [post, onRecheck, t])

      // Zero-install onboarding: auto-download @larksuite/cli via host Node runtime on first open
      useEffect(() => {
        if (stage !== 'no-cli') {
          autoInstallStartedRef.current = false
          return
        }
        if (health.cli && health.cli.canAutoInstall === false) return
        if (autoInstallStartedRef.current) return
        autoInstallStartedRef.current = true
        triggerAutoInstall()
      }, [stage, health.cli, triggerAutoInstall])

      // Silent background readiness detection for Step 2 & Step 3
      useEffect(() => {
        let active = true
        let timer = null

        const pollLoop = async () => {
          if (!active) return
          if (stage === 'no-app' && link) {
            try {
              const poll = await authFetch(`${API}/connect/app/poll`).then((r) => r.json()).catch(() => null)
              if (active && poll && poll.done) { onRecheck(); return }
              const st = await authFetch(`${API}/state`).then((r) => r.json()).catch(() => null)
              if (active && st && st.app && st.app.ready) { onRecheck(); return }
            } catch {}
          }
          if (stage === 'no-auth' && (link || deviceCode)) {
            try {
              const st = await authFetch(`${API}/state`).then((r) => r.json()).catch(() => null)
              if (active && st && st.stage === 'ready' && st.auth && st.auth.userReady) { onRecheck(); return }
              const loginState = await authFetch(`${API}/connect/login/state`).then((r) => r.json()).catch(() => null)
              if (active && loginState && loginState.done && loginState.ok) { onRecheck(); return }
            } catch {}
          }
          if (active) timer = setTimeout(pollLoop, 1200)
        }

        if ((stage === 'no-app' && link) || (stage === 'no-auth' && (link || deviceCode))) {
          setAutoChecking(true)
          timer = setTimeout(pollLoop, 600)
        } else {
          setAutoChecking(false)
        }
        return () => {
          active = false
          if (timer) clearTimeout(timer)
        }
      }, [stage, link, deviceCode, onRecheck])

      const copyInstall = useCallback(() => {
        const command = health.installCommand || 'npm i -g @larksuite/cli'
        const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
        if (clipboard && clipboard.writeText) {
          clipboard.writeText(command).then(() => {
            setCopied(true)
            onToast && onToast({ message: t('toast.copiedCmd') })
            setTimeout(() => setCopied(false), 1600)
          }).catch(() => {})
        }
      }, [health.installCommand, onToast, t])

      const openApp = useCallback(async () => {
        setBusyAction('start')
        setError(null)
        try {
          const payload = await post('/connect/app/start', { brand })
          if (payload.ok && payload.url) {
            setLink(payload.url)
            window.open(payload.url, '_blank', 'noopener')
          } else {
            setError(humanize(payload.message, t))
          }
        } catch (failure) {
          setError(humanize(String(failure), t))
        } finally {
          setBusyAction(null)
        }
      }, [brand, post, t])

      const startAuth = useCallback(async () => {
        setBusyAction('start')
        setError(null)
        try {
          const payload = await post('/connect/login/start')
          if (payload.ok && payload.url) {
            setLink(payload.url)
            setDeviceCode(payload.deviceCode)
            window.open(payload.url, '_blank', 'noopener')
          } else {
            setError(humanize(payload.message, t))
          }
        } catch (failure) {
          setError(humanize(String(failure), t))
        } finally {
          setBusyAction(null)
        }
      }, [post, t])

      const finishAuth = useCallback(async () => {
        setBusyAction('finish')
        setError(null)
        try {
          const curState = await authFetch(`${API}/state`).then((r) => r.json()).catch(() => null)
          if (curState && curState.stage === 'ready' && curState.auth && curState.auth.userReady) {
            onRecheck()
            return
          }
          const payload = await post('/connect/login/finish', { deviceCode })
          if (payload.ok) { onRecheck(); return }
          const afterState = await authFetch(`${API}/state`).then((r) => r.json()).catch(() => null)
          if (afterState && afterState.stage === 'ready' && afterState.auth && afterState.auth.userReady) {
            onRecheck()
            return
          }
          const text = String(payload.message || '')
          if (/expired|过期|invalid|失效/i.test(text) && /device|code|授权/i.test(text)) {
            setDeviceCode(null)
            setError(humanize(text, t))
            await startAuth()
            return
          }
          if (payload.pending) {
            const deadline = Date.now() + 20000
            let poll = 0
            while (Date.now() < deadline) {
              await new Promise((resolve) => setTimeout(resolve, poll < 4 ? 400 : 1200))
              poll++
              const state = await authFetch(`${API}/connect/login/state`).then((r) => r.json()).catch(() => null)
              if (state && state.ok) { onRecheck(); return }
              if (state && state.done && !state.ok) {
                setError(humanize(state.message || t('gate.pending'), t))
                return
              }
            }
            setError(t('gate.pending'))
            return
          }
          setError(humanize(text, t))
        } catch (failure) {
          setError(humanize(String(failure), t))
        } finally {
          setBusyAction(null)
        }
      }, [deviceCode, onRecheck, post, startAuth, t])

      const saveTeam = useCallback(async () => {
        setBusyAction('team')
        setError(null)
        try {
          const payload = await post('/connect/app/manual', { appId: teamId, appSecret: teamSecret, brand })
          if (payload.ok) {
            setTeamSecret('')
            onRecheck()
          } else {
            setError(humanize(payload.message, t))
          }
        } catch (failure) {
          setError(humanize(String(failure), t))
        } finally {
          setBusyAction(null)
        }
      }, [brand, teamId, teamSecret, onRecheck, post, t])

      const title = stage === 'no-cli' ? t('gate.noTool.title') : stage === 'no-app' ? t('gate.noApp.title') : t('gate.noAuth.title')
      const bodyText = stage === 'no-cli' ? t('gate.noTool.body') : stage === 'no-app' ? t('gate.noApp.body') : t('gate.noAuth.body')

      // Progressive actions: show ONLY what is actionable right now
      const canAutoInstall = !(health.cli && health.cli.canAutoInstall === false)
      const actions = []
      if (stage === 'no-cli') {
        if (busyAction !== 'install') {
          if (canAutoInstall) {
            actions.push(h(Button, { key: 'retryInstall', variant: 'primary', onClick: triggerAutoInstall }, t('gate.noTool.retry')))
          } else {
            actions.push(h(Button, { key: 'check', variant: 'primary', onClick: onRecheck }, t('gate.noTool.done')))
          }
        }
      } else if (stage === 'no-app') {
        if (!link) {
          actions.push(
            h(
              Button,
              { key: 'open', variant: 'primary', disabled: busy, onClick: openApp },
              busyAction === 'start' ? h(Icon, { name: 'refresh', size: 13, className: 'lw-spin' }) : null,
              busyAction === 'start' ? `${t('gate.waiting')}…` : t('gate.noApp.cta'),
            ),
          )
        } else {
          actions.push(h(Button, { key: 'done', variant: 'primary', disabled: busy, onClick: onRecheck }, t('gate.noApp.done')))
          actions.push(
            h(
              Button,
              { key: 'reopen', variant: 'ghost', onClick: () => window.open(link, '_blank', 'noopener') },
              t('gate.noApp.reopen'),
              h(Icon, { name: 'arrowUpRight', size: 13 }),
            ),
          )
        }
      } else {
        if (!deviceCode) {
          actions.push(
            h(
              Button,
              { key: 'auth', variant: 'primary', disabled: busy, onClick: startAuth },
              busyAction === 'start' ? h(Icon, { name: 'refresh', size: 13, className: 'lw-spin' }) : null,
              busyAction === 'start' ? `${t('gate.waiting')}…` : t('gate.noAuth.cta'),
            ),
          )
        } else {
          actions.push(
            h(
              Button,
              { key: 'finish', variant: 'primary', disabled: busy, onClick: finishAuth },
              busyAction === 'finish' ? h(Icon, { name: 'refresh', size: 13, className: 'lw-spin' }) : null,
              busyAction === 'finish' ? `${t('gate.waiting')} ${waited > 0 ? `${waited}s` : '…'}` : t('gate.noAuth.done'),
            ),
          )
          if (link) {
            actions.push(
              h(
                Button,
                { key: 'reopen', variant: 'ghost', onClick: () => window.open(link, '_blank', 'noopener') },
                t('gate.noAuth.reopen'),
                h(Icon, { name: 'arrowUpRight', size: 13 }),
              ),
            )
          }
        }
      }

      return h(
        'section',
        { key: stage, className: 'lw-card lw-stage-in', 'aria-labelledby': 'lw-gate-title' },
        h(Steps, { labels: [t('gate.step.tool'), t('gate.step.app'), t('gate.step.auth')], current }),
        h(
          'div',
          { className: 'lw-sect' },
          h('h2', { className: 'lw-h lw-h-lg', id: 'lw-gate-title' }, title),
          h('p', { className: 'lw-p' }, bodyText),
        ),
        stage === 'no-app' && !link
          ? h(
              'div',
              { className: 'lw-actions', role: 'group', 'aria-label': t('gate.brandLabel') },
              h(
                Button,
                { size: 'sm', active: brand === 'feishu', disabled: busy, onClick: () => setBrand('feishu') },
                t('gate.brandFeishu'),
              ),
              h(
                Button,
                { size: 'sm', active: brand === 'lark', disabled: busy, onClick: () => setBrand('lark') },
                t('gate.brandLark'),
              ),
            )
          : null,
        stage === 'no-cli' && busyAction === 'install'
          ? h(
              'div',
              { className: 'lw-wait', role: 'status', 'aria-live': 'polite' },
              h('span', { className: 'lw-dot is-busy' }),
              `${t('gate.noTool.installing')}${waited > 0 ? ` (${waited}s)` : ''}`,
            )
          : null,
        actions.length > 0 ? h('div', { className: 'lw-actions' }, actions) : null,
        autoChecking
          ? h(
              'div',
              { className: 'lw-wait', role: 'status', 'aria-live': 'polite' },
              h('span', { className: 'lw-dot is-busy' }),
              t('gate.autoChecking'),
            )
          : null,
        error
          ? h(Banner, {
              tone: 'error',
              title: t('error.title'),
              children: error,
              action: stage === 'no-cli' && canAutoInstall
                ? null
                : h(
                    Button,
                    {
                      variant: 'ghost',
                      size: 'sm',
                      onClick: () => (stage === 'no-auth' && deviceCode ? finishAuth() : onRecheck()),
                    },
                    t('error.retry'),
                  ),
            })
          : null,
        stage === 'no-cli'
          ? h(
              'div',
              { className: 'lw-field', style: { borderTop: '0.5px solid var(--lw-line)', paddingTop: 10 } },
              h(
                'button',
                {
                  type: 'button',
                  className: 'lw-details-toggle',
                  'aria-expanded': showManualCli,
                  onClick: () => setShowManualCli((v) => !v),
                },
                h(Icon, { name: 'chevronRight', size: 12, className: `lw-details-chevron${showManualCli ? ' is-open' : ''}` }),
                showManualCli ? t('gate.noTool.manualHide') : t('gate.noTool.manualToggle'),
              ),
              h(
                AnimatedCollapse,
                { open: showManualCli },
                h(
                  'div',
                  { className: 'lw-field', style: { paddingTop: 8 } },
                  h(
                    'div',
                    { className: 'lw-cmd' },
                    h('code', null, health.installCommand || 'npm i -g @larksuite/cli'),
                    h(
                      Button,
                      { size: 'sm', onClick: copyInstall },
                      h(Icon, { name: copied ? 'check' : 'copy', size: 12, className: copied ? 'lw-pop-in' : undefined, style: copied ? { color: 'var(--lw-ok)' } : undefined }),
                      copied ? t('gate.noTool.copied') : t('gate.noTool.copy'),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'lw-actions' },
                    h(Button, { size: 'sm', variant: 'ghost', onClick: onRecheck }, t('gate.noTool.done')),
                  ),
                ),
              ),
            )
          : null,
        stage === 'no-app'
          ? h(
              'div',
              { className: 'lw-field', style: { borderTop: '0.5px solid var(--lw-line)', paddingTop: 12 } },
              h(
                'button',
                {
                  type: 'button',
                  className: 'lw-details-toggle',
                  'aria-expanded': showTeam,
                  onClick: () => setShowTeam((v) => !v),
                },
                h(Icon, { name: 'chevronRight', size: 12, className: `lw-details-chevron${showTeam ? ' is-open' : ''}` }),
                showTeam ? t('gate.team.hide') : t('gate.team.toggle'),
              ),
              h(
                AnimatedCollapse,
                { open: showTeam },
                h(
                  'div',
                  { className: 'lw-field', style: { paddingTop: 8 } },
                  h('input', {
                    className: 'lw-input',
                    type: 'text',
                    autoComplete: 'off',
                    spellCheck: false,
                    placeholder: t('gate.team.appId'),
                    value: teamId,
                    onChange: (e) => setTeamId(e.currentTarget.value),
                  }),
                  h('input', {
                    className: 'lw-input',
                    type: 'password',
                    autoComplete: 'off',
                    placeholder: t('gate.team.secret'),
                    value: teamSecret,
                    onChange: (e) => setTeamSecret(e.currentTarget.value),
                  }),
                  h(
                    'div',
                    { className: 'lw-actions' },
                    h(Button, { size: 'sm', variant: 'primary', disabled: busy || !teamId.trim() || !teamSecret.trim(), onClick: saveTeam }, t('gate.team.save')),
                  ),
                ),
              ),
            )
          : null,
        stage === 'no-cli' ? h('p', { className: 'lw-meta' }, t('gate.noTool.hint')) : null,
      )
    }

    // ── Native Webview (Theme-Aware Loading Veil + Proper Lease Cleanup) ───

    function NativeWebview({ url, visible = true, reloadTick = 0, t }) {
      const containerRef = useRef(null)
      const webviewInstanceRef = useRef(null)
      const leaseRef = useRef(null)
      const guestAbortRef = useRef(null)
      const readyRef = useRef(false)
      const firstDocRef = useRef(true)
      const pendingUrlRef = useRef('')
      const loadedUrlRef = useRef('')
      const lastReloadTickRef = useRef(reloadTick)
      const tRef = useRef(t)
      tRef.current = t

      const [hasBeenVisible, setHasBeenVisible] = useState(Boolean(visible))
      const [loading, setLoading] = useState(true)
      const [slowLoad, setSlowLoad] = useState(false)
      const [error, setError] = useState(null)
      const [retryTick, setRetryTick] = useState(0)

      useEffect(() => {
        if (visible) setHasBeenVisible(true)
      }, [visible])

      // Surface quiet retry action only if initial load stalls > 12s
      useEffect(() => {
        if (!loading || error || !hasBeenVisible) {
          setSlowLoad(false)
          return undefined
        }
        const timer = setTimeout(() => setSlowLoad(true), 12000)
        return () => clearTimeout(timer)
      }, [loading, error, hasBeenVisible, retryTick, reloadTick])

      const dropGuest = useCallback(() => {
        if (guestAbortRef.current) {
          guestAbortRef.current.abort()
          guestAbortRef.current = null
        }
        readyRef.current = false
        firstDocRef.current = true
        if (webviewInstanceRef.current) {
          try { webviewInstanceRef.current.remove() } catch {}
          webviewInstanceRef.current = null
        }
        const lease = leaseRef.current
        leaseRef.current = null
        const desktop = typeof window !== 'undefined' && window.dshDesktop && window.dshDesktop.browser
        if (lease && desktop && typeof desktop.release === 'function') {
          desktop.release(lease).catch(() => {})
        }
      }, [])

      // Release Electron browser lease cleanly on unmount
      useEffect(() => () => dropGuest(), [dropGuest])

      useEffect(() => {
        const container = containerRef.current
        if (!container || !url || !hasBeenVisible) return undefined

        const isManualReload = reloadTick !== lastReloadTickRef.current
        lastReloadTickRef.current = reloadTick

        if (webviewInstanceRef.current && loadedUrlRef.current === url && retryTick === 0 && !isManualReload) {
          return undefined
        }

        let cancelled = false

        const navigateGuest = (el, targetUrl, forceReload) => {
          pendingUrlRef.current = targetUrl
          loadedUrlRef.current = targetUrl
          setLoading(true)
          setSlowLoad(false)
          setError(null)
          if (typeof el.loadURL === 'function') {
            if (!readyRef.current) return
            try {
              const cur = typeof el.getURL === 'function' ? el.getURL() : ''
              const op = forceReload && cur && !cur.startsWith('about:blank') && typeof el.reload === 'function'
                ? Promise.resolve(el.reload())
                : Promise.resolve(el.loadURL(targetUrl))
              op.catch((err) => {
                if (cancelled) return
                if (err && (err.code === 'ERR_ABORTED' || err.errno === -3)) return
                setLoading(false)
                setError(String((err && err.message) || err))
              })
            } catch (err) {
              setLoading(false)
              setError(String((err && err.message) || err))
            }
          } else {
            el.src = targetUrl
          }
        }

        async function initWebview() {
          // If an existing healthy guest is mounted, navigate/reload in place without tearing down partition/session
          if (webviewInstanceRef.current && !error) {
            navigateGuest(webviewInstanceRef.current, url, isManualReload || retryTick > 0)
            return
          }

          if (webviewInstanceRef.current) dropGuest()

          pendingUrlRef.current = url
          loadedUrlRef.current = url
          setLoading(true)
          setSlowLoad(false)
          setError(null)

          const desktop = window.dshDesktop && window.dshDesktop.browser
          if (!desktop || typeof desktop.acquire !== 'function') {
            const iframe = document.createElement('iframe')
            iframe.src = url
            iframe.style.cssText = 'width:100%;height:100%;border:none;flex:1;background:transparent;'
            iframe.onload = () => { if (!cancelled) setLoading(false) }
            iframe.onerror = () => { if (!cancelled) { setLoading(false); setError(tRef.current('view.webviewError')) } }
            container.innerHTML = ''
            container.appendChild(iframe)
            webviewInstanceRef.current = iframe
            return
          }

          try {
            const reservation = await desktop.acquire('workspace:lark')
            if (cancelled) {
              desktop.release(reservation.lease).catch(() => {})
              return
            }
            leaseRef.current = reservation.lease
            const guestAbort = new AbortController()
            guestAbortRef.current = guestAbort
            const { signal } = guestAbort

            const webview = document.createElement('webview')
            webview.style.cssText = 'width:100%;height:100%;border:none;flex:1 1 auto;min-width:0;min-height:0;display:flex;'
            webview.dataset.sidebarBrowserFrame = 'webview'
            webview.setAttribute('name', reservation.lease)
            webview.setAttribute('partition', reservation.partition)
            webview.setAttribute('allowpopups', '')
            webview.setAttribute('src', 'about:blank#' + reservation.lease)

            webview.addEventListener('dom-ready', () => {
              if (signal.aborted) return
              readyRef.current = true
              const target = pendingUrlRef.current
              if (target) {
                pendingUrlRef.current = ''
                Promise.resolve(webview.loadURL(target)).catch((err) => {
                  if (signal.aborted) return
                  if (err && (err.code === 'ERR_ABORTED' || err.errno === -3)) return
                  setLoading(false)
                  setError(String((err && err.message) || err))
                })
              }
            }, { signal })

            webview.addEventListener('did-navigate', () => {
              if (signal.aborted || !readyRef.current) return
              try {
                const cur = typeof webview.getURL === 'function' ? webview.getURL() : ''
                if (firstDocRef.current && /^https?:/i.test(cur)) {
                  firstDocRef.current = false
                  if (typeof webview.clearHistory === 'function') webview.clearHistory()
                }
              } catch {}
            }, { signal })

            webview.addEventListener('did-finish-load', () => {
              if (!signal.aborted && readyRef.current && !firstDocRef.current) setLoading(false)
            }, { signal })
            webview.addEventListener('did-stop-loading', () => {
              if (!signal.aborted && readyRef.current) {
                try {
                  const cur = typeof webview.getURL === 'function' ? webview.getURL() : ''
                  if (!cur || !cur.startsWith('about:blank')) setLoading(false)
                } catch {
                  setLoading(false)
                }
              }
            }, { signal })
            webview.addEventListener('did-fail-load', (e) => {
              if (signal.aborted) return
              if (e.isMainFrame !== false && e.errorCode !== -3) {
                setLoading(false)
                setError(e.errorDescription || String(e.errorCode))
              }
            }, { signal })
            const onCrash = () => {
              if (signal.aborted) return
              dropGuest()
              setLoading(false)
              setError(tRef.current('view.webviewError'))
            }
            webview.addEventListener('render-process-gone', onCrash, { signal })
            webview.addEventListener('destroyed', onCrash, { signal })

            if (typeof desktop.onOpenRequested === 'function') {
              const unsub = desktop.onOpenRequested(reservation.lease, (openUrl) => {
                if (!signal.aborted) window.open(openUrl, '_blank', 'noopener')
              })
              signal.addEventListener('abort', unsub, { once: true })
            }

            container.innerHTML = ''
            container.appendChild(webview)
            webviewInstanceRef.current = webview
          } catch (err) {
            if (!cancelled) {
              setLoading(false)
              setError(String((err && err.message) || err))
            }
          }
        }

        initWebview()
        return () => { cancelled = true }
      }, [url, hasBeenVisible, retryTick, reloadTick, dropGuest])

      return h(
        'div',
        { className: 'lw-wv-wrap' },
        h('div', { ref: containerRef, className: 'lw-wv-mount' }),
        !error
          ? h(
              'div',
              { className: `lw-wv-veil${loading ? '' : ' is-ready'}${loading && slowLoad ? ' is-slow' : ''}`, 'aria-hidden': !loading },
              h(Icon, { name: 'refresh', size: 16, className: loading ? 'lw-spin' : undefined }),
              h('span', null, t('view.webviewLoading')),
              loading && slowLoad
                ? h(Button, { size: 'sm', variant: 'ghost', onClick: () => setRetryTick((n) => n + 1) }, t('error.retry'))
                : null,
            )
          : null,
        error
          ? h(
              'div',
              { className: 'lw-wv-error' },
              h(Icon, { name: 'alertCircle', size: 20, style: { color: 'var(--lw-danger)' } }),
              h('div', { className: 'lw-p' }, `${t('view.webviewError')} (${error})`),
              h(
                'div',
                { className: 'lw-actions' },
                h(Button, { size: 'sm', onClick: () => setRetryTick((n) => n + 1) }, t('error.retry')),
                h(
                  Button,
                  { size: 'sm', variant: 'ghost', onClick: () => window.open(url, '_blank', 'noopener') },
                  t('view.external'),
                  h(Icon, { name: 'arrowUpRight', size: 12 }),
                ),
              ),
            )
          : null,
      )
    }

    // ── Upgraded Markdown Renderer (Tables, Code, Links, Quotes, Bold/Italic)

    function renderInlineText(text, keyPrefix) {
      // Match markdown links [label](https://...), bold **...**, italic *...*
      const tokenRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|\*([^*\n]+)\*/g
      const out = []
      let last = 0
      let m
      let k = 0
      while ((m = tokenRe.exec(text)) !== null) {
        if (m.index > last) out.push(text.slice(last, m.index))
        if (m[1] && m[2]) {
          out.push(
            h(
              'a',
              { key: `${keyPrefix}-a-${k++}`, href: m[2], target: '_blank', rel: 'noopener noreferrer', className: 'lw-md-link' },
              m[1],
            ),
          )
        } else if (m[3]) {
          out.push(h('strong', { key: `${keyPrefix}-b-${k++}`, style: { fontWeight: 600 } }, m[3]))
        } else if (m[4]) {
          out.push(h('em', { key: `${keyPrefix}-i-${k++}` }, m[4]))
        }
        last = m.index + m[0].length
      }
      if (last < text.length) out.push(text.slice(last))
      return out
    }

    function renderInlineMarkdown(text) {
      if (!text) return text
      const parts = []
      const codeRegex = /`([^`]+)`/g
      let lastIndex = 0
      let match
      let key = 0
      while ((match = codeRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          parts.push(renderInlineText(text.slice(lastIndex, match.index), key++))
        }
        parts.push(h('code', { key: `c-${key++}`, className: 'lw-inline-code' }, match[1]))
        lastIndex = match.index + match[0].length
      }
      if (lastIndex < text.length) {
        parts.push(renderInlineText(text.slice(lastIndex), key++))
      }
      return parts
    }

    function renderMarkdownContent(rawText) {
      if (!rawText) return null
      const lines = rawText.split('\n')
      const blocks = []
      let i = 0

      while (i < lines.length) {
        const line = lines[i]
        const trimmed = line.trim()

        // 1. Markdown Table
        if (trimmed.startsWith('|') && i + 1 < lines.length && /^\s*\|?[\s-:]+\|[\s-:]*\|?/.test(lines[i + 1])) {
          const tableLines = []
          while (i < lines.length && lines[i].trim().startsWith('|')) {
            tableLines.push(lines[i].trim())
            i++
          }
          if (tableLines.length >= 2) {
            const parseCells = (row) => row.replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim())
            const rawHeader = parseCells(tableLines[0])
            const rawRows = tableLines.slice(2).map(parseCells)
            blocks.push(
              h(
                'div',
                { key: `tbl-${blocks.length}`, className: 'lw-md-table-wrap' },
                h(
                  'table',
                  { className: 'lw-md-table' },
                  h('thead', null, h('tr', null, rawHeader.map((th, thIdx) => h('th', { key: thIdx }, renderInlineMarkdown(th))))),
                  h(
                    'tbody',
                    null,
                    rawRows.map((tr, trIdx) => h('tr', { key: trIdx }, tr.map((td, tdIdx) => h('td', { key: tdIdx }, renderInlineMarkdown(td))))),
                  ),
                ),
              ),
            )
            continue
          }
        }

        // 2. Fenced Code Block
        if (trimmed.startsWith('```')) {
          const codeLines = []
          i++
          while (i < lines.length && !lines[i].trim().startsWith('```')) {
            codeLines.push(lines[i])
            i++
          }
          i++
          blocks.push(h('pre', { key: `code-${blocks.length}`, className: 'lw-md-code' }, codeLines.join('\n')))
          continue
        }

        // 3. Blockquote
        if (trimmed.startsWith('> ')) {
          const qLines = []
          while (i < lines.length && lines[i].trim().startsWith('> ')) {
            qLines.push(lines[i].trim().slice(2))
            i++
          }
          blocks.push(
            h(
              'blockquote',
              { key: `q-${blocks.length}`, className: 'lw-md-quote' },
              qLines.map((ql, idx) => h('div', { key: idx }, renderInlineMarkdown(ql))),
            ),
          )
          continue
        }

        // 4. Unordered List
        if (/^[-*·]\s+/.test(trimmed)) {
          const items = []
          while (i < lines.length && /^[-*·]\s+/.test(lines[i].trim())) {
            items.push(lines[i].trim().replace(/^[-*·]\s+/, ''))
            i++
          }
          blocks.push(
            h('ul', { key: `ul-${blocks.length}`, className: 'lw-md-ul' }, items.map((itemText, idx) => h('li', { key: idx, className: 'lw-md-li' }, renderInlineMarkdown(itemText)))),
          )
          continue
        }

        // 5. Ordered List
        if (/^\d+\.\s+/.test(trimmed)) {
          const items = []
          while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
            items.push(lines[i].trim().replace(/^\d+\.\s+/, ''))
            i++
          }
          blocks.push(
            h('ol', { key: `ol-${blocks.length}`, className: 'lw-md-ol' }, items.map((itemText, idx) => h('li', { key: idx, className: 'lw-md-li' }, renderInlineMarkdown(itemText)))),
          )
          continue
        }

        // 6. Headings
        const hMatch = trimmed.match(/^(#{1,4})\s+(.*)$/)
        if (hMatch) {
          const level = hMatch[1].length
          i++
          blocks.push(
            h(
              `h${level === 1 ? 3 : level === 2 ? 4 : 5}`,
              { key: `h-${blocks.length}`, className: `lw-md-h ${level === 1 ? 'lw-md-h1' : level === 2 ? 'lw-md-h2' : 'lw-md-h3'}` },
              renderInlineMarkdown(hMatch[2]),
            ),
          )
          continue
        }

        // 7. Paragraph
        if (trimmed !== '') {
          const pLines = [line]
          i++
          while (
            i < lines.length &&
            lines[i].trim() !== '' &&
            !lines[i].trim().startsWith('|') &&
            !lines[i].trim().startsWith('```') &&
            !lines[i].trim().startsWith('> ') &&
            !/^[-*·]\s+/.test(lines[i].trim()) &&
            !/^\d+\.\s+/.test(lines[i].trim()) &&
            !/^(#{1,4})\s+/.test(lines[i].trim())
          ) {
            pLines.push(lines[i])
            i++
          }
          blocks.push(
            h(
              'div',
              { key: `p-${blocks.length}`, className: 'lw-md-p' },
              pLines.map((pl, plIdx) => h('div', { key: plIdx }, renderInlineMarkdown(pl))),
            ),
          )
          continue
        }

        i++
      }

      return blocks
    }

    function AssistantBubble({ msg, onRetry, onConfirmSkill, onCancelSkill, busy, t }) {
      const [thinkingOpen, setThinkingOpen] = useState(false)
      const [cmdOpen, setCmdOpen] = useState(false)

      if (msg.skillGuard) {
        const g = msg.skillGuard
        const status = g.status || (g.executed ? 'done' : 'pending')
        const pillClass = status === 'done' ? 'is-done' : status === 'pending' ? 'is-pending' : ''
        const pillText = status === 'done'
          ? t('view.skillDone')
          : status === 'cancelled'
            ? t('view.skillCancelled')
            : t('view.skillPending')
        const titleLabel = g.label ? `${t('view.skillTitle')} · ${g.label}` : t('view.skillTitle')
        const cmdText = g.commandPreview || (Array.isArray(g.steps) ? g.steps.map((s) => `lark-cli ${s.join(' ')}`).join(' && ') : '')
        return h(
          'div',
          { className: 'lw-msg lw-msg-ai' },
          h(
            'div',
            { className: 'lw-action-card' },
            h(
              'div',
              { className: 'lw-action-head' },
              h(
                'div',
                { className: 'lw-action-title' },
                h(Icon, { name: 'shieldCheck', size: 15, style: { color: status === 'done' ? 'var(--lw-ok)' : 'var(--lw-accent)' } }),
                h('span', null, titleLabel),
              ),
              h('span', { className: `lw-action-pill ${pillClass}` }, pillText),
            ),
            h('div', { className: 'lw-action-body' }, renderMarkdownContent(g.reason || msg.text || '')),
            cmdText
              ? h(
                  'div',
                  null,
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'lw-details-toggle',
                      'aria-expanded': cmdOpen,
                      onClick: () => setCmdOpen((v) => !v),
                    },
                    h(Icon, { name: 'chevronRight', size: 12, className: `lw-details-chevron${cmdOpen ? ' is-open' : ''}` }),
                    cmdOpen ? t('view.skillCmdHide') : t('view.skillCmdShow'),
                  ),
                  h(AnimatedCollapse, { open: cmdOpen }, h('div', { className: 'lw-action-cmd' }, cmdText)),
                )
              : null,
            status === 'pending' && onConfirmSkill
              ? h(
                  'div',
                  { className: 'lw-action-foot' },
                  onCancelSkill
                    ? h(
                        Button,
                        { size: 'sm', variant: 'ghost', disabled: Boolean(busy), onClick: onCancelSkill },
                        t('view.skillCancel'),
                      )
                    : null,
                  h(
                    Button,
                    { size: 'sm', variant: 'primary', disabled: Boolean(busy), onClick: onConfirmSkill },
                    busy ? h(Icon, { name: 'refresh', size: 12, className: 'lw-spin' }) : h(Icon, { name: 'check', size: 12 }),
                    busy ? t('view.skillRunning') : t('view.skillConfirm'),
                  ),
                )
              : null,
          ),
        )
      }

      let reasoning = msg.reasoning || ''
      let cleanText = msg.text || ''

      const thinkMatch = cleanText.match(/<think>([\s\S]*?)<\/think>/i)
      if (thinkMatch) {
        reasoning = (reasoning ? `${reasoning}\n` : '') + thinkMatch[1].trim()
        cleanText = cleanText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
      }

      return h(
        'div',
        { className: `lw-msg lw-msg-ai${msg.error ? ' is-error' : msg.warn ? ' is-warn' : ''}` },
        h(
          'div',
          { className: 'lw-msg-text' },
          reasoning
            ? h(
                'div',
                { style: { marginBottom: 4 } },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'lw-thinking-toggle',
                    'aria-expanded': thinkingOpen,
                    onClick: () => setThinkingOpen((v) => !v),
                  },
                  h(Icon, { name: 'chevronRight', size: 12, className: `lw-details-chevron${thinkingOpen ? ' is-open' : ''}` }),
                  h('span', null, t('view.thinkingDone')),
                ),
                h(AnimatedCollapse, { open: thinkingOpen }, h('div', { className: 'lw-thinking-content' }, reasoning)),
              )
            : null,
          h('div', null, renderMarkdownContent(cleanText)),
          msg.error && onRetry
            ? h(
                'div',
                { className: 'lw-msg-actions' },
                h(
                  Button,
                  { size: 'sm', variant: 'ghost', onClick: onRetry },
                  h(Icon, { name: 'refresh', size: 12 }),
                  t('view.retry'),
                ),
              )
            : null,
        ),
      )
    }

    // ── Account & Permissions Modal ────────────────────────────────────────

    function ConversationTabSwitch({ getEnabled, subscribe, onToggle, t }) {
      const [enabled, setEnabled] = useState(() => Boolean(getEnabled && getEnabled()))
      useEffect(() => {
        setEnabled(Boolean(getEnabled && getEnabled()))
        if (typeof subscribe !== 'function') return undefined
        return subscribe(() => {
          setEnabled(Boolean(getEnabled && getEnabled()))
        })
      }, [getEnabled, subscribe])
      const handleChange = (next) => {
        if (typeof onToggle !== 'function') return
        const val = Boolean(next)
        setEnabled(val)
        onToggle(val)
      }
      if (NativeSwitch) {
        return h(NativeSwitch, {
          checked: enabled,
          onChange: handleChange,
          label: t('settings.convTabLabel'),
          title: t('settings.convTabDesc'),
          disabled: typeof onToggle !== 'function',
        })
      }
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': enabled ? 'true' : 'false',
          'aria-label': t('settings.convTabLabel'),
          title: t('settings.convTabDesc'),
          disabled: typeof onToggle !== 'function',
          className: `lw-switch${enabled ? ' is-on' : ''}`,
          onClick: () => handleChange(!enabled),
        },
        h('span', { className: 'lw-switch-thumb' }),
      )
    }

    function PluginBundleConfig({ subject, getEnabled, subscribe, onToggle, t: propT }) {
      useEffect(() => ensureStyles(), [])
      const theme = useHostTheme()
      if (subject && (subject.kind !== 'bundle' || subject.pkg?.name !== 'dsh-lark-studio')) {
        return null
      }
      const tr = typeof propT === 'function' ? propT : (k) => k
      return h(
        'div',
        { className: 'lw-plugin-cfg', 'data-theme': theme },
        h(
          'div',
          { className: 'lw-plugin-cfg-row' },
          h(
            'div',
            { className: 'lw-plugin-cfg-text' },
            h('span', { className: 'lw-plugin-cfg-title' }, tr('settings.convTabLabel')),
            h('span', { className: 'lw-plugin-cfg-desc' }, tr('settings.convTabDesc')),
          ),
          h(ConversationTabSwitch, { getEnabled, subscribe, onToggle, t: tr }),
        ),
      )
    }

    const DEFAULT_SCOPE_DOMAINS = [
      { key: 'base', icon: 'table' },
      { key: 'calendar', icon: 'calendar' },
      { key: 'task', icon: 'checkSquare' },
      { key: 'im', icon: 'people' },
      { key: 'mail', icon: 'mail' },
      { key: 'contact', icon: 'user' },
      { key: 'approval', icon: 'shieldCheck' },
      { key: 'docs', icon: 'fileText' },
      { key: 'drive', icon: 'layout' },
      { key: 'wiki', icon: 'book' },
      { key: 'sheets', icon: 'chart' },
      { key: 'slides', icon: 'layout' },
      { key: 'markdown', icon: 'fileText' },
      { key: 'mindnotes', icon: 'spark' },
      { key: 'whiteboard', icon: 'image' },
      { key: 'vc', icon: 'people' },
      { key: 'minutes', icon: 'fileText' },
      { key: 'note', icon: 'fileText' },
      { key: 'okr', icon: 'chart' },
      { key: 'attendance', icon: 'check' },
      { key: 'apps', icon: 'spark' },
      { key: 'event', icon: 'refresh' },
      { key: 'application', icon: 'shieldCheck' },
    ]

    function AccountModal({ open, onClose, health, connected, scopesInfo, scopesLoading, scopesError, onRetryScopes, syncingAuth, busyAccount, onGrantAll, onLogout, onUnbind, convTabProps, t }) {
      const { mounted, phase } = useAnimatedPresence(open, 160)
      const [confirmMode, setConfirmMode] = useState(null)
      const boxRef = useRef(null)
      const prevFocusRef = useRef(null)

      useEffect(() => {
        if (!open) {
          setConfirmMode(null)
          if (prevFocusRef.current && typeof prevFocusRef.current.focus === 'function') {
            prevFocusRef.current.focus()
            prevFocusRef.current = null
          }
          return undefined
        }
        prevFocusRef.current = document.activeElement
        requestAnimationFrame(() => {
          if (boxRef.current) boxRef.current.focus()
        })
        const onKeyDown = (e) => {
          if (e.key === 'Escape' && !busyAccount) {
            e.stopPropagation()
            if (confirmMode) setConfirmMode(null)
            else onClose()
          }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [open, busyAccount, confirmMode, onClose])

      if (!mounted) return null

      const isEnUi = t('app.name') === 'Lark Workbench'
      const defaultIconByKey = Object.fromEntries(DEFAULT_SCOPE_DOMAINS.map((d) => [d.key, d.icon]))
      const orderedKeys = Array.isArray(scopesInfo?.domainOrder) && scopesInfo.domainOrder.length > 0
        ? scopesInfo.domainOrder
        : (scopesInfo?.domains && Object.keys(scopesInfo.domains).length > 0
            ? Object.keys(scopesInfo.domains)
            : DEFAULT_SCOPE_DOMAINS.map((d) => d.key))
      const domainList = orderedKeys.map((key) => {
        const entry = scopesInfo?.domains?.[key]
        const iconName = entry?.icon && ICONS[entry.icon] ? entry.icon : (defaultIconByKey[key] || 'checkSquare')
        const fallbackLabel = t(`scope.${key}`)
        const label = (isEnUi ? entry?.nameEn : entry?.name) || (fallbackLabel !== `scope.${key}` ? fallbackLabel : key)
        return {
          key,
          icon: iconName,
          label,
          ready: Boolean(entry?.ready),
        }
      })
      const verified = Boolean(scopesInfo && scopesInfo.scopesVerified !== false)
      const readyDomains = domainList.filter((d) => d.ready)
      const offDomains = domainList.filter((d) => !d.ready)
      const readyCount = readyDomains.length
      const allReady = Boolean(verified && domainList.length > 0 && readyCount === domainList.length)
      const checkingNow = Boolean(scopesLoading && !scopesInfo)

      return h(
        'div',
        {
          className: `lw-modal-overlay${phase === 'open' ? ' is-open' : phase === 'closing' ? ' is-closing' : ''}`,
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': t('account.title'),
          onClick: () => { if (!busyAccount) onClose() },
        },
        h(
          'div',
          {
            ref: boxRef,
            tabIndex: -1,
            className: 'lw-modal-box',
            style: { outline: 'none' },
            onClick: (e) => e.stopPropagation(),
          },
          h(
            'div',
            { className: 'lw-modal-head' },
            h('span', { className: 'lw-modal-title' }, t('account.title')),
            h(
              'button',
              {
                type: 'button',
                className: 'lw-modal-close',
                'aria-label': t('account.close'),
                title: t('account.close'),
                onClick: () => { if (!busyAccount) onClose() },
              },
              h(Icon, { name: 'close', size: 15 }),
            ),
          ),
          h(
            'div',
            { className: 'lw-kv-list' },
            h(
              'div',
              { className: 'lw-kv-row' },
              h('span', { className: 'lw-kv-key' }, t('account.user')),
              h(
                'span',
                { className: 'lw-kv-val' },
                h('span', { className: `lw-dot ${connected ? 'is-ok' : 'is-bad'}` }),
                health?.auth?.userName || (connected ? t('account.authed') : t('account.notLogin')),
              ),
            ),
            h(
              'div',
              { className: 'lw-kv-row' },
              h('span', { className: 'lw-kv-key' }, t('account.app')),
              h('span', { className: 'lw-kv-val lw-mono' }, health?.app?.appId || t('account.notConfigured')),
            ),
            h(
              'div',
              { className: 'lw-kv-row' },
              h('span', { className: 'lw-kv-key' }, t('account.cli')),
              h('span', { className: 'lw-kv-val' }, health?.cli?.available ? t('account.cliReady') : t('account.cliMissing')),
            ),
            convTabProps
              ? h(
                  'div',
                  { className: 'lw-kv-row' },
                  h('span', { className: 'lw-kv-key', title: t('settings.convTabDesc') }, t('settings.convTabLabel')),
                  h(
                    'span',
                    { className: 'lw-kv-val' },
                    h(ConversationTabSwitch, { ...convTabProps, t }),
                  ),
                )
              : null,
          ),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
              h(
                'span',
                { className: 'lw-meta', style: { fontWeight: 500, color: 'var(--lw-ink-2)' } },
                verified ? `${t('account.scopesTitle')} (${readyCount}/${domainList.length})` : t('account.scopesTitle'),
              ),
              h(
                'div',
                { style: { display: 'inline-flex', alignItems: 'center', gap: 10 } },
                onRetryScopes
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'lw-md-link',
                        disabled: Boolean(scopesLoading),
                        onClick: onRetryScopes,
                        style: {
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          cursor: scopesLoading ? 'default' : 'pointer',
                          fontSize: 11.5,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                          opacity: scopesLoading ? 0.6 : 1,
                        },
                      },
                      h(Icon, { name: 'refresh', size: 11, className: scopesLoading ? 'lw-spin' : undefined }),
                      t('account.scopeRetry'),
                    )
                  : null,
                scopesInfo?.consoleUrl
                  ? h(
                      'a',
                      {
                        href: scopesInfo.consoleUrl,
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        className: 'lw-md-link',
                        style: { fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 3 },
                      },
                      t('account.console'),
                      h(Icon, { name: 'arrowUpRight', size: 11 }),
                    )
                  : null,
              ),
            ),
            (scopesError || (scopesInfo && scopesInfo.scopesVerified === false))
              ? h(
                  'div',
                  { className: 'lw-meta', style: { color: 'var(--lw-warn)' } },
                  scopesError || scopesInfo?.scopesError || t('account.scopeError'),
                )
              : null,
            checkingNow
              ? h(
                  'div',
                  { className: 'lw-scope-loading-row' },
                  h(Icon, { name: 'refresh', size: 13, className: 'lw-spin' }),
                  h('span', null, t('account.scopesCheckingLine')),
                )
              : h(
                  'div',
                  { className: 'lw-scope-groups' },
                  readyDomains.length > 0
                    ? h(
                        'div',
                        { className: 'lw-scope-group' },
                        h('div', { className: 'lw-scope-group-head' }, `${t('account.scopeReady')} (${readyDomains.length})`),
                        h(
                          'div',
                          { className: 'lw-scope-flow' },
                          readyDomains.map((item) =>
                            h(
                              'span',
                              { key: item.key, className: 'lw-scope-chip is-ready' },
                              h('span', { className: 'lw-dot is-ok' }),
                              h(Icon, { name: item.icon, size: 12, style: { color: 'var(--lw-ink-3)' } }),
                              h('span', null, item.label),
                            ),
                          ),
                        ),
                      )
                    : null,
                  offDomains.length > 0
                    ? h(
                        'div',
                        { className: 'lw-scope-group' },
                        h('div', { className: 'lw-scope-group-head' }, `${t('account.scopeOff')} (${offDomains.length})`),
                        h(
                          'div',
                          { className: 'lw-scope-flow' },
                          offDomains.map((item) =>
                            h(
                              'span',
                              { key: item.key, className: 'lw-scope-chip is-off' },
                              h('span', { className: 'lw-dot' }),
                              h(Icon, { name: item.icon, size: 12, style: { color: 'var(--lw-ink-3)' } }),
                              h('span', null, item.label),
                            ),
                          ),
                        ),
                      )
                    : null,
                ),
            !allReady && (verified || !checkingNow)
              ? h(
                  Button,
                  { size: 'sm', variant: 'primary', disabled: busyAccount || syncingAuth, onClick: onGrantAll, style: { width: '100%' } },
                  syncingAuth ? h(Icon, { name: 'refresh', size: 12, className: 'lw-spin' }) : null,
                  syncingAuth ? t('account.granting') : t('account.grantAll'),
                )
              : null,
          ),
          confirmMode
            ? h(
                'div',
                { className: 'lw-modal-confirm', role: 'alertdialog' },
                h('div', { className: 'lw-confirm-head' }, confirmMode === 'logout' ? t('account.logoutTitle') : t('account.unbindTitle')),
                h(
                  'div',
                  { className: 'lw-meta' },
                  confirmMode === 'logout'
                    ? t('account.logoutBody').replace('%s', health?.auth?.userName || t('account.authed'))
                    : t('account.unbindBody').replace('%s', health?.app?.appId || ''),
                ),
                h(
                  'div',
                  { className: 'lw-actions', style: { justifyContent: 'flex-end' } },
                  h(Button, { size: 'sm', variant: 'ghost', disabled: busyAccount, onClick: () => setConfirmMode(null) }, t('account.cancel')),
                  h(
                    Button,
                    {
                      size: 'sm',
                      variant: 'danger',
                      disabled: busyAccount,
                      onClick: confirmMode === 'logout' ? onLogout : onUnbind,
                    },
                    busyAccount ? t('account.working') : confirmMode === 'logout' ? t('account.logoutConfirm') : t('account.unbindConfirm'),
                  ),
                ),
              )
            : h(
                'div',
                { className: 'lw-modal-footer' },
                h(
                  Button,
                  { size: 'sm', variant: 'ghost', disabled: busyAccount || !connected, onClick: () => setConfirmMode('logout') },
                  t('account.logout'),
                ),
                h(
                  Button,
                  { size: 'sm', variant: 'danger', disabled: busyAccount || !health?.app?.appId, onClick: () => setConfirmMode('unbind') },
                  t('account.unbind'),
                ),
              ),
        ),
      )
    }

    // ── Main Workbench Component ───────────────────────────────────────────

    function Workbench(props) {
      if (props) {
        const resolved = resolveDshSessionId(props, props.ctx)
        if (resolved) currentDshSessionId = resolved
      }

      useEffect(() => ensureStyles(), [])

      const rootRef = useRef(null)
      const layoutRef = useRef(null)
      const containerWidth = useContainerSize(rootRef)
      const isCompact = containerWidth < 720
      const isNarrow = containerWidth < 480

      const t = useMemo(() => translator(props), [props.t])
      const activeLang = useMemo(() => (t('app.name') === 'Lark Workbench' ? 'en' : 'zh'), [t])
      const theme = useHostTheme()

      const [stage, setStage] = useState('pick')
      const [sentence, setSentence] = useState('')
      const [showMoreScenes, setShowMoreScenes] = useState(false)
      const [tweakText, setTweakText] = useState('')
      const [adjustText, setAdjustText] = useState('')
      const [adjustError, setAdjustError] = useState(null)
      const [liveReasoning, setLiveReasoning] = useState('')
      const [liveReply, setLiveReply] = useState('')
      const [liveStage, setLiveStage] = useState('')
      const [confirmPlan, setConfirmPlan] = useState(null)
      const [savedDraft, setSavedDraft] = useState(readSavedDraft)
      const [history, setHistory] = useState([])
      const [attachments, setAttachments] = useState([])
      const [sourceAttachment, setSourceAttachment] = useState(null)
      const uploadAbortsRef = useRef(new Map())
      const [syncingAuth, setSyncingAuth] = useState(false)
      const [syncingTable, setSyncingTable] = useState(false)
      const [syncedTick, setSyncedTick] = useState(false)
      const [webviewReloadTick, setWebviewReloadTick] = useState(0)
      const [compactPane, setCompactPane] = useState('chat') // 'chat' | 'table' on compact containers

      const authAbortRef = useRef(null)
      const activeRequestAbortRef = useRef(null)
      const liveThinkingRef = useRef(null)
      const autoFollowRef = useRef(true)

      const [tableOpen, setTableOpen] = useState(() => {
        try {
          if (window.localStorage.getItem('dsh-lark-table-open') === 'false') return false
        } catch {}
        return true
      })
      const toggleTable = useCallback((nextOpen) => {
        try { window.localStorage.setItem('dsh-lark-table-open', String(nextOpen)) } catch {}
        setTableOpen(nextOpen)
      }, [])

      const [splitWidth, setSplitWidth] = useState(() => {
        try {
          const v = parseInt(window.localStorage.getItem('dsh-lark-split-width'), 10)
          if (!isNaN(v) && v >= 280 && v <= 1200) return v
        } catch {}
        return 420
      })
      const [isResizing, setIsResizing] = useState(false)
      const [isEasingSplit, setIsEasingSplit] = useState(false)
      const splitWidthRef = useRef(splitWidth)
      splitWidthRef.current = splitWidth

      // Direct 0ms Pointer-Tracked Split Resizer (Container-Clamped)
      const startResize = useCallback((e) => {
        e.preventDefault()
        const target = e.currentTarget
        if (target && typeof target.setPointerCapture === 'function') {
          try { target.setPointerCapture(e.pointerId) } catch {}
        }
        setIsResizing(true)
        setIsEasingSplit(false)
        const startX = e.clientX
        const initialWidth = splitWidthRef.current
        const totalW = (layoutRef.current && layoutRef.current.clientWidth) || window.innerWidth || 1000
        const minW = 280
        const maxW = Math.max(minW, totalW - 300)

        const onPointerMove = (moveEvent) => {
          const nextW = Math.round(Math.min(Math.max(initialWidth + (moveEvent.clientX - startX), minW), maxW))
          setSplitWidth(nextW)
        }
        const onPointerUp = () => {
          setIsResizing(false)
          try { window.localStorage.setItem('dsh-lark-split-width', String(splitWidthRef.current)) } catch {}
          window.removeEventListener('pointermove', onPointerMove)
          window.removeEventListener('pointerup', onPointerUp)
          window.removeEventListener('pointercancel', onPointerUp)
        }
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
        window.addEventListener('pointercancel', onPointerUp)
      }, [])

      const resetSplitWidth = useCallback(() => {
        setIsEasingSplit(true)
        setSplitWidth(420)
        try { window.localStorage.setItem('dsh-lark-split-width', '420') } catch {}
        setTimeout(() => setIsEasingSplit(false), 300)
      }, [])

      const adjustInputRef = useRef(null)
      const chatStreamRef = useRef(null)
      const [showDetails, setShowDetails] = useState(false)
      const [plan, setPlan] = useState(null)
      const [planStage, setPlanStage] = useState('understanding')
      const [previewReply, setPreviewReply] = useState(null)
      const [queuedPrompt, setQueuedPrompt] = useState(null)
      const [changedFields, setChangedFields] = useState([])
      const [nudgeBuild, setNudgeBuild] = useState(false)
      const changedTimerRef = useRef(null)
      const nudgeTimerRef = useRef(null)
      const lastRefinePromptRef = useRef('')
      const [busy, setBusy] = useState(null)
      const [error, setError] = useState(null)
      const [health, setHealth] = useState(null)
      const [recent, setRecent] = useState(readRecent)
      const [active, setActive] = useState(null)
      const [copiedView, setCopiedView] = useState(false)
      const [toast, setToast] = useState(null)
      const toastTimerRef = useRef(null)
      const alive = useRef(true)

      const showToast = useCallback((nextToast) => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
        setToast(nextToast)
        const duration = nextToast && nextToast.onUndo ? 5000 : 2800
        toastTimerRef.current = setTimeout(() => setToast(null), duration)
      }, [])

      const dismissToast = useCallback(() => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
        setToast(null)
      }, [])

      const [models, setModels] = useState([])
      const [selectedModel, setSelectedModel] = useState(() => {
        try { return JSON.parse(window.localStorage.getItem('dsh-lark-model') || 'null') || null } catch { return null }
      })
      const modelKey = useCallback((m) => (m ? `${m.provider || ''}:${m.id || ''}` : ''), [])

      useEffect(() => {
        let isMount = true
        authFetch(`${API}/models`)
          .then((r) => r.json())
          .then((data) => {
            if (!isMount || !data || !data.ok || !Array.isArray(data.models) || data.models.length === 0) return
            setModels(data.models)
            try {
              const saved = JSON.parse(window.localStorage.getItem('dsh-lark-model') || 'null')
              if (saved) {
                const matched = data.models.find((m) => (m.provider === saved.provider && m.id === saved.id) || m.id === saved.id)
                if (matched) { setSelectedModel(matched); return }
              }
            } catch {}
            if (data.current) {
              const matched = data.models.find((m) => (m.provider === data.current.provider && m.id === data.current.model) || m.id === data.current.model)
              if (matched) { setSelectedModel(matched); return }
            }
            setSelectedModel(data.models[0])
          })
          .catch(() => {})
        return () => { isMount = false }
      }, [])

      const changeModel = useCallback((targetKey) => {
        const found = models.find((m) => modelKey(m) === targetKey || m.id === targetKey)
        if (found) {
          setSelectedModel(found)
          try { window.localStorage.setItem('dsh-lark-model', JSON.stringify(found)) } catch {}
        }
      }, [models, modelKey])

      const realTable = props.realTable
      useEffect(() => {
        if (realTable && typeof realTable.closeSidebarBrowserTabs === 'function') {
          realTable.closeSidebarBrowserTabs(props.sessionId)
        }
      }, [props.sessionId, realTable])

      const lastSyncedActiveRef = useRef(null)
      const busyRef = useRef(busy)
      busyRef.current = busy

      const refreshHealth = useCallback(async () => {
        try {
          const payload = await authFetch(`${API}/state`).then((r) => r.json())
          if (!alive.current) return
          setHealth(payload)
          setError(null)
          if (payload && payload.active && payload.active.updatedAt && !busyRef.current) {
            const incoming = payload.active
            if (!lastSyncedActiveRef.current || incoming.updatedAt > (lastSyncedActiveRef.current.updatedAt || 0)) {
              lastSyncedActiveRef.current = incoming
              if (incoming.preview && incoming.plan) {
                setPlan(incoming.plan)
                setStage('preview')
              } else if (incoming.url) {
                setActive(incoming)
                setStage('view')
                setRecent(rememberRecent(incoming))
              }
            }
          }
        } catch {
          if (alive.current) setHealth({ stage: 'unknown' })
        }
      }, [])

      // Visibility-aware health check (pauses when hidden, polite interval when connected)
      const connected = Boolean(health && health.stage === 'ready' && health.auth && health.auth.userReady)
      useEffect(() => {
        alive.current = true
        refreshHealth()
        const intervalMs = connected ? 15000 : 4000
        const timer = setInterval(() => {
          if (alive.current && (typeof document === 'undefined' || !document.hidden)) refreshHealth()
        }, intervalMs)
        const onVisible = () => {
          if (typeof document !== 'undefined' && !document.hidden && alive.current) refreshHealth()
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          alive.current = false
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [refreshHealth, connected])

      // Smart auto-scroll: follow stream continuously unless user deliberately scrolled up
      useEffect(() => {
        const el = chatStreamRef.current
        if (stage !== 'view' || !el) return
        if (autoFollowRef.current) {
          el.scrollTop = el.scrollHeight
        }
      }, [stage, history, busy, liveReasoning, liveReply, liveStage])

      // Keep the internal live-thinking box scrolled to the latest line while streaming
      useEffect(() => {
        const box = liveThinkingRef.current
        if (box && !liveReply) {
          box.scrollTop = box.scrollHeight
        }
      }, [liveReasoning, liveReply])

      // Hide host conversation composer via lightweight MutationObserver (no 250ms polling)
      useEffect(() => {
        const selector = '[data-composer-seat], [data-conversation-region="composer"], [class*="composerSeat"], [class*="composerStack"]'
        const hideSeats = () => {
          document.querySelectorAll(selector).forEach((seat) => {
            if (seat && !seat.dataset.lwHidden) {
              seat.dataset.lwHidden = 'true'
              seat.style.setProperty('display', 'none', 'important')
            }
          })
        }
        hideSeats()
        const observer = new MutationObserver(hideSeats)
        if (document.body) observer.observe(document.body, { childList: true, subtree: true })
        return () => {
          observer.disconnect()
          document.querySelectorAll(selector).forEach((seat) => {
            if (seat && seat.dataset.lwHidden === 'true') {
              delete seat.dataset.lwHidden
              seat.style.removeProperty('display')
            }
          })
        }
      }, [])

      // Smart desktop auto-focus when entering workspace
      useEffect(() => {
        if (stage !== 'view') return
        const canHover = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: hover)').matches
        if (canHover && adjustInputRef.current) {
          requestAnimationFrame(() => adjustInputRef.current && adjustInputRef.current.focus())
        }
      }, [stage, active && active.url])

      // Auto-persist active preview draft so accidental back/tab-switch never loses work
      useEffect(() => {
        if (stage === 'preview' && plan && Array.isArray(plan.tables)) {
          setSavedDraft(saveSavedDraft({ plan, sentence, at: Date.now() }))
        }
      }, [stage, plan, sentence])

      // Escape cancels destructive confirm card
      useEffect(() => {
        if (!confirmPlan) return undefined
        const onKey = (e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            setConfirmPlan(null)
          }
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [confirmPlan])

      const toolOk = !health || !health.cli || health.cli.available !== false

      const post = useCallback(async (path, body, signal) => {
        const payload = body && typeof body === 'object' && !Array.isArray(body)
          ? { lang: activeLang, ...body }
          : body
        const response = await authFetch(`${API}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal,
        })
        return response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
      }, [activeLang])

      const postStream = useCallback(async (path, body, { signal, onEvent } = {}) => {
        const payloadBody = body && typeof body === 'object' && !Array.isArray(body)
          ? { lang: activeLang, ...body, stream: true }
          : body
        const resp = await authFetch(`${API}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal,
          body: JSON.stringify(payloadBody),
        })
        const contentType = resp.headers.get('content-type') || ''
        if (!contentType.includes('text/event-stream') || !resp.body) {
          return resp.json().catch(() => ({ ok: false, message: `HTTP ${resp.status}` }))
        }
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        let finalPayload
        const handleLine = (line) => {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) return
          try {
            const evt = JSON.parse(trimmed.slice(5).trim())
            if (evt.type === 'done') finalPayload = evt.payload
            else if (evt.type === 'error' && !finalPayload) finalPayload = { ok: false, message: evt.error || t('error.title') }
            else onEvent?.(evt)
          } catch {}
        }
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            if (buf.trim()) buf.split('\n').forEach(handleLine)
            break
          }
          buf += decoder.decode(value, { stream: true })
          const parts = buf.split('\n\n')
          buf = parts.pop() || ''
          for (const part of parts) {
            part.split('\n').forEach(handleLine)
          }
        }
        return finalPayload
      }, [activeLang, t])

      const stopActiveRequest = useCallback(() => {
        if (activeRequestAbortRef.current) {
          activeRequestAbortRef.current.abort()
          activeRequestAbortRef.current = null
        }
        if (queuedPrompt?.text) {
          if (queuedPrompt.target === 'refine') setTweakText(queuedPrompt.text)
          else setAdjustText(queuedPrompt.text)
        }
        setQueuedPrompt(null)
        setPlanStage('understanding')
        setBusy(null)
        setLiveReasoning('')
        setLiveReply('')
        setLiveStage('')
        showToast({ message: t('toast.stopped') })
      }, [queuedPrompt, showToast, t])

      const restart = useCallback(() => {
        if (activeRequestAbortRef.current) {
          activeRequestAbortRef.current.abort()
          activeRequestAbortRef.current = null
        }
        const savedPlan = stage === 'preview' && plan ? plan : null
        const savedSentence = sentence
        setStage('pick')
        setPlan(null)
        setPlanStage('understanding')
        setPreviewReply(null)
        setQueuedPrompt(null)
        setActive(null)
        setError(null)
        setHistory([])
        setSentence('')
        setTweakText('')
        setAdjustText('')
        setAdjustError(null)
        setConfirmPlan(null)
        setSourceAttachment(null)
        setShowDetails(false)
        setCopiedView(false)
        setCompactPane('chat')
        if (savedPlan) {
          showToast({
            message: t('toast.draftCleared'),
            onUndo: () => {
              setPlan(savedPlan)
              setSentence(savedSentence)
              setStage('preview')
            },
          })
        }
      }, [stage, plan, sentence, showToast, t])

      const build = useCallback(async () => {
        if (!plan || busy) return
        setBusy('build')
        setError(null)
        try {
          const payload = await post('/build', {
            plan,
            kanban: true,
            sample: true,
            ...(sourceAttachment?.id ? { importAttachmentId: sourceAttachment.id } : {}),
          })
          if (!alive.current) return
          if (payload.ok) {
            const item = {
              name: payload.baseName,
              url: payload.url,
              at: Date.now(),
              token: payload.token,
              table: payload.tables && payload.tables[0] ? payload.tables[0].name : undefined,
            }
            setRecent(rememberRecent(item))
            clearSavedDraft()
            setSavedDraft(null)
            setActive(item)
            setHistory([])
            setStage('view')
            showToast({ message: t('toast.built') })
          } else {
            setError(payload.message || payload.error || t('error.title'))
          }
        } catch (failure) {
          if (alive.current) setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          if (alive.current) setBusy(null)
        }
      }, [plan, busy, post, showToast, t])

      /** Background live sync — NEVER wipes chat history. */
      const refreshLive = useCallback(async (item, showFeedback = false) => {
        if (!item) return
        const token = item.token || baseTokenFrom(item.url)
        if (!token) return
        if (showFeedback) {
          setSyncingTable(true)
          setWebviewReloadTick((n) => n + 1)
        }
        try {
          const query = new URLSearchParams({ token, limit: '12' })
          if (item.table) query.set('table', item.table)
          const res = await authFetch(`${API}/records?${query}`).then((r) => r.json())
          if (alive.current && res && res.ok) {
            if (res.table && res.table !== item.table) {
              const next = { ...item, table: res.table }
              setActive(next)
              const entries = readRecent().map((e) => (e.url === next.url ? { ...e, table: next.table } : e))
              try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(entries)) } catch {}
              setRecent(entries)
            }
            if (showFeedback) {
              setSyncedTick(true)
              showToast({ message: t('toast.synced') })
              setTimeout(() => { if (alive.current) setSyncedTick(false) }, 1600)
            }
          }
        } catch {} finally {
          if (alive.current && showFeedback) setSyncingTable(false)
        }
      }, [showToast, t])

      const openRecent = useCallback(async (item) => {
        if (!item || busy) return
        setActive(item)
        setStage('view')
        setCompactPane('chat')
        setError(null)
        setHistory([])
        setAdjustText('')
        setAdjustError(null)
        setConfirmPlan(null)
        refreshLive(item, false)
      }, [busy, refreshLive])

      const finishAdjust = useCallback(async (payload) => {
        if (!payload) {
          setAdjustError(t('error.title'))
          return
        }
        if (payload.needsConfirm) {
          const hasTableConfirm = (Array.isArray(payload.destructive) && payload.destructive.length > 0)
            || (Array.isArray(payload.ops) && payload.ops.length > 0)
          if (payload.confirmKind === 'skill_guard' || payload.skill || !hasTableConfirm) {
            setConfirmPlan(null)
            setAdjustError(null)
            const hasExecutableSkill = payload.confirmKind === 'skill_guard' && Array.isArray(payload.steps) && payload.steps.length > 0
            setHistory((prev) => [
              ...prev,
              {
                role: 'assistant',
                text: payload.reply || payload.summary || '',
                warn: !hasExecutableSkill,
                ...(hasExecutableSkill
                  ? {
                      skillGuard: {
                        skill: payload.skill || payload.domain || 'feishu',
                        label: payload.skillLabel || '',
                        reason: payload.confirmReason || payload.reply || payload.summary || '',
                        commandPreview: payload.commandPreview || '',
                        steps: payload.steps,
                        status: 'pending',
                      },
                    }
                  : {}),
              },
            ])
            return
          }
          setConfirmPlan({ ops: payload.ops ?? [], destructive: payload.destructive ?? [] })
          return
        }
        if (payload.type === 'missing_scope') {
          setConfirmPlan(null)
          setAdjustError(null)
          setHistory((prev) => [
            ...prev,
            {
              role: 'assistant',
              missingScope: true,
              domain: payload.domain || '',
              domainTitle: payload.domainTitle || t('scope.defaultDomain'),
              requiredScopes: payload.requiredScopes || [],
              consoleUrl: payload.consoleUrl,
              text: payload.reply || payload.message || '',
            },
          ])
          return
        }
        if (payload.type === 'table_plan' && payload.plan) {
          setConfirmPlan(null)
          setAdjustError(null)
          setSentence(payload.sentence || payload.plan.baseName || '')
          setPlan(payload.plan)
          setSourceAttachment(payload.sourceAttachment || null)
          setTweakText('')
          setShowDetails(false)
          setStage('preview')
          return
        }
        if (!payload.ok && !payload.summary && !payload.reply) {
          const msg = payload.message || payload.error || t('error.title')
          setHistory((prev) => [...prev, { role: 'assistant', text: humanize(msg, t), error: true }])
          return
        }
        setConfirmPlan(null)
        const replyText = payload.reply || payload.summary || ''
        setHistory((prev) => [
          ...prev,
          {
            role: 'assistant',
            text: replyText,
            reasoning: payload.reasoning || null,
            warn: payload.ok === false,
          },
        ])

        if (payload.type !== 'answer' && payload.type !== 'collab' && payload.type !== 'suggest_table') {
          if (payload.live && payload.live.ok && payload.live.table && active && payload.live.table !== active.table) {
            const next = { ...active, table: payload.live.table }
            setActive(next)
            const entries = readRecent().map((e) => (e.url === next.url ? { ...e, table: next.table } : e))
            try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(entries)) } catch {}
            setRecent(entries)
          }
        }
      }, [active, t])

      const openCollab = useCallback((initialPrompt) => {
        setActive({ type: 'collab', name: t('view.collabTitle') })
        setStage('view')
        setHistory([])
        setAdjustText(initialPrompt || '')
        setAdjustError(null)
        setConfirmPlan(null)
      }, [t])

      const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
      const MAX_FILES = 5

      const visionWarning = useMemo(() => {
        const hasImage = attachments.some((a) => a.status !== 'error' && (a.kind === 'image' || /\.(png|jpe?g|webp|gif)$/i.test(a.name || '')))
        if (!hasImage) return false
        const mods = selectedModel && Array.isArray(selectedModel.inputModalities) ? selectedModel.inputModalities : null
        return Boolean(mods && !mods.includes('image'))
      }, [attachments, selectedModel])

      const removeAttachment = useCallback((localId) => {
        const controller = uploadAbortsRef.current.get(localId)
        if (controller) {
          try { controller.abort() } catch {}
          uploadAbortsRef.current.delete(localId)
        }
        setAttachments((prev) => {
          const target = prev.find((a) => a.localId === localId)
          if (target?.id) {
            authFetch(`${API}/upload?id=${encodeURIComponent(target.id)}`, { method: 'DELETE' }).catch(() => {})
          }
          return prev.filter((a) => a.localId !== localId)
        })
      }, [])

      const addFiles = useCallback((fileList) => {
        const incoming = Array.from(fileList || [])
        if (incoming.length === 0) return

        setAttachments((prev) => {
          const remaining = MAX_FILES - prev.length
          if (remaining <= 0) {
            showToast({ message: t('file.tooMany') })
            return prev
          }
          const accepted = []
          for (const rawFile of incoming.slice(0, remaining)) {
            if (rawFile.size > MAX_UPLOAD_BYTES) {
              showToast({ message: `${rawFile.name}: ${t('file.tooLarge')}` })
              continue
            }
            const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            const isImg = String(rawFile.type || '').startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(rawFile.name || '')
            accepted.push({
              localId,
              name: rawFile.name || 'file',
              size: rawFile.size,
              mime: rawFile.type || 'application/octet-stream',
              kind: isImg ? 'image' : 'text',
              status: 'uploading',
              progress: 25,
              rawFile,
            })
          }
          if (incoming.length > remaining) {
            showToast({ message: t('file.tooMany') })
          }
          for (const entry of accepted) {
            const controller = new AbortController()
            uploadAbortsRef.current.set(entry.localId, controller)
            const q = new URLSearchParams({ name: entry.name, mime: entry.mime })
            const targetUrl = `${API}/upload?${q.toString()}`
            const progressTimer = setInterval(() => {
              if (!alive.current) return
              setAttachments((curr) => curr.map((a) => (
                a.localId === entry.localId && a.status === 'uploading' && a.progress < 85
                  ? { ...a, progress: Math.min(85, a.progress + 12) }
                  : a
              )))
            }, 180)

            authFetch(targetUrl, {
              method: 'POST',
              headers: { 'content-type': 'application/octet-stream' },
              body: entry.rawFile,
              signal: controller.signal,
            })
              .then(async (resp) => {
                const text = await resp.text().catch(() => '')
                let parsed = null
                try { parsed = JSON.parse(text) } catch {}
                return { status: resp.status, ok: resp.ok, parsed }
              })
              .then(({ status, ok, parsed }) => {
                clearInterval(progressTimer)
                uploadAbortsRef.current.delete(entry.localId)
                if (!alive.current || controller.signal.aborted) return
                if (ok && parsed && parsed.ok && parsed.file) {
                  const f = parsed.file
                  setAttachments((curr) => curr.map((a) => (
                    a.localId === entry.localId
                      ? {
                          ...a,
                          id: f.id,
                          kind: f.kind,
                          previewMeta: activeLang === 'en' ? (f.previewMetaEn || f.previewMeta) : f.previewMeta,
                          totalRows: f.totalRows || 0,
                          status: 'ready',
                          progress: 100,
                        }
                      : a
                  )))
                } else {
                  const errMsg = parsed?.error || (status ? `HTTP ${status}` : t('file.uploadFailed'))
                  setAttachments((curr) => curr.map((a) => (
                    a.localId === entry.localId ? { ...a, status: 'error', error: errMsg } : a
                  )))
                }
              })
              .catch((err) => {
                clearInterval(progressTimer)
                uploadAbortsRef.current.delete(entry.localId)
                if (!alive.current || controller.signal.aborted) return
                const errMsg = err instanceof Error ? err.message : t('file.uploadFailed')
                setAttachments((curr) => curr.map((a) => (
                  a.localId === entry.localId ? { ...a, status: 'error', error: errMsg } : a
                )))
              })
          }
          return [...prev, ...accepted.map(({ rawFile, ...rest }) => rest)]
        })
      }, [activeLang, showToast, t])

      const applyAdjust = useCallback(async (overrideText, options = {}) => {
        if (busy) return
        const readyFiles = options.attachments || attachments.filter((a) => a.status === 'ready' && a.id)
        const historyAttachmentIds = []
        for (const msg of history) {
          if (msg && msg.role === 'user' && Array.isArray(msg.files)) {
            for (const f of msg.files) {
              if (f && f.id) historyAttachmentIds.push(f.id)
            }
          }
        }
        const newIds = readyFiles.map((f) => f.id)
        const attachmentIds = [...new Set([...newIds, ...historyAttachmentIds.slice(-5)])].slice(0, 5)
        const text = (typeof overrideText === 'string' ? overrideText : adjustText).trim()
        if (!text && attachmentIds.length === 0) return
        const isCollab = options.collab || (active && active.type === 'collab') || !active
        const token = (active && active.token) || (active && baseTokenFrom(active.url)) || ''
        if (!token && !isCollab) {
          setAdjustError(t('view.noToken'))
          return
        }
        if (isCollab && (!active || active.type !== 'collab')) {
          setActive({ type: 'collab', name: t('view.collabTitle') })
          setStage('view')
        }
        const recentHistory = history
          .filter((msg) => msg && msg.text && !msg.error)
          .map((msg) => ({ role: msg.role === 'user' ? 'user' : 'assistant', text: msg.text }))
          .slice(-8)

        const displayFiles = readyFiles.map((f) => ({ id: f.id, name: f.name, kind: f.kind, previewMeta: f.previewMeta }))
        const displayUserText = text || t('file.defaultPrompt').replace('{n}', String(displayFiles.length))

        if (options.retryIndex !== undefined) {
          setHistory((prev) => prev.filter((_, i) => i !== options.retryIndex))
        } else {
          setHistory((prev) => [...prev, { role: 'user', text: displayUserText, files: displayFiles }])
        }
        setAdjustText('')
        if (!options.attachments) setAttachments([])
        setBusy('adjust')
        autoFollowRef.current = true
        setLiveReasoning('')
        setLiveReply('')
        setLiveStage('')
        setAdjustError(null)

        const controller = new AbortController()
        activeRequestAbortRef.current = controller

        try {
          let payload
          if (isCollab && typeof window !== 'undefined' && window.fetch) {
            payload = await postStream('/adjust', {
              token: token || '',
              type: 'collab',
              instruction: text,
              attachments: attachmentIds,
              table: (active && active.table) || '',
              history: recentHistory,
              model: selectedModel ? selectedModel.id : undefined,
              provider: selectedModel ? selectedModel.provider : undefined,
            }, {
              signal: controller.signal,
              onEvent: (evt) => {
                if (evt.type === 'reasoning') setLiveReasoning((prev) => prev + evt.delta)
                else if (evt.type === 'reply_delta' && evt.delta) {
                  setLiveReply((prev) => prev + evt.delta)
                  setLiveStage((prev) => (prev === 'planning_table' || prev === 'building_preview' ? prev : 'writing'))
                }
                else if (evt.type === 'stage' && evt.stage) setLiveStage(evt.stage)
                else if (evt.type === 'text') setLiveStage((prev) => (prev === 'planning_table' || prev === 'building_preview' ? prev : 'writing'))
              },
            })
          } else {
            payload = await post('/adjust', {
              token: token || '',
              type: isCollab ? 'collab' : 'base',
              instruction: text,
              attachments: attachmentIds,
              table: (active && active.table) || '',
              history: recentHistory,
              model: selectedModel ? selectedModel.id : undefined,
              provider: selectedModel ? selectedModel.provider : undefined,
            }, controller.signal)
          }
          if (!alive.current || controller.signal.aborted) return
          if (payload) await finishAdjust(payload)
        } catch (failure) {
          if (controller.signal.aborted) return
          const errMsg = failure instanceof Error ? failure.message : String(failure)
          if (alive.current) {
            setHistory((prev) => [...prev, { role: 'assistant', text: humanize(errMsg, t), error: true }])
          }
        } finally {
          if (activeRequestAbortRef.current === controller) activeRequestAbortRef.current = null
          if (alive.current) {
            setBusy(null)
            setLiveReasoning('')
            setLiveReply('')
            setLiveStage('')
          }
        }
      }, [active, adjustText, busy, finishAdjust, history, post, postStream, selectedModel, t])

      const planFor = useCallback(async (text) => {
        const readyFiles = attachments.filter((a) => a.status === 'ready' && a.id)
        const attachmentIds = readyFiles.map((f) => f.id)
        const s = String(text || '').trim()
        if ((!s && attachmentIds.length === 0) || busy) return
        // When files are attached on the home screen, route to the conversational
        // understanding workspace first instead of assuming table creation upfront.
        if (attachmentIds.length > 0) {
          setSentence('')
          setAttachments([])
          setError(null)
          setPreviewReply(null)
          openCollab('')
          setTimeout(() => { applyAdjust(s, { collab: true, attachments: readyFiles }) }, 0)
          return
        }
        setSentence(s)
        setPreviewReply(null)
        setPlanStage('understanding')
        setBusy('plan')
        setError(null)
        const controller = new AbortController()
        activeRequestAbortRef.current = controller
        try {
          const payload = typeof window !== 'undefined' && window.fetch
            ? await postStream('/plan', {
                sentence: s,
                attachments: attachmentIds,
                model: selectedModel ? selectedModel.id : undefined,
                provider: selectedModel ? selectedModel.provider : undefined,
              }, {
                signal: controller.signal,
                onEvent: (evt) => {
                  if (evt.type === 'stage' && evt.stage) setPlanStage(evt.stage)
                },
              })
            : await post('/plan', {
                sentence: s,
                attachments: attachmentIds,
                model: selectedModel ? selectedModel.id : undefined,
                provider: selectedModel ? selectedModel.provider : undefined,
              }, controller.signal)
          if (!alive.current || controller.signal.aborted) return
          if (payload && payload.ok && payload.plan) {
            setPlan(payload.plan)
            setSourceAttachment(payload.sourceAttachment || null)
            setAttachments([])
            setTweakText('')
            setShowDetails(false)
            setStage('preview')
            return
          }
          if (payload && payload.isNotTable) {
            // Seamlessly hand off non-table queries (including file Q&A) to Lark Assistant
            if (activeRequestAbortRef.current === controller) activeRequestAbortRef.current = null
            setBusy(null)
            setPlanStage('understanding')
            setAttachments([])
            openCollab('')
            setTimeout(() => { applyAdjust(s, { collab: true, attachments: readyFiles }) }, 0)
            return
          }
          setError(payload?.message || payload?.error || t('error.title'))
        } catch (err) {
          if (controller.signal.aborted) return
          if (alive.current) setError(err instanceof Error ? err.message : String(err))
        } finally {
          if (activeRequestAbortRef.current === controller) activeRequestAbortRef.current = null
          if (alive.current) {
            setBusy(null)
            setPlanStage('understanding')
          }
        }
      }, [attachments, busy, post, postStream, selectedModel, openCollab, applyAdjust, t])

      const refine = useCallback(async (extra) => {
        const readyFiles = attachments.filter((a) => a.status === 'ready' && a.id)
        const attachmentIds = readyFiles.map((f) => f.id)
        const clean = String(extra || '').trim()
        if ((!clean && attachmentIds.length === 0) || busy || !plan) return
        const clearTweakIfUnchanged = () => {
          setTweakText((prev) => (String(prev || '').trim() === clean ? '' : prev))
        }
        lastRefinePromptRef.current = clean
        const prevPlan = plan
        setBusy('refine')
        setError(null)
        setPreviewReply(null)
        const controller = new AbortController()
        activeRequestAbortRef.current = controller
        try {
          const payload = await post('/plan', {
            sentence: clean,
            attachments: attachmentIds,
            currentPlan: prevPlan,
            model: selectedModel ? selectedModel.id : undefined,
            provider: selectedModel ? selectedModel.provider : undefined,
          }, controller.signal)
          if (!alive.current || controller.signal.aborted) return

          if (payload && payload.ok && payload.action === 'build') {
            clearTweakIfUnchanged()
            setAttachments([])
            setPreviewReply(null)
            if (activeRequestAbortRef.current === controller) activeRequestAbortRef.current = null
            setBusy(null)
            setTimeout(() => { build() }, 0)
            return
          }

          if (payload && payload.ok && payload.action === 'reply') {
            clearTweakIfUnchanged()
            setAttachments([])
            setPreviewReply(payload.reply || t('toast.kept'))
            return
          }

          if (payload && payload.isNotTable) {
            clearTweakIfUnchanged()
            setAttachments([])
            setPreviewReply(null)
            if (activeRequestAbortRef.current === controller) activeRequestAbortRef.current = null
            setBusy(null)
            openCollab('')
            setTimeout(() => { applyAdjust(clean, { collab: true, attachments: readyFiles }) }, 0)
            return
          }

          if (payload && payload.ok && payload.action === 'keep') {
            clearTweakIfUnchanged()
            setAttachments([])
            if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current)
            setNudgeBuild(true)
            nudgeTimerRef.current = setTimeout(() => { if (alive.current) setNudgeBuild(false) }, 1600)
            showToast({ message: t('toast.kept') })
            return
          }

          if (payload && payload.ok && payload.plan) {
            const nextPlan = payload.plan
            if (payload.sourceAttachment) setSourceAttachment(payload.sourceAttachment)
            setAttachments([])
            // Compute highlighted fields (server list with client fallback diff)
            let diffNames = Array.isArray(payload.changedFields) ? payload.changedFields : []
            if (diffNames.length === 0) {
              const prevNames = new Set((prevPlan.tables?.[0]?.fields || []).map((f) => f.name))
              diffNames = (nextPlan.tables?.[0]?.fields || []).map((f) => f.name).filter((n) => !prevNames.has(n))
            }
            setPlan(nextPlan)
            setPreviewReply(null)
            clearTweakIfUnchanged()
            if (diffNames.length > 0) {
              if (changedTimerRef.current) clearTimeout(changedTimerRef.current)
              setChangedFields(diffNames)
              changedTimerRef.current = setTimeout(() => { if (alive.current) setChangedFields([]) }, 1700)
            }
            showToast({
              message: t('toast.refined'),
              onUndo: () => {
                setPlan(prevPlan)
                setChangedFields([])
              },
            })
            return
          }

          setError(payload?.message || payload?.error || t('error.title'))
        } catch (err) {
          if (controller.signal.aborted) return
          if (alive.current) setError(err instanceof Error ? err.message : String(err))
        } finally {
          if (activeRequestAbortRef.current === controller) activeRequestAbortRef.current = null
          if (alive.current) setBusy(null)
        }
      }, [plan, busy, attachments, post, selectedModel, build, openCollab, applyAdjust, showToast, t])

      // Flush queued user prompt as soon as the current request finishes naturally
      useEffect(() => {
        if (busy || !queuedPrompt || !alive.current) return
        const next = queuedPrompt
        setQueuedPrompt(null)
        const timer = setTimeout(() => {
          if (!alive.current) return
          if (next.target === 'refine') refine(next.text)
          else applyAdjust(next.text)
        }, 0)
        return () => clearTimeout(timer)
      }, [busy, queuedPrompt, refine, applyAdjust])

      const confirmApply = useCallback(async () => {
        if (!confirmPlan || !active || busy) return
        const token = active.token || baseTokenFrom(active.url)
        if (!token) { setAdjustError(t('view.noToken')); return }
        setBusy('adjust')
        setAdjustError(null)
        try {
          const payload = await post('/adjust', {
            token,
            ops: confirmPlan.ops,
            confirm: true,
            table: active.table,
          })
          if (!alive.current) return
          await finishAdjust(payload)
        } catch (failure) {
          if (alive.current) setAdjustError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          if (alive.current) setBusy(null)
        }
      }, [active, busy, confirmPlan, finishAdjust, post, t])

      // Instant Remove from Recent + 5s Undo Toast
      const forgetRecent = useCallback((item) => {
        if (!item) return
        const previous = readRecent()
        const next = previous.filter((entry) => entry.url !== item.url)
        try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch {}
        setRecent(next)
        showToast({
          message: t('recent.removed').replace('%s', item.name),
          onUndo: () => {
            try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(previous)) } catch {}
            setRecent(previous)
          },
        })
      }, [showToast, t])

      // Instant Clear Chat + 5s Undo Toast
      const clearChat = useCallback(() => {
        if (history.length === 0) return
        const snapshot = history
        setHistory([])
        showToast({
          message: t('toast.cleared'),
          onUndo: () => setHistory(snapshot),
        })
      }, [history, showToast, t])

      const copyActiveUrl = useCallback(() => {
        if (!active || !active.url) return
        const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
        if (clipboard && clipboard.writeText) {
          clipboard.writeText(active.url).then(() => {
            setCopiedView(true)
            showToast({ message: t('toast.copied') })
            setTimeout(() => { if (alive.current) setCopiedView(false) }, 1800)
          }).catch(() => {})
        }
      }, [active, showToast, t])

      // ── Account Modal State ──────────────────────────────────────────────
      const [showAccountModal, setShowAccountModal] = useState(false)
      const [busyAccount, setBusyAccount] = useState(false)
      const [scopesInfo, setScopesInfo] = useState(null)
      const [scopesLoading, setScopesLoading] = useState(false)
      const [scopesError, setScopesError] = useState(null)

      const refreshScopes = useCallback(async (force = false) => {
        setScopesLoading(true)
        setScopesError(null)
        try {
          const resp = await authFetch(`${API}/connect/scopes${force ? '?force=1' : ''}`)
          const data = await resp.json().catch(() => null)
          if (!alive.current) return null
          if (data && data.ok) {
            setScopesInfo(data)
            if (data.scopesVerified === false && data.scopesError) {
              setScopesError(data.scopesError)
            }
            return data
          }
          setScopesError(data?.message || data?.error || t('account.scopeError'))
        } catch {
          if (alive.current) setScopesError(t('account.scopeError'))
        } finally {
          if (alive.current) setScopesLoading(false)
        }
        return null
      }, [t])

      useEffect(() => {
        if (!connected) return
        if (!scopesInfo && !scopesLoading) {
          refreshScopes(false)
        }
      }, [connected, scopesInfo, scopesLoading, refreshScopes])

      useEffect(() => {
        if (!showAccountModal) return
        refreshScopes(false)
      }, [showAccountModal, refreshScopes])

      const handleGrantAll = useCallback(async () => {
        setSyncingAuth(true)
        try {
          const payload = await post('/connect/login/start', {})
          if (payload.ok && payload.url) {
            window.open(payload.url, '_blank', 'noopener')
            const deadline = Date.now() + 60000
            let pollCount = 0
            while (Date.now() < deadline && alive.current) {
              await new Promise((r) => setTimeout(r, pollCount < 4 ? 400 : 1200))
              pollCount++
              const sc = await authFetch(`${API}/connect/scopes?force=1`).then((r) => r.json()).catch(() => null)
              if (sc && sc.ok && alive.current) {
                setScopesInfo(sc)
                const entries = Object.values(sc.domains || {})
                if (sc.scopesVerified !== false && entries.length > 0 && entries.every((d) => d.ready)) {
                  refreshHealth()
                  break
                }
              }
              const st = await authFetch(`${API}/connect/login/state`).then((r) => r.json()).catch(() => null)
              if (st && st.ok) {
                refreshHealth()
                refreshScopes(true)
                break
              }
            }
          }
        } catch {} finally {
          if (alive.current) setSyncingAuth(false)
        }
      }, [post, refreshHealth, refreshScopes])

      const handleLogout = useCallback(async () => {
        if (busyAccount) return
        setBusyAccount(true)
        try {
          await post('/connect/logout', {})
          setScopesInfo(null)
          setScopesError(null)
          setShowAccountModal(false)
          if (stage === 'view') restart()
          await refreshHealth()
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          if (alive.current) setBusyAccount(false)
        }
      }, [busyAccount, post, stage, restart, refreshHealth])

      const handleUnbind = useCallback(async () => {
        if (busyAccount) return
        setBusyAccount(true)
        try {
          await post('/connect/unbind', {})
          setScopesInfo(null)
          setScopesError(null)
          setShowAccountModal(false)
          if (stage === 'view') restart()
          await refreshHealth()
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          if (alive.current) setBusyAccount(false)
        }
      }, [busyAccount, post, stage, restart, refreshHealth])

      const statusBadge = h(
        'button',
        {
          type: 'button',
          className: 'lw-status',
          onClick: () => setShowAccountModal(true),
          title: t('status.manage'),
          'aria-label': t('status.manage'),
        },
        h('span', { className: `lw-dot ${!health ? 'is-busy' : health.stage === 'unknown' ? 'is-bad' : connected ? 'is-ok' : ''}` }),
        h(
          'span',
          { className: isNarrow ? 'lw-hide-compact' : undefined },
          !health
            ? t('status.checking')
            : health.stage === 'unknown'
              ? t('status.offline')
              : connected
                ? (health.auth && health.auth.userName ? health.auth.userName : t('status.ready'))
                : t('status.setup'),
        ),
      )

      // ── Screen Rendering ─────────────────────────────────────────────────

      const preserveWorkspaceOnAuthDrop = Boolean(
        !connected
        && health?.stage === 'no-auth'
        && ((stage === 'view' && history.length > 0) || (stage === 'preview' && Boolean(plan))),
      )

      let content = null

      if (!health) {
        content = h(
          'div',
          { className: 'lw-boot', role: 'status', 'aria-live': 'polite' },
          h('span', { className: 'lw-dot is-busy' }),
          h('span', { className: 'lw-meta' }, t('status.checking')),
        )
      } else if (health.stage === 'unknown') {
        content = h(
          'section',
          { className: 'lw-card lw-stage-in' },
          h('div', { className: 'lw-sect' }, h('h2', { className: 'lw-h' }, t('status.offline')), h('p', { className: 'lw-p' }, t('gate.retryBody'))),
          h('div', { className: 'lw-actions' }, h(Button, { variant: 'primary', size: 'sm', onClick: refreshHealth }, t('status.recheck'))),
        )
      } else if (!connected && !preserveWorkspaceOnAuthDrop) {
        content = h(ConnectGate, { health, t, onRecheck: refreshHealth, onToast: showToast })
      } else if (stage === 'pick') {
        const planning = busy === 'plan'
        const primaryScenes = SCENARIOS.filter((s) => s.primary)
        const extraScenes = SCENARIOS.filter((s) => !s.primary)

        const openDraft = (draft) => {
          if (!draft || !draft.plan) return
          setPlan(draft.plan)
          setSentence(draft.sentence || '')
          setTweakText('')
          setShowDetails(false)
          setError(null)
          setStage('preview')
        }

        const discardDraft = () => {
          const prev = savedDraft
          clearSavedDraft()
          setSavedDraft(null)
          showToast({
            message: t('draft.discarded'),
            onUndo: prev
              ? () => {
                  saveSavedDraft(prev)
                  setSavedDraft(prev)
                }
              : undefined,
          })
        }

        const runScenario = (scenario) => {
          const promptText = t(scenario.promptKey)
          if (scenario.type === 'collab') {
            openCollab('')
            setTimeout(() => { applyAdjust(promptText, { collab: true }) }, 0)
          } else {
            setSentence(promptText)
            planFor(promptText)
          }
        }

        content = h(
          'section',
          { className: 'lw-pick lw-stage-in' },
          h('h1', { className: 'lw-hero-title' }, t('pick.title')),
          h(UnifiedComposer, {
            value: sentence,
            onChange: (val) => {
              setSentence(val)
              if (error) setError(null)
            },
            onSubmit: () => {
              const hasReady = attachments.some((a) => a.status === 'ready')
              if (sentence.trim().length >= 2 || hasReady) planFor(sentence)
            },
            onStop: planning ? stopActiveRequest : null,
            placeholder: t('pick.placeholder'),
            busy: planning,
            disabled: !toolOk || (sentence.trim().length < 2 && !attachments.some((a) => a.status === 'ready')),
            models,
            selectedModel,
            modelKey,
            changeModel,
            files: attachments,
            onAddFiles: addFiles,
            onRemoveFile: removeAttachment,
            visionWarning,
            minHeight: 62,
            id: 'lw-own',
            ariaLabel: t('pick.own'),
            t,
          }),
          error
            ? h(Banner, {
                tone: 'error',
                title: t('error.title'),
                children: humanize(error, t),
                action: h(Button, { variant: 'ghost', size: 'sm', onClick: () => (sentence ? planFor(sentence) : restart()) }, t('error.retry')),
              })
            : null,
          planning
            ? h(
                'div',
                { className: 'lw-planning', 'aria-live': 'polite' },
                h(
                  'div',
                  { className: `lw-plan-status${planStage === 'building_preview' ? ' is-building' : ''}` },
                  h(
                    'div',
                    { className: 'lw-think-dots', 'aria-hidden': true },
                    h('span', null),
                    h('span', null),
                    h('span', null),
                  ),
                  h(
                    'span',
                    { className: 'lw-meta lw-thinking-label' },
                    planStage === 'building_preview'
                      ? t('busy.buildingPreview')
                      : planStage === 'routing_collab'
                        ? t('busy.routingCollab')
                        : t('busy.planningSub'),
                  ),
                ),
                planStage === 'building_preview' ? h(TableSkeleton) : null,
              )
            : h(
                'div',
                { className: 'lw-scenes-wrap' },
                h(
                  'div',
                  { className: 'lw-scenes', role: 'group', 'aria-label': t('pick.own') },
                  primaryScenes.map((scenario) =>
                    h(
                      'button',
                      {
                        key: scenario.id,
                        type: 'button',
                        className: 'lw-chip',
                        disabled: Boolean(busy) || !toolOk,
                        onClick: () => runScenario(scenario),
                      },
                      h(Icon, { name: scenario.icon, size: 13, className: 'lw-chip-ico' }),
                      h('span', null, t(scenario.titleKey)),
                    ),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'lw-chip is-muted',
                      'aria-expanded': showMoreScenes,
                      onClick: () => setShowMoreScenes((v) => !v),
                    },
                    h(Icon, { name: showMoreScenes ? 'chevronDown' : 'moreHorizontal', size: 13 }),
                    h('span', null, showMoreScenes ? t('pick.less') : t('pick.more')),
                  ),
                ),
                h(
                  AnimatedCollapse,
                  { open: showMoreScenes },
                  h(
                    'div',
                    { className: 'lw-scenes', style: { paddingTop: 2 } },
                    extraScenes.map((scenario) =>
                      h(
                        'button',
                        {
                          key: scenario.id,
                          type: 'button',
                          className: 'lw-chip',
                          disabled: Boolean(busy) || !toolOk,
                          onClick: () => runScenario(scenario),
                        },
                        h(Icon, { name: scenario.icon, size: 13, className: 'lw-chip-ico' }),
                        h('span', null, t(scenario.titleKey)),
                      ),
                    ),
                  ),
                ),
                h(DraftEntry, {
                  draft: savedDraft,
                  t,
                  onResume: openDraft,
                  onDiscard: discardDraft,
                  disabled: Boolean(busy) || !toolOk,
                }),
                h(Recent, {
                  items: recent,
                  t,
                  onOpen: openRecent,
                  onForget: forgetRecent,
                  disabled: Boolean(busy) || !toolOk,
                }),
              ),
        )
      } else if (stage === 'preview' && plan) {
        const primaryTable = plan.tables[0]
        const totalCols = plan.tables.reduce((sum, tbl) => sum + (tbl.fields || []).length, 0)
        const totalRows = primaryTable ? (primaryTable.records ?? []).length : 0
        const hasKanban = plan.tables.some((tbl) => Boolean(tbl.kanbanField))
        const isRefining = busy === 'refine' || busy === 'plan'
        const isBuilding = busy === 'build'
        const changedSet = changedFields.length > 0 ? new Set(changedFields) : null

        content = h(
          'div',
          { className: 'lw-workspace lw-stage-in' },
          h(
            'header',
            { className: 'lw-ws-header' },
            h(
              'div',
              { className: 'lw-ws-header-left' },
              h(
                'button',
                { type: 'button', className: 'lw-back', disabled: Boolean(busy), onClick: restart },
                h(Icon, { name: 'arrowLeft', size: 14 }),
                h('span', null, t('preview.back')),
              ),
              h('div', { className: 'lw-ws-sep' }),
              h('span', { className: 'lw-ws-title' }, plan.baseName || t('preview.title')),
            ),
            h(
              'div',
              { className: 'lw-ws-header-right' },
              h(
                Button,
                {
                  variant: 'primary',
                  size: 'sm',
                  className: nudgeBuild ? 'is-nudge' : '',
                  disabled: Boolean(busy) || !toolOk,
                  onClick: build,
                },
                isBuilding || isRefining ? h(Icon, { name: 'refresh', size: 12, className: 'lw-spin' }) : null,
                isBuilding ? t('busy.building') : isRefining ? t('busy.refining') : t('preview.build'),
              ),
            ),
          ),
          h(
            'div',
            { className: 'lw-preview-scroll' },
            h(
              'div',
              { className: 'lw-preview-inner' },
              error
                ? h(Banner, {
                    tone: 'error',
                    title: t('error.title'),
                    children: humanize(error, t),
                    action: h(
                      Button,
                      {
                        variant: 'ghost',
                        size: 'sm',
                        onClick: () => {
                          const retryText = tweakText.trim() || lastRefinePromptRef.current
                          if (retryText) refine(retryText)
                          else setError(null)
                        },
                      },
                      t('error.retry'),
                    ),
                  })
                : null,
              h(
                'div',
                { className: 'lw-preview-head' },
                h('h2', { className: 'lw-preview-title' }, plan.baseName || t('preview.title')),
                plan.intro ? h('p', { className: 'lw-p' }, plan.intro) : null,
                h(
                  'div',
                  { className: 'lw-preview-meta' },
                  h('span', null, t('preview.draft')),
                  h('span', { className: 'lw-preview-sep' }, '·'),
                  h('span', null, `${totalCols} ${t('preview.cols')}`),
                  totalRows > 0 ? h('span', { className: 'lw-preview-sep' }, '·') : null,
                  totalRows > 0 ? h('span', null, `${totalRows} ${t('preview.rows')}`) : null,
                  hasKanban ? h('span', { className: 'lw-preview-sep' }, '·') : null,
                  hasKanban ? h('span', null, t('preview.kanban')) : null,
                  sourceAttachment && sourceAttachment.totalRows > 0 ? h('span', { className: 'lw-preview-sep' }, '·') : null,
                  sourceAttachment && sourceAttachment.totalRows > 0
                    ? h('span', null, t('file.importBadge').replace('{n}', String(sourceAttachment.totalRows)))
                    : null,
                ),
              ),
              plan.tables.map((table) =>
                h(
                  'div',
                  { key: table.name, style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                  plan.tables.length > 1 ? h('div', { className: 'lw-meta' }, table.name) : null,
                  h(PreviewTable, { table, t, refining: isRefining || isBuilding, changedSet }),
                ),
              ),
              h(
                'div',
                null,
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'lw-details-toggle',
                    'aria-expanded': showDetails,
                    onClick: () => setShowDetails((v) => !v),
                  },
                  h(Icon, { name: 'chevronRight', size: 12, className: `lw-details-chevron${showDetails ? ' is-open' : ''}` }),
                  showDetails ? t('preview.detailsHide') : `${t('preview.detailsShow')} (${totalCols})`,
                ),
                h(
                  AnimatedCollapse,
                  { open: showDetails },
                  plan.tables.map((table) => h(Legend, { key: `legend-${table.name}`, table, t })),
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'lw-ws-dock' },
            h(
              'div',
              { className: 'lw-composer-wrap', style: { maxWidth: 900 } },
              previewReply
                ? h(
                    'div',
                    { className: 'lw-preview-reply', role: 'status', 'aria-live': 'polite' },
                    h(Icon, { name: 'spark', size: 14, className: 'lw-preview-reply-ico' }),
                    h('div', { className: 'lw-preview-reply-text' }, renderMarkdownContent(previewReply)),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'lw-preview-reply-close',
                        title: t('preview.replyClose'),
                        'aria-label': t('preview.replyClose'),
                        onClick: () => setPreviewReply(null),
                      },
                      h(Icon, { name: 'close', size: 13 }),
                    ),
                  )
                : null,
              queuedPrompt && queuedPrompt.target === 'refine'
                ? h(
                    'div',
                    { className: 'lw-queue-bar', role: 'status' },
                    h('span', { className: 'lw-dot is-busy' }),
                    h('span', { className: 'lw-queue-text' }, `${t('composer.queued')}${queuedPrompt.text}`),
                    h('button', { type: 'button', className: 'lw-queue-cancel', onClick: () => setQueuedPrompt(null) }, t('composer.cancelQueue')),
                  )
                : null,
              h(UnifiedComposer, {
                value: tweakText,
                onChange: (val) => {
                  setTweakText(val)
                  if (previewReply && String(val || '').trim()) setPreviewReply(null)
                },
                onSubmit: () => {
                  const hasReady = attachments.some((a) => a.status === 'ready')
                  if (tweakText.trim() || hasReady) refine(tweakText)
                },
                onQueue: (val) => {
                  const clean = String(val || '').trim()
                  if (!clean) return
                  setQueuedPrompt({ target: 'refine', text: clean })
                  setTweakText('')
                },
                onStop: isRefining ? stopActiveRequest : null,
                placeholder: t('preview.tweakPlaceholder'),
                busy: isRefining,
                disabled: !tweakText.trim() && !attachments.some((a) => a.status === 'ready'),
                models,
                selectedModel,
                modelKey,
                changeModel,
                files: attachments,
                onAddFiles: addFiles,
                onRemoveFile: removeAttachment,
                visionWarning,
                minHeight: 46,
                id: 'lw-tweak',
                ariaLabel: t('preview.tweakPlaceholder'),
                t,
              }),
            ),
          ),
        )
      } else if (stage === 'view' && active) {
        const isTableMode = Boolean(active && active.type !== 'collab' && active.url)
        const showSplit = isTableMode && !isCompact && tableOpen
        const showChatPane = !isTableMode || !isCompact || compactPane === 'chat'
        const showWebviewPane = isTableMode && (isCompact ? compactPane === 'table' : tableOpen)

        const starters = isTableMode
          ? [
              { icon: 'chart', label: t('starter.analyze'), prompt: t('starter.analyze.prompt') },
              { icon: 'layout', label: t('starter.kanban'), prompt: t('starter.kanban.prompt') },
              { icon: 'table', label: t('starter.form'), prompt: t('starter.form.prompt') },
              { icon: 'checkSquare', label: t('starter.batch'), prompt: t('starter.batch.prompt') },
            ]
          : [
              { icon: 'calendar', label: t('starter.calendar'), prompt: t('starter.calendar.prompt') },
              { icon: 'checkSquare', label: t('starter.todo'), prompt: t('starter.todo.prompt') },
              { icon: 'people', label: t('starter.chat'), prompt: t('starter.chat.prompt') },
              { icon: 'mail', label: t('starter.mail'), prompt: t('starter.mail.prompt') },
            ]

        const emptyState = h(
          'div',
          { className: 'lw-empty-stage' },
          h('div', { className: 'lw-empty-mark' }, h(Icon, { name: isTableMode ? 'table' : 'spark', size: 17 })),
          h('p', { className: 'lw-empty-copy' }, isTableMode ? t('view.emptyTable') : t('view.emptyCollab')),
          h(
            'div',
            { className: 'lw-empty-chips' },
            starters.map((item, idx) =>
              h(
                'button',
                {
                  key: idx,
                  type: 'button',
                  className: 'lw-chip',
                  disabled: Boolean(busy),
                  onClick: () => applyAdjust(item.prompt),
                },
                h(Icon, { name: item.icon, size: 13, className: 'lw-chip-ico' }),
                h('span', null, item.label),
              ),
            ),
          ),
        )

        const chatFeed = h(
          'div',
          {
            ref: chatStreamRef,
            className: 'lw-chat-stream',
            onScroll: (e) => {
              const el = e.currentTarget
              autoFollowRef.current = (el.scrollHeight - el.scrollTop - el.clientHeight) < 80
            },
          },
          history.length === 0 && busy !== 'adjust' ? emptyState : null,
          history.map((msg, idx) => {
            if (msg.missingScope) {
              return h(
                'div',
                { key: idx, className: 'lw-msg lw-msg-ai' },
                h(
                  'div',
                  { className: 'lw-scope-card' },
                  h(
                    'div',
                    { className: 'lw-scope-head' },
                    h(Icon, { name: 'shieldCheck', size: 15, style: { color: 'var(--lw-accent)' } }),
                    t('view.scopeNeed').replace('%s', msg.domainTitle || ''),
                  ),
                  msg.text ? h('div', { className: 'lw-meta', style: { whiteSpace: 'pre-wrap' } }, msg.text) : null,
                  h(
                    'div',
                    { className: 'lw-actions' },
                    h(
                      Button,
                      {
                        size: 'sm',
                        variant: 'primary',
                        disabled: syncingAuth,
                        onClick: async () => {
                          if (authAbortRef.current) authAbortRef.current.aborted = true
                          const curAbort = { aborted: false }
                          authAbortRef.current = curAbort
                          setSyncingAuth(true)
                          try {
                            const payload = await post('/connect/login/start', {
                              ...(msg.domain ? { domain: msg.domain } : {}),
                              ...(Array.isArray(msg.requiredScopes) && msg.requiredScopes.length > 0 ? { scopes: msg.requiredScopes } : {}),
                            })
                            if (payload.ok && payload.url) {
                              window.open(payload.url, '_blank', 'noopener')
                              if (payload.deviceCode) {
                                post('/connect/login/finish', { deviceCode: payload.deviceCode }).catch(() => {})
                              }
                              const deadline = Date.now() + 60000
                              while (Date.now() < deadline && !curAbort.aborted) {
                                await new Promise((r) => setTimeout(r, 1500))
                                if (curAbort.aborted) return
                                const st = await authFetch(`${API}/connect/login/state`).then((r) => r.json()).catch(() => null)
                                if (st && st.ok) {
                                  setSyncingAuth(false)
                                  refreshHealth()
                                  refreshScopes()
                                  const lastUser = [...history.slice(0, idx)].reverse().find((m) => m && m.role === 'user')
                                  if (lastUser && lastUser.text) applyAdjust(lastUser.text, { retryIndex: idx })
                                  return
                                }
                              }
                            }
                          } catch {} finally {
                            if (!curAbort.aborted) setSyncingAuth(false)
                          }
                        },
                      },
                      syncingAuth ? h(Icon, { name: 'refresh', size: 12, className: 'lw-spin' }) : null,
                      syncingAuth ? t('view.scopeWaiting') : t('view.scopeAuth'),
                    ),
                    h(
                      Button,
                      {
                        size: 'sm',
                        variant: 'ghost',
                        onClick: () => {
                          if (authAbortRef.current) authAbortRef.current.aborted = true
                          setSyncingAuth(false)
                          const lastUser = [...history.slice(0, idx)].reverse().find((m) => m && m.role === 'user')
                          if (lastUser && lastUser.text) applyAdjust(lastUser.text, { retryIndex: idx })
                        },
                      },
                      t('view.retry'),
                    ),
                    msg.consoleUrl
                      ? h(
                          'a',
                          {
                            href: msg.consoleUrl,
                            target: '_blank',
                            rel: 'noopener noreferrer',
                            className: 'lw-md-link',
                            style: { fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 'auto' },
                          },
                          t('view.scopeConsole'),
                          h(Icon, { name: 'arrowUpRight', size: 11 }),
                        )
                      : null,
                  ),
                ),
              )
            }

            if (msg.role === 'user') {
              return h(
                'div',
                { key: idx, className: 'lw-msg lw-msg-user' },
                Array.isArray(msg.files) && msg.files.length > 0
                  ? h(
                      'div',
                      { className: 'lw-msg-files' },
                      msg.files.map((f, fIdx) =>
                        h(
                          'div',
                          { key: f.id || fIdx, className: 'lw-msg-file-chip', title: f.name },
                          h(Icon, { name: fileKindIcon(f.kind, f.name), size: 12 }),
                          h('span', null, f.name),
                        ),
                      ),
                    )
                  : null,
                h('div', { className: 'lw-msg-text' }, msg.text),
              )
            }

            const prevUser = msg.error
              ? [...history.slice(0, idx)].reverse().find((m) => m && m.role === 'user')
              : null

            return h(AssistantBubble, {
              key: idx,
              msg,
              busy,
              t,
              onCancelSkill: msg.skillGuard && msg.skillGuard.status === 'pending'
                ? () => {
                    if (busy) return
                    setHistory((prev) => prev.map((m, i) => (
                      i === idx && m.skillGuard ? { ...m, skillGuard: { ...m.skillGuard, status: 'cancelled' } } : m
                    )))
                  }
                : null,
              onConfirmSkill: msg.skillGuard && msg.skillGuard.status === 'pending'
                ? async () => {
                    if (busy) return
                    const prevUser = [...history.slice(0, idx)].reverse().find((m) => m && m.role === 'user')
                    setHistory((prev) => prev.map((m, i) => (
                      i === idx && m.skillGuard ? { ...m, skillGuard: { ...m.skillGuard, status: 'done' } } : m
                    )))
                    setBusy('adjust')
                    setAdjustError(null)
                    try {
                      const payload = await post('/adjust', {
                        type: 'collab',
                        confirmSkill: true,
                        skillName: msg.skillGuard.skill,
                        skillSteps: msg.skillGuard.steps,
                        instruction: prevUser?.text || '',
                        lang: activeLang,
                        model: selectedModel ? selectedModel.id : undefined,
                        provider: selectedModel ? selectedModel.provider : undefined,
                      })
                      if (alive.current) await finishAdjust(payload)
                    } catch (err) {
                      if (alive.current) {
                        setHistory((prev) => [...prev, { role: 'assistant', text: humanize(err instanceof Error ? err.message : String(err), t), error: true }])
                      }
                    } finally {
                      if (alive.current) setBusy(null)
                    }
                  }
                : null,
              onRetry: prevUser ? () => applyAdjust(prevUser.text, { retryIndex: idx }) : null,
            })
          }),
          busy === 'adjust'
            ? h(
                'div',
                { className: 'lw-msg lw-msg-ai' },
                h(
                  'div',
                  { className: 'lw-thinking-live', role: 'status', 'aria-live': 'polite' },
                  h(
                    'div',
                    { className: 'lw-thinking-head' },
                    h('span', { className: 'lw-dot is-busy' }),
                    h(
                      'span',
                      { className: 'lw-thinking-label' },
                      liveStage === 'building_preview'
                        ? t('busy.buildingPreview')
                        : liveStage === 'planning_table'
                          ? t('busy.planningTable')
                          : liveStage === 'writing'
                            ? t('busy.writing')
                            : t('busy.thinking'),
                    ),
                  ),
                  liveReasoning
                    ? h(
                        'div',
                        {
                          ref: liveThinkingRef,
                          className: 'lw-thinking-content',
                          style: (liveStage === 'building_preview' || liveReply)
                            ? { opacity: 0.52, maxHeight: 72, transition: 'opacity var(--dur-ui) var(--ease-out), max-height var(--dur-ui) var(--ease-out)' }
                            : undefined,
                        },
                        liveReasoning,
                      )
                    : null,
                  liveReply
                    ? h(
                        'div',
                        { className: 'lw-msg-text', style: { marginTop: 4 } },
                        renderMarkdownContent(liveReply),
                        h('span', { className: 'lw-stream-cursor', 'aria-hidden': true }),
                      )
                    : null,
                  liveStage === 'planning_table' || liveStage === 'building_preview'
                    ? h('div', { className: 'lw-stage-in', style: { marginTop: 4 } }, h(TableSkeleton))
                    : null,
                ),
              )
            : null,
        )

        const adjustBlock = h(
          'div',
          { className: 'lw-ws-dock' },
          preserveWorkspaceOnAuthDrop
            ? h(Banner, {
                tone: 'warn',
                children: t('account.reauthBanner'),
                action: h(
                  Button,
                  { size: 'sm', variant: 'primary', disabled: syncingAuth, onClick: handleGrantAll },
                  syncingAuth ? t('account.granting') : t('account.reauthCta'),
                ),
              })
            : null,
          confirmPlan
            ? h(
                'div',
                { className: 'lw-confirm-card', role: 'alertdialog', 'aria-label': t('view.confirmTitle') },
                h(
                  'div',
                  { className: 'lw-confirm-head' },
                  h(Icon, { name: 'alertCircle', size: 15, style: { color: 'var(--lw-danger)' } }),
                  t('view.confirmTitle'),
                ),
                h('div', { className: 'lw-meta' }, t('view.confirmBody')),
                h(
                  'ul',
                  { className: 'lw-confirm-list' },
                  confirmPlan.destructive.map((line, index) => h('li', { key: index }, line)),
                ),
                h(
                  'div',
                  { className: 'lw-actions', style: { justifyContent: 'flex-end' } },
                  h(Button, { size: 'sm', variant: 'ghost', disabled: Boolean(busy), onClick: () => setConfirmPlan(null) }, t('view.confirmNo')),
                  h(Button, { size: 'sm', variant: 'danger', disabled: Boolean(busy), onClick: confirmApply }, t('view.confirmYes')),
                ),
              )
            : h(
                'div',
                { className: 'lw-composer-wrap' },
                adjustError ? h(Banner, { tone: 'error', title: t('error.title'), children: humanize(adjustError, t) }) : null,
                queuedPrompt && queuedPrompt.target === 'adjust'
                  ? h(
                      'div',
                      { className: 'lw-queue-bar', role: 'status' },
                      h('span', { className: 'lw-dot is-busy' }),
                      h('span', { className: 'lw-queue-text' }, `${t('composer.queued')}${queuedPrompt.text}`),
                      h('button', { type: 'button', className: 'lw-queue-cancel', onClick: () => setQueuedPrompt(null) }, t('composer.cancelQueue')),
                    )
                  : null,
                h(UnifiedComposer, {
                  value: adjustText,
                  onChange: setAdjustText,
                  onSubmit: () => {
                    const hasReady = attachments.some((a) => a.status === 'ready')
                    if (adjustText.trim() || hasReady) applyAdjust()
                  },
                  onQueue: (val) => {
                    const clean = String(val || '').trim()
                    if (!clean) return
                    setQueuedPrompt({ target: 'adjust', text: clean })
                    setAdjustText('')
                  },
                  onStop: busy === 'adjust' ? stopActiveRequest : null,
                  placeholder: isTableMode ? t('view.tablePlaceholder') : t('view.collabPlaceholder'),
                  busy: busy === 'adjust',
                  disabled: !adjustText.trim() && !attachments.some((a) => a.status === 'ready'),
                  models,
                  selectedModel,
                  modelKey,
                  changeModel,
                  files: attachments,
                  onAddFiles: addFiles,
                  onRemoveFile: removeAttachment,
                  visionWarning,
                  minHeight: 44,
                  id: 'lw-adjust-input',
                  ariaLabel: isTableMode ? t('view.tablePlaceholder') : t('view.collabPlaceholder'),
                  inputRef: adjustInputRef,
                  t,
                }),
              ),
        )

        content = h(
          'div',
          { className: 'lw-workspace lw-stage-in' },
          h(
            'header',
            { className: 'lw-ws-header' },
            h(
              'div',
              { className: 'lw-ws-header-left' },
              h(
                'button',
                { type: 'button', className: 'lw-back', onClick: restart, title: t('view.back') },
                h(Icon, { name: 'arrowLeft', size: 14 }),
                h('span', { className: isNarrow ? 'lw-hide-compact' : undefined }, t('view.back')),
              ),
              h('div', { className: 'lw-ws-sep' }),
              h('span', { className: 'lw-ws-title', title: isTableMode ? active.name : t('view.collabTitle') }, isTableMode ? active.name : t('view.collabTitle')),
            ),
            isTableMode
              ? h(
                  'div',
                  { className: 'lw-ws-header-right' },
                  isCompact
                    ? h(
                        'div',
                        { className: 'lw-seg', role: 'tablist' },
                        h(
                          'button',
                          {
                            type: 'button',
                            role: 'tab',
                            'aria-selected': compactPane === 'chat',
                            className: `lw-seg-btn${compactPane === 'chat' ? ' is-active' : ''}`,
                            onClick: () => setCompactPane('chat'),
                          },
                          t('view.tabChat'),
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            role: 'tab',
                            'aria-selected': compactPane === 'table',
                            className: `lw-seg-btn${compactPane === 'table' ? ' is-active' : ''}`,
                            onClick: () => setCompactPane('table'),
                          },
                          t('view.tabTable'),
                        ),
                      )
                    : null,
                  h(
                    Button,
                    {
                      variant: 'ghost',
                      size: 'sm',
                      iconOnly: isCompact,
                      disabled: syncingTable,
                      title: syncedTick ? t('view.synced') : t('view.sync'),
                      'aria-label': t('view.sync'),
                      onClick: () => refreshLive(active, true),
                    },
                    h(Icon, {
                      name: syncedTick ? 'check' : 'refresh',
                      size: 13,
                      className: syncingTable ? 'lw-spin' : syncedTick ? 'lw-pop-in' : undefined,
                      style: syncedTick ? { color: 'var(--lw-ok)' } : undefined,
                    }),
                    !isCompact ? h('span', null, syncedTick ? t('view.synced') : t('view.sync')) : null,
                  ),
                  h(
                    Button,
                    {
                      variant: 'ghost',
                      size: 'sm',
                      iconOnly: true,
                      title: copiedView ? t('view.copied') : t('view.copy'),
                      'aria-label': t('view.copy'),
                      onClick: copyActiveUrl,
                    },
                    h(Icon, {
                      name: copiedView ? 'check' : 'copy',
                      size: 13,
                      className: copiedView ? 'lw-pop-in' : undefined,
                      style: copiedView ? { color: 'var(--lw-ok)' } : undefined,
                    }),
                  ),
                  !isCompact && active.url
                    ? h(
                        Button,
                        {
                          variant: 'ghost',
                          size: 'sm',
                          active: tableOpen,
                          title: tableOpen ? t('view.tableHide') : t('view.tableShow'),
                          'aria-pressed': tableOpen,
                          onClick: () => toggleTable(!tableOpen),
                        },
                        h(Icon, { name: 'splitPane', size: 13 }),
                        h('span', null, tableOpen ? t('view.tableHide') : t('view.tableShow')),
                      )
                    : null,
                  h(
                    Button,
                    {
                      variant: 'ghost',
                      size: 'sm',
                      iconOnly: true,
                      title: t('view.external'),
                      'aria-label': t('view.external'),
                      onClick: () => window.open(active.url, '_blank', 'noopener'),
                    },
                    h(Icon, { name: 'arrowUpRight', size: 13 }),
                  ),
                )
              : h(
                  'div',
                  { className: 'lw-ws-header-right' },
                  history.length > 0
                    ? h(
                        Button,
                        {
                          variant: 'ghost',
                          size: 'sm',
                          onClick: clearChat,
                          title: t('view.clearTip'),
                        },
                        h(Icon, { name: 'trash', size: 13 }),
                        h('span', null, t('view.clear')),
                      )
                    : null,
                  statusBadge,
                ),
          ),
          h(
            'div',
            { ref: layoutRef, className: 'lw-ws-layout' },
            h(
              'div',
              {
                className: `lw-ws-left ${showSplit ? 'is-split' : 'is-full'}${isEasingSplit ? ' is-easing' : ''}${!showChatPane ? ' is-hidden' : ''}`,
                style: showSplit ? { width: Math.min(splitWidth, Math.max(280, containerWidth - 300)) } : undefined,
              },
              chatFeed,
              adjustBlock,
            ),
            showSplit
              ? h('div', {
                  className: `lw-resizer${isResizing ? ' is-active' : ''}`,
                  role: 'separator',
                  'aria-orientation': 'vertical',
                  onPointerDown: startResize,
                  onDoubleClick: resetSplitWidth,
                  title: t('view.resizeTip'),
                })
              : null,
            isTableMode && active.url
              ? h(
                  'div',
                  {
                    className: `lw-ws-right${!showWebviewPane ? ' is-hidden' : ''}`,
                    style: { pointerEvents: isResizing ? 'none' : 'auto' },
                  },
                  h(NativeWebview, {
                    url: active.url,
                    visible: showWebviewPane,
                    reloadTick: webviewReloadTick,
                    t,
                    key: 'persistent-lark-webview',
                  }),
                )
              : null,
          ),
        )
      }

      const isWorkspace = (stage === 'view' && Boolean(active)) || (stage === 'preview' && Boolean(plan))

      return h(
        'div',
        {
          ref: rootRef,
          className: `lw${isWorkspace ? ' is-workspace' : ''}${isCompact ? ' is-compact' : ''}${isNarrow ? ' is-narrow' : ''}`,
          'data-theme': theme,
        },
        isWorkspace
          ? content
          : h(
              'div',
              { className: 'lw-col' },
              h(
                'header',
                { className: 'lw-head' },
                h(
                  'div',
                  { className: 'lw-head-main' },
                  h('span', { className: 'lw-mark' }, h(Mark, { size: 13 })),
                  h('span', { className: 'lw-name' }, t('app.name')),
                ),
                statusBadge,
              ),
              h('div', { className: 'lw-body' }, content),
            ),
        h(AccountModal, {
          open: showAccountModal,
          onClose: () => setShowAccountModal(false),
          health,
          connected,
          scopesInfo,
          scopesLoading,
          scopesError,
          onRetryScopes: () => refreshScopes(true),
          syncingAuth,
          busyAccount,
          onGrantAll: handleGrantAll,
          onLogout: handleLogout,
          onUnbind: handleUnbind,
          convTabProps: props.convTabProps,
          t,
        }),
        h(ToastStack, { toast, onDismiss: dismissToast, t }),
      )
    }

    return {
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs'],
      apply(ctx, config) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }))
        const t = ctx.locale.bind(NS)
        const realTable = hostBrowser(ctx)
        const CONV_TAB_KEY = 'dsh-lark-conv-tab'
        let configFormsSvc = null
        try {
          configFormsSvc = typeof ctx.get === 'function' ? ctx.get('configForms') : null
        } catch {}
        const configForm =
          configFormsSvc && typeof configFormsSvc.get === 'function'
            ? configFormsSvc.get('lark-workbench')
            : null
        const convTabListeners = new Set()

        const readLocalConvTab = () => {
          try {
            const raw = window.localStorage.getItem(CONV_TAB_KEY)
            if (raw === 'true') return true
            if (raw === 'false') return false
          } catch {}
          return null
        }

        const getConvTabEnabled = () => {
          const localVal = readLocalConvTab()
          if (localVal !== null) return localVal
          const ref = config && config.showInConversationTab
          const synced = ref && typeof ref.get === 'function' ? ref.get() : ref
          if (typeof synced === 'boolean') return synced
          const snap = configForm && typeof configForm.getSnapshot === 'function' ? configForm.getSnapshot() : null
          return Boolean(snap && snap.value && snap.value.showInConversationTab)
        }

        const notifyConvTab = () => {
          for (const fn of convTabListeners) {
            try { fn() } catch {}
          }
        }

        const subscribeConvTab = (listener) => {
          convTabListeners.add(listener)
          const unsubs = [() => convTabListeners.delete(listener)]
          if (config && config.showInConversationTab && typeof config.showInConversationTab.subscribe === 'function') {
            unsubs.push(config.showInConversationTab.subscribe(listener))
          }
          if (configForm && typeof configForm.subscribe === 'function') {
            unsubs.push(configForm.subscribe(listener))
          }
          return () => {
            for (const fn of unsubs) {
              if (typeof fn === 'function') fn()
            }
          }
        }

        const toggleConvTab = (next) => {
          const val = Boolean(next)
          try { window.localStorage.setItem(CONV_TAB_KEY, String(val)) } catch {}
          notifyConvTab()
          if (configForm && typeof configForm.set === 'function') {
            try { Promise.resolve(configForm.set('showInConversationTab', val)).catch(() => {}) } catch {}
          }
          return true
        }

        const convTabProps = {
          getEnabled: getConvTabEnabled,
          subscribe: subscribeConvTab,
          onToggle: toggleConvTab,
        }

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: 'lark-workbench', order: 20, label: () => t('app.name') }, PanelIcon),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            { name: 'main', key: 'lark-workbench', locale: NS },
            (props) => h(Workbench, { ...props, realTable, ctx, convTabProps, isStandalone: true }),
          ),
        )
        ctx.slots.inject('plugins.detail.section', () =>
          ctx.slots.register(
            { name: 'plugins.detail.section', id: 'dsh-lark-studio-settings', order: 10, locale: NS },
            (props) => h(PluginBundleConfig, { ...props, ...convTabProps }),
          ),
        )

        let disposeConvView = null
        const syncConvView = () => {
          const enabled = getConvTabEnabled()
          if (enabled && !disposeConvView) {
            disposeConvView = ctx.slots.inject('conversation.view', () =>
              ctx.slots.register(
                { name: 'conversation.view', id: 'lark-workbench', order: 5, label: () => t('app.name'), locale: NS },
                (props) => h(Workbench, { ...props, realTable, ctx, convTabProps, isConversationView: true }),
              ),
            )
          } else if (!enabled && disposeConvView) {
            const dispose = disposeConvView
            disposeConvView = null
            dispose()
          }
        }
        syncConvView()
        ctx.effect(() => subscribeConvTab(syncConvView))
        ctx.effect(() => () => {
          if (disposeConvView) {
            const dispose = disposeConvView
            disposeConvView = null
            dispose()
          }
        })

        if (ctx.sidebarRightTabs) {
          ctx.effect(() =>
            ctx.sidebarRightTabs.register({
              id: 'lark-workbench',
              kind: 'lark-workbench',
              title: () => t('app.name'),
            }),
          )
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register(
              { name: 'sidebar.right.pane.tab', key: 'lark-workbench', locale: NS },
              (props) => h(Workbench, { ...props, realTable, ctx, convTabProps, isRightSidebar: true }),
            ),
          )
          ctx.slots.inject('sidebar.right.pane.tab.title', () =>
            ctx.slots.register(
              { name: 'sidebar.right.pane.tab.title', key: 'lark-workbench', locale: NS },
              (props) => h('span', null, (props && typeof props.t === 'function' ? props.t : t)('app.name')),
            ),
          )
        }
      },
    }
  },
})
