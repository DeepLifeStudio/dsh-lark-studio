/**
 * Lark Workbench — Client half.
 *
 * Design notes: Paper & Ink
 * ─────────────────────────
 * A warm, low-chroma canvas carries the page; one white stage (the composer)
 * carries the action; everything else is type, space and hairlines.
 *
 * 1. One focus per screen. The composer owns the first screen; the six
 *    scenarios are a one-line chip row underneath, never a wall of cards.
 * 2. Type does the hierarchy — a 40px question, a 15px supporting line,
 *    12px metadata — so no borders are needed to separate sections.
 * 3. One light source: warm, low-contrast shadows and hairline rules. The
 *    only saturated colour is the Feishu blue mark, plus the status dot and
 *    the option pills in the table preview.
 * 4. Every state keeps the same composer: planning, errors and refinement
 *    happen in place instead of replacing the screen.
 * 5. Created tables stay reachable: Recent reopens a live view through the
 *    same CLI, and entries can be removed (with confirmation) without ever
 *    touching the table itself.
 * 6. A built table is a workspace, not a receipt. The success card hands off
 *    to the same table, whose one-line adjust composer keeps the "say one
 *    sentence" promise; deleting something always asks first.
 * 7. The real Base is the source of truth. The host's right-docked browser
 *    opens the native Feishu page (own login, no iframe), so this panel never
 *    re-implements a table: it shows the shape, samples on demand, and keeps
 *    the one-line composer. Without that browser it falls back to the system
 *    browser, and the read-only sample opens by default.
 */

window.__ModuleLoader__.load({
  id: 'dsh-lark-studio',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const API = 'api/dsh-lark'
    const NS = 'dsh-lark-studio'
    const RECENT_KEY = 'dsh-lark-recent'

    let currentDshSessionId = ''

    function resolveDshSessionId(props, ctx) {
      if (props && props.sessionId) return String(props.sessionId)
      if (props && props.session && props.session.id) return String(props.session.id)
      try {
        const fromMounted = ctx && ctx.sidebarRight && ctx.sidebarRight.mounted && typeof ctx.sidebarRight.mounted.getSnapshot === 'function'
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

      let res
      try {
        res = await fetch(targetUrl, { ...options, headers })
      } catch (err) {
        throw err
      }

      // If primary Connection route (api/dsh-lark) 404s on an older host, try legacy /dsh-lark/api fallback
      if (res.status === 404 && typeof targetUrl === 'string' && targetUrl.includes('api/dsh-lark')) {
        const fallbackUrl = targetUrl.replace(/(\/)?api\/dsh-lark/, '/dsh-lark/api')
        try {
          const fallbackHeaders = new Headers(options.headers || {})
          if (sid) fallbackHeaders.set('x-dsh-session-id', sid)
          const fallbackRes = await fetch(fallbackUrl, { ...options, headers: fallbackHeaders })
          if (fallbackRes.ok || fallbackRes.status !== 404) {
            return fallbackRes
          }
        } catch {}
      }

      return res
    }

    // ── Content ────────────────────────────────────────────────────────────

    const SCENARIOS = [
      {
        id: 'crm',
        type: 'base',
        icon: 'table',
        title: '客户和生意',
        desc: '谁在跟、谈到哪一步、别忘下次联系',
        prompt: '我想记客户往来：公司、联系人、现在谈到哪一步、下次什么时候联系',
      },
      {
        id: 'task',
        type: 'base',
        icon: 'check',
        title: '工作任务',
        desc: '谁负责、什么时候交、做完没有',
        prompt: '我想记工作任务：任务、负责人、做到哪一步了、截止时间',
      },
      {
        id: 'content',
        type: 'base',
        icon: 'calendar',
        title: '内容排期',
        desc: '写什么、发哪里、什么时候发',
        prompt: '我想排内容：选题、发在哪个平台、什么状态、什么时候发',
      },
      {
        id: 'collab-calendar',
        type: 'collab',
        icon: 'calendar',
        title: '今日日程',
        desc: '查今天会议安排与空闲时段',
        prompt: '查一下我今天的日程安排与会议',
      },
      {
        id: 'collab-todo',
        type: 'collab',
        icon: 'check',
        title: '我的待办',
        desc: '未完成待办任务与截止日期',
        prompt: '列出我所有未完成的待办事项',
      },
      {
        id: 'collab-chat',
        type: 'collab',
        icon: 'people',
        title: '搜索群聊',
        desc: '查找可见的项目群聊列表',
        prompt: '搜索我加入的飞书群聊',
      },
      {
        id: 'collab-mail',
        type: 'collab',
        icon: 'receipt',
        title: '邮件速览',
        desc: '查最近收到的重要邮件',
        prompt: '查一下我最近收到的重要邮件',
      },
      {
        id: 'expense',
        type: 'base',
        icon: 'receipt',
        title: '花钱报销',
        desc: '花在哪、多少钱、报了没有',
        prompt: '我想记报销：花在什么事上、金额、日期、报销到哪一步',
      },
    ]

    const ICONS = {
      people: [
        'M8.5 10a2.6 2.6 0 100-5.2 2.6 2.6 0 000 5.2Z',
        'M15.5 10.4a2.2 2.2 0 100-4.4 2.2 2.2 0 000 4.4Z',
        'M3.5 18.5c0-2.8 2.2-4.6 5-4.6s5 1.8 5 4.6',
        'M14.2 13.9c2.3.2 4.1 1.9 4.1 4.2',
      ],
      check: [
        'M4.5 6.5A2 2 0 016.5 4.5h11a2 2 0 012 2v11a2 2 0 01-2 2h-11a2 2 0 01-2-2Z',
        'M8.2 12.1l2.4 2.4 5-5',
      ],
      calendar: [
        'M4.5 7.5A2 2 0 016.5 5.5h11a2 2 0 012 2v9a2 2 0 01-2 2h-11a2 2 0 01-2-2Z',
        'M4.5 10.5h15',
        'M8.5 3.8v3.4',
        'M15.5 3.8v3.4',
      ],
      user: [
        'M12 11.6a3.1 3.1 0 100-6.2 3.1 3.1 0 000 6.2Z',
        'M5.6 19.6c0-3.4 2.9-5.5 6.4-5.5s6.4 2.1 6.4 5.5',
      ],
      receipt: [
        'M6.5 3.8h11v15.4l-2.2-1.4-2.2 1.4-2.2-1.4-2.2 1.4-2.2-1.4Z',
        'M9.5 8.2h5',
        'M9.5 11.8h5',
      ],
      book: [
        'M4.5 5.4c2.6-.9 5.2-.9 7.5.4 2.3-1.3 4.9-1.3 7.5-.4v12c-2.6-.9-5.2-.9-7.5.4-2.3-1.3-4.9-1.3-7.5-.4Z',
        'M12 5.8v12',
      ],
      lock: [
        'M7 10.5V8a5 5 0 0110 0v2.5',
        'M5.5 10.5h13a1.5 1.5 0 011.5 1.5v6.5a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18.5V12a1.5 1.5 0 011.5-1.5Z',
      ],
      refresh: [
        'M4 12a8 8 0 0114.9-4M20 4v5h-5',
        'M20 12a8 8 0 01-14.9 4M4 20v-5h5',
      ],
      arrowLeft: ['M19 12H5', 'M11 6l-6 6 6 6'],
      arrowUpRight: ['M7 17L17 7', 'M9 7h8v8'],
      chevron: ['M9 6l6 6-6 6'],
      tick: ['M4.8 12.4l4.6 4.6L19.2 7.2'],
      table: [
        'M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2Z',
        'M4 10h16',
        'M10 10v10',
      ],
      fieldText: ['M5 7.5h14', 'M5 12h10', 'M5 16.5h12.5'],
      fieldNumber: ['M9.6 4.4L8 19.6', 'M16 4.4l-1.6 15.2', 'M4.9 9.2h14.2', 'M4.3 14.8h14.2'],
      fieldSelect: ['M6.8 9.4l5.2 5.2 5.2-5.2'],
      fieldDate: [
        'M5.2 7.6a2 2 0 012-2h9.6a2 2 0 012 2v9.2a2 2 0 01-2 2H7.2a2 2 0 01-2-2Z',
        'M5.2 10.6h13.6',
        'M9 4.8v3.4',
        'M15 4.8v3.4',
      ],
      fieldUser: ['M12 11.6a3.1 3.1 0 100-6.2 3.1 3.1 0 000 6.2Z', 'M5.6 19.6c0-3.4 2.9-5.5 6.4-5.5s6.4 2.1 6.4 5.5'],
      fieldCheck: [
        'M5.6 6.3a1.8 1.8 0 011.8-1.8h9.2a1.8 1.8 0 011.8 1.8v11.4a1.8 1.8 0 01-1.8 1.8H7.4a1.8 1.8 0 01-1.8-1.8Z',
        'M8.7 12.1l2.3 2.3 4.5-4.5',
      ],
      sparkles: [
        'M12 3v3m0 12v3m9-9h-3M6 12H3m14.5-6.5l-2.1 2.1M8.6 15.4l-2.1 2.1m0-11l2.1 2.1m8.8 8.8l2.1 2.1',
      ],
      send: [
        'M22 2L11 13',
        'M22 2l-7 20-4-9-9-4 20-7z',
      ],
      robot: [
        'M12 2a2 2 0 012 2v2a2 2 0 01-2 2 2 2 0 01-2-2V4a2 2 0 012-2z',
        'M4 11a2 2 0 012-2h12a2 2 0 012 2v7a2 2 0 01-2 2H6a2 2 0 01-2-2v-7z',
        'M9 14h.01',
        'M15 14h.01',
      ],
      arrowUp: [
        'M12 19V5',
        'M5 12l7-7 7 7',
      ],
      chevronDown: [
        'M6 9l6 6 6-6',
      ],
      chart: [
        'M18 20V10',
        'M12 20V4',
        'M6 20v-6',
      ],
      form: [
        'M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2',
        'M9 2h6a1 1 0 011 1v2a1 1 0 01-1 1H9a1 1 0 01-1-1V3a1 1 0 011-1z',
        'M9 12h6',
        'M9 16h6',
      ],
      dashboard: [
        'M3 3h8v9H3z',
        'M13 3h8v5h-8z',
        'M13 12h8v9h-8z',
        'M3 16h8v5H3z',
      ],
      layout: [
        'M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2Z',
        'M4 9h16',
        'M9 9v11',
      ],
      shieldCheck: [
        'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
        'M9 12l2 2 4-4',
      ],
      zap: [
        'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
      ],
      helpCircle: [
        'M12 22a10 10 0 100-20 10 10 0 000 20z',
        'M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3',
        'M12 17h.01',
      ],
      larkAi: {
        filled: true,
        paths: [
          'M11 3c0 4.4-3.6 8-8 8 4.4 0 8 3.6 8 8 0-4.4 3.6-8 8-8-4.4 0-8-3.6-8-8Z',
          'M19 2.5c0 1.8-1.2 3-3 3 1.8 0 3 1.2 3 3 0-1.8 1.2-3 3-3-1.8 0-3-1.2-3-3Z',
        ],
      },
    }

    function Icon({ name, size = 16, strokeWidth = 1.65, className, style }) {
      const def = ICONS[name] ?? ICONS.check
      const isCustomFill = Boolean(def && !Array.isArray(def) && def.filled)
      const paths = Array.isArray(def) ? def : (def.paths || [])
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: isCustomFill ? 'currentColor' : 'none',
          stroke: isCustomFill ? 'none' : 'currentColor',
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

    const ZH = {
      'app.name': '飞书工作台',
      'status.checking': '检查中…',
      'status.ready': '已连接飞书',
      'status.noTool': '未装连接工具',
      'status.offline': '服务未连接',
      'status.recheck': '重新检查',
      'status.setup': '待完成连接',
      'pick.title': '一句话，协同飞书与智能建表',
      'pick.subtitle': '或者，从一个场景开始',
      'pick.trust': '直连你的飞书账号，安全隐私仅自己可见',
      'pick.own': '描述你的业务建表需求或飞书指令',
      'pick.placeholder': '比如：我想记客户往来、查今天日程、查看待办任务、搜索项目群聊…',
      'pick.submit': '发送执行',
      'pick.shortcut': '⌘↵',
      'recent.title': '最近创建',
      'recent.delete': '删除',
      'recent.confirmTitle': '移除「%s」？',
      'recent.confirmBody': '只从「最近创建」里移除，飞书里的表不受影响。',
      'recent.cancel': '取消',
      'recent.remove': '移除',
      'view.eyebrow': '已创建的表',
      'view.noToken': '没从这个链接里认出表格，回飞书里打开吧。',
      'view.back': '返回',
      'view.error': '读不到这张表',
      'view.empty': '这张表还没有数据',
      'view.more': '还有更多数据，在飞书里查看完整表格',
      'view.rows': '条记录',
      'view.adjustTitle': '继续调整',
      'view.adjustPlaceholder': '想改什么？一句话就行，例如：再加一列「负责人」',
      'view.adjustEmpty': '这张表还没有数据。说一句「加一条记录：…」就能开始',
      'view.adjustBtn': '应用修改',
      'view.adjustBusy': '正在改…',
      'view.adjustDone': '改好了',
      'view.suggestLead': '试试',
      'view.suggestField': '加一列',
      'view.suggestOptions': '改选项',
      'view.suggestView': '做看板',
      'view.suggestRecord': '加条记录',
      'view.confirmTitle': '确认删除？',
      'view.confirmBody': '这些改动没法撤销，删掉的列、记录或选项恢复不了。',
      'view.confirmYes': '确认删除',
      'view.confirmNo': '先不删',
      'view.openReal': '在右侧打开真表',
      'view.openExternal': '在系统浏览器打开',
      'view.opening': '正在打开…',
      'view.noSession': '右侧栏挂在对话上：点左侧任意会话回到对话，再点一次这个按钮。',
      'view.openFailed': '右侧浏览器没能打开这张表',
      'view.reopenReal': '再打开一次',
      'view.realTitle': '真实表格已在右侧打开',
      'view.realBody': '右侧是飞书原生多维表格，可以直接编辑；也可以在下面说一句，改完立刻映射到真表。',
      'view.realExternal': '已在系统浏览器打开',
      'view.realBodyExternal': '系统浏览器里是真实的飞书表格；回到这里仍然可以用一句话改结构。',
      'view.realIdle': '分屏多维表格未开启',
      'view.realIdleBody': '点击右上角「分屏内嵌真表 ◫」即可开启：左侧为你正在操作的工作台与AI对话，右侧实时分屏内嵌飞书多维表格（首次需扫码登录）。',
      'view.noHost': '当前宿主没有内置浏览器',
      'view.noHostBody': '真表会用系统浏览器打开；回到这里仍然可以一句话调整结构。',
      'view.structure': '字段结构',
      'view.samplesShow': '看样本数据',
      'view.samplesHide': '收起样本',
      'view.samplesNote': '只读样本，完整数据看右侧真表',
      'view.adjustHint': '一句话说清楚要改什么，改完直接落在真表上',
      'busy.planning': '正在构思表结构…',
      'busy.planningSub': '正在匹配列与示例数据，通常需要几秒钟',
      'busy.building': '正在建表…',
      'preview.title': '结构预览',
      'preview.empty': '建好后从这里开始填写',
      'preview.cols': '列',
      'preview.rows': '条示例',
      'preview.kanban': '看板视图',
      'preview.detailsShow': '查看全部字段与选项说明',
      'preview.detailsHide': '收起字段说明',
      'preview.tweakPlaceholder': '想微调？比如：再加一列「来源」，或去掉「预计金额」',
      'preview.tweakBtn': '调整',
      'preview.build': '确认并建表',
      'preview.back': '返回重选',
      'done.title': '已建好',
      'done.open': '在飞书中打开',
      'done.copy': '复制链接',
      'done.copied': '已复制',
      'done.again': '再建一张表',
      'done.continue': '继续调整',
      'done.next': '接下来怎么用',
      'done.step1': '打开表后直接把顶部的示例行改成你的第一条数据，不用先删。',
      'done.step2': '点任意单元格即可输入，内容会自动保存。',
      'done.step3': '表头最右边的「+」可加列，点列标题可修改选项。',
      'done.step4': '需要协作时，点右上角「分享」邀请同事即可。',
      'done.adjustHint': '建好之后想改，不用重建：点「继续调整」，一句话就能加列、改选项、做看板。',
      'done.realOpened': '真表已在右侧打开，可以直接编辑；也能在这里继续用一句话改。',
      'done.warnings': '有几处未完全建成',
      'error.title': '没成功',
      'error.retry': '再试一次',
      'gate.step.tool': '安装工具',
      'gate.step.app': '关联应用',
      'gate.step.auth': '授权',
      'gate.noTool.title': '先安装连接工具',
      'gate.noTool.body': '复制下面这行命令，粘贴到终端里按回车执行。',
      'gate.noTool.copy': '复制',
      'gate.noTool.copied': '已复制',
      'gate.noTool.done': '我装好了',
      'gate.noTool.hint': '装完如果仍提示未找到，重启应用再试。',
      'gate.noApp.title': '让工具认识你的飞书',
      'gate.noApp.body': '点击下方按钮打开飞书页面，填个名字并确认默认权限即可（约 1 分钟）。',
      'gate.noApp.cta': '打开飞书页面',
      'gate.noApp.done': '我建好了',
      'gate.noApp.reopen': '重新打开',
      'gate.team.toggle': '打不开或无权限？使用同事的应用',
      'gate.team.hide': '收起',
      'gate.team.body': '把同事发来的这两项粘贴进来即可。',
      'gate.team.appId': 'App ID（cli_ 开头）',
      'gate.team.secret': 'App Secret',
      'gate.team.save': '使用此应用',
      'gate.noAuth.title': '最后一步：授权一次',
      'gate.noAuth.body': '飞书仅请求多维表格相关权限，不会读取聊天记录或替你发消息。',
      'gate.noAuth.cta': '去授权',
      'gate.noAuth.done': '我授权好了',
      'gate.noAuth.reopen': '重新打开',
      'gate.noAuth.hint': '只需授权一次，过期时这里会提醒。',
      'gate.waiting': '正在确认，已等待 ',
      'gate.autoChecking': '已唤起浏览器，正在自动检测就绪状态（也可随时点击手动确认）',
      'gate.pending': '飞书尚未返回确认，请确保浏览器中显示「授权成功」后再点一次。',
      'gate.idle': '正在检查连接…',
      'gate.retryBody': '连不上本地服务，可能是应用刚重启，点下方重新检查。',
    }

    const EN = {
      'app.name': 'Lark Workbench',
      'status.checking': 'Checking…',
      'status.ready': 'Connected',
      'status.noTool': 'CLI missing',
      'status.offline': 'Offline',
      'status.recheck': 'Check again',
      'status.setup': 'Not connected',
      'pick.title': 'One sentence, full Feishu orchestration',
      'pick.subtitle': 'Or start from a scenario',
      'pick.trust': 'Connected to your private Feishu space',
      'pick.own': 'Describe your table or Lark instruction',
      'pick.placeholder': 'e.g. client tracking base, today agenda, pending tasks, search group chats…',
      'pick.submit': 'Send & Run',
      'pick.shortcut': '⌘↵',
      'recent.title': 'Recent',
      'recent.delete': 'Delete',
      'recent.confirmTitle': 'Remove “%s”?',
      'recent.confirmBody': 'Only removes it from Recent. The Feishu Base is not touched.',
      'recent.cancel': 'Cancel',
      'recent.remove': 'Remove',
      'view.eyebrow': 'Saved table',
      'view.noToken': 'Could not find a table id in this link. Open it in Feishu instead.',
      'view.back': 'Back',
      'view.error': 'Could not load this table',
      'view.empty': 'No rows yet',
      'view.more': 'More rows live in Feishu',
      'view.rows': 'rows',
      'view.adjustTitle': 'Make a change',
      'view.adjustPlaceholder': 'What should change? One sentence, e.g. add an "Owner" column',
      'view.adjustEmpty': 'No rows yet. Try “add a record: …”',
      'view.adjustBtn': 'Apply',
      'view.adjustBusy': 'Editing…',
      'view.adjustDone': 'Done',
      'view.suggestLead': 'Try',
      'view.suggestField': 'Add column',
      'view.suggestOptions': 'Edit options',
      'view.suggestView': 'Kanban',
      'view.suggestRecord': 'Add row',
      'view.confirmTitle': 'Delete this?',
      'view.confirmBody': 'These changes cannot be undone.',
      'view.confirmYes': 'Delete',
      'view.confirmNo': 'Keep',
      'view.openReal': 'Open the real table',
      'view.openExternal': 'Open in system browser',
      'view.opening': 'Opening…',
      'view.noSession': 'The right column lives beside a conversation: open a session on the left, then press the button again.',
      'view.openFailed': 'The docked browser could not open this table',
      'view.reopenReal': 'Open again',
      'view.realTitle': 'The real table is open on the right',
      'view.realBody': 'That is the native Feishu Base — edit it directly, or say one sentence below and the change lands there.',
      'view.realExternal': 'Opened in your system browser',
      'view.realBodyExternal': 'The real Feishu Base is there; you can still reshape it from here in one sentence.',
      'view.realIdle': 'The real table is not open yet',
      'view.realIdleBody': 'Press “Open the real table”: the native Base docks on the right (one Feishu sign-in the first time). The “Lark Workbench” tab in the conversation header is where the two sit side by side.',
      'view.noHost': 'This host has no built-in browser',
      'view.noHostBody': 'The table opens in your system browser; you can still reshape it from here.',
      'view.structure': 'Columns',
      'view.samplesShow': 'Show sample rows',
      'view.samplesHide': 'Hide sample rows',
      'view.samplesNote': 'Read-only sample — the full data lives in the real table',
      'view.adjustHint': 'Say what should change — it lands in the real table',
      'busy.planning': 'Designing the table…',
      'busy.planningSub': 'Generating columns and sample rows, usually takes a few seconds',
      'busy.building': 'Creating Base…',
      'preview.title': 'Table preview',
      'preview.empty': 'Start filling here',
      'preview.cols': 'columns',
      'preview.rows': 'samples',
      'preview.kanban': 'Kanban view',
      'preview.detailsShow': 'Show column details & options',
      'preview.detailsHide': 'Hide column details',
      'preview.tweakPlaceholder': 'Need a tweak? e.g. add a "Source" column or remove "Amount"',
      'preview.tweakBtn': 'Refine',
      'preview.build': 'Create Base',
      'preview.back': 'Back',
      'done.title': 'Created',
      'done.open': 'Open in Feishu',
      'done.copy': 'Copy link',
      'done.copied': 'Copied',
      'done.again': 'Create another',
      'done.continue': 'Keep editing',
      'done.next': 'Quick guide',
      'done.step1': 'Overwrite the top sample rows directly with your first real entry.',
      'done.step2': 'Click any cell to type; every edit saves automatically.',
      'done.step3': 'Use "+" at the right edge of the header to add columns, or click a header to edit options.',
      'done.step4': 'Click Share in the top right whenever you want to invite teammates.',
      'done.adjustHint': 'To change it later, click “Keep editing” — one sentence adds a column, changes options or makes a kanban.',
      'done.realOpened': 'The real table is open on the right — edit it there, or keep reshaping it here in one sentence.',
      'done.warnings': 'Some parts had warnings',
      'error.title': 'Did not work',
      'error.retry': 'Try again',
      'gate.step.tool': 'Install CLI',
      'gate.step.app': 'Connect App',
      'gate.step.auth': 'Authorize',
      'gate.noTool.title': 'Install the bridge tool first',
      'gate.noTool.body': 'Copy the command below into your terminal and press Enter.',
      'gate.noTool.copy': 'Copy',
      'gate.noTool.copied': 'Copied',
      'gate.noTool.done': 'I installed it',
      'gate.noTool.hint': 'If it still says missing, restart the app and try again.',
      'gate.noApp.title': 'Connect to your Feishu',
      'gate.noApp.body': 'Open Feishu, name your app, and accept the default permissions (~1 min).',
      'gate.noApp.cta': 'Open Feishu',
      'gate.noApp.done': 'I created it',
      'gate.noApp.reopen': 'Open again',
      'gate.team.toggle': 'No permission? Use a teammate’s app',
      'gate.team.hide': 'Hide',
      'gate.team.body': 'Paste the App ID and App Secret from your teammate.',
      'gate.team.appId': 'App ID (starts with cli_)',
      'gate.team.secret': 'App Secret',
      'gate.team.save': 'Use this app',
      'gate.noAuth.title': 'One-time authorization',
      'gate.noAuth.body': 'Feishu will only ask for table permissions — never chat access.',
      'gate.noAuth.cta': 'Authorize',
      'gate.noAuth.done': 'I authorized',
      'gate.noAuth.reopen': 'Open again',
      'gate.noAuth.hint': 'Only needed once until the token expires.',
      'gate.waiting': 'Confirming… waited ',
      'gate.autoChecking': 'Browser opened. Auto-detecting status (you can also click manually)',
      'gate.pending': 'No confirmation yet. Make sure the browser says authorized, then click again.',
      'gate.idle': 'Checking connection…',
      'gate.retryBody': 'Local service did not respond — it may have just restarted.',
    }

    const KIND_HINT = {
      text: '文本',
      number: '数字',
      select: '单选',
      datetime: '日期',
      user: '人员',
      checkbox: '勾选',
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

    // ── Design system ──────────────────────────────────────────────────────
    // Warm paper, ink type, one cobalt accent. Depth comes from tone and a
    // single light source, never from nested borders. Display type carries the
    // hierarchy; chrome, metadata and shortcuts stay deliberately quiet.

    const CSS = `
.lw{
  --lw-bg:#F6F4EF;
  --lw-bg-top:#FAF8F4;
  --lw-surface:#FFFFFF;
  --lw-surface-2:#FAF8F3;
  --lw-ink:#191713;
  --lw-ink-2:#5B554A;
  --lw-ink-3:#7C7568;
  --lw-line:rgba(25,23,19,.08);
  --lw-line-2:rgba(25,23,19,.15);
  --lw-accent:#3370FF;
  --lw-accent-2:#245BDB;
  --lw-accent-soft:rgba(51,112,255,.08);
  --lw-solid:#1A1813;
  --lw-solid-hover:#2E2A22;
  --lw-solid-ink:#FBFAF7;
  --lw-ok:#12795A;
  --lw-warn:#9A5A0B;
  --lw-danger:#AF2318;
  --lw-e1:0 1px 2px rgba(24,20,14,.05);
  --lw-e2:0 1px 2px rgba(24,20,14,.04), 0 12px 28px -18px rgba(24,20,14,.22);
  --lw-e3:0 1px 2px rgba(24,20,14,.04), 0 8px 16px -12px rgba(24,20,14,.12), 0 28px 56px -32px rgba(24,20,14,.26);
  --r-sm:8px; --r-md:12px; --r-lg:16px; --r-xl:20px;
  --ease:cubic-bezier(.22,1,.36,1); --fast:180ms;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;

  height:100%; overflow:auto; display:flex; justify-content:center;
  padding:44px 44px 88px; box-sizing:border-box;
  background:
    radial-gradient(1100px 480px at 8% -18%, rgba(255,255,255,.75), transparent 66%),
    linear-gradient(180deg,var(--lw-bg-top) 0%, var(--lw-bg) 380px);
  color:var(--lw-ink);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","Microsoft YaHei",sans-serif;
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
}
.lw[data-theme="dark"]{
  --lw-bg:#0B0A08;
  --lw-bg-top:#121009;
  --lw-surface:#1B1814;
  --lw-surface-2:#24201A;
  --lw-ink:#F4F1EA;
  --lw-ink-2:#ABA398;
  --lw-ink-3:#948C80;
  --lw-line:rgba(255,255,255,.09);
  --lw-line-2:rgba(255,255,255,.16);
  --lw-accent:#93AAFF;
  --lw-accent-2:#6E8CFF;
  --lw-accent-soft:rgba(140,166,255,.12);
  --lw-solid:#F4F1EA;
  --lw-solid-hover:#FFFFFF;
  --lw-solid-ink:#191713;
  --lw-ok:#57D6A3;
  --lw-warn:#F0B565;
  --lw-danger:#FF9384;
  --lw-e1:0 1px 2px rgba(0,0,0,.45);
  --lw-e2:0 1px 2px rgba(0,0,0,.45), 0 14px 30px -18px rgba(0,0,0,.72);
  --lw-e3:0 1px 2px rgba(0,0,0,.5), 0 10px 22px -14px rgba(0,0,0,.6), 0 32px 64px -36px rgba(0,0,0,.85);
  background:linear-gradient(180deg,var(--lw-bg-top) 0%, var(--lw-bg) 380px);
}
.lw *{box-sizing:border-box}
.lw ::selection{background:color-mix(in srgb,var(--lw-accent) 18%,transparent)}
.lw-col{width:100%;max-width:800px;min-width:0;min-height:100%;display:flex;flex-direction:column;gap:26px}
.lw-body{display:flex;flex-direction:column;gap:26px;width:100%;min-width:0;margin:auto 0;padding-bottom:14vh}

/* ── Chrome ───────────────────────────────────────────────────────────── */
.lw-head{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.lw-head-main{display:flex;align-items:center;gap:10px;min-width:0}
.lw-mark{
  width:26px;height:26px;border-radius:8px;flex:none;
  background:linear-gradient(155deg,#3E68F5 0%,#2244CE 100%);
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 1px 2px rgba(30,52,150,.3), inset 0 1px 0 rgba(255,255,255,.28);
}
.lw-head-copy{display:flex;flex-direction:column;gap:1px;min-width:0}
.lw-name{font-size:13.5px;font-weight:600;letter-spacing:-.008em;color:var(--lw-ink);line-height:1.3}

.lw-topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:28px}
.lw-back{
  font:inherit;font-size:12.5px;font-weight:540;color:var(--lw-ink-2);
  background:transparent;border:0;padding:5px 9px 5px 6px;margin-left:-6px;border-radius:8px;
  display:inline-flex;align-items:center;gap:6px;cursor:pointer;
  transition:background var(--fast) var(--ease),color var(--fast) var(--ease);
}
.lw-back:hover:not(:disabled){background:color-mix(in srgb,var(--lw-ink) 5%,transparent);color:var(--lw-ink)}
.lw-back:disabled{opacity:.45;cursor:default}

.lw-status{
  display:inline-flex;align-items:center;gap:7px;flex:none;
  font-size:11.5px;font-weight:500;line-height:1;color:color-mix(in srgb,var(--lw-ink) 58%,transparent);
  font-variant-numeric:tabular-nums;
  cursor:pointer;
  padding:4px 9px;
  border-radius:14px;
  border:1px solid transparent;
  background:transparent;
  transition:all .15s ease;
}
.lw-status:hover{
  background:var(--lw-surface-2);
  border-color:var(--lw-line);
  color:var(--lw-ink);
}
.lw-modal-overlay{
  position:fixed;
  top:0;left:0;right:0;bottom:0;
  background:rgba(0,0,0,.45);
  display:flex;
  align-items:center;
  justify-content:center;
  z-index:99999;
  backdrop-filter:blur(4px);
  animation:lwFadeIn .15s ease-out;
}
.lw-modal-box{
  background:var(--lw-surface);
  border:1px solid var(--lw-line);
  border-radius:18px;
  width:92%;
  max-width:440px;
  padding:22px 24px;
  box-shadow:0 14px 36px rgba(0,0,0,.18);
  display:flex;
  flex-direction:column;
  gap:16px;
  animation:lwFadeIn .2s ease-out;
}
.lw-modal-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
}
.lw-modal-title{
  font-size:15px;
  font-weight:600;
  color:var(--lw-ink);
  display:flex;
  align-items:center;
  gap:8px;
}
.lw-modal-close{
  background:none;
  border:none;
  color:var(--lw-ink-3);
  font-size:16px;
  cursor:pointer;
  padding:4px 8px;
  border-radius:6px;
  transition:all .15s ease;
}
.lw-modal-close:hover{
  background:var(--lw-surface-2);
  color:var(--lw-ink);
}
.lw-account-card{
  background:var(--lw-surface-2);
  border:1px solid var(--lw-line-2);
  border-radius:12px;
  padding:12px 14px;
  display:flex;
  flex-direction:column;
  gap:8px;
}
.lw-account-row{
  display:flex;
  align-items:center;
  justify-content:space-between;
  font-size:12.5px;
}
.lw-account-label{
  color:var(--lw-ink-3);
}
.lw-account-val{
  color:var(--lw-ink);
  font-weight:500;
}
.lw-account-actions{
  display:flex;
  flex-direction:column;
  gap:10px;
}
.lw-account-action-card{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  padding:12px 14px;
  border:1px solid var(--lw-line);
  border-radius:12px;
  background:var(--lw-surface);
}
.lw-account-action-text{
  display:flex;
  flex-direction:column;
  gap:2px;
  min-width:0;
}
.lw-account-action-name{
  font-size:13px;
  font-weight:600;
  color:var(--lw-ink);
}
.lw-account-action-desc{
  font-size:11.5px;
  color:var(--lw-ink-3);
  line-height:1.4;
}
.lw-dot{width:5px;height:5px;border-radius:50%;background:var(--lw-ink-3);flex:none}
.lw-dot.is-ok{background:var(--lw-ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--lw-ok) 13%,transparent)}
.lw-dot.is-bad{background:var(--lw-danger)}
.lw-dot.is-busy{background:var(--lw-accent);animation:lw-pulse 1.4s var(--ease) infinite}
@keyframes lw-pulse{0%,100%{opacity:.25}50%{opacity:1}}
@keyframes lw-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
.lw-spin{animation:lw-spin .8s linear infinite}

/* ── Hero ─────────────────────────────────────────────────────────────── */
.lw-hero{display:flex;flex-direction:column;gap:14px;padding:32px 0 8px}
.lw-hero-title{
  margin:0;font-size:clamp(31px,3.4vw,44px);font-weight:600;line-height:1.2;
  letter-spacing:-.028em;color:var(--lw-ink);text-wrap:balance;
}

/* ── Typography & surfaces ────────────────────────────────────────────── */
.lw-pick{display:flex;flex-direction:column;gap:20px}
.lw-own{display:flex;flex-direction:column;gap:12px}
.lw-sect{display:flex;flex-direction:column;gap:5px}
.lw-h{font-size:15px;font-weight:600;line-height:1.4;letter-spacing:-.012em;color:var(--lw-ink);margin:0}
.lw-h-lg{font-size:21px;letter-spacing:-.02em;line-height:1.35}
.lw-p{font-size:13px;line-height:1.7;color:var(--lw-ink-2);margin:0}
.lw-meta{font-size:11.5px;line-height:1.6;color:var(--lw-ink-3);margin:0}
.lw-card{
  background:var(--lw-surface);border:1px solid var(--lw-line);border-radius:var(--r-xl);
  padding:26px 30px 28px;display:flex;flex-direction:column;gap:20px;box-shadow:var(--lw-e2);
}

/* ── Controls ─────────────────────────────────────────────────────────── */
.lw-btn{
  font:inherit;font-size:12.5px;font-weight:560;line-height:1;height:36px;padding:0 16px;
  border-radius:10px;border:1px solid var(--lw-line-2);background:var(--lw-surface);
  color:var(--lw-ink);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;
  gap:6px;white-space:nowrap;flex:none;box-shadow:var(--lw-e1);
  transition:background var(--fast) var(--ease),border-color var(--fast) var(--ease),
    box-shadow var(--fast) var(--ease),transform 120ms var(--ease),color var(--fast) var(--ease);
}
.lw-btn:hover:not(:disabled){
  background:var(--lw-surface-2);border-color:color-mix(in srgb,var(--lw-ink) 22%,transparent);
}
.lw-btn:active:not(:disabled){transform:translateY(1px)}
.lw-btn:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--lw-accent) 22%,transparent)}
.lw-btn.is-primary{
  background:var(--lw-solid);border-color:var(--lw-solid);color:var(--lw-solid-ink);
  box-shadow:0 1px 2px rgba(24,20,14,.22), 0 8px 20px -12px rgba(24,20,14,.5);
}
.lw-btn.is-primary:hover:not(:disabled){
  background:var(--lw-solid-hover);border-color:var(--lw-solid-hover);
  box-shadow:0 1px 2px rgba(24,20,14,.24), 0 10px 24px -12px rgba(24,20,14,.55);
}
.lw-btn:disabled{box-shadow:none;cursor:default}
.lw-btn.is-primary:disabled{
  background:color-mix(in srgb,var(--lw-ink) 7%,var(--lw-surface));
  color:color-mix(in srgb,var(--lw-ink) 42%,transparent);border:1px solid transparent;box-shadow:none;
}
.lw-btn:not(.is-primary):disabled{opacity:.55}
.lw-btn.is-ghost{background:transparent;border-color:transparent;box-shadow:none;color:var(--lw-ink-2);padding:0 10px;height:34px}
.lw-btn.is-ghost:hover:not(:disabled){background:color-mix(in srgb,var(--lw-ink) 5%,transparent);color:var(--lw-ink);border-color:transparent}
.lw-btn.is-link{background:none;border:0;box-shadow:none;height:auto;padding:0;font-size:12px;font-weight:540;
  color:var(--lw-ink-2);text-decoration:none}
.lw-btn.is-link:hover:not(:disabled){color:var(--lw-accent);background:none}
.lw-btn.is-sm{height:32px;padding:0 13px;font-size:12px;border-radius:9px}
.lw-btn.is-danger{
  background:color-mix(in srgb,var(--lw-danger) 9%,var(--lw-surface));
  border-color:color-mix(in srgb,var(--lw-danger) 28%,transparent);
  color:var(--lw-danger);box-shadow:none;
}
.lw-btn.is-danger:hover:not(:disabled){
  background:color-mix(in srgb,var(--lw-danger) 14%,var(--lw-surface));
  border-color:color-mix(in srgb,var(--lw-danger) 40%,transparent);
}
.lw-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}

.lw-input{
  font:inherit;font-size:13px;line-height:1.5;width:100%;padding:10px 13px;
  border-radius:10px;border:1px solid var(--lw-line-2);background:var(--lw-surface);
  color:var(--lw-ink);outline:none;box-shadow:var(--lw-e1);
  transition:border-color var(--fast) var(--ease),box-shadow var(--fast) var(--ease);
}
.lw-input::placeholder{color:var(--lw-ink-3)}
.lw-input:focus{border-color:color-mix(in srgb,var(--lw-accent) 45%,transparent);
  box-shadow:0 0 0 3px var(--lw-accent-soft),var(--lw-e1)}
.lw-field{display:flex;flex-direction:column;gap:10px}

/* ── Composer (the one focal surface) ─────────────────────────────────── */
.lw-composer{
  background:var(--lw-surface);border:1px solid var(--lw-line-2);border-radius:20px;
  box-shadow:var(--lw-e3);overflow:hidden;
  transition:border-color var(--fast) var(--ease),box-shadow 260ms var(--ease);
}
.lw-composer:focus-within{
  border-color:color-mix(in srgb,var(--lw-ink) 35%,transparent);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--lw-ink) 6%,transparent),var(--lw-e3);
}
.lw-composer-area{
  font:inherit;font-size:14.5px;line-height:1.6;color:var(--lw-ink);
  width:100%;min-height:56px;padding:14px 18px 4px;border:0;background:transparent;
  outline:none;resize:none;display:block;box-sizing:border-box;
}
.lw-composer-area::placeholder{color:color-mix(in srgb,var(--lw-ink) 38%,transparent)}
.lw-composer-bar{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:8px 12px 10px 18px;border-top:1px solid var(--lw-line);
}
.lw-trust{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--lw-ink-3)}
.lw-composer-right{display:flex;align-items:center;gap:10px;margin-left:auto}
.lw-kbd{
  font-family:var(--mono);font-size:10px;color:var(--lw-ink-3);letter-spacing:.06em;
  padding:3px 5px;border:1px solid var(--lw-line);border-radius:5px;background:var(--lw-surface-2);
}

/* ── Inline command block ─────────────────────────────────────────────── */
.lw-cmd{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:10px 10px 10px 14px;border-radius:var(--r-md);
  background:var(--lw-surface-2);border:1px solid var(--lw-line);
}
.lw-cmd code{
  font-family:var(--mono);font-size:12px;
  color:var(--lw-ink);user-select:all;overflow-x:auto;white-space:nowrap;
}

/* ── Stepper ──────────────────────────────────────────────────────────── */
.lw-steps{display:flex;align-items:center;flex-wrap:wrap;row-gap:8px}
.lw-step{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--lw-ink-3)}
.lw-step-num{
  width:20px;height:20px;border-radius:50%;border:1px solid var(--lw-line-2);
  display:flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:700;flex:none;
  background:transparent;color:var(--lw-ink-3);
}
.lw-step.is-done .lw-step-num{background:var(--lw-ok);border-color:transparent;color:#fff}
.lw-step.is-done{color:var(--lw-ink-2)}
.lw-step.is-current .lw-step-num{border-color:var(--lw-accent);color:var(--lw-accent);background:var(--lw-accent-soft)}
.lw-step.is-current{color:var(--lw-ink);font-weight:600}
.lw-step-bar{width:22px;height:1px;background:var(--lw-line-2);margin:0 9px;flex:none}

/* ── Preview ──────────────────────────────────────────────────────────── */
.lw-preview-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;flex-wrap:wrap}
.lw-preview-title{font-size:24px;font-weight:600;letter-spacing:-.026em;color:var(--lw-ink);margin:0;line-height:1.3}
.lw-preview-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--lw-ink-3);margin-top:7px;font-variant-numeric:tabular-nums}
.lw-preview-sep{opacity:.45}
.lw-preview-scroll{flex:1 1 auto;overflow-y:auto;padding:24px 20px;min-height:0;width:100%;background:var(--lw-bg);display:flex;flex-direction:column;align-items:center}

/* ── Real table + console stage ───────────────────────────────────────── */
.lw.is-workspace{
  padding:0 !important;
  overflow:hidden !important;
  display:flex !important;
  flex-direction:column !important;
  justify-content:flex-start !important;
  width:100% !important;
  height:100% !important;
  background:var(--lw-bg);
}
.lw-workspace{
  display:flex;
  flex-direction:column;
  width:100%;
  height:100%;
  min-height:0;
  overflow:hidden;
}
.lw-ws-header{
  height:48px;
  flex:none;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:0 16px;
  border-bottom:1px solid var(--lw-line);
  background:var(--lw-surface);
  position:sticky;
  top:0;
  z-index:100;
}
.lw-ws-header-left{
  display:flex;
  align-items:center;
  gap:10px;
  min-width:0;
}
.lw-ws-sep{
  width:1px;
  height:14px;
  background:var(--lw-line-2);
  flex:none;
}
.lw-ws-title{
  font-size:14px;
  font-weight:600;
  color:var(--lw-ink);
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
  max-width:320px;
}
.lw-ws-header-right{
  display:flex;
  align-items:center;
  gap:6px;
  flex:none;
}
.lw-ws-layout{
  display:flex;
  flex:1 1 auto;
  width:100%;
  height:calc(100% - 48px);
  min-height:0;
  overflow:hidden;
}
.lw-ws-left{
  display:flex;
  flex-direction:column;
  height:100%;
  min-height:0;
  min-width:0;
  overflow:hidden;
  background:var(--lw-bg);
  transition:width .15s ease;
}
.lw-ws-left.is-split{
  flex:none;
}
.lw-resizer{
  width:10px;
  margin-left:-5px;
  margin-right:-5px;
  height:100%;
  cursor:col-resize;
  position:relative;
  z-index:25;
  flex:none;
  background:transparent;
  user-select:none;
}
.lw-resizer::after{
  content:'';
  position:absolute;
  top:0;
  bottom:0;
  left:4px;
  width:2px;
  background:var(--lw-line);
  transition:background .15s ease, width .15s ease, left .15s ease;
}
.lw-resizer:hover::after,
.lw-resizer.is-active::after{
  background:var(--lw-accent, #3370ff);
  width:3px;
  left:3px;
}
.lw-resize-overlay{
  position:fixed;
  top:0;
  left:0;
  right:0;
  bottom:0;
  z-index:99999;
  cursor:col-resize;
  user-select:none;
}
.lw-ws-left.is-full{
  flex:1 1 auto;
  width:100%;
}
.lw-ws-left.is-split .lw-chat-stream{
  max-width:100%;
  padding:16px 18px;
}
.lw-ws-right{
  display:flex;
  flex-direction:column;
  flex:1 1 auto;
  height:100%;
  min-height:0;
  min-width:0;
  overflow:hidden;
  background:#ffffff;
  position:relative;
}
.lw-ws-body{
  flex:1;
  min-height:0;
  position:relative;
  background:#ffffff;
  display:flex;
  width:100%;
}
.lw-ws-webview{
  width:100%;
  height:100%;
  border:none;
  display:block;
}
.lw-chat-stream{
  flex:1;
  min-height:0;
  overflow-y:auto;
  display:flex;
  flex-direction:column;
  gap:16px;
  padding:24px 20px;
  max-width:760px;
  width:100%;
  margin:0 auto;
}
.lw-ws-left.is-split .lw-chat-stream{
  max-width:100%;
  padding:18px 16px;
}
.lw-hero-card{
  background:var(--lw-surface);
  border:1px solid var(--lw-line);
  border-radius:16px;
  padding:18px 20px;
  box-shadow:0 4px 18px rgba(0,0,0,.03);
  display:flex;
  flex-direction:column;
  gap:12px;
  margin-bottom:8px;
  animation:lwFadeIn .2s ease-out;
}
.lw-hero-head{
  display:flex;
  align-items:center;
  gap:12px;
}
.lw-hero-avatar{
  width:36px;
  height:36px;
  border-radius:10px;
  background:var(--lw-solid);
  color:var(--lw-solid-ink);
  display:flex;
  align-items:center;
  justify-content:center;
  flex:none;
  box-shadow:0 2px 6px rgba(24,20,14,.18);
}
.lw-hero-title-wrap{
  display:flex;
  flex-direction:column;
  gap:2px;
  min-width:0;
  flex:1;
}
.lw-hero-title{
  font-size:14.5px;
  font-weight:600;
  color:var(--lw-ink);
  letter-spacing:-.01em;
  white-space:nowrap;
}
.lw-hero-subtitle{
  font-size:12px;
  color:var(--lw-ink-3);
  display:flex;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
  align-items:center;
  gap:6px;
}
.lw-hero-subtitle::before{
  content:'';
  width:6px;
  height:6px;
  border-radius:50%;
  background:var(--lw-ok);
  display:inline-block;
}
.lw-hero-body{
  font-size:13px;
  line-height:1.6;
  color:var(--lw-ink-2);
}
.lw-hero-hints-title{
  font-size:12px;
  font-weight:600;
  color:var(--lw-ink-3);
  margin-top:4px;
}
.lw-hero-hints{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
}
.lw-hero-hint-pill{
  border:1px solid var(--lw-line);
  background:var(--lw-surface);
  color:var(--lw-ink-2);
  padding:5px 12px;
  border-radius:9px;
  font-size:12.5px;
  font-weight:500;
  cursor:pointer;
  transition:background var(--fast) var(--ease),border-color var(--fast) var(--ease),color var(--fast) var(--ease);
  display:inline-flex;
  align-items:center;
  gap:6px;
  box-shadow:0 1px 1px rgba(24,20,14,.02);
}
.lw-hero-hint-pill:hover{
  background:var(--lw-surface-2);
  border-color:color-mix(in srgb,var(--lw-ink) 18%,transparent);
  color:var(--lw-ink);
}
.lw-msg{
  display:flex;
  flex-direction:column;
  gap:4px;
  max-width:88%;
  animation:lwFadeIn .18s ease-out;
}
.lw-msg-role{
  font-size:11px;
  font-weight:600;
  color:var(--lw-ink-3);
}
.lw-msg-user{
  align-self:flex-end;
  align-items:flex-end;
}
.lw-msg-user .lw-msg-text{
  background:var(--lw-solid);
  color:var(--lw-solid-ink);
  padding:10px 16px;
  border-radius:18px 18px 4px 18px;
  font-size:13.5px;
  line-height:1.5;
  box-shadow:0 1px 3px rgba(24,20,14,.12);
}
.lw-msg-ai{
  align-self:flex-start;
  align-items:flex-start;
}
.lw-msg-ai .lw-msg-text{
  background:var(--lw-surface);
  color:var(--lw-ink);
  border:1px solid var(--lw-line);
  padding:12px 16px;
  border-radius:18px 18px 18px 4px;
  font-size:13.5px;
  line-height:1.6;
  box-shadow:0 2px 10px rgba(0,0,0,.03);
}
.lw-msg-ai.is-busy .lw-msg-text{
  color:var(--lw-ink-2);
  border-style:dashed;
}
.lw-msg.is-error .lw-msg-text{
  background:color-mix(in srgb,var(--lw-danger) 8%,var(--lw-surface));
  border-color:color-mix(in srgb,var(--lw-danger) 30%,transparent);
  color:var(--lw-danger);
}
.lw-msg.is-warn .lw-msg-text{
  background:color-mix(in srgb,var(--lw-warn) 8%,var(--lw-surface));
  border-color:color-mix(in srgb,var(--lw-warn) 30%,transparent);
  color:var(--lw-warn);
}
.lw-thinking-toggle{
  display:inline-flex;
  align-items:center;
  gap:6px;
  padding:4px 9px;
  border-radius:6px;
  background:color-mix(in srgb, var(--lw-ink) 4%, transparent);
  color:var(--lw-ink-3);
  font-size:11.5px;
  font-weight:500;
  cursor:pointer;
  user-select:none;
  margin-bottom:8px;
  border:1px solid color-mix(in srgb, var(--lw-ink) 8%, transparent);
  transition:all .15s ease;
}
.lw-thinking-toggle:hover{
  background:color-mix(in srgb, var(--lw-ink) 8%, transparent);
  color:var(--lw-ink);
}
.lw-thinking-content{
  padding:10px 14px;
  margin-bottom:12px;
  background:color-mix(in srgb, var(--lw-ink) 3%, transparent);
  border-left:2px solid color-mix(in srgb, var(--lw-accent) 60%, transparent);
  border-radius:4px;
  font-size:12px;
  color:var(--lw-ink-3);
  line-height:1.65;
  white-space:pre-wrap;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  animation:lwFadeIn .2s ease;
}
.lw-md-table-wrap{
  overflow-x:auto;
  margin:10px 0;
  border:1px solid var(--lw-line);
  border-radius:8px;
  background:var(--lw-surface);
  box-shadow:0 1px 4px rgba(0,0,0,.02);
}
.lw-md-table{
  width:100%;
  border-collapse:collapse;
  font-size:13px;
  text-align:left;
}
.lw-md-table thead{
  background:color-mix(in srgb, var(--lw-accent) 8%, var(--lw-surface));
  border-bottom:1px solid var(--lw-line);
}
.lw-md-table th{
  padding:9px 14px;
  font-weight:600;
  color:var(--lw-ink);
  border-right:1px solid var(--lw-line);
  white-space:nowrap;
}
.lw-md-table th:last-child{
  border-right:none;
}
.lw-md-table td{
  padding:8px 14px;
  color:var(--lw-ink);
  border-right:1px solid var(--lw-line);
  border-bottom:1px solid var(--lw-line);
  line-height:1.5;
}
.lw-md-table td:last-child{
  border-right:none;
}
.lw-md-table tbody tr:last-child td{
  border-bottom:none;
}
.lw-md-table tbody tr:hover{
  background:color-mix(in srgb, var(--lw-accent) 4%, transparent);
}
.lw-md-code{
  background:color-mix(in srgb, var(--lw-ink) 5%, var(--lw-surface));
  border:1px solid var(--lw-line);
  border-radius:6px;
  padding:10px 14px;
  font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
  font-size:12px;
  line-height:1.5;
  overflow-x:auto;
  margin:8px 0;
  color:var(--lw-ink);
}
.lw-inline-code{
  background:color-mix(in srgb, var(--lw-ink) 6%, transparent);
  border:1px solid color-mix(in srgb, var(--lw-ink) 12%, transparent);
  border-radius:4px;
  padding:1.5px 5px;
  font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
  font-size:12px;
  color:var(--lw-ink);
}
.lw-md-ul{
  margin:6px 0 10px 18px;
  padding:0;
  list-style-type:disc;
}
.lw-md-ol{
  margin:6px 0 10px 18px;
  padding:0;
  list-style-type:decimal;
}
.lw-md-li{
  margin:4px 0;
  line-height:1.65;
  color:var(--lw-ink);
}
.lw-md-li::marker{
  color:var(--lw-accent);
}
@keyframes lwShimmer{
  0%, 100%{ opacity: .55; transform: scale(.98); }
  50%{ opacity: 1; transform: scale(1); }
}
.lw-thinking-shimmer{
  animation: lwShimmer 1.8s ease-in-out infinite;
  color: var(--lw-ink-2);
  font-weight: 500;
  font-size: 13px;
}
@keyframes lwSpinPulse{
  0%{ transform: rotate(0deg); }
  50%{ transform: rotate(180deg) scale(1.1); }
  100%{ transform: rotate(360deg); }
}
.lw-thinking-spin{
  animation: lwSpinPulse 2.5s ease-in-out infinite;
}
.lw-thinking-pill-busy{
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 88%;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 10px 14px;
}
.lw-thinking-header{
  display: flex;
  align-items: center;
  gap: 8px;
}
.lw-thinking-live-body{
  font-size: 13px;
  line-height: 1.6;
  color: var(--lw-ink-3, #94a3b8);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow-y: auto;
  padding-left: 12px;
  border-left: 2px solid rgba(99, 102, 241, 0.45);
  margin-top: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
@keyframes lwFadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
.lw-ws-dock{
  flex:none;
  border-top:1px solid var(--lw-line);
  background:var(--lw-surface);
  padding:10px 14px 12px;
  box-shadow:0 -3px 12px rgba(0,0,0,.03);
  display:flex;
  flex-direction:column;
  gap:6px;
  z-index:10;
}
.lw-composer-wrap{
  width:100%;
  max-width:760px;
  margin:0 auto;
  display:flex;
  flex-direction:column;
  gap:6px;
}
.lw-ws-left.is-split .lw-composer-wrap{
  max-width:100%;
}
.lw-composer-card{
  display:flex;
  flex-direction:column;
  background:var(--lw-surface);
  border:1px solid var(--lw-line-2);
  border-radius:18px;
  padding:10px 12px 8px 14px;
  box-shadow:0 2px 10px rgba(0,0,0,.02);
  transition:border-color .15s ease,box-shadow .15s ease;
}
.lw-composer-card:focus-within{
  border-color:var(--lw-accent);
  box-shadow:0 4px 16px color-mix(in srgb, var(--lw-accent) 14%, transparent);
}
.lw-composer-textarea{
  width:100%;
  border:none;
  outline:none;
  background:transparent;
  font-size:13.5px;
  color:var(--lw-ink);
  line-height:1.5;
  resize:none;
  min-height:26px;
  max-height:130px;
  font-family:inherit;
  padding:0;
  margin:0;
  box-sizing:border-box;
}
.lw-composer-textarea::placeholder{
  color:var(--lw-ink-3);
}
.lw-composer-actions{
  display:flex;
  align-items:center;
  justify-content:space-between;
  margin-top:8px;
  gap:8px;
}
.lw-composer-left{
  display:flex;
  align-items:center;
  gap:8px;
  min-width:0;
}
.lw-composer-clear-btn{
  background:none;
  border:none;
  color:var(--lw-ink-3);
  cursor:pointer;
  font-size:11.5px;
  padding:2px 6px;
  border-radius:6px;
  transition:color .15s ease,background .15s ease;
  white-space:nowrap;
}
.lw-composer-clear-btn:hover{
  color:var(--lw-ink);
  background:var(--lw-surface-2);
}
.lw-composer-right{
  display:flex;
  align-items:center;
  gap:8px;
  flex:none;
}
.lw-model-picker{
  position:relative;
  display:inline-flex;
  align-items:center;
  background:var(--lw-surface-2);
  border-radius:14px;
  padding:0 22px 0 10px;
  height:28px;
  transition:all .15s ease;
}
.lw-model-picker:hover{
  background:color-mix(in srgb, var(--lw-ink) 6%, var(--lw-surface-2));
}
.lw-model-picker select{
  appearance:none;
  -webkit-appearance:none;
  background:transparent;
  border:none;
  font-size:12px;
  font-weight:500;
  color:var(--lw-ink-2);
  padding:0;
  margin:0;
  cursor:pointer;
  outline:none;
  max-width:180px;
  text-overflow:ellipsis;
  white-space:nowrap;
  line-height:28px;
  height:28px;
}
.lw-model-picker-arrow{
  position:absolute;
  right:7px;
  pointer-events:none;
  color:var(--lw-ink-3);
  display:flex;
  align-items:center;
  justify-content:center;
}
.lw-composer-send-circle{
  width:28px;
  height:28px;
  border-radius:50%;
  border:none;
  background:var(--lw-accent);
  color:#ffffff;
  display:flex;
  align-items:center;
  justify-content:center;
  cursor:pointer;
  flex:none;
  transition:all .15s ease;
}
.lw-composer-send-circle:disabled{
  background:#a4bdf6;
  color:#ffffff;
  opacity:0.65;
  cursor:not-allowed;
  transform:none;
  box-shadow:none;
}
.lw-composer-send-circle:not(:disabled):hover{
  transform:scale(1.06);
  box-shadow:0 2px 8px color-mix(in srgb, var(--lw-accent) 35%, transparent);
}
.lw-composer-hint{
  font-size:11px;
  color:var(--lw-ink-3);
  text-align:center;
  padding-bottom:2px;
}

.lw-col.is-wide{max-width:1120px}
.lw-body.is-stage{margin:0 0 auto;padding-bottom:0;gap:18px}
.lw-stage{display:flex;flex-direction:column;gap:20px;width:100%;min-width:0}
.lw-stage-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;flex-wrap:wrap}
.lw-stage-title{min-width:0;display:flex;flex-direction:column;gap:2px}
.lw-stage-title .lw-preview-title{margin-top:3px}

.lw-real{
  display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;
  border:1px solid var(--lw-line);background:var(--lw-surface);
  transition:border-color var(--fast) var(--ease),background var(--fast) var(--ease);
}
.lw-real.is-live{
  border-color:color-mix(in srgb,var(--lw-ok) 30%,transparent);
  background:color-mix(in srgb,var(--lw-ok) 4%,var(--lw-surface));
}
.lw-real.is-quiet{background:var(--lw-surface-2)}
.lw-real-dot{width:6px;height:6px;border-radius:50%;background:var(--lw-ink-3);flex:none}
.lw-real.is-live .lw-real-dot{background:var(--lw-ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--lw-ok) 14%,transparent)}
.lw-real-copy{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.lw-real-title{font-size:12.5px;font-weight:600;color:var(--lw-ink);line-height:1.4}
.lw-real-body{font-size:12px;line-height:1.6;color:var(--lw-ink-2)}
.lw-real-note{font-size:12px;line-height:1.6;color:var(--lw-ok);margin-top:5px}

.lw-structure{display:flex;flex-direction:column;gap:9px}
.lw-structure-head{display:flex;align-items:baseline;gap:8px}
.lw-sect-label{font-size:11.5px;font-weight:600;letter-spacing:.02em;color:var(--lw-ink-3)}
.lw-fields{display:flex;flex-wrap:wrap;gap:6px}
.lw-field-chip{
  display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;
  border-radius:8px;border:1px solid var(--lw-line);background:var(--lw-surface);
  font-size:12px;line-height:1;color:var(--lw-ink);
}
.lw-field-ico{color:var(--lw-ink-3);flex:none}
.lw-field-name{font-weight:560}
.lw-field-kind{font-size:10.5px;color:var(--lw-ink-3)}

.lw-fold{display:flex;flex-direction:column;gap:10px;min-width:0}
.lw-fold-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.lw-fold-body{display:flex;flex-direction:column;gap:8px;min-width:0}

/* The adjust bar docks to the bottom: the table is elsewhere, the words live here. */
.lw-dock{
  position:sticky;bottom:16px;z-index:3;display:flex;flex-direction:column;gap:12px;
  margin-top:6px;padding:15px 17px 16px;border-radius:18px;
  border:1px solid var(--lw-line-2);
  background:color-mix(in srgb,var(--lw-surface) 88%,transparent);
  -webkit-backdrop-filter:blur(16px) saturate(1.3);backdrop-filter:blur(16px) saturate(1.3);
  box-shadow:var(--lw-e3);
}
.lw-dock-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}
.lw-dock-hint{font-size:11.5px;color:var(--lw-ink-3)}
.lw-dock .lw-tweak-row{padding-top:0;border-top:0}

.lw-table-wrap{border-radius:14px;overflow-x:auto;background:var(--lw-surface);border:1px solid var(--lw-line);min-width:0;max-width:100%}
.lw-table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:520px}
.lw-table th{
  text-align:left;padding:11px 16px;background:var(--lw-surface-2);
  border-bottom:1px solid var(--lw-line);vertical-align:middle;white-space:nowrap;
  font-weight:600;font-size:11.5px;color:var(--lw-ink-2);letter-spacing:.01em;
}
.lw-th-inner{display:inline-flex;align-items:center;gap:6px}
.lw-th-glyph{color:var(--lw-ink-3);opacity:.85}
.lw-table td{
  padding:13px 16px;border-bottom:1px solid var(--lw-line);
  color:var(--lw-ink);white-space:nowrap;max-width:210px;overflow:hidden;text-overflow:ellipsis;
}
.lw-table tbody tr:last-child td{border-bottom:0}
.lw-table tbody tr:hover td{background:color-mix(in srgb,var(--lw-surface-2) 65%,transparent)}
.lw-table td.is-empty{color:var(--lw-ink-3);opacity:.5}
.lw-table td.is-num{font-variant-numeric:tabular-nums;color:var(--lw-ink)}

/* Warm, low-saturation option pills */
.lw-pills{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap}
.lw-pill{
  display:inline-flex;align-items:center;height:21px;padding:0 7px;border-radius:5px;
  font-size:11px;font-weight:540;line-height:1;white-space:nowrap;letter-spacing:.005em;
}
.lw-pill.tone-blue{background:#EDF0FE;color:#2B4FE0}
.lw-pill.tone-slate{background:#F0EDE6;color:#575144}
.lw-pill.tone-teal{background:#E7F3F0;color:#0E6E63}
.lw-pill.tone-amber{background:#FAF0DD;color:#8A5A0E}
.lw-pill.tone-emerald{background:#E8F3EC;color:#146B49}
.lw-pill.tone-rose{background:#FAEAE8;color:#9E2B22}
.lw[data-theme="dark"] .lw-pill.tone-blue{background:rgba(147,170,255,.14);color:#AFC2FF}
.lw[data-theme="dark"] .lw-pill.tone-slate{background:rgba(244,241,234,.09);color:#C9C2B6}
.lw[data-theme="dark"] .lw-pill.tone-teal{background:rgba(87,214,163,.12);color:#7FE3C1}
.lw[data-theme="dark"] .lw-pill.tone-amber{background:rgba(240,181,101,.14);color:#F0C78C}
.lw[data-theme="dark"] .lw-pill.tone-emerald{background:rgba(87,214,163,.12);color:#8BE3B9}
.lw[data-theme="dark"] .lw-pill.tone-rose{background:rgba(255,147,132,.14);color:#FFB0A4}

/* Collapsible column spec */
.lw-details-toggle{
  font:inherit;font-size:12px;font-weight:540;color:var(--lw-ink-3);
  background:none;border:0;padding:2px 0;cursor:pointer;align-self:flex-start;
  display:inline-flex;align-items:center;gap:6px;
  transition:color var(--fast) var(--ease);
}
.lw-details-toggle:hover{color:var(--lw-ink)}
.lw-details-chevron{transition:transform var(--fast) var(--ease)}
.lw-details-chevron.is-open{transform:rotate(90deg)}

.lw-legend{display:flex;flex-direction:column;border-top:1px solid var(--lw-line);padding-top:4px}
.lw-legend-row{
  display:flex;align-items:baseline;gap:12px;padding:9px 0;
  border-bottom:1px solid var(--lw-line);font-size:12px;line-height:1.55;
}
.lw-legend-row:last-child{border-bottom:0}
.lw-legend-key{flex:none;min-width:96px;font-weight:600;color:var(--lw-ink)}
.lw-legend-kind{flex:none;min-width:34px;font-size:10.5px;color:var(--lw-ink-3)}
.lw-legend-val{flex:1;color:var(--lw-ink-2);min-width:0}
.lw-legend-opts{color:var(--lw-ink-3);font-size:11px;margin-left:6px}

.lw-tweak-row{display:flex;gap:8px;align-items:center;padding-top:18px;border-top:1px solid var(--lw-line)}
.lw-tweak-row .lw-input{flex:1;box-shadow:none}

/* Adjusting a saved table: the same composer idea, applied after creation. */
.lw-tweak{display:flex;flex-direction:column;gap:12px;padding-top:18px;border-top:1px solid var(--lw-line)}
.lw-tweak .lw-tweak-row{padding-top:0;border-top:0}
.lw-tweak-title{font-size:11.5px;font-weight:600;letter-spacing:.02em;color:var(--lw-ink-3)}
.lw-suggest{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.lw-suggest-lead{font-size:11.5px;color:var(--lw-ink-3);margin-right:1px}
.lw-adjust-note{font-size:12.5px;line-height:1.7;color:var(--lw-ink-2);white-space:pre-wrap}
.lw-adjust-note.is-warn{color:var(--lw-warn)}
.lw-confirm-card{
  display:flex;flex-direction:column;gap:10px;padding:14px 16px;border-radius:14px;
  border:1px solid color-mix(in srgb,var(--lw-warn) 26%,transparent);
  background:color-mix(in srgb,var(--lw-warn) 4%,var(--lw-surface));
}
.lw-confirm-list{margin:0;padding-left:18px;font-size:12.5px;line-height:1.8;color:var(--lw-ink-2)}

/* ── Feedback ─────────────────────────────────────────────────────────── */
.lw-banner{
  display:flex;align-items:flex-start;gap:11px;padding:13px 15px;border-radius:14px;
  border:1px solid color-mix(in srgb,var(--lw-danger) 22%,transparent);
  background:color-mix(in srgb,var(--lw-danger) 4%,var(--lw-surface));
}
.lw-banner.is-warn{
  border-color:color-mix(in srgb,var(--lw-warn) 24%,transparent);
  background:color-mix(in srgb,var(--lw-warn) 4%,var(--lw-surface));
}
.lw-banner-icon{
  flex:none;width:16px;height:16px;border-radius:50%;font-size:10px;font-weight:800;
  line-height:16px;text-align:center;margin-top:2px;background:var(--lw-danger);color:#fff;
}
.lw-banner.is-warn .lw-banner-icon{background:var(--lw-warn);color:#FFF9F0}
.lw-banner-body{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
.lw-banner-action{flex:none;align-self:center;margin-left:6px}
.lw-banner-title{font-size:12.5px;font-weight:600;color:var(--lw-ink)}
.lw-banner-text{font-size:12px;line-height:1.65;color:var(--lw-ink-2);word-break:break-word}
.lw-wait{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--lw-ink-2);font-variant-numeric:tabular-nums}

/* ── Success ──────────────────────────────────────────────────────────── */
.lw-done-head{display:flex;align-items:flex-start;gap:16px}
.lw-check{
  width:44px;height:44px;border-radius:14px;flex:none;display:flex;align-items:center;
  justify-content:center;background:var(--lw-ok);color:#FFFFFF;
  box-shadow:0 1px 2px rgba(12,60,44,.18), 0 10px 22px -12px color-mix(in srgb,var(--lw-ok) 70%,transparent);
}
.lw-done-copy{display:flex;flex-direction:column;gap:3px;min-width:0;padding-top:1px}
.lw-done-eyebrow{font-size:11px;font-weight:600;letter-spacing:.08em;color:var(--lw-ink-3);text-transform:none}
.lw-done-title{font-size:23px;font-weight:600;letter-spacing:-.024em;color:var(--lw-ink);line-height:1.32;margin:0}
.lw-url{
  font-size:11.5px;line-height:1.5;color:var(--lw-ink-3);word-break:break-all;
  text-decoration:none;display:inline-block;margin-top:4px;font-family:var(--mono);
}
.lw-url:hover{color:var(--lw-accent);text-decoration:underline;text-underline-offset:3px}
.lw-next{display:flex;flex-direction:column;gap:11px;border-top:1px solid var(--lw-line);padding-top:20px}
.lw-next-title{font-size:11.5px;font-weight:600;letter-spacing:.02em;color:var(--lw-ink-3)}
.lw-next-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:34px}
.lw-next-card{
  display:flex;gap:11px;align-items:flex-start;padding:12px 0 13px;
  border-top:1px solid var(--lw-line);
  font-size:12.5px;line-height:1.65;color:var(--lw-ink-2);
}
.lw-next-num{
  flex:none;font-family:var(--mono);font-size:10.5px;font-weight:500;
  color:var(--lw-ink-3);line-height:1.95;letter-spacing:.02em;font-variant-numeric:tabular-nums;
}

/* ── Loading ──────────────────────────────────────────────────────────── */
.lw-plan-status{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:600;color:var(--lw-ink)}
.lw-skel-table{border:1px solid var(--lw-line);border-radius:14px;overflow:hidden}
.lw-skel-row{
  display:grid;grid-template-columns:1.2fr 1fr 1fr 1fr;gap:14px;
  padding:14px 16px;border-bottom:1px solid var(--lw-line);
}
.lw-skel-row.is-head{background:var(--lw-surface-2)}
.lw-skel-row:last-child{border-bottom:0}
.lw-skel{
  height:9px;border-radius:4px;
  background:linear-gradient(90deg,color-mix(in srgb,var(--lw-ink) 6%,transparent) 25%,color-mix(in srgb,var(--lw-ink) 11%,transparent) 37%,color-mix(in srgb,var(--lw-ink) 6%,transparent) 63%);
  background-size:400% 100%;animation:lw-shimmer 1.8s ease-in-out infinite;
}
@keyframes lw-shimmer{0%{background-position:100% 0}100%{background-position:0 0}}

/* ── Scenario chips (a shortcut row, not a section) ───────────────────── */
.lw-scenes{display:flex;flex-wrap:wrap;gap:8px}
.lw-chip{
  font:inherit;display:inline-flex;align-items:center;gap:7px;
  height:30px;padding:0 11px;border-radius:9px;
  border:1px solid var(--lw-line);background:var(--lw-surface);
  color:var(--lw-ink-2);font-size:12.5px;font-weight:500;line-height:1;
  cursor:pointer;white-space:nowrap;box-shadow:0 1px 1px rgba(24,20,14,.02);
  transition:background var(--fast) var(--ease),border-color var(--fast) var(--ease),
    color var(--fast) var(--ease),transform 120ms var(--ease);
}
.lw-chip:hover:not(:disabled){
  background:var(--lw-surface-2);
  border-color:color-mix(in srgb,var(--lw-ink) 18%,transparent);
  color:var(--lw-ink);
}
.lw-chip:active:not(:disabled){transform:translateY(1px)}
.lw-chip:focus-visible{outline:none;border-color:var(--lw-accent);box-shadow:0 0 0 3px var(--lw-accent-soft)}
.lw-chip:disabled{opacity:.5;cursor:default}
.lw-chip-ico{color:var(--lw-ink-3);transition:color var(--fast) var(--ease)}
.lw-chip:hover:not(:disabled) .lw-chip-ico{color:var(--lw-accent)}

/* ── Recent ───────────────────────────────────────────────────────────── */
.lw-recent{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-height:22px}
.lw-recent-label{font-size:11.5px;color:var(--lw-ink-3);flex:none;letter-spacing:.02em}
.lw-recent-list{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-left:-7px}
.lw-recent-item{
  display:inline-flex;align-items:center;border-radius:7px;
  transition:background var(--fast) var(--ease);
}
.lw-recent-item:hover{background:color-mix(in srgb,var(--lw-ink) 5%,transparent)}
.lw-recent-open{
  font:inherit;display:inline-flex;align-items:center;gap:6px;
  padding:3px 2px 3px 7px;border:0;background:none;border-radius:7px;
  color:var(--lw-ink-2);font-size:12.5px;font-weight:500;line-height:1.45;
  cursor:pointer;max-width:250px;transition:color var(--fast) var(--ease);
}
.lw-recent-open:hover{color:var(--lw-ink)}
.lw-recent-open:disabled{opacity:.5;cursor:default}
.lw-recent-del{
  width:18px;height:18px;margin:0 3px 0 1px;border:0;border-radius:5px;background:none;
  color:var(--lw-ink-3);font-size:15px;line-height:1;cursor:pointer;flex:none;
  opacity:.55;transition:opacity var(--fast) var(--ease),background var(--fast) var(--ease),color var(--fast) var(--ease);
}
.lw-recent-item:hover .lw-recent-del,
.lw-recent-del:focus-visible{opacity:1}
.lw-recent-del:hover{background:color-mix(in srgb,var(--lw-danger) 12%,transparent);color:var(--lw-danger)}
.lw-recent-ico{color:var(--lw-ink-3);flex:none;opacity:.8}
.lw-recent-name{font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.lw-recent-confirm:focus{outline:none}
.lw-recent-confirm{
  display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;
  padding:10px 12px;border:1px solid var(--lw-line-2);border-radius:12px;
  background:var(--lw-surface);box-shadow:var(--lw-e1);
}
.lw-confirm-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.lw-confirm-title{font-size:12.5px;font-weight:600;color:var(--lw-ink)}
.lw-confirm-body{font-size:11.5px;line-height:1.5;color:var(--lw-ink-3)}
.lw-confirm-actions{display:flex;gap:8px;flex:none}

.lw-busy-inline{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--lw-ink-2);font-variant-numeric:tabular-nums}
.lw-composer.is-busy{box-shadow:var(--lw-e2)}
.lw-composer.is-busy .lw-composer-area{color:var(--lw-ink-2)}
.lw-planning{
  display:flex;flex-direction:column;gap:14px;padding:20px 22px 22px;
  background:var(--lw-surface);border:1px solid var(--lw-line);border-radius:var(--r-lg);
  box-shadow:var(--lw-e1);
}

@media (max-width:720px){
  .lw{padding:26px 18px 64px}
  .lw-kbd{display:none}
  .lw-composer-bar{padding-left:18px}
  .lw-trust{font-size:11px}
  .lw-scenes{gap:6px}
  .lw-chip{height:28px;padding:0 9px;font-size:12px}
  .lw-next-grid{grid-template-columns:minmax(0,1fr)}
  .lw-tweak-row{flex-direction:column;align-items:stretch}
  .lw-card{padding:22px 20px 24px;border-radius:16px}
  .lw-hero{padding-top:18px}
}
@media (prefers-reduced-motion:reduce){
  .lw *,.lw *::before,.lw *::after{animation-duration:0s!important;transition-duration:0s!important}
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

    // ── i18n ───────────────────────────────────────────────────────────────

    function translator(props) {
      if (typeof props.t === 'function') {
        return (key) => {
          const value = props.t(key)
          return value === key ? (ZH[key] ?? key) : value
        }
      }
      return (key) => ZH[key] ?? key
    }

    function humanize(message) {
      const text = String(message ?? '').trim()
      if (!text) return '没响应，再试一次就好。'
      if (/找不到 lark-cli|没找到 lark-cli|lark-cli 不可用/i.test(text)) return '还没装连接飞书的小工具，装好之后再来。'
      if (/device_code is invalid|device code.*invalid/i.test(text)) return '这个授权链接失效了，我给你发一个新的。'
      if (/expired|过期/i.test(text) && /device|code|授权/i.test(text)) return '授权链接过期了，我重新发一个给你。'
      if (/pending|audit|审核|审批|not approved/i.test(text)) return '授权已提交，还在等管理员审批，批完再点一次就好。'
      if (/429|too many|rate limit|frequency|限流|频率/i.test(text)) return '操作太频繁了，等十几秒再试。'
      if (/forbidden|permission|scope|403|权限/i.test(text)) return '飞书说权限不够，重新授权一次把权限给全就好。'
      if (/auth|授权|登录|token .*(expired|invalid)|needs_refresh/i.test(text)) return '飞书那边要重新授权一下。'
      if (/timeout|超时|aborted|ETIMEDOUT|想太久了/i.test(text)) return '飞书响应有点慢，再试一次。'
      if (/ENOTFOUND|ECONNREFUSED|network|网络/i.test(text)) return '连不上飞书，检查下网络。'
      if (/模型没有|无法解析|没能组成/.test(text)) return '我没太看懂要记什么。换个说法，或者点下面任意一个场景试试。'
      if (/required flag|missing required|is required/i.test(text)) return '这张表的信息没读全，回飞书里打开看看吧。'
      return text
    }

    function detectTheme() {
      try {
        const probe = getComputedStyle(document.documentElement)
          .getPropertyValue('--dsw-alias-bg-base')
          .trim()
        if (probe) {
          let r
          let g
          let b
          const hex = probe.match(/^#([0-9a-f]{6})$/i)
          if (hex) {
            r = parseInt(hex[1].slice(0, 2), 16)
            g = parseInt(hex[1].slice(2, 4), 16)
            b = parseInt(hex[1].slice(4, 6), 16)
          } else {
            const rgb = probe.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
            if (rgb) {
              r = Number(rgb[1])
              g = Number(rgb[2])
              b = Number(rgb[3])
            }
          }
          if (r !== undefined) return 0.299 * r + 0.587 * g + 0.114 * b < 128 ? 'dark' : 'light'
        }
      } catch {
        // fall through to the media query
      }
      try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      } catch {
        return 'light'
      }
    }

    function useHostTheme() {
      const [theme, setTheme] = useState(detectTheme)
      useEffect(() => {
        const observer = new MutationObserver(() => setTheme(detectTheme()))
        observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class', 'data-theme', 'style'],
        })
        return () => observer.disconnect()
      }, [])
      return theme
    }

    // ── Primitives ─────────────────────────────────────────────────────────

    function Button({ variant = 'default', size, className = '', children, ...rest }) {
      const modifier =
        variant === 'primary' ? ' is-primary'
          : variant === 'ghost' ? ' is-ghost'
            : variant === 'link' ? ' is-link'
              : variant === 'danger' ? ' is-danger'
                : ''
      const sizeMod = size === 'sm' ? ' is-sm' : ''
      return h('button', { type: 'button', ...rest, className: `lw-btn${modifier}${sizeMod}${className ? ` ${className}` : ''}` }, children)
    }

    function Banner({ tone = 'error', title, children, action }) {
      const warn = tone === 'warn'
      return h(
        'div',
        { className: `lw-banner${warn ? ' is-warn' : ''}`, role: 'alert' },
        h('span', { className: 'lw-banner-icon', 'aria-hidden': true }, '!'),
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
              h('span', { className: 'lw-step-num' }, index < current ? '✓' : String(index + 1)),
              h('span', null, label),
            ),
          ),
        ),
      )
    }

    function Heartbeat({ t, seconds }) {
      return h(
        'div',
        { className: 'lw-wait', role: 'status', 'aria-live': 'polite' },
        h('span', { className: 'lw-dot is-busy' }),
        `${t('gate.waiting')}${seconds}s`,
      )
    }

    function TableSkeleton() {
      return h(
        'div',
        { className: 'lw-skel-table', 'aria-hidden': true },
        h(
          'div',
          { className: 'lw-skel-row is-head' },
          h('div', { className: 'lw-skel', style: { width: '65%' } }),
          h('div', { className: 'lw-skel', style: { width: '52%' } }),
          h('div', { className: 'lw-skel', style: { width: '58%' } }),
          h('div', { className: 'lw-skel', style: { width: '48%' } }),
        ),
        [0, 1, 2].map((row) =>
          h(
            'div',
            { className: 'lw-skel-row', key: row },
            h('div', { className: 'lw-skel', style: { width: `${78 - row * 9}%` } }),
            h('div', { className: 'lw-skel', style: { width: `${60 + row * 7}%` } }),
            h('div', { className: 'lw-skel', style: { width: `${46 + row * 11}%` } }),
            h('div', { className: 'lw-skel', style: { width: `${55 - row * 6}%` } }),
          ),
        ),
      )
    }

    function Mark({ size = 18 }) {
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

    function UnifiedComposer({
      value = '',
      onChange = () => {},
      onSubmit = () => {},
      placeholder = '',
      busy = false,
      busyText = '处理中…',
      buttonText = '发送',
      disabled = false,
      models = [],
      selectedModel = null,
      modelKey = (m) => (m ? `${m.provider || ''}:${m.id || ''}` : ''),
      changeModel = () => {},
      trustText = '直连你的飞书账号，安全隐私仅自己可见',
      minHeight = 60,
      id = 'lw-composer-input',
      ariaLabel = '输入框',
      inputRef = null,
    }) {
      return h(
        'div',
        { className: `lw-composer${busy ? ' is-busy' : ''}` },
        h('textarea', {
          id,
          ref: inputRef,
          className: 'lw-composer-area',
          style: { minHeight: `${minHeight}px` },
          value,
          placeholder,
          'aria-label': ariaLabel,
          'aria-busy': busy ? 'true' : undefined,
          readOnly: Boolean(busy),
          spellCheck: false,
          onChange: (event) => onChange(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey || !event.shiftKey)) {
              event.preventDefault()
              if (value.trim().length >= 1 && !busy && !disabled) {
                onSubmit(value)
              }
            }
          },
        }),
        h(
          'div',
          { className: 'lw-composer-bar' },
          h(
            'span',
            { className: 'lw-trust' },
            h(Icon, { name: 'lock', size: 12 }),
            h('span', null, trustText),
          ),
          h(
            'div',
            { className: 'lw-composer-right', style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h(
              'div',
              { className: 'lw-model-picker', title: '切换当前使用的 AI 模型' },
              h(
                'select',
                {
                  value: modelKey(selectedModel),
                  onChange: (e) => changeModel(e.target.value),
                  disabled: Boolean(busy),
                },
                !models || models.length === 0
                  ? [h('option', { key: 'empty', value: '' }, '加载模型中…')]
                  : models.map((m) =>
                      h(
                        'option',
                        { key: modelKey(m), value: modelKey(m) },
                        m.name + (m.kind ? ` ${m.kind}` : ''),
                      ),
                    ),
              ),
              h(
                'span',
                { className: 'lw-model-picker-arrow' },
                h(Icon, { name: 'chevronDown', size: 12 }),
              ),
            ),
            busy
              ? h(
                  'span',
                  { className: 'lw-busy-inline', role: 'status' },
                  h('span', { className: 'lw-dot is-busy' }),
                  busyText,
                )
              : h(
                  Button,
                  {
                    key: 'submit-btn',
                    variant: 'primary',
                    size: 'sm',
                    disabled: Boolean(busy) || disabled || !value.trim(),
                    onClick: () => {
                      if (value.trim() && !busy && !disabled) onSubmit(value)
                    },
                  },
                  buttonText,
                ),
          ),
        ),
      )
    }

    // ── Host browser ───────────────────────────────────────────────────────
    // "Connected to Feishu" is an API grant; it carries no web session. Feishu
    // also refuses to be framed, so the real Base belongs in the host's own
    // browser tab: a real page with its own login, docked next to the session.
    //
    // The right Sidebar is Session-scoped: the host reserves the "conversation"
    // main panel as the only Session-bound surface. This panel is a global one,
    // so the column has nothing to attach a tab to until a conversation is on
    // screen. The hand-off therefore brings the conversation forward first and
    // opens the tab once the column reports a mounted Session. It never opens
    // an external window by itself.

    function hostBrowser(ctx) {
      const read = (name) => {
        try {
          return typeof ctx.get === 'function' ? ctx.get(name) : undefined
        } catch (failure) {
          return undefined
        }
      }
      const hasBrowserTab = () => {
        const registry = read('sidebarRightTabs')
        if (!registry || typeof registry.get !== 'function') return false
        try {
          return registry.get('browser') !== undefined
        } catch (failure) {
          return false
        }
      }
      const column = () => {
        const right = read('sidebarRight')
        return right && typeof right.openTab === 'function' ? right : undefined
      }
      const mountedSession = (right) => {
        try {
          return right.mounted && typeof right.mounted.getSnapshot === 'function'
            ? right.mounted.getSnapshot()
            : undefined
        } catch (failure) {
          return undefined
        }
      }
      return {
        available() {
          return Boolean(column() && hasBrowserTab())
        },
        /**
         * Dock the Base in the host's browser tab.
         * @param url - the Base URL.
         * @param options.navigate - bring the conversation forward when no
         *   Session is on screen (an explicit click may; an automatic hand-off
         *   must not yank the user out of the panel).
         * @returns a promise of what actually happened; never opens externally.
         */
        open(url, options = {}) {
          const navigate = options.navigate !== false
          return new Promise((resolve) => {
            if (!url) {
              resolve({ mode: 'unavailable' })
              return
            }
            const right = column()
            if (!right || !hasBrowserTab()) {
              resolve({ mode: 'unavailable' })
              return
            }
            const switchToWorkbenchTab = (sessionId) => {
              if (sessionId) {
                try {
                  const key = `dsh.conversation.${sessionId}`
                  const existing = JSON.parse(localStorage.getItem(key) || '{}')
                  existing.view = 'lark-workbench'
                  localStorage.setItem(key, JSON.stringify(existing))
                } catch (e) {}
                try {
                  const uiConv = read('uiConversation')
                  if (uiConv && typeof uiConv.binding === 'function') {
                    uiConv.binding(sessionId).activate('lark-workbench')
                  }
                } catch (e) {}
              }
              const clickDomTab = () => {
                const tabs = document.querySelectorAll('[role="tab"]')
                for (const tab of tabs) {
                  if (tab.textContent && tab.textContent.includes('飞书工作台')) {
                    tab.click()
                    return true
                  }
                }
                return false
              }
              if (!clickDomTab()) {
                setTimeout(clickDomTab, 60)
                setTimeout(clickDomTab, 180)
                setTimeout(clickDomTab, 400)
              }
            }

            const attempt = (sessionId) => {
              try {
                switchToWorkbenchTab(sessionId)
                right.openTab('browser', { params: { url } })
                resolve({ mode: 'sidebar' })
              } catch (failure) {
                resolve({ mode: 'error', message: String((failure && failure.message) || failure) })
              }
            }

            const currentSession = mountedSession(right)
            if (currentSession !== undefined) {
              attempt(currentSession)
              return
            }
            if (!navigate) {
              resolve({ mode: 'no-session' })
              return
            }
            try {
              const layout = read('layout')
              if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(null)
            } catch (failure) {}
            let tries = 0
            const timer = setInterval(() => {
              tries += 1
              const sid = mountedSession(right)
              if (sid !== undefined) {
                clearInterval(timer)
                attempt(sid)
                return
              }
              if (tries >= 30) {
                clearInterval(timer)
                resolve({ mode: 'no-session' })
              }
            }, 100)
          })
        },
        closeSidebarBrowserTabs(sessionId) {
          try {
            const right = column()
            if (!right || typeof right.closeIn !== 'function') return
            const tabs = right.openTabs && typeof right.openTabs.getSnapshot === 'function'
              ? right.openTabs.getSnapshot()
              : []
            for (const tab of tabs) {
              if ((!sessionId || tab.sessionId === sessionId) && (tab.kind === 'browser' || (tab.tabId && String(tab.tabId).includes('browser')))) {
                right.closeIn(tab.sessionId, tab.tabId)
              }
            }
          } catch (e) {}
        },
      }
    }

    // ── Preview ────────────────────────────────────────────────────────────

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

    function liveCell(row, name, index) {
      if (Array.isArray(row)) return row[index]
      if (!row || typeof row !== 'object') return undefined
      const bag = row.fields && typeof row.fields === 'object' ? row.fields : row
      return bag[name]
    }

    function LiveTable({ fields, rows, emptyLabel }) {
      const names = (fields || []).map((field) => field && field.name).filter(Boolean)
      const columns = names.length > 0
        ? names
        : Array.from(new Set((rows || []).flatMap((row) => (row && typeof row === 'object' && !Array.isArray(row)
            ? Object.keys(row.fields && typeof row.fields === 'object' ? row.fields : row)
            : []))))
      // Knowing the column type lets the read-only sample show the same option
      // pills the Base does, instead of flattening every select into plain text.
      const byName = new Map((fields || []).filter((field) => field && field.name).map((field) => [field.name, field]))
      return h(
        'div',
        { className: 'lw-table-wrap' },
        h(
          'table',
          { className: 'lw-table' },
          h('thead', null, h('tr', null, columns.map((name) => h('th', { key: name, scope: 'col' }, name)))),
          h(
            'tbody',
            null,
            (rows || []).length > 0
              ? rows.map((row, rowIndex) =>
                  h(
                    'tr',
                    { key: rowIndex },
                    columns.map((name, columnIndex) => {
                      const value = liveCell(row, name, columnIndex)
                      const field = byName.get(name)
                      if (field && field.type === 'select' && value != null) {
                        const picked = (Array.isArray(value) ? value : [value]).map(cellText).filter(Boolean)
                        if (picked.length > 0) {
                          return h(
                            'td',
                            { key: name },
                            h(
                              'span',
                              { className: 'lw-pills' },
                              picked.map((val, optIndex) =>
                                h(
                                  'span',
                                  { key: `${val}-${optIndex}`, className: `lw-pill tone-${pillToneFor(field, val)}` },
                                  val,
                                ),
                              ),
                            ),
                          )
                        }
                      }
                      const text = cellText(value)
                      return h(
                        'td',
                        {
                          key: name,
                          className: `${text ? '' : 'is-empty'}${typeof value === 'number' ? ' is-num' : ''}`.trim(),
                        },
                        text || '—',
                      )
                    }),
                  ),
                )
              : h('tr', null, h('td', { colSpan: columns.length || 1, className: 'is-empty' }, emptyLabel)),
          ),
        ),
      )
    }

    function pillToneFor(field, optionName) {
      const options = Array.isArray(field.options) ? field.options : []
      const idx = options.findIndex((o) => o && o.name === optionName)
      return PILL_TONES[(idx >= 0 ? idx : 0) % PILL_TONES.length]
    }

    function PreviewTable({ table, t }) {
      const columns = table.fields
      const rows = (table.records ?? []).slice(0, 4)
      return h(
        'div',
        { className: 'lw-table-wrap' },
        h(
          'table',
          { className: 'lw-table' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              columns.map((field) =>
                h(
                  'th',
                  {
                    key: field.name,
                    scope: 'col',
                    title: field.description || KIND_HINT[field.type] || '',
                  },
                  h(
                    'span',
                    { className: 'lw-th-inner' },
                    h(Icon, {
                      name: KIND_ICON[field.type] ?? 'fieldText',
                      size: 12,
                      strokeWidth: 1.6,
                      className: 'lw-th-glyph',
                    }),
                    h('span', null, field.name),

                  ),
                ),
              ),
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
                      const raw = record[field.name]
                      if (field.type === 'select' && raw != null) {
                        const list = Array.isArray(raw) ? raw : [String(raw)]
                        const nonEmpty = list.filter(Boolean)
                        if (nonEmpty.length > 0) {
                          return h(
                            'td',
                            { key: field.name },
                            h(
                              'span',
                              { className: 'lw-pills' },
                              nonEmpty.map((val, optIndex) =>
                                h(
                                  'span',
                                  {
                                    key: `${val}-${optIndex}`,
                                    className: `lw-pill tone-${pillToneFor(field, val)}`,
                                  },
                                  val,
                                ),
                              ),
                            ),
                          )
                        }
                      }
                      const value = cellText(raw)
                      return h(
                        'td',
                        {
                          key: field.name,
                          className: `${value ? '' : 'is-empty'}${field.type === 'number' ? ' is-num' : ''}`.trim(),
                        },
                        value || '—',
                      )
                    }),
                  ),
                )
              : h('tr', null, h('td', { colSpan: columns.length, className: 'is-empty' }, t('preview.empty'))),
          ),
        ),
      )
    }

    function Legend({ table }) {
      return h(
        'div',
        { className: 'lw-legend' },
        table.fields.map((field) =>
          h(
            'div',
            { className: 'lw-legend-row', key: field.name },
            h('span', { className: 'lw-legend-key' }, field.name),
            h('span', { className: 'lw-legend-kind' }, KIND_HINT[field.type] ?? ''),
            h(
              'span',
              { className: 'lw-legend-val' },
              field.description || '',
              field.type === 'select' && Array.isArray(field.options) && field.options.length > 0
                ? h('span', { className: 'lw-legend-opts' }, `（${field.options.map((o) => o.name).join(' / ')}）`)
                : null,
            ),
          ),
        ),
      )
    }

    // ── Recent ─────────────────────────────────────────────────────────────

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

    function Recent({ items, t, onOpen, onForget, disabled }) {
      const [pending, setPending] = useState(null)
      const panelRef = useRef(null)

      useEffect(() => {
        if (pending && panelRef.current) panelRef.current.focus()
      }, [pending])

      if (items.length === 0) return null

      if (pending) {
        return h(
          'div',
          {
            className: 'lw-recent lw-recent-confirm',
            role: 'alertdialog',
            tabIndex: -1,
            ref: panelRef,
            'aria-label': t('recent.confirmTitle').replace('%s', pending.name),
            onKeyDown: (event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                setPending(null)
              }
            },
          },
          h(
            'div',
            { className: 'lw-confirm-copy' },
            h('div', { className: 'lw-confirm-title' }, t('recent.confirmTitle').replace('%s', pending.name)),
            h('div', { className: 'lw-confirm-body' }, `${t('recent.confirmBody')}`),
          ),
          h(
            'div',
            { className: 'lw-confirm-actions' },
            h('button', {
              type: 'button',
              className: 'lw-btn is-sm',
              onClick: () => setPending(null),
            }, t('recent.cancel')),
            h('button', {
              type: 'button',
              className: 'lw-btn is-sm is-danger',
              onClick: () => {
                onForget(pending)
                setPending(null)
              },
            }, t('recent.remove')),
          ),
        )
      }

      const visible = items.slice(0, 3)
      return h(
        'div',
        { className: 'lw-recent' },
        h('div', { className: 'lw-recent-label' }, t('recent.title')),
        h(
          'div',
          { className: 'lw-recent-list' },
          visible.flatMap((item, index) => {
            const date = item.at ? new Date(item.at).toLocaleDateString('zh-CN') : ''
            const row = h(
              'div',
              { key: item.url, className: 'lw-recent-item' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'lw-recent-open',
                  disabled: Boolean(disabled),
                  title: date ? `${item.name} · ${date}` : item.name,
                  onClick: () => onOpen(item),
                },
                h(Icon, { name: 'table', size: 12, className: 'lw-recent-ico' }),
                h('span', { className: 'lw-recent-name' }, item.name),
              ),
              h('button', {
                type: 'button',
                className: 'lw-recent-del',
                'aria-label': `${t('recent.delete')} ${item.name}`,
                title: t('recent.delete'),
                onClick: () => setPending(item),
              }, '×'),
            )
            return [row]
          }),
        ),
      )
    }

    // ── Connection gate ────────────────────────────────────────────────────

    function ConnectGate({ health, t, onRecheck }) {
      const stage = (health.stage === 'ready' && (!health.auth || !health.auth.userReady)) ? 'no-auth' : health.stage
      const current = stage === 'no-cli' ? 0 : stage === 'no-app' ? 1 : 2
      const [busy, setBusy] = useState(false)
      const [waited, setWaited] = useState(0)
      const [error, setError] = useState(null)
      const [link, setLink] = useState(null)
      const [deviceCode, setDeviceCode] = useState(null)
      const [copied, setCopied] = useState(false)
      const [showTeam, setShowTeam] = useState(false)
      const [teamId, setTeamId] = useState('')
      const [teamSecret, setTeamSecret] = useState('')
      const [autoChecking, setAutoChecking] = useState(false)

      useEffect(() => {
        if (!busy) {
          setWaited(0)
          return undefined
        }
        const startedAt = Date.now()
        const timer = setInterval(() => setWaited(Math.round((Date.now() - startedAt) / 1000)), 500)
        return () => clearInterval(timer)
      }, [busy])

      // 自动静默探活：Step 2 应用配置与 Step 3 用户授权自动感知并平滑推进下一步
      useEffect(() => {
        let active = true
        let timer = null

        const pollLoop = async () => {
          if (!active) return

          if (stage === 'no-app' && link) {
            try {
              const poll = await authFetch(`${API}/connect/app/poll`).then((r) => r.json()).catch(() => null)
              if (active && poll && poll.done) {
                onRecheck()
                return
              }
              const st = await authFetch(`${API}/state`).then((r) => r.json()).catch(() => null)
              if (active && st && st.app && st.app.ready) {
                onRecheck()
                return
              }
            } catch {}
          }

          if (stage === 'no-auth' && (link || deviceCode)) {
            try {
              const st = await authFetch(`${API}/state`).then((r) => r.json()).catch(() => null)
              if (active && st && st.stage === 'ready' && st.auth && st.auth.userReady) {
                onRecheck()
                return
              }
              const loginState = await authFetch(`${API}/connect/login/state`).then((r) => r.json()).catch(() => null)
              if (active && loginState && loginState.done && loginState.ok) {
                onRecheck()
                return
              }
            } catch {}
          }

          if (active) {
            timer = setTimeout(pollLoop, 1200)
          }
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

      const copyInstall = useCallback(() => {
        const command = health.installCommand || 'npm i -g @larksuite/cli'
        const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
        if (clipboard && clipboard.writeText) {
          clipboard.writeText(command).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          }).catch(() => {})
        }
      }, [health.installCommand])

      const openApp = useCallback(async () => {
        setBusy(true)
        setError(null)
        try {
          const payload = await post('/connect/app/start')
          if (payload.ok && payload.url) {
            setLink(payload.url)
            window.open(payload.url, '_blank', 'noopener')
          } else {
            setError(humanize(payload.message) || '页面没打开，再点一次试试')
          }
        } catch (failure) {
          setError(String(failure))
        } finally {
          setBusy(false)
        }
      }, [post])

      const startAuth = useCallback(async () => {
        setBusy(true)
        setError(null)
        try {
          const payload = await post('/connect/login/start')
          if (payload.ok && payload.url) {
            setLink(payload.url)
            setDeviceCode(payload.deviceCode)
            window.open(payload.url, '_blank', 'noopener')
          } else {
            setError(humanize(payload.message) || '没能拿到授权链接，再点一次')
          }
        } catch (failure) {
          setError(String(failure))
        } finally {
          setBusy(false)
        }
      }, [post])

      const finishAuth = useCallback(async () => {
        setBusy(true)
        setError(null)
        try {
          const curState = await authFetch(`${API}/state`).then((r) => r.json()).catch(() => null)
          if (curState && curState.stage === 'ready' && curState.auth && curState.auth.userReady) {
            onRecheck()
            return
          }
          const payload = await post('/connect/login/finish', { deviceCode })
          if (payload.ok) {
            onRecheck()
            return
          }
          const afterState = await authFetch(`${API}/state`).then((r) => r.json()).catch(() => null)
          if (afterState && afterState.stage === 'ready' && afterState.auth && afterState.auth.userReady) {
            onRecheck()
            return
          }
          const text = String(payload.message || '')
          if (/expired|过期|invalid|失效/i.test(text) && /device|code|授权/i.test(text)) {
            setDeviceCode(null)
            setError(humanize(text))
            await startAuth()
            return
          }
          if (payload.pending) {
            const deadline = Date.now() + 20000
            let poll = 0
            while (Date.now() < deadline) {
              const waitMs = poll < 4 ? 400 : 1200
              await new Promise((resolve) => setTimeout(resolve, waitMs))
              poll++
              const state = await authFetch(`${API}/connect/login/state`).then((r) => r.json()).catch(() => null)
              if (state && state.ok) {
                onRecheck()
                return
              }
              if (state && state.done && !state.ok) {
                setError(humanize(state.message || t('gate.pending')))
                return
              }
            }
            setError(t('gate.pending'))
            return
          }
          setError(humanize(text || '授权还没完成'))
        } catch (failure) {
          setError(String(failure))
        } finally {
          setBusy(false)
        }
      }, [deviceCode, onRecheck, post, startAuth, t])

      const saveTeam = useCallback(async () => {
        setBusy(true)
        setError(null)
        try {
          const payload = await post('/connect/app/manual', { appId: teamId, appSecret: teamSecret })
          if (payload.ok) {
            setTeamSecret('')
            onRecheck()
          } else {
            setError(humanize(payload.message || '没保存成功，检查两个值有没有复制全'))
          }
        } catch (failure) {
          setError(String(failure))
        } finally {
          setBusy(false)
        }
      }, [teamId, teamSecret, onRecheck, post])

      const title = stage === 'no-cli' ? t('gate.noTool.title') : stage === 'no-app' ? t('gate.noApp.title') : t('gate.noAuth.title')
      const bodyText = stage === 'no-cli' ? t('gate.noTool.body') : stage === 'no-app' ? t('gate.noApp.body') : t('gate.noAuth.body')

      const actions = []
      if (stage === 'no-cli') {
        actions.push(h(Button, { key: 'check', variant: 'primary', onClick: onRecheck }, t('gate.noTool.done')))
      } else if (stage === 'no-app') {
        actions.push(h(Button, { key: 'open', variant: 'primary', disabled: busy, onClick: openApp }, busy ? `${t('gate.waiting')}…` : t('gate.noApp.cta')))
        actions.push(h(Button, { key: 'done', disabled: busy, onClick: onRecheck }, t('gate.noApp.done')))
        if (link) actions.push(h(Button, { key: 'reopen', variant: 'ghost', onClick: () => window.open(link, '_blank', 'noopener') }, t('gate.noApp.reopen')))
      } else {
        actions.push(
          h(
            Button,
            { key: 'auth', variant: 'primary', disabled: busy, onClick: startAuth },
            busy
              ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } }, h(Icon, { name: 'refresh', size: 13, className: 'lw-spin' }), '正在确认…')
              : t('gate.noAuth.cta'),
          ),
        )
        actions.push(
          h(
            Button,
            { key: 'finish', disabled: busy || !deviceCode, onClick: finishAuth },
            busy
              ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } }, h(Icon, { name: 'refresh', size: 13, className: 'lw-spin' }), '正在确认…')
              : t('gate.noAuth.done'),
          ),
        )
        if (link) actions.push(h(Button, { key: 'reopen', variant: 'ghost', onClick: () => window.open(link, '_blank', 'noopener') }, t('gate.noAuth.reopen')))
      }

      return h(
        'section',
        { className: 'lw-card', 'aria-labelledby': 'lw-gate-title' },
        h(Steps, { labels: [t('gate.step.tool'), t('gate.step.app'), t('gate.step.auth')], current }),
        h(
          'div',
          { className: 'lw-sect' },
          h('h2', { className: 'lw-h lw-h-lg', id: 'lw-gate-title' }, title),
          h('p', { className: 'lw-p' }, bodyText),
        ),
        stage === 'no-cli'
          ? h(
              'div',
              { className: 'lw-cmd' },
              h('code', null, health.installCommand || 'npm i -g @larksuite/cli'),
              h(Button, { size: 'sm', onClick: copyInstall }, copied ? t('gate.noTool.copied') : t('gate.noTool.copy')),
            )
          : null,
        link ? h('a', { className: 'lw-url', href: link, target: '_blank', rel: 'noreferrer' }, link) : null,
        h('div', { className: 'lw-actions' }, actions),
        autoChecking
          ? h(
              'div',
              {
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  color: 'var(--lw-ink-3)',
                  marginTop: 4,
                  padding: '4px 2px',
                },
              },
              h(Icon, { name: 'refresh', size: 12, className: 'lw-spin' }),
              t('gate.autoChecking'),
            )
          : null,
        busy ? h(Heartbeat, { t, seconds: waited }) : null,
        error
          ? h(Banner, {
              tone: 'error',
              title: t('error.title'),
              children: error,
              action: h(Button, { variant: 'ghost', size: 'sm', onClick: () => (stage === 'no-auth' ? finishAuth() : onRecheck()) }, t('error.retry')),
            })
          : null,
        stage === 'no-app'
          ? h(
              'div',
              { className: 'lw-field', style: { borderTop: '1px solid var(--lw-line)', paddingTop: 14 } },
              h(Button, { variant: 'link', onClick: () => setShowTeam((value) => !value), 'aria-expanded': showTeam }, showTeam ? t('gate.team.hide') : t('gate.team.toggle')),
              showTeam
                ? h(
                    'div',
                    { className: 'lw-field' },
                    h('p', { className: 'lw-p' }, t('gate.team.body')),
                    h('input', {
                      className: 'lw-input', type: 'text', autoComplete: 'off', spellCheck: false,
                      placeholder: t('gate.team.appId'), value: teamId,
                      onChange: (event) => setTeamId(event.currentTarget.value),
                    }),
                    h('input', {
                      className: 'lw-input', type: 'password', autoComplete: 'off',
                      placeholder: t('gate.team.secret'), value: teamSecret,
                      onChange: (event) => setTeamSecret(event.currentTarget.value),
                    }),
                    h('div', { className: 'lw-actions' },
                      h(Button, { disabled: busy || !teamId.trim() || !teamSecret.trim(), onClick: saveTeam }, t('gate.team.save'))),
                  )
                : null,
            )
          : null,
        stage === 'no-cli' ? h('p', { className: 'lw-meta' }, t('gate.noTool.hint')) : null,
        stage === 'no-auth' ? h('p', { className: 'lw-meta' }, t('gate.noAuth.hint')) : null,
      )
    }

    // ── Native Webview (Direct In-Panel Browser) ──────────────────────────
    function NativeWebview({ url }) {
      const containerRef = useRef(null)
      const webviewInstanceRef = useRef(null)
      const leaseRef = useRef(null)
      const loadedUrlRef = useRef('')
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState(null)

      useEffect(() => {
        const container = containerRef.current
        if (!container || !url) return

        // 核心防抖：如果已经加载过完全相同的 URL，绝不重复销毁与重建 webview！
        if (webviewInstanceRef.current && loadedUrlRef.current === url) {
          return
        }

        let disposed = false

        async function initWebview() {
          // 如果 webview 已经存在，只是 URL 改变，直接进行页面导航，无需重建 DOM 节点
          if (webviewInstanceRef.current) {
            loadedUrlRef.current = url
            setLoading(true)
            setError(null)
            try {
              if (typeof webviewInstanceRef.current.loadURL === 'function') {
                webviewInstanceRef.current.loadURL(url)
              } else {
                webviewInstanceRef.current.src = url
              }
            } catch (err) {
              webviewInstanceRef.current.src = url
            }
            return
          }

          setLoading(true)
          setError(null)
          loadedUrlRef.current = url

          const desktop = window.dshDesktop && window.dshDesktop.browser
          if (!desktop || typeof desktop.acquire !== 'function') {
            const iframe = document.createElement('iframe')
            iframe.src = url
            iframe.style.cssText = 'width:100%;height:100%;border:none;flex:1;'
            iframe.onload = () => { if (!disposed) setLoading(false) }
            iframe.onerror = (e) => { if (!disposed) setError('iframe 加载异常') }
            container.innerHTML = ''
            container.appendChild(iframe)
            webviewInstanceRef.current = iframe
            return
          }

          try {
            const reservation = await desktop.acquire('workspace:lark')
            if (disposed) {
              desktop.release(reservation.lease).catch(() => {})
              return
            }
            leaseRef.current = reservation.lease

            const webview = document.createElement('webview')
            webview.style.cssText = 'width:100%;height:100%;border:none;flex:1 1 auto;min-width:0;min-height:0;display:flex;'
            webview.dataset.sidebarBrowserFrame = 'webview'
            webview.setAttribute('name', reservation.lease)
            webview.setAttribute('partition', reservation.partition)
            webview.setAttribute('allowpopups', '')
            webview.setAttribute('src', 'about:blank#' + reservation.lease)

            let loaded = false
            webview.addEventListener('dom-ready', () => {
              if (disposed) return
              if (!loaded) {
                loaded = true
                webview.loadURL(url)
              }
            })

            webview.addEventListener('did-fail-load', (e) => {
              if (disposed) return
              if (e.errorCode !== -3) { // 忽略中止错误
                setError(`加载失败: ${e.errorDescription || e.errorCode}`)
              }
            })

            if (typeof desktop.onOpenRequested === 'function') {
              const unsub = desktop.onOpenRequested(reservation.lease, (openUrl) => {
                window.open(openUrl, '_blank', 'noopener')
              })
              webview.addEventListener('destroyed', unsub, { once: true })
            }

            container.innerHTML = ''
            container.appendChild(webview)
            webviewInstanceRef.current = webview
          } catch (err) {
            console.error('NativeWebview error:', err)
            if (!disposed) {
              setError(String((err && err.message) || err))
            }
          }
        }

        initWebview()

        return () => {
          disposed = true
        }
      }, [url])

      return h(
        'div',
        {
          style: {
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            flex: '1 1 auto',
            minWidth: 0,
            minHeight: 0,
            position: 'relative',
            background: '#ffffff',
          },
        },
        error
          ? h(
              'div',
              {
                style: {
                  padding: '16px',
                  color: 'var(--lw-bad)',
                  fontSize: '13px',
                  background: 'var(--lw-surface)',
                },
              },
              `飞书多维表格加载异常：${error}`,
            )
          : null,
        h('div', {
          ref: containerRef,
          style: {
            width: '100%',
            height: '100%',
            display: 'flex',
            flex: '1 1 auto',
            minWidth: 0,
            minHeight: 0,
          },
        }),
      )
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
          parts.push(renderTextFormatting(text.slice(lastIndex, match.index), key++))
        }
        parts.push(h('code', { key: `c-${key++}`, className: 'lw-inline-code' }, match[1]))
        lastIndex = match.index + match[0].length
      }
      if (lastIndex < text.length) {
        parts.push(renderTextFormatting(text.slice(lastIndex), key++))
      }
      return parts
    }

    function renderTextFormatting(text, keyPrefix) {
      const boldRegex = /\*\*([^*]+)\*\*/g
      const elements = []
      let lastIdx = 0
      let m
      let k = 0
      while ((m = boldRegex.exec(text)) !== null) {
        if (m.index > lastIdx) {
          elements.push(text.slice(lastIdx, m.index))
        }
        elements.push(h('strong', { key: `${keyPrefix}-b-${k++}`, style: { fontWeight: 600 } }, m[1]))
        lastIdx = m.index + m[0].length
      }
      if (lastIdx < text.length) {
        elements.push(text.slice(lastIdx))
      }
      return elements
    }

    function renderMarkdownContent(rawText) {
      if (!rawText) return null
      const lines = rawText.split('\n')
      const blocks = []
      let i = 0

      while (i < lines.length) {
        const line = lines[i]

        // 1. Markdown Table detection
        if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?[\s-:]+\|[\s-:]*\|?/.test(lines[i + 1])) {
          const tableLines = []
          while (i < lines.length && lines[i].trim().startsWith('|')) {
            tableLines.push(lines[i].trim())
            i++
          }
          if (tableLines.length >= 2) {
            const rawHeader = tableLines[0].split('|').map((s) => s.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
            const rawRows = tableLines.slice(2).map((rowLine) => {
              return rowLine.split('|').map((s) => s.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
            })

            blocks.push(
              h('div', { key: `tbl-${blocks.length}`, className: 'lw-md-table-wrap' }, [
                h('table', { className: 'lw-md-table' }, [
                  h('thead', null, [
                    h('tr', null, rawHeader.map((th, thIdx) => h('th', { key: thIdx }, renderInlineMarkdown(th)))),
                  ]),
                  h('tbody', null, rawRows.map((tr, trIdx) => h(
                    'tr',
                    { key: trIdx },
                    tr.map((td, tdIdx) => h('td', { key: tdIdx }, renderInlineMarkdown(td))),
                  ))),
                ]),
              ]),
            )
            continue
          }
        }

        // 2. Code Block
        if (line.trim().startsWith('```')) {
          const codeLines = []
          i++
          while (i < lines.length && !lines[i].trim().startsWith('```')) {
            codeLines.push(lines[i])
            i++
          }
          i++
          blocks.push(
            h('pre', { key: `code-${blocks.length}`, className: 'lw-md-code' }, codeLines.join('\n')),
          )
          continue
        }

        // 3. Unordered List (- or *)
        if (/^[-*]\s+/.test(line.trim())) {
          const listItems = []
          while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
            listItems.push(lines[i].trim().replace(/^[-*]\s+/, ''))
            i++
          }
          blocks.push(
            h('ul', { key: `ul-${blocks.length}`, className: 'lw-md-ul' },
              listItems.map((itemText, idx) =>
                h('li', { key: idx, className: 'lw-md-li' }, renderInlineMarkdown(itemText))
              )
            )
          )
          continue
        }

        // 4. Ordered List (1. 2.)
        if (/^\d+\.\s+/.test(line.trim())) {
          const listItems = []
          while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
            listItems.push(lines[i].trim().replace(/^\d+\.\s+/, ''))
            i++
          }
          blocks.push(
            h('ol', { key: `ol-${blocks.length}`, className: 'lw-md-ol' },
              listItems.map((itemText, idx) =>
                h('li', { key: idx, className: 'lw-md-li' }, renderInlineMarkdown(itemText))
              )
            )
          )
          continue
        }

        // 5. Headings (# ## ###)
        const hMatch = line.trim().match(/^(#{1,4})\s+(.*)$/)
        if (hMatch) {
          const level = hMatch[1].length
          const hText = hMatch[2]
          i++
          blocks.push(
            h(`h${level === 1 ? 3 : (level === 2 ? 4 : 5)}`, {
              key: `h-${blocks.length}`,
              style: { fontWeight: 600, margin: '8px 0 4px', fontSize: level === 1 ? '15px' : (level === 2 ? '14px' : '13px'), color: 'var(--lw-ink)' },
            }, renderInlineMarkdown(hText)),
          )
          continue
        }

        // 6. Regular Paragraph
        if (line.trim() !== '') {
          const pLines = [line]
          i++
          while (
            i < lines.length &&
            lines[i].trim() !== '' &&
            !lines[i].trim().startsWith('|') &&
            !lines[i].trim().startsWith('```') &&
            !/^[-*]\s+/.test(lines[i].trim()) &&
            !/^\d+\.\s+/.test(lines[i].trim()) &&
            !/^(#{1,4})\s+/.test(lines[i].trim())
          ) {
            pLines.push(lines[i])
            i++
          }
          blocks.push(
            h(
              'div',
              { key: `p-${blocks.length}`, style: { margin: '5px 0', lineHeight: 1.6 } },
              pLines.map((pl, plIdx) => h('div', { key: plIdx }, renderInlineMarkdown(pl))),
            ),
          )
          continue
        }

        i++
      }

      return blocks
    }

    function AssistantBubble({ msg, modelName }) {
      const [thinkingOpen, setThinkingOpen] = useState(false)

      let reasoning = msg.reasoning || ''
      let cleanText = msg.text || ''

      const thinkMatch = cleanText.match(/<think>([\s\S]*?)<\/think>/i)
      if (thinkMatch) {
        reasoning = (reasoning ? reasoning + '\n' : '') + thinkMatch[1].trim()
        cleanText = cleanText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
      }

      if (!reasoning && /我们需要|用户要求|思路：|分析：|思考：|Let me think/i.test(cleanText)) {
        const tableIndex = cleanText.indexOf('|')
        const introIndex = cleanText.indexOf('以下')
        const splitIndex = introIndex !== -1 && (tableIndex === -1 || introIndex < tableIndex) ? introIndex : tableIndex
        if (splitIndex > 0) {
          reasoning = cleanText.slice(0, splitIndex).trim()
          cleanText = cleanText.slice(splitIndex).trim()
        }
      }

      return h(
        'div',
        {
          className: `lw-msg lw-msg-ai${msg.error ? ' is-error' : msg.warn ? ' is-warn' : ''}`,
          style: { marginBottom: 14, maxWidth: '96%' },
        },
        h('div', { className: 'lw-msg-role' }, modelName),
        h(
          'div',
          { className: 'lw-msg-text' },
          [
            reasoning
              ? h('div', { key: 'reasoning-block', style: { marginBottom: 6 } }, [
                  h(
                    'div',
                    {
                      className: 'lw-thinking-toggle',
                      onClick: () => setThinkingOpen(!thinkingOpen),
                      title: '点击展开/折叠思考过程',
                    },
                    [
                      h(
                        'svg',
                        {
                          width: 13,
                          height: 13,
                          viewBox: '0 0 24 24',
                          fill: 'none',
                          stroke: 'currentColor',
                          strokeWidth: 2,
                          strokeLinecap: 'round',
                          strokeLinejoin: 'round',
                        },
                        [
                          h('path', { d: 'M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7z' }),
                          h('path', { d: 'M9 21h6' }),
                        ],
                      ),
                      h('span', null, '已深度思考'),
                      h(
                        'svg',
                        {
                          width: 11,
                          height: 11,
                          viewBox: '0 0 24 24',
                          fill: 'none',
                          stroke: 'currentColor',
                          strokeWidth: 2,
                          style: { transform: thinkingOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' },
                        },
                        h('polyline', { points: '9 18 15 12 9 6' }),
                      ),
                    ],
                  ),
                  thinkingOpen
                    ? h('div', { className: 'lw-thinking-content' }, reasoning)
                    : null,
                ])
              : null,
            h('div', { key: 'body-content' }, renderMarkdownContent(cleanText)),
          ],
        ),
      )
    }

    // ── Panel ──────────────────────────────────────────────────────────────

    function Workbench(props) {
      if (props) {
        const resolved = resolveDshSessionId(props, props.ctx)
        if (resolved) currentDshSessionId = resolved
      }
      const t = useMemo(() => translator(props), [props.t])
      const theme = useHostTheme()
      const [stage, setStage] = useState('pick')
      const [sentence, setSentence] = useState('')
      const [tweakText, setTweakText] = useState('')
      const [adjustText, setAdjustText] = useState('')
      const [adjustNote, setAdjustNote] = useState(null)
      const [adjustWarn, setAdjustWarn] = useState(false)
      const [adjustError, setAdjustError] = useState(null)
      const [liveReasoning, setLiveReasoning] = useState('')
      const [confirmPlan, setConfirmPlan] = useState(null)
      const [history, setHistory] = useState([])
      const [syncingAuth, setSyncingAuth] = useState(false)
      const authAbortRef = useRef(null)
      const [tableOpen, setTableOpen] = useState(() => {
        try {
          const v = window.localStorage.getItem('dsh-lark-table-open')
          if (v === 'false') return false
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
          if (!isNaN(v) && v >= 300 && v <= 1400) return v
        } catch {}
        return 460
      })
      const [isResizing, setIsResizing] = useState(false)
      const splitWidthRef = useRef(splitWidth)
      splitWidthRef.current = splitWidth

      const startResize = useCallback((e) => {
        e.preventDefault()
        setIsResizing(true)
        const startX = e.clientX
        const initialWidth = splitWidthRef.current

        const onMouseMove = (moveEvent) => {
          const deltaX = moveEvent.clientX - startX
          const minW = 320
          const maxW = Math.max(minW, (window.innerWidth || 1200) - 340)
          const newWidth = Math.min(Math.max(initialWidth + deltaX, minW), maxW)
          setSplitWidth(newWidth)
          try { window.localStorage.setItem('dsh-lark-split-width', String(newWidth)) } catch {}
        }

        const onMouseUp = () => {
          setIsResizing(false)
          window.removeEventListener('mousemove', onMouseMove)
          window.removeEventListener('mouseup', onMouseUp)
        }

        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup', onMouseUp)
      }, [])

      const resetSplitWidth = useCallback(() => {
        setSplitWidth(460)
        try { window.localStorage.setItem('dsh-lark-split-width', '460') } catch {}
      }, [])
      const adjustInputRef = useRef(null)
      const chatEndRef = useRef(null)
      const chatStreamRef = useRef(null)
      const webviewRef = useRef(null)
      const focusAdjustRef = useRef(false)
      const [showDetails, setShowDetails] = useState(false)
      const [plan, setPlan] = useState(null)
      const [result, setResult] = useState(null)
      const [busy, setBusy] = useState(null)
      const [error, setError] = useState(null)
      const [health, setHealth] = useState(null)
      const [recent, setRecent] = useState(readRecent)
      const [active, setActive] = useState(null)
      const [live, setLive] = useState(null)
      const [copiedUrl, setCopiedUrl] = useState(false)
      const [copiedView, setCopiedView] = useState(false)
      // Where the real Base went: null = never asked, 'sidebar' | 'window' = open.
      const [realState, setRealState] = useState(null)
      // A hand-off the host refused: shown instead of silently opening Chrome.
      const [realError, setRealError] = useState(null)
      const [openingReal, setOpeningReal] = useState(false)
      const openedReal = useRef(new Set())
      const realTable = props.realTable
      const hostReady = Boolean(realTable && realTable.available())
      const [samplesOpen, setSamplesOpen] = useState(!hostReady)
      const alive = useRef(true)

      const [models, setModels] = useState([])
      const [selectedModel, setSelectedModel] = useState(() => {
        try {
          const saved = JSON.parse(window.localStorage.getItem('dsh-lark-model') || 'null')
          return saved || null
        } catch {
          return null
        }
      })

      const modelKey = useCallback((m) => (m ? `${m.provider || ''}:${m.id || ''}` : ''), [])

      useEffect(() => {
        let isMount = true
        authFetch(`${API}/models`)
          .then((r) => r.json())
          .then((data) => {
            if (isMount && data && data.ok && Array.isArray(data.models) && data.models.length > 0) {
              setModels(data.models)
              try {
                const saved = JSON.parse(window.localStorage.getItem('dsh-lark-model') || 'null')
                if (saved) {
                  const matched = data.models.find((m) => (m.provider === saved.provider && m.id === saved.id) || m.id === saved.id)
                  if (matched) {
                    setSelectedModel(matched)
                    return
                  }
                }
              } catch {}
              if (data.current) {
                const matched = data.models.find((m) => (m.provider === data.current.provider && m.id === data.current.model) || m.id === data.current.model)
                if (matched) {
                  setSelectedModel(matched)
                  return
                }
              }
              setSelectedModel(data.models[0])
            }
          })
          .catch(() => {})
        return () => { isMount = false }
      }, [])

      const changeModel = useCallback((targetKey) => {
        const found = models.find((m) => modelKey(m) === targetKey || m.id === targetKey)
        if (found) {
          setSelectedModel(found)
          try {
            window.localStorage.setItem('dsh-lark-model', JSON.stringify(found))
          } catch {}
        }
      }, [models, modelKey])

      const openRealTable = useCallback(async (url, options = {}) => {
        if (!url) return
        if (!realTable) {
          window.open(url, '_blank', 'noopener')
          setRealState('window')
          return
        }
        setOpeningReal(true)
        try {
          const outcome = await realTable.open(url, { navigate: options.navigate !== false })
          if (!alive.current) return
          if (outcome.mode === 'sidebar') {
            openedReal.current.add(url)
            setRealError(null)
            setRealState('sidebar')
            return
          }
          if (outcome.mode === 'no-session') {
            if (!options.silent) setRealError(t('view.noSession'))
            return
          }
          if (outcome.mode === 'error') {
            setRealState(null)
            setRealError(outcome.message || t('view.openFailed'))
            return
          }
          // The host has no docked browser: an explicit external open, never a silent one.
          window.open(url, '_blank', 'noopener')
          setRealState('window')
        } finally {
          if (alive.current) setOpeningReal(false)
        }
      }, [realTable, t])

      /**
       * The table is the source of truth: show it once, then leave the tab alone.
       * Automatic hand-off never switches the panel under the user; only an
       * explicit click may bring the conversation forward to host the tab.
       */
      const autoOpenRealTable = useCallback(() => {}, [])

      useEffect(() => {
        if (realTable && typeof realTable.closeSidebarBrowserTabs === 'function') {
          realTable.closeSidebarBrowserTabs(props.sessionId)
        }
      }, [props.sessionId, realTable])

      const lastSyncedActiveRef = useRef(null)

      const refreshHealth = useCallback(async () => {
        try {
          const payload = await authFetch(`${API}/state`).then((response) => response.json())
          if (alive.current) {
            setHealth(payload)
            setError(null)
            if (payload && payload.active && payload.active.updatedAt) {
              const incoming = payload.active
              if (!lastSyncedActiveRef.current || incoming.updatedAt > (lastSyncedActiveRef.current.updatedAt || 0)) {
                lastSyncedActiveRef.current = incoming
                if (incoming.preview && incoming.plan) {
                  setPlan(incoming.plan)
                  setStage('preview')
                } else if (incoming.url) {
                  setActive(incoming)
                  setStage('view')
                  try {
                    const existing = readRecent()
                    const next = [incoming, ...existing.filter((e) => e.url !== incoming.url)].slice(0, 8)
                    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
                    setRecent(next)
                  } catch {}
                }
              }
            }
          }
        } catch {
          if (alive.current) setHealth({ stage: 'unknown' })
        }
      }, [])

      useEffect(() => {
        alive.current = true
        refreshHealth()
        const timer = setInterval(() => {
          if (alive.current) refreshHealth()
        }, 3000)
        return () => {
          alive.current = false
          clearInterval(timer)
        }
      }, [refreshHealth])

      // Coming straight from the success card: leave the cursor where the next
      // sentence goes, the same way the composer starts a table.
      useEffect(() => {
        if (stage === 'view' && live && live.ok && focusAdjustRef.current) {
          focusAdjustRef.current = false
          adjustInputRef.current?.focus()
        }
      }, [stage, live])

      useEffect(() => {
        if (stage === 'view' && chatStreamRef.current) {
          chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight
        }
      }, [stage, history, busy, liveReasoning])

      // Hide host conversation bottom composer when Workbench is active in conversation
      useEffect(() => {
        const findAndHide = () => {
          const seats = document.querySelectorAll(
            '[data-composer-seat], [data-conversation-region="composer"], [class*="composerSeat"], [class*="composerStack"]'
          )
          seats.forEach((seat) => {
            if (seat && !seat.dataset.lwHidden) {
              seat.dataset.lwHidden = 'true'
              seat.style.setProperty('display', 'none', 'important')
            }
          })
        }
        findAndHide()
        const timer = setInterval(findAndHide, 250)
        return () => {
          clearInterval(timer)
          const seats = document.querySelectorAll(
            '[data-composer-seat], [data-conversation-region="composer"], [class*="composerSeat"], [class*="composerStack"]'
          )
          seats.forEach((seat) => {
            if (seat && seat.dataset.lwHidden === 'true') {
              delete seat.dataset.lwHidden
              seat.style.removeProperty('display')
            }
          })
        }
      }, [])

      const connected = Boolean(health && health.stage === 'ready' && health.auth && health.auth.userReady)
      const toolOk = !health || !health.cli || health.cli.available !== false

      const post = useCallback(async (path, body) => {
        const response = await authFetch(`${API}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        return response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
      }, [])

      const build = useCallback(async () => {
        if (!plan || busy) return
        setBusy('build')
        setError(null)
        try {
          const payload = await post('/build', { plan, kanban: true, sample: true })
          if (!alive.current) return
          if (payload.ok) {
            setResult(payload)
            setCopiedUrl(false)
            const item = {
              name: payload.baseName,
              url: payload.url,
              at: Date.now(),
              token: payload.token,
              table: payload.tables && payload.tables[0] ? payload.tables[0].name : undefined,
            }
            setRecent(rememberRecent(item))
            setActive(item)
            setStage('view')
            setAdjustNote('表格已在飞书生成！可以在下方输入一句话继续调整。')
          } else {
            setError(payload.message || payload.error || t('error.title'))
          }
        } catch (failure) {
          if (alive.current) setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          if (alive.current) setBusy(null)
        }
      }, [plan, busy, post, t, autoOpenRealTable])

      const restart = useCallback(() => {
        setStage('pick')
        setPlan(null)
        setResult(null)
        setActive(null)
        setLive(null)
        setError(null)
        setHistory([])
        setSentence('')
        setTweakText('')
        setAdjustText('')
        setAdjustNote(null)
        setAdjustWarn(false)
        setAdjustError(null)
        setConfirmPlan(null)
        setShowDetails(false)
        setCopiedUrl(false)
        setCopiedView(false)
      }, [])

      /** Reopen a table that was created earlier: read its live data through
       *  the same CLI that built it, so the panel is a workspace, not a dead end. */
      const openRecent = useCallback(async (item) => {
        if (!item || busy) return
        const token = item.token || baseTokenFrom(item.url)
        setActive(item)
        setStage('view')
        setLive({ loading: true })
        setError(null)
        setHistory([])
        setAdjustText('')
        setAdjustNote(null)
        setAdjustWarn(false)
        setAdjustError(null)
        setConfirmPlan(null)
        if (!token) {
          setLive({ ok: false, message: t('view.noToken') })
          return
        }
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 15000)
        try {
          const query = new URLSearchParams({ token, limit: '12' })
          if (item.table) query.set('table', item.table)
          const payload = await authFetch(`${API}/records?${query.toString()}`, { signal: controller.signal })
            .then((response) => response.json())
          if (!alive.current) return
          if (payload && payload.ok) {
            setLive({ ok: true, fields: payload.fields ?? [], rows: payload.rows ?? [], more: Boolean(payload.more) })
            if (payload.table && payload.table !== item.table) {
              const entries = readRecent().map((entry) => (
                entry.url === item.url ? { ...entry, table: payload.table } : entry
              ))
              try {
                window.localStorage.setItem(RECENT_KEY, JSON.stringify(entries))
              } catch {
                // ignore storage failures, the view still works
              }
              setRecent(entries)
            }
          } else {
            setLive({ ok: false, message: (payload && (payload.message || payload.error)) || t('view.error') })
          }
        } catch (failure) {
          if (alive.current) setLive({ ok: false, message: failure instanceof Error ? failure.message : String(failure) })
        } finally {
          clearTimeout(timer)
        }
      }, [busy, t, autoOpenRealTable])

      /** From the success card: reopen the same table and land in the adjust bar. */
      const continueAdjusting = useCallback(() => {
        if (!result) return
        const item = {
          name: result.baseName,
          url: result.url,
          token: result.token,
          at: Date.now(),
          table: result.tables && result.tables[0] ? result.tables[0].name : undefined,
        }
        if (item.url) setRecent(rememberRecent(item))
        focusAdjustRef.current = true
        openRecent(item)
      }, [result, openRecent])

      /** Refresh table schema & preview data in background without wiping conversation history. */
      const refreshLive = useCallback(async (item) => {
        if (!item) return
        const token = item.token || baseTokenFrom(item.url)
        if (!token) return
        try {
          const query = new URLSearchParams({ token, limit: '12' })
          if (item.table) query.set('table', item.table)
          const res = await authFetch(`${API}/records?${query}`).then((r) => r.json())
          if (alive.current && res && res.ok) {
            setLive({
              ok: true,
              fields: res.fields ?? [],
              rows: res.rows ?? [],
              more: Boolean(res.more),
            })
          }
        } catch {}
      }, [])

      /** Shared tail for "apply" and "apply after confirming a deletion". */
      const finishAdjust = useCallback(async (payload) => {
        if (!payload) {
          setAdjustError(t('error.title'))
          return
        }
        if (payload.needsConfirm) {
          setConfirmPlan({ ops: payload.ops ?? [], destructive: payload.destructive ?? [] })
          return
        }
        if (payload.type === 'missing_scope') {
          setConfirmPlan(null)
          setAdjustError(null)
          setAdjustText('')
          setHistory((prev) => [
            ...prev,
            {
              role: 'assistant',
              missingScope: true,
              domainTitle: payload.domainTitle || '飞书功能',
              requiredScopes: payload.requiredScopes || [],
              consoleUrl: payload.consoleUrl,
              text: payload.reply || payload.message || '需要开通对应权限才能继续。',
            },
          ])
          return
        }
        if (payload.type === 'table_plan' && payload.plan) {
          setConfirmPlan(null)
          setAdjustError(null)
          setAdjustText('')
          setSentence(payload.sentence || payload.plan.baseName || '')
          setPlan(payload.plan)
          setTweakText('')
          setShowDetails(false)
          setStage('preview')
          return
        }
        if (!payload.ok && !payload.summary && !payload.reply) {
          setAdjustError(payload.message || payload.error || t('error.title'))
          return
        }
        setConfirmPlan(null)
        setAdjustText('')
        setAdjustWarn(payload.ok === false)
        const replyText = payload.reply || payload.summary || t('view.adjustDone')
        setAdjustNote(replyText)
        setHistory((prev) => [
          ...prev,
          {
            role: 'assistant',
            text: replyText,
            reasoning: payload.reasoning || null,
            warn: payload.ok === false,
          },
        ])

        // Only update local table preview data if there were actual table mutations.
        // Feishu webview natively syncs via collaborative WebSocket, so we never reload the full webview page.
        if (payload.type !== 'answer' && payload.type !== 'collab' && payload.type !== 'suggest_table') {
          if (payload.live && payload.live.ok) {
            setLive({
              ok: true,
              fields: payload.live.fields ?? [],
              rows: payload.live.rows ?? [],
              more: Boolean(payload.live.more),
            })
            if (payload.live.table && active && payload.live.table !== active.table) {
              const next = { ...active, table: payload.live.table }
              setActive(next)
              const entries = readRecent().map((entry) => (
                entry.url === next.url ? { ...entry, table: next.table } : entry
              ))
              try {
                window.localStorage.setItem(RECENT_KEY, JSON.stringify(entries))
              } catch {}
              setRecent(entries)
            }
          } else {
            await refreshLive(active)
          }
        }
      }, [active, refreshLive, t])

      const openCollab = useCallback((initialPrompt) => {
        const item = { type: 'collab', name: '飞书协同助手' }
        setActive(item)
        setStage('view')
        setHistory([])
        setAdjustText(initialPrompt || '')
        setAdjustError(null)
        setAdjustWarn(false)
        setConfirmPlan(null)
        setLive(null)
      }, [])

      /** A follow-up sentence changes the table in place or answers questions. */
      const applyAdjust = useCallback(async (overrideText, options = {}) => {
        if (busy) return
        const text = (typeof overrideText === 'string' ? overrideText : adjustText).trim()
        if (!text) return
        const isCollab = options.collab || (active && active.type === 'collab') || !active
        const token = (active && active.token) || (active && baseTokenFrom(active.url)) || ''
        if (!token && !isCollab) {
          setAdjustError(t('view.noToken'))
          return
        }
        if (!active || active.type !== 'collab') {
          const item = { type: 'collab', name: '飞书协同助手' }
          setActive(item)
          setStage('view')
        }
        const recentHistory = history
          .filter((msg) => msg && msg.text && !msg.error)
          .map((msg) => ({ role: msg.role === 'user' ? 'user' : 'assistant', text: msg.text }))
          .slice(-8)

        if (options.retryIndex !== undefined) {
          // Replace in-place: remove the failed card and keep existing user prompt
          setHistory((prev) => prev.filter((_, i) => i !== options.retryIndex))
        } else {
          setHistory((prev) => [...prev, { role: 'user', text }])
        }
        setAdjustText('')
        if (adjustInputRef.current) {
          adjustInputRef.current.style.height = 'auto'
        }
        setBusy('adjust')
        setLiveReasoning('')
        setAdjustError(null)
        try {
          let payload
          if (isCollab && typeof window !== 'undefined' && window.fetch) {
            const resp = await authFetch(`${API}/adjust`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                token: token || '',
                type: 'collab',
                instruction: text,
                table: (active && active.table) || '',
                history: recentHistory,
                model: selectedModel ? selectedModel.id : undefined,
                provider: selectedModel ? selectedModel.provider : undefined,
                stream: true,
              }),
            })
            const contentType = resp.headers.get('content-type') || ''
            if (contentType.includes('text/event-stream') && resp.body) {
              const reader = resp.body.getReader()
              const decoder = new TextDecoder()
              let buf = ''
              while (true) {
                const { done, value } = await reader.read()
                if (done) {
                  if (buf.trim()) {
                    const lines = buf.split('\n')
                    for (const line of lines) {
                      const trimmed = line.trim()
                      if (trimmed.startsWith('data:')) {
                        try {
                          const evt = JSON.parse(trimmed.slice(5).trim())
                          if (evt.type === 'done') payload = evt.payload
                        } catch {}
                      }
                    }
                  }
                  break
                }
                buf += decoder.decode(value, { stream: true })
                const parts = buf.split('\n\n')
                buf = parts.pop() || ''
                for (const part of parts) {
                  const lines = part.split('\n')
                  for (const line of lines) {
                    const trimmed = line.trim()
                    if (trimmed.startsWith('data:')) {
                      try {
                        const evt = JSON.parse(trimmed.slice(5).trim())
                        if (evt.type === 'reasoning') {
                          setLiveReasoning((prev) => prev + evt.delta)
                        } else if (evt.type === 'done') {
                          payload = evt.payload
                        }
                      } catch {}
                    }
                  }
                }
              }
            } else {
              payload = await resp.json().catch(() => ({ ok: false, message: `HTTP ${resp.status}` }))
            }
          } else {
            payload = await post('/adjust', {
              token: token || '',
              type: isCollab ? 'collab' : 'base',
              instruction: text,
              table: (active && active.table) || '',
              history: recentHistory,
              model: selectedModel ? selectedModel.id : undefined,
              provider: selectedModel ? selectedModel.provider : undefined,
            })
          }
          if (!alive.current) return
          if (payload) await finishAdjust(payload)
        } catch (failure) {
          const errMsg = failure instanceof Error ? failure.message : String(failure)
          if (alive.current) {
            setAdjustError(errMsg)
            setHistory((prev) => [...prev, { role: 'assistant', text: `未完成：${errMsg}`, error: true }])
          }
        } finally {
          if (alive.current) {
            setBusy(null)
            setLiveReasoning('')
          }
        }
      }, [active, adjustText, busy, finishAdjust, history, post, selectedModel, t])

      const planFor = useCallback(
        async (text) => {
          if (!text || !text.trim() || busy) return
          const s = text.trim()
          setSentence(s)
          setBusy('plan')
          setError(null)
          try {
            const payload = await post('/plan', {
              sentence: s,
              model: selectedModel ? selectedModel.id : undefined,
              provider: selectedModel ? selectedModel.provider : undefined,
            })
            if (!alive.current) return
            if (payload && payload.ok && payload.plan) {
              setPlan(payload.plan)
              setTweakText('')
              setShowDetails(false)
              setStage('preview')
              return
            }
            if (payload && payload.isNotTable) {
              // 用户输入非建表意图（如日常问候、查日程、问答），自然转入飞书协同助手
              openCollab(s)
              await applyAdjust(s, { collab: true })
              return
            }
            setError(payload?.message || payload?.error || t('error.title'))
          } catch (err) {
            if (alive.current) {
              setError(err instanceof Error ? err.message : String(err))
            }
          } finally {
            if (alive.current) {
              setBusy(null)
            }
          }
        },
        [busy, post, selectedModel, alive, openCollab, applyAdjust, t],
      )

      const refine = useCallback(
        async (extra) => {
          const clean = extra.trim()
          if (!clean || busy) return
          const base = sentence || (plan ? plan.baseName : '')
          await planFor(`${base}。另外：${clean}`)
        },
        [sentence, plan, planFor, busy],
      )

      /** The exact ops the panel just planned, replayed after the user says yes. */
      const confirmApply = useCallback(async () => {
        if (!confirmPlan || !active || busy) return
        const token = active.token || baseTokenFrom(active.url)
        if (!token) {
          setAdjustError(t('view.noToken'))
          return
        }
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

      const forgetRecent = useCallback((item) => {
        if (!item) return
        const next = readRecent().filter((entry) => entry.url !== item.url)
        try {
          window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
        } catch {
          // keep the in-memory list consistent even if storage is unavailable
        }
        setRecent(next)
      }, [])

      const copyActiveUrl = useCallback(() => {
        if (!active || !active.url) return
        const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
        if (clipboard && clipboard.writeText) {
          clipboard.writeText(active.url).then(() => {
            setCopiedView(true)
            setTimeout(() => setCopiedView(false), 1800)
          }).catch(() => {})
        }
      }, [active])

      const copyResultUrl = useCallback(() => {
        if (!result || !result.url) return
        const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
        if (clipboard && clipboard.writeText) {
          clipboard.writeText(result.url).then(() => {
            setCopiedUrl(true)
            setTimeout(() => setCopiedUrl(false), 1800)
          }).catch(() => {})
        }
      }, [result])

      const [showAccountModal, setShowAccountModal] = useState(false)
      const [busyAccount, setBusyAccount] = useState(false)
      const [accountConfirm, setAccountConfirm] = useState(null)
      const [scopesInfo, setScopesInfo] = useState(null)

      useEffect(() => {
        if (showAccountModal) {
          authFetch(`${API}/connect/scopes`)
            .then((r) => r.json())
            .then((data) => {
              if (data && data.ok) setScopesInfo(data)
            })
            .catch(() => {})
        }
      }, [showAccountModal])

      const handleLogout = useCallback(async () => {
        if (busyAccount) return
        setBusyAccount(true)
        try {
          await post('/connect/logout', {})
          setShowAccountModal(false)
          setAccountConfirm(null)
          if (stage === 'view') {
            restart()
          }
          await refreshHealth()
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusyAccount(false)
        }
      }, [busyAccount, post, stage, restart, refreshHealth])

      const handleUnbind = useCallback(async () => {
        if (busyAccount) return
        setBusyAccount(true)
        try {
          await post('/connect/unbind', {})
          setShowAccountModal(false)
          setAccountConfirm(null)
          if (stage === 'view') {
            restart()
          }
          await refreshHealth()
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusyAccount(false)
        }
      }, [busyAccount, post, stage, restart, refreshHealth])

      const statusBadge = h(
        'button',
        {
          type: 'button',
          className: 'lw-status',
          role: 'button',
          onClick: () => setShowAccountModal(true),
          title: '点击管理飞书连接、退出登录或换绑应用',
          'aria-label': '飞书连接与账号设置',
        },
        h('span', { className: `lw-dot ${!health ? 'is-busy' : health.stage === 'unknown' ? 'is-bad' : connected ? 'is-ok' : ''}` }),
        h(
          'span',
          null,
          !health
            ? t('gate.idle')
            : health.stage === 'unknown'
              ? t('status.offline')
              : connected
                ? t('status.ready')
                : t('status.setup'),
          connected && health.auth && health.auth.userName ? ` · ${health.auth.userName}` : '',
        ),
        h(Icon, { name: 'chevronDown', size: 10, style: { marginLeft: 2, opacity: 0.65 } }),
      )

      const isSubView = connected && busy !== 'plan' && (stage === 'preview' || stage === 'done' || stage === 'view')

      const header = isSubView
        ? h(
            'div',
            { className: 'lw-topbar' },
            h(
              'button',
              { type: 'button', className: 'lw-back', disabled: Boolean(busy), onClick: restart },
              h(Icon, { name: 'arrowLeft', size: 15 }),
              stage === 'view' ? t('view.back') : t('preview.back'),
            ),
            statusBadge,
          )
        : h(
            'header',
            { className: 'lw-head' },
            h(
              'div',
              { className: 'lw-head-main' },
              h('span', { className: 'lw-mark' }, h(Mark, { size: 15 })),
              h(
                'div',
                { className: 'lw-head-copy' },
                h('span', { className: 'lw-name' }, t('app.name')),
              ),
            ),
            statusBadge,
          )

      let content = null
      if (!health) {
        content = h(
          'section',
          { className: 'lw-card' },
          h(TableSkeleton),
          h(Button, { variant: 'ghost', size: 'sm', onClick: refreshHealth }, t('status.recheck')),
        )
      } else if (health.stage === 'unknown') {
        content = h(
          'section',
          { className: 'lw-card' },
          h('div', { className: 'lw-sect' }, h('h2', { className: 'lw-h' }, t('status.offline')), h('p', { className: 'lw-p' }, t('gate.retryBody'))),
          h('div', { className: 'lw-actions' }, h(Button, { variant: 'primary', onClick: refreshHealth }, t('status.recheck'))),
        )
      } else if (!connected) {
        content = h(ConnectGate, { health, t, onRecheck: refreshHealth })
      } else if (stage === 'pick') {
        const planning = busy === 'plan'
        content = h(
          'section',
          { className: 'lw-pick' },
          h(
            'div',
            { className: 'lw-hero' },
            h('h1', { className: 'lw-hero-title' }, t('pick.title')),
          ),
          h(
            'div',
            { className: 'lw-own' },
            h(UnifiedComposer, {
              value: sentence,
              onChange: (val) => {
                setSentence(val)
                setError(null)
              },
              onSubmit: () => {
                if (sentence.trim().length >= 2) planFor(sentence)
              },
              placeholder: t('pick.placeholder'),
              busy: planning,
              busyText: t('busy.planning'),
              buttonText: '生成预览',
              disabled: !toolOk || sentence.trim().length < 2,
              models,
              selectedModel,
              modelKey,
              changeModel,
              trustText: t('pick.trust'),
              minHeight: 76,
              id: 'lw-own',
              ariaLabel: t('pick.own'),
            }),
          ),
          error
            ? h(Banner, {
                tone: 'error',
                title: t('error.title'),
                children: humanize(error),
                action: h(Button, { variant: 'ghost', size: 'sm', onClick: () => (sentence ? planFor(sentence) : restart()) }, t('error.retry')),
              })
            : null,
          planning
            ? null
            : h(
                'div',
                { className: 'lw-scenes', role: 'group', 'aria-label': t('pick.subtitle') },
                SCENARIOS.map((scenario) =>
                  h(
                    'button',
                    {
                      key: scenario.id,
                      type: 'button',
                      className: 'lw-chip',
                      title: scenario.desc,
                      disabled: Boolean(busy) || !toolOk,
                      onClick: () => {
                        if (scenario.type === 'collab') {
                          openCollab(scenario.prompt)
                          applyAdjust(scenario.prompt)
                        } else {
                          setSentence(scenario.prompt)
                          planFor(scenario.prompt)
                        }
                      },
                    },
                    h(Icon, { name: scenario.icon, size: 13, className: 'lw-chip-ico' }),
                    h('span', null, scenario.title),
                  ),
                ),
              ),
          planning
            ? h(
                'div',
                { className: 'lw-planning', 'aria-live': 'polite' },
                h('p', { className: 'lw-meta' }, t('busy.planningSub')),
                h(TableSkeleton),
              )
            : h(Recent, {
                items: recent,
                t,
                onOpen: openRecent,
                onForget: forgetRecent,
                disabled: Boolean(busy) || !toolOk,
              }),
        )
      } else if (stage === 'preview' && plan) {
        const primaryTable = plan.tables[0]
        const totalCols = plan.tables.reduce((sum, tbl) => sum + tbl.fields.length, 0)
        const totalRows = primaryTable ? (primaryTable.records ?? []).length : 0
        const hasKanban = plan.tables.some((tbl) => Boolean(tbl.kanbanField))

        const previewCard = h(
          'section',
          { className: 'lw-card', style: { width: '100%', maxWidth: 1040, margin: '0 auto' } },
          h(
            'div',
            { className: 'lw-preview-head' },
            h(
              'div',
              { style: { minWidth: 0, flex: 1 } },
              h('h2', { className: 'lw-preview-title' }, plan.baseName || t('preview.title')),
              plan.intro ? h('p', { className: 'lw-p', style: { marginTop: 4 } }, plan.intro) : null,
              h(
                'div',
                { className: 'lw-preview-meta' },
                h('span', null, `${totalCols} ${t('preview.cols')}`),
                totalRows > 0 ? h('span', { className: 'lw-preview-sep' }, '·') : null,
                totalRows > 0 ? h('span', null, `${totalRows} ${t('preview.rows')}`) : null,
                hasKanban ? h('span', { className: 'lw-preview-sep' }, '·') : null,
                hasKanban ? h('span', null, t('preview.kanban')) : null,
              ),
            ),
            h(
              Button,
              { variant: 'primary', disabled: Boolean(busy) || !toolOk, onClick: build },
              busy === 'build' ? t('busy.building') : busy === 'plan' ? t('busy.planning') : t('preview.build'),
            ),
          ),
          busy === 'build' || busy === 'plan'
            ? h(TableSkeleton)
            : plan.tables.map((table) =>
                h(
                  'div',
                  { key: table.name, style: { display: 'flex', flexDirection: 'column', gap: 10 } },
                  plan.tables.length > 1 ? h('div', { className: 'lw-meta' }, table.name) : null,
                  h(PreviewTable, { table, t }),
                ),
              ),
          h(
            'button',
            {
              type: 'button',
              className: 'lw-details-toggle',
              'aria-expanded': showDetails,
              onClick: () => setShowDetails((value) => !value),
            },
            h(Icon, { name: 'chevron', size: 13, className: `lw-details-chevron${showDetails ? ' is-open' : ''}` }),
            showDetails ? t('preview.detailsHide') : `${t('preview.detailsShow')} (${totalCols})`,
          ),
          showDetails
            ? plan.tables.map((table) => h(Legend, { key: `legend-${table.name}`, table }))
            : null,
        )

        const tweakDock = h(
          'div',
          { className: 'lw-ws-dock' },
          h(
            'div',
            { className: 'lw-composer-wrap', style: { maxWidth: 1040 } },
            h(
              'div',
              { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 4 } },
              h('span', { style: { fontSize: 12, color: 'var(--lw-ink-3)', marginRight: 2 } }, '快捷调整:'),
              [
                { label: '+ 加一列状态', prompt: '增加一列「状态」，单选：待处理/进行中/已完成' },
                { label: '+ 加一列负责人', prompt: '增加一列「负责人」，关联团队成员' },
                { label: '+ 增加优先级', prompt: '增加一列「优先级」，单选：高/中/低' },
                { label: '生成看板视图', prompt: '针对当前表生成一个按状态分组的看板视图' },
                { label: '补充示例数据', prompt: '再帮我补充 3 条真实的业务示例记录' },
              ].map((item, idx) =>
                h(
                  'button',
                  {
                    key: idx,
                    type: 'button',
                    className: 'lw-chip',
                    style: { padding: '4px 10px', fontSize: 12, height: 'auto' },
                    disabled: Boolean(busy),
                    onClick: () => {
                      setTweakText(item.prompt)
                      refine(item.prompt)
                    },
                  },
                  item.label,
                ),
              ),
            ),
            h(UnifiedComposer, {
              value: tweakText,
              onChange: (val) => setTweakText(val),
              onSubmit: () => {
                if (tweakText.trim()) refine(tweakText)
              },
              placeholder: t('preview.tweakPlaceholder') || '想微调？比如：再加一列「来源」，或去掉「预计金额」',
              busy: busy === 'plan',
              busyText: '调整中…',
              buttonText: '调整方案',
              disabled: !tweakText.trim(),
              models,
              selectedModel,
              modelKey,
              changeModel,
              trustText: '直连你的飞书账号，安全隐私仅自己可见',
              minHeight: 52,
              id: 'lw-tweak',
              ariaLabel: '微调方案',
            }),
          ),
        )

        content = h(
          'div',
          { className: 'lw-workspace' },
          h(
            'div',
            { className: 'lw-ws-header' },
            h(
              'div',
              { className: 'lw-ws-header-left' },
              h(
                'button',
                { type: 'button', className: 'lw-back', disabled: Boolean(busy), onClick: restart, title: t('preview.back') },
                h(Icon, { name: 'arrowLeft', size: 14 }),
                h('span', null, t('preview.back')),
              ),
              h('div', { className: 'lw-ws-sep' }),
              h('span', { className: 'lw-ws-title' }, plan.baseName || '多维表格方案预览'),
              statusBadge,
            ),
            h(
              'div',
              { className: 'lw-ws-header-right' },
              h(
                Button,
                { variant: 'primary', size: 'sm', disabled: Boolean(busy) || !toolOk, onClick: build },
                busy === 'build' ? t('busy.building') : busy === 'plan' ? t('busy.planning') : t('preview.build'),
              ),
            ),
          ),
          h(
            'div',
            { className: 'lw-preview-scroll' },
            error
              ? h(Banner, {
                  tone: 'error',
                  title: t('error.title'),
                  children: humanize(error),
                  style: { maxWidth: 1040, width: '100%', marginBottom: 12 },
                  action: h(Button, { variant: 'ghost', size: 'sm', onClick: () => (sentence ? planFor(sentence) : restart()) }, t('error.retry')),
                })
              : null,
            previewCard,
          ),
          tweakDock,
        )
      } else if (stage === 'done' && result) {
        const steps = [t('done.step1'), t('done.step2'), t('done.step3'), t('done.step4')]
        content = h(
          'section',
          { className: 'lw-card' },
          h(
            'div',
            { className: 'lw-done-head' },
            h('span', { className: 'lw-check', 'aria-hidden': true }, h(Icon, { name: 'tick', size: 22, strokeWidth: 2.1 })),
            h(
              'div',
              { className: 'lw-done-copy' },
              h('div', { className: 'lw-done-eyebrow' }, t('done.title')),
              h('h2', { className: 'lw-done-title' }, result.baseName),
              result.url
                ? h(
                    'a',
                    {
                      className: 'lw-url',
                      href: result.url,
                      target: '_blank',
                      rel: 'noreferrer',
                      onClick: (event) => {
                        event.preventDefault()
                        continueAdjusting()
                      },
                    },
                    result.url,
                  )
                : null,
            ),
          ),
          h(
            'div',
            { className: 'lw-actions' },
            h(
              Button,
              { variant: 'primary', onClick: continueAdjusting, disabled: !result.token && !result.url },
              '进入分屏工作台查看真表',
            ),
            result.url
              ? h(
                  Button,
                  { variant: 'ghost', onClick: () => window.open(result.url, '_blank', 'noopener') },
                  '外部浏览器打开',
                  h(Icon, { name: 'arrowUpRight', size: 14 }),
                )
              : null,
            result.url
              ? h(Button, { variant: 'ghost', onClick: copyResultUrl }, copiedUrl ? t('done.copied') : t('done.copy'))
              : null,
            h(Button, { variant: 'ghost', onClick: restart }, t('done.again')),
          ),
          realError
            ? h(Banner, {
                tone: 'error',
                title: t('view.openFailed'),
                children: humanize(realError),
                action: result.url
                  ? h(
                      Button,
                      { variant: 'ghost', size: 'sm', onClick: () => window.open(result.url, '_blank', 'noopener') },
                      t('view.openExternal'),
                    )
                  : null,
              })
            : null,
          (result.warnings ?? []).length > 0
            ? h(Banner, {
                tone: 'warn',
                title: t('done.warnings'),
                children: h('ul', { style: { margin: 0, paddingLeft: 16 } }, result.warnings.map((warning, index) => h('li', { key: index }, warning))),
              })
            : null,
          h(
            'div',
            { className: 'lw-next' },
            h('div', { className: 'lw-next-title' }, t('done.next')),
            h(
              'div',
              { className: 'lw-next-grid' },
              steps.map((stepText, index) =>
                h(
                  'div',
                  { className: 'lw-next-card', key: index },
                  h('span', { className: 'lw-next-num' }, String(index + 1)),
                  h('span', null, stepText),
                ),
              ),
            ),
            h('p', { className: 'lw-meta' }, t('done.adjustHint')),
          ),
        )
      } else if (stage === 'view' && active) {
        const isTableMode = Boolean(active && active.type !== 'collab' && active.url)
        const fields = live && live.ok ? live.fields : []
        const rows = live && live.ok ? live.rows : []
        const stats = live && live.ok
          ? [
              `${fields.length} ${t('preview.cols')}`,
              rows.length > 0 ? `${rows.length} ${t('view.rows')}` : null,
            ].filter(Boolean).join(' · ')
          : ''

        const HERO_RECOMMENDATIONS = [
          {
            icon: 'chart',
            color: '#ff7d00',
            label: '数据分析',
            prompt: '帮我对当前表格数据进行统计分析，提取关键洞察与数据分布',
          },
          {
            icon: 'table',
            color: '#722ed1',
            label: '数据表搭建',
            prompt: '帮我规划并新建一张业务数据表，包含常用的基础字段',
          },
          {
            icon: 'form',
            color: '#f53f3f',
            label: '收集表搭建',
            prompt: '针对当前表格搭建一个数据收集表单，方便录入数据',
          },
          {
            icon: 'dashboard',
            color: '#165dff',
            label: '仪表盘搭建',
            prompt: '为当前数据表创建一个仪表盘与统计图表，直观展示关键指标',
          },
          {
            icon: 'layout',
            color: '#00b42a',
            label: '视图页面搭建',
            prompt: '为当前表创建一个看板视图或画册视图，方便团队协作与进度跟踪',
          },
          {
            icon: 'shieldCheck',
            color: '#0fc6c2',
            label: '高级权限配置',
            prompt: '开启高级权限并配置不同成员角色的行级与列级访问权限',
          },
          {
            icon: 'zap',
            color: '#f7ba1e',
            label: '批量数据处理',
            prompt: '帮我批量检查并更新数据记录（如批量更新状态或补齐空缺字段）',
          },
          {
            icon: 'helpCircle',
            color: '#86909c',
            label: '教程问答',
            prompt: '多维表格有哪些常用公式和高阶功能？',
          },
        ]

        const COLLAB_HERO_RECOMMENDATIONS = [
          {
            icon: 'calendar',
            color: '#165dff',
            label: '今日日程',
            prompt: '查一下我今天的日程安排与会议',
          },
          {
            icon: 'check',
            color: '#00b42a',
            label: '我的待办',
            prompt: '列出我所有未完成的待办事项',
          },
          {
            icon: 'people',
            color: '#722ed1',
            label: '搜索群聊',
            prompt: '搜索我加入的可见群聊列表',
          },
          {
            icon: 'receipt',
            color: '#ff7d00',
            label: '邮件速览',
            prompt: '查一下我最近收到的重要邮件',
          },
          {
            icon: 'user',
            color: '#0fc6c2',
            label: '查通讯录',
            prompt: '按名字查同事信息或联系方式',
          },
          {
            icon: 'table',
            color: '#2b5aed',
            label: '新建多维表格',
            prompt: '我想新建一张项目任务跟踪的多维表格',
          },
          {
            icon: 'book',
            color: '#f53f3f',
            label: '查知识库',
            prompt: '在团队知识库中搜索最新规范',
          },
          {
            icon: 'helpCircle',
            color: '#86909c',
            label: '协同答疑',
            prompt: '飞书支持哪些自动化流程与日程联动？',
          },
        ]

        const handleUsePrompt = (promptText) => {
          setAdjustText(promptText)
        }

        const heroCard = h(
          'div',
          { className: 'lw-hero-card' },
          h(
            'div',
            { className: 'lw-hero-head', style: { justifyContent: 'space-between', alignItems: 'center', gap: 6 } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: '1 1 auto' } },
              h(
                'div',
                { className: 'lw-hero-avatar', style: { flex: 'none' } },
                h(Icon, { name: 'larkAi', size: 20 }),
              ),
              h(
                'div',
                { className: 'lw-hero-title-wrap', style: { minWidth: 0 } },
                h('div', { className: 'lw-hero-title', style: { whiteSpace: 'nowrap' } }, isTableMode ? '飞书表格 AI 助手' : '飞书全能协同助手'),
                h('div', { className: 'lw-hero-subtitle', style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, isTableMode ? `已连接「${active.name}」` : '已连接飞书全域协同服务'),
              ),
            ),
          ),
          h(
            'div',
            { className: 'lw-hero-body', style: { fontSize: 12.5, lineHeight: 1.5 } },
            isTableMode
              ? '支持完整多轮对话记忆与追问。你可以直接输入修改指令（如加列、改选项、建看板），也可以随时提问（如「刚刚加了什么记录」）。'
              : '随时通过对话查询日程、管理待办、搜索群聊、起草邮件或查通讯录。如需建表或改表，输入一句话即可自动切换至表格模式。',
          ),
          h('div', { className: 'lw-hero-hints-title' }, '为你推荐'),
          h(
            'div',
            { className: 'lw-hero-hints' },
            (isTableMode ? HERO_RECOMMENDATIONS : COLLAB_HERO_RECOMMENDATIONS).map((item, idx) =>
              h(
                'button',
                {
                  key: idx,
                  type: 'button',
                  className: 'lw-chip',
                  onClick: () => handleUsePrompt(item.prompt),
                  title: `填入指令：${item.prompt}`,
                },
                h(Icon, { name: item.icon, size: 13, className: 'lw-chip-ico' }),
                h('span', null, item.label),
              ),
            ),
          ),
        )

        const chatFeed = h(
          'div',
          { ref: chatStreamRef, className: 'lw-chat-stream', style: { flex: 1, padding: '14px 14px', overflowY: 'auto' } },
          heroCard,
          history.map((msg, idx) => {
            if (msg.missingScope) {
              return h(
                'div',
                {
                  key: idx,
                  className: 'lw-msg lw-msg-ai',
                  style: { marginBottom: 12 },
                },
                h('div', { className: 'lw-msg-role' }, selectedModel?.name || '飞书助手'),
                h(
                  'div',
                  {
                    style: {
                      padding: '12px 14px',
                      background: 'color-mix(in srgb, var(--lw-accent) 8%, var(--lw-surface))',
                      border: '1px solid color-mix(in srgb, var(--lw-accent) 25%, transparent)',
                      borderRadius: 12,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    },
                  },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13, color: 'var(--lw-ink)' } }, [
                    h(Icon, { name: 'shieldCheck', size: 16, style: { color: 'var(--lw-accent)' } }),
                    `需要开通「${msg.domainTitle || '飞书功能'}」访问权限`,
                  ]),
                  h('div', { style: { fontSize: 12, color: 'var(--lw-ink-2)', lineHeight: 1.5, whiteSpace: 'pre-wrap' } }, msg.text),
                  h(
                    'div',
                    { style: { display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' } },
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
                            const payload = await post('/connect/login/start', {})
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
                                  const lastUser = [...history.slice(0, idx)].reverse().find((m) => m && m.role === 'user')
                                  if (lastUser && lastUser.text) {
                                    applyAdjust(lastUser.text, { retryIndex: idx })
                                  }
                                  return
                                }
                              }
                            }
                          } catch {} finally {
                            if (!curAbort.aborted) setSyncingAuth(false)
                          }
                        },
                      },
                      syncingAuth ? '正在等待飞书授权确认…' : `立即授权「${msg.domainTitle || '此功能'}」并查询 ↗`,
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
                      '重试',
                    ),
                    msg.consoleUrl
                      ? h(
                          'a',
                          {
                            href: msg.consoleUrl,
                            target: '_blank',
                            rel: 'noopener',
                            style: { fontSize: 11, color: 'var(--lw-ink-3)', marginLeft: 4, textDecoration: 'none' },
                          },
                          '应用管理配置 ↗',
                        )
                      : null,
                  ),
                ),
              )
            }
            if (msg.role === 'user') {
              return h(
                'div',
                {
                  key: idx,
                  className: 'lw-msg lw-msg-user',
                  style: { marginBottom: 12 },
                },
                h('div', { className: 'lw-msg-role' }, '你'),
                h('div', { className: 'lw-msg-text', style: { whiteSpace: 'pre-wrap', lineHeight: 1.5 } }, msg.text),
              )
            }
            return h(AssistantBubble, {
              key: idx,
              msg,
              modelName: selectedModel?.name || 'AI',
            })
          }),
          busy === 'adjust'
            ? h(
                'div',
                { className: 'lw-msg lw-msg-ai is-busy' },
                h('div', { className: 'lw-msg-role' }, selectedModel?.name || 'AI'),
                h(
                  'div',
                  { className: 'lw-msg-text lw-thinking-pill-busy' },
                  [
                    h(
                      'div',
                      { className: 'lw-thinking-header' },
                      [
                        h(
                          'svg',
                          {
                            className: 'lw-thinking-spin',
                            width: 14,
                            height: 14,
                            viewBox: '0 0 24 24',
                            fill: 'none',
                            stroke: 'currentColor',
                            strokeWidth: 2,
                            strokeLinecap: 'round',
                            strokeLinejoin: 'round',
                            style: { color: 'var(--lw-accent)' },
                          },
                          [
                            h('path', { d: 'M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7z' }),
                            h('path', { d: 'M9 21h6' }),
                          ],
                        ),
                        h('span', { className: 'lw-thinking-shimmer' }, '正在深度思考…'),
                      ],
                    ),
                    liveReasoning
                      ? h('div', { className: 'lw-thinking-live-body' }, liveReasoning)
                      : null,
                  ],
                ),
              )
            : null,
          h('div', { ref: chatEndRef }),
        )

        const adjustBlock = h(
          'div',
          { className: 'lw-ws-dock' },
          confirmPlan
            ? h(
                'div',
                { className: 'lw-confirm-card', role: 'alertdialog', 'aria-label': t('view.confirmTitle') },
                h('div', { className: 'lw-confirm-title' }, t('view.confirmTitle')),
                h('div', { className: 'lw-confirm-body' }, t('view.confirmBody')),
                h(
                  'ul',
                  { className: 'lw-confirm-list' },
                  confirmPlan.destructive.map((line, index) => h('li', { key: index }, line)),
                ),
                h(
                  'div',
                  { className: 'lw-actions' },
                  h(Button, { variant: 'danger', disabled: Boolean(busy), onClick: confirmApply }, t('view.confirmYes')),
                  h(Button, { variant: 'ghost', disabled: Boolean(busy), onClick: () => setConfirmPlan(null) }, t('view.confirmNo')),
                ),
              )
            : h(
                'div',
                { className: 'lw-composer-wrap' },
                h(UnifiedComposer, {
                  value: adjustText,
                  onChange: (val) => setAdjustText(val),
                  onSubmit: () => {
                    if (adjustText.trim()) applyAdjust()
                  },
                  placeholder: isTableMode
                    ? '输入表格调整指令（如：加一列负责人、批量改状态），回车调整…'
                    : '输入飞书协同指令，回车发送…',
                  busy: busy === 'adjust',
                  busyText: '思考执行中…',
                  buttonText: isTableMode ? '调整' : '发送',
                  disabled: !adjustText.trim(),
                  models,
                  selectedModel,
                  modelKey,
                  changeModel,
                  trustText: '直连你的飞书账号，安全隐私仅自己可见',
                  minHeight: 52,
                  id: 'lw-adjust-input',
                  ariaLabel: '协同指令输入框',
                  inputRef: adjustInputRef,
                }),
                adjustError
                  ? h(Banner, { tone: 'error', title: t('error.title'), children: humanize(adjustError) })
                  : null,
              ),
        )

        content = h(
          'div',
          { className: 'lw-workspace' },
          h(
            'div',
            { className: 'lw-ws-header' },
            h(
              'div',
              { className: 'lw-ws-header-left' },
              h(
                'button',
                { type: 'button', className: 'lw-back', onClick: restart, title: t('view.back') },
                h(Icon, { name: 'arrowLeft', size: 14 }),
                h('span', null, t('view.back')),
              ),
              h('div', { className: 'lw-ws-sep' }),
              h('span', { className: 'lw-ws-title' }, isTableMode ? active.name : '飞书协同助手'),
              statusBadge,
            ),
            isTableMode
              ? h(
                  'div',
                  { className: 'lw-ws-header-right' },
                  h(
                    Button,
                    {
                      variant: 'ghost',
                      size: 'sm',
                      title: '重新读取飞书最新数据',
                      onClick: () => openRecent(active),
                    },
                    h(Icon, { name: 'refresh', size: 13 }),
                    '同步数据',
                  ),
                  h(
                    Button,
                    { variant: 'ghost', size: 'sm', onClick: copyActiveUrl },
                    copiedView ? t('done.copied') : t('done.copy'),
                  ),
                  active.url
                    ? h(
                        Button,
                        {
                          variant: tableOpen ? 'primary' : 'ghost',
                          size: 'sm',
                          onClick: () => toggleTable(!tableOpen),
                          title: tableOpen ? '收起右侧飞书表格，进入全屏对话模式' : '展开右侧飞书表格，进入分屏协作模式',
                        },
                        tableOpen ? '收起表格 ◫' : '展开表格 ◫',
                      )
                    : null,
                  h(
                    Button,
                    {
                      variant: 'ghost',
                      size: 'sm',
                      onClick: () => window.open(active.url, '_blank', 'noopener'),
                      title: '在系统默认浏览器中打开飞书完整表格',
                    },
                    '外部打开',
                    h(Icon, { name: 'arrowUpRight', size: 13 }),
                  ),
                )
              : h(
                  'div',
                  { className: 'lw-ws-header-right' },
                  h(
                    Button,
                    {
                      variant: 'ghost',
                      size: 'sm',
                      onClick: () => setHistory([]),
                      title: '清空当前对话会话',
                    },
                    '清空对话',
                  ),
                ),
          ),
          h(
            'div',
            { className: 'lw-ws-layout' },
            h(
              'div',
              {
                className: `lw-ws-left ${isTableMode && tableOpen ? 'is-split' : 'is-full'}`,
                style: isTableMode && tableOpen
                  ? {
                      width: splitWidth,
                      flex: 'none',
                      display: 'flex',
                      flexDirection: 'column',
                      transition: isResizing ? 'none' : 'width .15s ease',
                      background: 'var(--lw-bg)',
                    }
                  : {
                      flex: '1 1 auto',
                      width: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      background: 'var(--lw-bg)',
                    },
              },
              chatFeed,
              adjustBlock,
            ),
            isTableMode && tableOpen
              ? h('div', {
                  className: `lw-resizer${isResizing ? ' is-active' : ''}`,
                  onMouseDown: startResize,
                  onDoubleClick: resetSplitWidth,
                  title: '拖拽调整分栏宽度，双击恢复默认',
                })
              : null,
            isTableMode && active.url
              ? h(
                  'div',
                  {
                    className: 'lw-ws-right',
                    style: {
                      flex: 1,
                      height: '100%',
                      display: tableOpen ? 'flex' : 'none',
                      pointerEvents: isResizing ? 'none' : 'auto',
                    },
                  },
                  h(NativeWebview, { url: active.url, key: 'persistent-lark-webview' }),
                )
              : null,
            isTableMode && isResizing ? h('div', { className: 'lw-resize-overlay' }) : null,
          ),
        )
      }

      const isWorkspace = (stage === 'view' && Boolean(active)) || (stage === 'preview' && Boolean(plan))

      const accountModal = showAccountModal
        ? h(
            'div',
            {
              className: 'lw-modal-overlay',
              onClick: () => {
                if (!busyAccount) {
                  setShowAccountModal(false)
                  setAccountConfirm(null)
                }
              },
            },
            h(
              'div',
              {
                className: 'lw-modal-box',
                onClick: (e) => e.stopPropagation(),
              },
              h(
                'div',
                { className: 'lw-modal-head' },
                h(
                  'div',
                  { className: 'lw-modal-title' },
                  h(Icon, { name: 'shieldCheck', size: 18, style: { color: 'var(--lw-accent)' } }),
                  '飞书连接与账号设置',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'lw-modal-close',
                    onClick: () => {
                      if (!busyAccount) {
                        setShowAccountModal(false)
                        setAccountConfirm(null)
                      }
                    },
                    title: '关闭',
                  },
                  '✕',
                ),
              ),
              h(
                'div',
                { className: 'lw-account-card' },
                h(
                  'div',
                  { className: 'lw-account-row' },
                  h('span', { className: 'lw-account-label' }, '当前登录人'),
                  h(
                    'span',
                    { className: 'lw-account-val', style: { display: 'flex', alignItems: 'center', gap: 6 } },
                    h('span', { className: `lw-dot ${connected ? 'is-ok' : 'is-bad'}` }),
                    health.auth?.userName || (connected ? '已授权' : '未登录'),
                  ),
                ),
                h(
                  'div',
                  { className: 'lw-account-row' },
                  h('span', { className: 'lw-account-label' }, '飞书应用 (App ID)'),
                  h('span', { className: 'lw-account-val', style: { fontFamily: 'monospace', fontSize: 12 } }, health.app?.appId || '未配置'),
                ),
                h(
                  'div',
                  { className: 'lw-account-row' },
                  h('span', { className: 'lw-account-label' }, '连接工具 (CLI)'),
                  h('span', { className: 'lw-account-val' }, health.cli?.available ? '正常就绪 (lark-cli)' : '不可用'),
                ),
              ),
              h(
                'div',
                { className: 'lw-account-scopes', style: { display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0' } },
                h(
                  'div',
                  { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, fontWeight: 600, color: 'var(--lw-ink)' } },
                  h('span', null, '飞书全域能力与权限大盘'),
                  scopesInfo?.consoleUrl
                    ? h(
                        'a',
                        {
                          href: scopesInfo.consoleUrl,
                          target: '_blank',
                          rel: 'noopener',
                          style: { fontSize: 11, color: 'var(--lw-accent)', textDecoration: 'none' },
                        },
                        '前往开放平台配置 ↗',
                      )
                    : null,
                ),
                h(
                  'div',
                  {
                    style: {
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, 1fr)',
                      gap: 6,
                      padding: '8px',
                      background: 'var(--lw-surface)',
                      borderRadius: 8,
                      border: '1px solid var(--lw-line)',
                    },
                  },
                  [
                    { name: '多维表格与云文档', ready: scopesInfo?.domains?.base?.ready ?? true, count: scopesInfo?.domains?.base?.count || 87, icon: 'table' },
                    { name: '日历与日程', ready: scopesInfo?.domains?.calendar?.ready ?? false, icon: 'calendar' },
                    { name: '任务与待办', ready: scopesInfo?.domains?.task?.ready ?? false, icon: 'check' },
                    { name: '即时消息与群聊', ready: scopesInfo?.domains?.im?.ready ?? false, icon: 'people' },
                    { name: '飞书邮箱', ready: scopesInfo?.domains?.mail?.ready ?? false, icon: 'receipt' },
                    { name: '通讯录与组织', ready: scopesInfo?.domains?.contact?.ready ?? false, icon: 'user' },
                  ].map((item, i) =>
                    h(
                      'div',
                      {
                        key: i,
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '4px 8px',
                          fontSize: 11.5,
                          borderRadius: 6,
                          background: 'var(--lw-bg)',
                        },
                      },
                      h('span', { style: { display: 'flex', alignItems: 'center', gap: 5 } }, [
                        h(Icon, { name: item.icon, size: 12, style: { opacity: 0.7 } }),
                        item.name,
                      ]),
                      h(
                        'span',
                        {
                          style: {
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 10.5,
                            color: item.ready ? 'var(--lw-success)' : !scopesInfo ? 'var(--lw-accent)' : 'var(--lw-ink-3)',
                          },
                        },
                        item.ready
                          ? [h('span', { className: 'lw-dot is-ok', style: { width: 5, height: 5 } }), item.count ? `${item.count}项就绪` : '已开通']
                          : !scopesInfo
                            ? [h('span', { className: 'lw-dot is-busy', style: { width: 5, height: 5 } }), '核验中…']
                            : [h('span', { className: 'lw-dot', style: { width: 5, height: 5, background: 'var(--lw-ink-4)' } }), '未开启'],
                      ),
                    ),
                  ),
                ),
                Boolean(scopesInfo && [
                  scopesInfo?.domains?.base?.ready,
                  scopesInfo?.domains?.calendar?.ready,
                  scopesInfo?.domains?.task?.ready,
                  scopesInfo?.domains?.im?.ready,
                  scopesInfo?.domains?.mail?.ready,
                  scopesInfo?.domains?.contact?.ready,
                ].every(Boolean))
                  ? h(
                      'div',
                      {
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                          padding: '8px 12px',
                          marginTop: 6,
                          fontSize: 12,
                          fontWeight: 500,
                          color: 'var(--lw-success)',
                          background: 'color-mix(in srgb, var(--lw-success) 8%, var(--lw-surface))',
                          borderRadius: 8,
                          border: '1px solid color-mix(in srgb, var(--lw-success) 20%, transparent)',
                        },
                      },
                      h(Icon, { name: 'shieldCheck', size: 15 }),
                      '飞书全域协同能力已全部开通就绪',
                    )
                  : (!scopesInfo || syncingAuth)
                    ? h(
                        'div',
                        {
                          style: {
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 8,
                            padding: '8px 12px',
                            marginTop: 6,
                            fontSize: 12,
                            fontWeight: 500,
                            color: 'var(--lw-ink-2)',
                            background: 'color-mix(in srgb, var(--lw-ink) 4%, var(--lw-surface))',
                            borderRadius: 8,
                            border: '1px solid var(--lw-line)',
                          },
                        },
                        h(Icon, { name: 'refresh', size: 13, className: 'lw-spin' }),
                        h('span', null, syncingAuth ? '正在开通全域协同…' : '正在核验全域权限…'),
                      )
                    : h(
                        Button,
                        {
                          size: 'sm',
                          variant: 'primary',
                          disabled: busyAccount,
                          onClick: async () => {
                            setSyncingAuth(true)
                            try {
                              const payload = await post('/connect/login/start', {})
                              if (payload.ok && payload.url) {
                                window.open(payload.url, '_blank', 'noopener')
                                const deadline = Date.now() + 60000
                                let pollCount = 0
                                while (Date.now() < deadline) {
                                  const waitMs = pollCount < 4 ? 400 : 1200
                                  await new Promise((r) => setTimeout(r, waitMs))
                                  pollCount++
                                  const sc = await authFetch(`${API}/connect/scopes`).then((r) => r.json()).catch(() => null)
                                  if (sc && sc.ok) {
                                    setScopesInfo(sc)
                                    const allOk = Object.values(sc.domains || {}).every((d) => d.ready)
                                    if (allOk) {
                                      refreshHealth()
                                      break
                                    }
                                  }
                                  const st = await authFetch(`${API}/connect/login/state`).then((r) => r.json()).catch(() => null)
                                  if (st && st.ok) {
                                    refreshHealth()
                                    break
                                  }
                                }
                              }
                            } catch {} finally {
                              setSyncingAuth(false)
                            }
                          },
                          style: { marginTop: 4, width: '100%' },
                        },
                        '一键开通全域协同授权 ↗',
                      ),
              ),
              accountConfirm === 'logout'
                ? h(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', background: 'color-mix(in srgb, var(--lw-danger) 6%, var(--lw-surface))', border: '1px solid color-mix(in srgb, var(--lw-danger) 25%, transparent)', borderRadius: 12 } },
                    h('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--lw-ink)' } }, '确定要退出当前飞书账号吗？'),
                    h('div', { style: { fontSize: 12, color: 'var(--lw-ink-2)', lineHeight: 1.5 } }, `退出后将清除「${health.auth?.userName || '当前用户'}」的登录 Token，你可以切换为其他飞书账号扫码或确认授权登录。`),
                    h(
                      'div',
                      { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 } },
                      h(Button, { size: 'sm', variant: 'ghost', disabled: busyAccount, onClick: () => setAccountConfirm(null) }, '取消'),
                      h(Button, { size: 'sm', variant: 'danger', disabled: busyAccount, onClick: handleLogout }, busyAccount ? '正在退出…' : '确认退出登录'),
                    ),
                  )
                : accountConfirm === 'unbind'
                  ? h(
                      'div',
                      { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', background: 'color-mix(in srgb, var(--lw-danger) 6%, var(--lw-surface))', border: '1px solid color-mix(in srgb, var(--lw-danger) 25%, transparent)', borderRadius: 12 } },
                      h('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--lw-ink)' } }, '确定要解绑当前飞书应用吗？'),
                      h('div', { style: { fontSize: 12, color: 'var(--lw-ink-2)', lineHeight: 1.5 } }, `将清除当前绑定的 App ID (${health.app?.appId || ''}) 与应用凭据，解绑后可以重新输入新企业的自建应用 App ID 和 Secret。`),
                      h(
                        'div',
                        { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 } },
                        h(Button, { size: 'sm', variant: 'ghost', disabled: busyAccount, onClick: () => setAccountConfirm(null) }, '取消'),
                        h(Button, { size: 'sm', variant: 'danger', disabled: busyAccount, onClick: handleUnbind }, busyAccount ? '正在解绑…' : '确认解绑应用'),
                      ),
                    )
                  : h(
                      'div',
                      { className: 'lw-account-actions' },
                      h(
                        'div',
                        { className: 'lw-account-action-card' },
                        h(
                          'div',
                          { className: 'lw-account-action-text' },
                          h('div', { className: 'lw-account-action-name' }, '切换账号 / 退出登录'),
                          h('div', { className: 'lw-account-action-desc' }, '清除当前飞书登录凭据，切换至其他飞书用户账号'),
                        ),
                        h(
                          Button,
                          {
                            size: 'sm',
                            variant: 'ghost',
                            disabled: busyAccount || !connected,
                            onClick: () => setAccountConfirm('logout'),
                          },
                          '退出登录',
                        ),
                      ),
                      h(
                        'div',
                        { className: 'lw-account-action-card' },
                        h(
                          'div',
                          { className: 'lw-account-action-text' },
                          h('div', { className: 'lw-account-action-name' }, '更换应用 / 换绑企业应用'),
                          h('div', { className: 'lw-account-action-desc' }, '解绑当前应用凭据，换绑新的自建应用或企业空间'),
                        ),
                        h(
                          Button,
                          {
                            size: 'sm',
                            variant: 'danger',
                            disabled: busyAccount || !health.app?.appId,
                            onClick: () => setAccountConfirm('unbind'),
                          },
                          '换绑应用',
                        ),
                      ),
                    ),
            ),
          )
        : null

      return h(
        'div',
        { className: `lw${isWorkspace ? ' is-workspace' : ''}`, 'data-theme': theme },
        h('style', null, CSS),
        isWorkspace
          ? content
          : h(
              'div',
              { className: `lw-col${stage === 'preview' ? ' is-wide' : ''}` },
              isSubView ? null : header,
              h(
                'div',
                { className: 'lw-body' },
                isSubView ? header : null,
                error && stage !== 'pick'
                  ? h(Banner, {
                      tone: 'error',
                      title: t('error.title'),
                      children: humanize(error),
                      action: h(Button, { variant: 'ghost', size: 'sm', onClick: () => (sentence ? planFor(sentence) : restart()) }, t('error.retry')),
                    })
                  : null,
                content,
              ),
            ),
        accountModal,
      )
    }

    return {
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'zh', ZH))
        ctx.effect(() => ctx.locale.register(NS, 'en', EN))
        const t = ctx.locale.bind(NS)
        const realTable = hostBrowser(ctx)

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: 'lark-workbench', order: 20, label: () => t('app.name') }, PanelIcon),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            { name: 'main', key: 'lark-workbench', locale: NS },
            (props) => h(Workbench, { ...props, realTable, ctx, isStandalone: true }),
          ),
        )
        ctx.slots.inject('conversation.view', () =>
          ctx.slots.register(
            { name: 'conversation.view', id: 'lark-workbench', order: 5, label: () => t('app.name'), locale: NS },
            (props) => h(Workbench, { ...props, realTable, ctx, isConversationView: true }),
          ),
        )

        if (ctx.sidebarRightTabs) {
          ctx.effect(() =>
            ctx.sidebarRightTabs.register({
              id: 'lark-workbench',
              label: () => t('app.name'),
              icon: 'table',
              order: 20,
            }),
          )
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register(
              { name: 'sidebar.right.pane.tab', key: 'lark-workbench', locale: NS },
              (props) => h(Workbench, { ...props, realTable, ctx, isRightSidebar: true }),
            ),
          )
          ctx.slots.inject('sidebar.right.pane.tab.title', () =>
            ctx.slots.register(
              { name: 'sidebar.right.pane.tab.title', key: 'lark-workbench' },
              () => h('span', null, t('app.name')),
            ),
          )
        }
      },
    }
  },
})
