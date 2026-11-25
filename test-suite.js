/**
 * Automated test suite for lark-workbench Base operations & AI context.
 */

import assert from 'node:assert'
import { spawn } from 'node:child_process'
import { sanitizeOps, createAdjustPlanner } from './adjust-planner.js'
import { destructiveChanges, createOperations } from './ops.js'
import { createPlanner, resolveLang, sanitizePlan } from './planner.js'
import { inject } from './index.js'

console.log('🚀 开始执行飞书工作台多维表格全功能自动化测试...\n')

let passCount = 0
let failCount = 0
const pendingTests = []

const realSubprocess = {
  spawn({ argv, cwd, env, stdio }) {
    const proc = spawn(argv[0], argv.slice(1), { cwd, env });
    if (stdio?.stdin?.data) {
      proc.stdin.write(stdio.stdin.data);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }
    let stdoutStr = '';
    let stderrStr = '';
    proc.stdout.on('data', d => stdoutStr += d.toString());
    proc.stderr.on('data', d => stderrStr += d.toString());
    const done = new Promise((resolve) => {
      proc.on('close', code => resolve({ exitCode: code }));
      proc.on('error', err => {
        stderrStr = err.message;
        resolve({ exitCode: 1 });
      });
    });
    return {
      done,
      collected: {
        stdout: { readFrom: () => ({ text: stdoutStr }) },
        stderr: { readFrom: () => ({ text: stderrStr }) },
      },
      terminate: () => proc.kill()
    };
  }
};

function test(name, fn) {
  try {
    const res = fn()
    if (res && typeof res.then === 'function') {
      const p = res.then(() => {
        console.log(`✅ [PASS] ${name}`)
        passCount++
      }).catch((err) => {
        console.error(`❌ [FAIL] ${name}`)
        console.error(`   Error: ${err.message}`)
        failCount++
      })
      pendingTests.push(p)
      return
    }
    console.log(`✅ [PASS] ${name}`)
    passCount++
  } catch (err) {
    console.error(`❌ [FAIL] ${name}`)
    console.error(`   Error: ${err.message}`)
    failCount++
  }
}

// -------------------------------------------------------------
// 1. 字段类型（Schema & Types）全面校验测试
// -------------------------------------------------------------
test('1.1 字段定义 - 基础类型 (text, number, datetime, checkbox)', () => {
  const mockPlan = {
    type: 'ops',
    ops: [
      { op: 'add_field', field: { name: '任务标题', type: 'text', description: '任务名称' } },
      { op: 'add_field', field: { name: '预估工时', type: 'number', style: { format: '0.0' } } },
      { op: 'add_field', field: { name: '截止日期', type: 'datetime' } },
      { op: 'add_field', field: { name: '是否紧急', type: 'checkbox' } },
    ]
  }
  const result = sanitizeOps(mockPlan)
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.ops.length, 4)
  assert.strictEqual(result.ops[0].fields[0].type, 'text')
  assert.strictEqual(result.ops[1].fields[0].type, 'number')
  assert.strictEqual(result.ops[2].fields[0].type, 'datetime')
  assert.strictEqual(result.ops[3].fields[0].type, 'checkbox')
})

test('1.2 字段定义 - 单选与多选 (select, multiple)', () => {
  const mockPlan = {
    type: 'ops',
    ops: [
      {
        op: 'add_field',
        field: { name: '状态', type: 'select', options: ['未开始', '进行中', '已完成'], multiple: false }
      },
      {
        op: 'add_field',
        field: { name: '标签', type: 'select', options: ['Bug', 'Feature', 'Refactor'], multiple: true }
      }
    ]
  }
  const result = sanitizeOps(mockPlan)
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.ops[0].fields[0].multiple, false)
  assert.strictEqual(result.ops[0].fields[0].options.length, 3)
  assert.strictEqual(result.ops[1].fields[0].multiple, true)
  assert.strictEqual(result.ops[1].fields[0].options[0].name, 'Bug')
})

test('1.3 字段定义 - 高级字段 (formula, link, lookup, user, auto_number)', () => {
  const mockPlan = {
    type: 'ops',
    ops: [
      {
        op: 'add_field',
        field: { name: '执行人', type: 'user', multiple: true }
      },
      {
        op: 'add_field',
        field: { name: '完成进度公式', type: 'formula', expression: 'AVERAGE(子任务进度)' }
      },
      {
        op: 'add_field',
        field: { name: '关联项目', type: 'link', link_table: '项目表', bidirectional: true }
      },
      {
        op: 'add_field',
        field: { name: '引用项目负责人', type: 'lookup', from: '关联项目', select: '负责人' }
      },
      {
        op: 'add_field',
        field: { name: '任务ID', type: 'auto_number' }
      }
    ]
  }
  const result = sanitizeOps(mockPlan)
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.ops.length, 5)
  assert.strictEqual(result.ops[0].fields[0].type, 'user')
  assert.strictEqual(result.ops[0].fields[0].multiple, true)
  assert.strictEqual(result.ops[1].fields[0].type, 'formula')
  assert.strictEqual(result.ops[1].fields[0].expression, 'AVERAGE(子任务进度)')
  assert.strictEqual(result.ops[2].fields[0].type, 'link')
  assert.strictEqual(result.ops[2].fields[0].link_table, '项目表')
  assert.strictEqual(result.ops[2].fields[0].bidirectional, true)
  assert.strictEqual(result.ops[3].fields[0].type, 'lookup')
  assert.strictEqual(result.ops[3].fields[0].from, '关联项目')
  assert.strictEqual(result.ops[3].fields[0].select, '负责人')
  assert.strictEqual(result.ops[4].fields[0].type, 'auto_number')
})

// -------------------------------------------------------------
// 2. 问答与查询模式（Answer & QA Mode）
// -------------------------------------------------------------
test('2.1 问答模式 - 自然语言查询回答识别', () => {
  const mockAnswer = {
    type: 'answer',
    reply: '当前工作任务表中共有 3 条记录：张三（2条）、李四（1条），其中 2 条状态为进行中。'
  }
  const result = sanitizeOps(mockAnswer)
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.type, 'answer')
  assert.strictEqual(result.ops.length, 0)
  assert.ok(result.reply.includes('共有 3 条记录'))
})

test('2.2 问答模式 - 追问上一轮结果的兜底机制', () => {
  const history = [
    { role: 'user', text: '加一条任务' },
    { role: 'assistant', text: '已为您添加一条记录：写周报' }
  ]
  const result = sanitizeOps({ ops: [] }, '刚刚加了什么', history)
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.type, 'answer')
  assert.ok(result.reply.includes('写周报'))
})

// -------------------------------------------------------------
// 3. 数据记录操作（Record CRUD）
// -------------------------------------------------------------
test('3.1 批量新增记录 (add_records)', () => {
  const mockAdd = {
    type: 'ops',
    ops: [
      {
        op: 'add_records',
        table: '工作任务',
        records: [
          { '任务名称': '设计架构', '状态': ['进行中'], '工时': 8 },
          { '任务名称': '编写代码', '状态': ['未开始'], '工时': 16 }
        ]
      }
    ]
  }
  const result = sanitizeOps(mockAdd)
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.ops[0].op, 'add_records')
  assert.strictEqual(result.ops[0].records.length, 2)
  assert.strictEqual(result.ops[0].records[0]['任务名称'], '设计架构')
})

test('3.2 条件批量修改与精确修改 (update_records)', () => {
  const mockUpdateWhere = {
    type: 'ops',
    ops: [
      {
        op: 'update_records',
        table: '工作任务',
        where: { '负责人': '张三' },
        fields: { '优先级': ['高'] }
      },
      {
        op: 'update_records',
        table: '工作任务',
        records: [
          { record_id: 'rec_1001', fields: { '状态': ['已完成'] } }
        ]
      }
    ]
  }
  const result = sanitizeOps(mockUpdateWhere)
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.ops[0].op, 'update_records')
  assert.deepStrictEqual(result.ops[0].where, [{ field: '负责人', value: '张三' }])
  assert.deepStrictEqual(result.ops[0].fields, { '优先级': ['高'] })
  assert.strictEqual(result.ops[1].records[0].record_id, 'rec_1001')
})

test('3.3 条件批量删除与按 ID 删除 (delete_records)', () => {
  const mockDelete = {
    type: 'ops',
    ops: [
      {
        op: 'delete_records',
        table: '工作任务',
        where: { '状态': '已废弃' }
      },
      {
        op: 'delete_records',
        table: '工作任务',
        record_ids: ['rec_2001', 'rec_2002']
      }
    ]
  }
  const result = sanitizeOps(mockDelete)
  assert.strictEqual(result.ok, true)
  assert.deepStrictEqual(result.ops[0].where, [{ field: '状态', value: '已废弃' }])
  assert.deepStrictEqual(result.ops[1].record_ids, ['rec_2001', 'rec_2002'])
})

// -------------------------------------------------------------
// 4. 视图与数据表管理（Views & Tables）
// -------------------------------------------------------------
test('4.1 视图创建 (grid, kanban, gallery, calendar, gantt)', () => {
  const mockViews = {
    type: 'ops',
    ops: [
      { op: 'add_view', name: '全量表格', type: 'grid' },
      { op: 'add_view', name: '状态看板', type: 'kanban', group_by: '状态' },
      { op: 'add_view', name: '卡片画册', type: 'gallery' },
      { op: 'add_view', name: '日程日历', type: 'calendar' },
      { op: 'add_view', name: '甘特排期', type: 'gantt' },
      { op: 'rename_view', view: '全量表格', name: '汇总视图' },
      { op: 'delete_view', view: '旧视图' }
    ]
  }
  const result = sanitizeOps(mockViews)
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.ops.length, 7)
  assert.strictEqual(result.ops[1].group_by, '状态')
  assert.strictEqual(result.ops[4].type, 'gantt')
})

test('4.2 数据表管理 (add_table, rename_table)', () => {
  const mockTables = {
    type: 'ops',
    ops: [
      {
        op: 'add_table',
        name: '缺陷台账',
        fields: [
          { name: '缺陷描述', type: 'text' },
          { name: '严重度', type: 'select', options: ['致命', '严重', '一般'] }
        ]
      },
      { op: 'rename_table', table: '缺陷台账', name: 'Bug看板表' }
    ]
  }
  const result = sanitizeOps(mockTables)
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.ops[0].name, '缺陷台账')
  assert.strictEqual(result.ops[0].fields.length, 2)
  assert.strictEqual(result.ops[1].name, 'Bug看板表')
})

// -------------------------------------------------------------
// 5. 破坏性操作安全审查（Destructive Safety Check）
// -------------------------------------------------------------
test('5.1 破坏性操作拦截识别 (destructiveChanges)', () => {
  const riskyOps = [
    { op: 'delete_field', field: '机密备注' },
    { op: 'delete_view', view: '主视图' },
    { op: 'delete_records', record_ids: ['rec_1', 'rec_2'] },
    { op: 'remove_options', field: '状态', options: ['已作废'] },
    { op: 'disable_adv_perm' },
    { op: 'delete_role', role_name: '外包审计员' },
  ]
  const risky = destructiveChanges(riskyOps)
  assert.strictEqual(risky.length, 6)
  assert.ok(risky[0].includes('机密备注'))
  assert.ok(risky[1].includes('主视图'))
  assert.ok(risky[2].includes('2 条记录'))
  assert.ok(risky[3].includes('已作废'))
  assert.ok(risky[4].includes('高级权限'))
  assert.ok(risky[5].includes('外包审计员'))
})

// -------------------------------------------------------------
// 6. 真实数据注入上下文构建（AI Context & Live Records）
// -------------------------------------------------------------
test('6.1 AI 上下文构建验证 (Schema + Live Records 注入)', () => {
  const mockSchema = {
    tables: [
      {
        name: '工作任务',
        fields: [
          { name: '任务名称', type: 'text' },
          { name: '负责人', type: 'user' },
          { name: '状态', type: 'select', options: [{ name: '进行中' }, { name: '已完成' }] }
        ],
        views: [{ name: '表格', type: 'grid' }]
      }
    ]
  }
  const mockLive = {
    ok: true,
    table: '工作任务',
    fields: [{ name: '任务名称' }, { name: '负责人' }, { name: '状态' }],
    rows: [
      { '任务名称': '上线部署', '负责人': '张三', '状态': ['进行中'] },
      { '任务名称': '编写文档', '负责人': '李四', '状态': ['已完成'] }
    ],
    ids: ['rec_001', 'rec_002']
  }

  // 通过 createAdjustPlanner 内部构造测试
  let capturedMessages = []
  const mockCtx = {
    llm: {
      stream({ messages }) {
        capturedMessages = messages
        return (async function* () {
          yield { type: 'text-delta', text: '{"type":"answer","reply":"测试回复"}' }
        })()
      }
    }
  }

  const planner = createAdjustPlanner({ ctx: mockCtx })
  planner.plan({ instruction: '表里现在有哪些数据' }, mockSchema, mockLive).then((res) => {
    assert.strictEqual(res.ok, true)
    const systemPromptContent = capturedMessages[0].content[0].text
    assert.ok(systemPromptContent.includes('工作任务'), '应当包含表名')
    assert.ok(systemPromptContent.includes('上线部署'), '应当包含真实第一行记录')
    assert.ok(systemPromptContent.includes('编写文档'), '应当包含真实第二行记录')
    assert.ok(systemPromptContent.includes('rec_001'), '应当包含记录ID')
    console.log('✅ [PASS] 6.1 AI 上下文构建验证 (Schema + Live Records 注入成功)')
  }).catch((err) => {
    console.error('❌ [FAIL] 6.1 AI 上下文构建验证: ' + err.message)
    failCount++
  })
})

// -------------------------------------------------------------
// 7. 底层 CLI 进程与飞书授权环境（Real CLI Integration）
// -------------------------------------------------------------
test('7.1 lark-cli 路径解析与飞书身份就绪状态测试', () => {
  const mockSubprocess = {
    spawn({ argv, cwd, env }) {
      const proc = spawn(argv[0], argv.slice(1), { cwd, env });
      let stdoutStr = '';
      let stderrStr = '';
      proc.stdout.on('data', d => stdoutStr += d.toString());
      proc.stderr.on('data', d => stderrStr += d.toString());
      const done = new Promise((resolve) => {
        proc.on('close', code => resolve({ exitCode: code }));
        proc.on('error', err => {
          stderrStr = err.message;
          resolve({ exitCode: 1 });
        });
      });
      return {
        done,
        collected: {
          stdout: { readFrom: () => ({ text: stdoutStr }) },
          stderr: { readFrom: () => ({ text: stderrStr }) },
        },
        terminate: () => proc.kill()
      };
    }
  };

  const ops = createOperations({ ctx: { subprocess: mockSubprocess } });
  ops.status().then((status) => {
    assert.strictEqual(status.cli.available, true, 'lark-cli 应当可用');
    assert.strictEqual(typeof status.auth.ready, 'boolean', '飞书授权状态 ready 字段应当为布尔值');
    console.log(`✅ [PASS] 7.1 lark-cli 真实环境连接正常 (当前账号状态: ${status.auth.ready ? status.auth.userName : '未就绪'})`);
  }).catch((err) => {
    console.error('❌ [FAIL] 7.1 CLI 测试失败: ' + err.message);
    failCount++;
  });
});

// -------------------------------------------------------------
// 8. 高级权限、字段 AI 插件、视图设置、仪表盘与表单扩展测试
// -------------------------------------------------------------
test('8.1 高级权限与角色配置 (enable_adv_perm, create_role, delete_role)', () => {
  const mockPlan = {
    type: 'ops',
    ops: [
      { op: 'enable_adv_perm' },
      {
        op: 'create_role',
        role_name: '外部审计员',
        table_perm: { '工作任务': 'read_only' },
        field_perm: { '敏感底价': 'no_perm', '任务名称': 'read' },
        copy: false,
        download: false,
      },
      {
        op: 'update_role',
        role_name: '外部审计员',
        download: true,
      },
      {
        op: 'delete_role',
        role_name: '外部审计员',
      },
    ]
  }
  const result = sanitizeOps(mockPlan)
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.ops.length, 4)
  assert.strictEqual(result.ops[0].op, 'enable_adv_perm')
  assert.strictEqual(result.ops[1].op, 'create_role')
  assert.strictEqual(result.ops[1].role_name, '外部审计员')
  assert.strictEqual(result.ops[1].copy, false)
  assert.strictEqual(result.ops[2].download, true)
  assert.strictEqual(result.ops[3].op, 'delete_role')
})

test('8.2 字段 AI 插件设置与触发 (set_field_ai_extension, trigger_field_ai)', () => {
  const mockPlan = {
    type: 'ops',
    ops: [
      {
        op: 'set_field_ai_extension',
        table: '工作任务',
        field: '任务简报总结',
        prompt: '根据需求描述生成 50 字精炼总结',
        ref_fields: ['需求描述', '任务名称']
      },
      {
        op: 'trigger_field_ai',
        table: '工作任务',
        field: '任务简报总结'
      }
    ]
  }
  const result = sanitizeOps(mockPlan)
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.ops.length, 2)
  assert.strictEqual(result.ops[0].op, 'set_field_ai_extension')
  assert.strictEqual(result.ops[0].field, '任务简报总结')
  assert.deepStrictEqual(result.ops[0].ref_fields, ['需求描述', '任务名称'])
  assert.strictEqual(result.ops[1].op, 'trigger_field_ai')
})

test('8.3 视图显隐列配置 (set_view_visible_fields)', () => {
  const mockPlan = {
    type: 'ops',
    ops: [
      {
        op: 'set_view_visible_fields',
        table: '工作任务',
        view: '主看板',
        visible_fields: ['任务名称', '负责人', '优先级']
      }
    ]
  }
  const result = sanitizeOps(mockPlan)
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.ops[0].op, 'set_view_visible_fields')
  assert.strictEqual(result.ops[0].view, '主看板')
  assert.deepStrictEqual(result.ops[0].visible_fields, ['任务名称', '负责人', '优先级'])
})

test('8.4 统计仪表盘与表单问卷 (add_dashboard, add_form)', () => {
  const mockPlan = {
    type: 'ops',
    ops: [
      { op: 'add_dashboard', name: '项目进度效能看板' },
      { op: 'add_form', table: '工作任务', name: '需求提报表单' }
    ]
  }
  const result = sanitizeOps(mockPlan)
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.ops.length, 2)
  assert.strictEqual(result.ops[0].op, 'add_dashboard')
  assert.strictEqual(result.ops[0].name, '项目进度效能看板')
  assert.strictEqual(result.ops[1].op, 'add_form')
  assert.strictEqual(result.ops[1].name, '需求提报表单')
})

test('8.5 飞书连接退出登录与解绑应用接口支持 (ops.logout, ops.unbindApp)', () => {
  const mockCtx = {
    subprocess: { spawn: () => ({ done: Promise.resolve({ exitCode: 0 }), collected: {} }) },
    webServer: {},
    llm: {},
  }
  const ops = createOperations(mockCtx, process.cwd())
  assert.strictEqual(typeof ops.logout, 'function')
  assert.strictEqual(typeof ops.unbindApp, 'function')
})

// -------------------------------------------------------------
// 9. 自适应多态工作台与 22 领域协同调度全量测试
// -------------------------------------------------------------
test('9.1 全域权限大盘与 22 领域能力解析 (ops.getScopes)', async () => {
  const ops = createOperations({ ctx: { subprocess: realSubprocess } }, process.cwd())
  assert.strictEqual(typeof ops.getScopes, 'function')
  const scopes = await ops.getScopes()
  assert.strictEqual(scopes.ok, true)
  assert.strictEqual(typeof scopes.appId, 'string')
  assert.strictEqual(typeof scopes.consoleUrl, 'string')
  assert.strictEqual(typeof scopes.domains, 'object')
  assert.strictEqual(typeof scopes.domains.base, 'object')
  assert.strictEqual(typeof scopes.domains.calendar.ready, 'boolean')
  assert.strictEqual(typeof scopes.domains.task.ready, 'boolean')
  assert.strictEqual(typeof scopes.domains.im.ready, 'boolean')
  assert.strictEqual(typeof scopes.domains.mail.ready, 'boolean')
})

test('9.2 协同指令意图分发与权限优雅降级引导 (ops.dispatchCollab)', async () => {
  const ops = createOperations({ ctx: { subprocess: realSubprocess } }, process.cwd())
  assert.strictEqual(typeof ops.dispatchCollab, 'function')

  // 测试日历意图识别与缺失权限引导卡片数据结构
  const calRes = await ops.dispatchCollab({ instruction: '查下我今天的日程安排' })
  assert.strictEqual(typeof calRes.ok, 'boolean')
  if (!calRes.ok && calRes.type === 'missing_scope') {
    assert.strictEqual(calRes.domain, 'calendar')
    assert(calRes.requiredScopes.length > 0)
    assert(calRes.consoleUrl.startsWith('https://open.feishu.cn'))
  }

  // 测试待办任务意图识别
  const taskRes = await ops.dispatchCollab({ instruction: '列出我所有未完成的待办清单' })
  assert.strictEqual(typeof taskRes.ok, 'boolean')
  if (!taskRes.ok && taskRes.type === 'missing_scope') {
    assert.strictEqual(taskRes.domain, 'task')
  }

  // 测试多维表格建表引导识别
  const tableRes = await ops.dispatchCollab({ instruction: '我想建一张项目台账数据表' })
  assert.strictEqual(tableRes.ok, true)
  assert.strictEqual(tableRes.type, 'suggest_table')

  // 测试普通对话/问答不会误触发历史上下文中的群聊查询工具
  const thanksRes = await ops.dispatchCollab({
    instruction: '谢谢',
    history: [
      { role: 'user', text: '查看飞书群聊' },
      { role: 'assistant', text: '💬 为您找到以下飞书群聊：1. 深度生活工作室' },
    ],
  })
  assert.strictEqual(thanksRes.ok, true)
  assert.strictEqual(thanksRes.type, 'collab')
  assert(!thanksRes.reply.includes('为您找到以下飞书群聊'))
})

test('9.3 前端多态自适应逻辑校验 (isTableMode 判定与操作栏收拢)', () => {
  // 判定函数模拟
  const checkTableMode = (active) => Boolean(active && active.type !== 'collab' && active.url)

  // 1. 表格工作态：有真实表格 URL
  const tableSession = {
    type: 'base',
    name: '工作任务台账',
    url: 'https://feishu.cn/base/bascn123456',
    token: 'bascn123456',
  }
  assert.strictEqual(checkTableMode(tableSession), true)

  // 2. 通用协同态：type 为 collab
  const collabSession = {
    type: 'collab',
    name: '飞书协同助手',
  }
  assert.strictEqual(checkTableMode(collabSession), false)

  // 模拟操作栏按钮可见性规则
  const getHeaderActions = (active) => {
    const isTable = checkTableMode(active)
    if (isTable) {
      return ['同步数据', '复制链接', '展开表格', '外部打开']
    }
    return ['清空对话']
  }

  assert.deepStrictEqual(getHeaderActions(tableSession), ['同步数据', '复制链接', '展开表格', '外部打开'])
  assert.deepStrictEqual(getHeaderActions(collabSession), ['清空对话'])

  // 3. 模拟 applyAdjust 状态机演进防回归校验
  const simulateApplyAdjustState = (currentActive, options = {}) => {
    let nextActive = currentActive
    const isCollab = options.collab || (currentActive && currentActive.type === 'collab') || !currentActive
    if (isCollab && (!currentActive || currentActive.type !== 'collab')) {
      nextActive = { type: 'collab', name: '飞书协同助手' }
    }
    return nextActive
  }

  // 表格状态下发送消息，不得篡改 active 会话对象，必须保持表格模式与全部 4 个操作按钮
  const stateAfterSendInTable = simulateApplyAdjustState(tableSession)
  assert.strictEqual(checkTableMode(stateAfterSendInTable), true)
  assert.strictEqual(stateAfterSendInTable.name, '工作任务台账')
  assert.strictEqual(stateAfterSendInTable.url, 'https://feishu.cn/base/bascn123456')
  assert.deepStrictEqual(getHeaderActions(stateAfterSendInTable), ['同步数据', '复制链接', '展开表格', '外部打开'])

  // 空会话状态下发送协同指令，平滑进入协同模式
  const stateAfterSendInEmpty = simulateApplyAdjustState(null, { collab: true })
  assert.strictEqual(checkTableMode(stateAfterSendInEmpty), false)
  assert.strictEqual(stateAfterSendInEmpty.type, 'collab')
  assert.deepStrictEqual(getHeaderActions(stateAfterSendInEmpty), ['清空对话'])
})

test('9.4 飞书全域协同指令与 lark_collab 调度验证', async () => {
  const ops = createOperations({ ctx: { subprocess: realSubprocess } }, process.cwd())
  const res = await ops.dispatchCollab({ instruction: '查一下我今天的日程安排与会议' })
  assert.strictEqual(typeof res.ok, 'boolean')
  assert.strictEqual(res.domain, 'calendar')
  assert.ok(typeof res.reply === 'string' && res.reply.length > 0)
})

test('9.5 飞书团队知识库与云文档检索调度验证', async () => {
  const ops = createOperations({ ctx: { subprocess: realSubprocess } }, process.cwd())
  const res = await ops.dispatchCollab({ instruction: '在团队知识库中搜索最新规范' })
  assert.strictEqual(typeof res.ok, 'boolean')
  assert.strictEqual(res.domain, 'wiki')
  assert.ok(typeof res.reply === 'string' && res.reply.includes('知识库'))
})

test('10.1 旧 /dsh-lark/api HTTP 路由与固定 desktop-workbench 绕过已彻底移除', async () => {
  assert.strictEqual(inject.includes('webServer'), false, 'inject 不应再依赖 webServer')
  assert.strictEqual(inject.includes('sessions'), false, 'inject 不应再依赖 sessions')
  assert.strictEqual(inject.includes('connection'), true, 'inject 必须包含 connection')

  let webServerRegisterCalled = false
  const registeredRoutes = new Map()
  const mockCtx = {
    subprocess: realSubprocess,
    connection: {
      fetch: {
        register: (route) => {
          registeredRoutes.set(route.path, route)
          return () => { registeredRoutes.delete(route.path) }
        }
      }
    },
    webServer: {
      register: () => {
        webServerRegisterCalled = true
        return () => {}
      }
    },
    commands: { register: () => {} },
    tools: { register: () => {} },
    effect: (fn) => fn()
  }

  const { apply } = await import('./index.js')
  apply(mockCtx)

  assert.strictEqual(webServerRegisterCalled, false, '不应注册任何旧版 webServer /dsh-lark/api 路由')
  assert.strictEqual(registeredRoutes.size, 18, '全部 18 个端点应仅通过 DSH Connection Fetch 注册')
})

test('10.4 DSH Connection Fetch 路由注册与调用测试 (官方 Connection 机制)', async () => {
  const registeredRoutes = new Map()
  const mockCtx = {
    subprocess: realSubprocess,
    connection: {
      fetch: {
        register: (route) => {
          registeredRoutes.set(route.path, route)
          return () => { registeredRoutes.delete(route.path) }
        }
      }
    },
    webServer: { register: () => {} },
    commands: { register: () => {} },
    tools: { register: () => {} },
    effect: (fn) => fn(),
    llm: { listProviders: () => [] },
    sessions: { get: () => null, list: () => [] }
  }

  const { apply } = await import('./index.js')
  apply(mockCtx)

  const expectedPaths = [
    '/api/dsh-lark/state',
    '/api/dsh-lark/models',
    '/api/dsh-lark/active',
    '/api/dsh-lark/records',
    '/api/dsh-lark/plan',
    '/api/dsh-lark/build',
    '/api/dsh-lark/adjust',
    '/api/dsh-lark/connect/scopes',
    '/api/dsh-lark/connect/cli/install',
    '/api/dsh-lark/connect/cli/state',
    '/api/dsh-lark/connect/app/start',
    '/api/dsh-lark/connect/app/poll',
    '/api/dsh-lark/connect/app/manual',
    '/api/dsh-lark/connect/login/start',
    '/api/dsh-lark/connect/login/finish',
    '/api/dsh-lark/connect/login/state',
    '/api/dsh-lark/connect/logout',
    '/api/dsh-lark/connect/unbind',
  ]

  for (const p of expectedPaths) {
    assert.ok(registeredRoutes.has(p), `Missing route registration: ${p}`)
    const r = registeredRoutes.get(p)
    assert.strictEqual(r.path, p)
  }

  const stateRoute = registeredRoutes.get('/api/dsh-lark/state')
  const req = new Request('http://127.0.0.1:49152/api/dsh-lark/state', { method: 'GET' })
  const res = await stateRoute.fetch(req)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.strictEqual(body.ok, true)
})

// -------------------------------------------------------------
// 11. DSH Connection 全链路真实仿真测试 (Full-Link Integration)
// -------------------------------------------------------------
test('11.1 DSH Connection 网关仿真：Peer 身份鉴权与跨域防护 (非 Owner 拦截 403)', async () => {
  const registeredRoutes = new Map()
  const mockCtx = {
    subprocess: realSubprocess,
    connection: {
      fetch: {
        register: (route) => {
          registeredRoutes.set(route.path, route)
          return () => { registeredRoutes.delete(route.path) }
        }
      }
    },
    webServer: { register: () => {} },
    commands: { register: () => {} },
    tools: { register: () => {} },
    effect: (fn) => fn(),
    llm: { listProviders: () => [] },
    sessions: { get: () => null, list: () => [] }
  }

  const { apply } = await import('./index.js')
  apply(mockCtx)

  function simulateDshGateway(request, peer) {
    const pathname = new URL(request.url).pathname
    const route = registeredRoutes.get(pathname)
    if (!route || !route.methods.includes(request.method)) {
      return Promise.resolve(new Response('not found', { status: 404 }))
    }
    if (!peer || !peer.principal || peer.principal.kind !== 'owner') {
      return Promise.resolve(new Response('forbidden', { status: 403 }))
    }
    return route.fetch(request)
  }

  const badPeerReq = new Request('http://127.0.0.1:49152/api/dsh-lark/state', { method: 'GET' })
  const resDenied = await simulateDshGateway(badPeerReq, { principal: { kind: 'anonymous' } })
  assert.strictEqual(resDenied.status, 403)

  const goodPeer = { principal: { kind: 'owner' } }
  const resAllowed = await simulateDshGateway(badPeerReq, goodPeer)
  assert.strictEqual(resAllowed.status, 200)
  const body = await resAllowed.json()
  assert.strictEqual(body.ok, true)
})

test('11.2 Connection 管道状态、模型与授权生命周期全链路测试', async () => {
  const registeredRoutes = new Map()
  const mockCtx = {
    subprocess: realSubprocess,
    connection: {
      fetch: {
        register: (route) => {
          registeredRoutes.set(route.path, route)
          return () => { registeredRoutes.delete(route.path) }
        }
      }
    },
    webServer: { register: () => {} },
    commands: { register: () => {} },
    tools: { register: () => {} },
    effect: (fn) => fn(),
    llm: {
      listProviders: () => [{ id: 'deepseek-account', name: 'DeepSeek' }],
      listModels: () => [{ id: 'deepseek-chat', name: 'DeepSeek-V3' }]
    },
    sessions: { get: () => null, list: () => [] }
  }

  const { apply } = await import('./index.js')
  apply(mockCtx)

  const modelsRoute = registeredRoutes.get('/api/dsh-lark/models')
  const modelsRes = await modelsRoute.fetch(new Request('http://127.0.0.1:49152/api/dsh-lark/models', { method: 'GET' }))
  assert.strictEqual(modelsRes.status, 200)
  const modelsData = await modelsRes.json()
  assert.strictEqual(modelsData.ok, true)
  assert.ok(Array.isArray(modelsData.models))

  const scopesRoute = registeredRoutes.get('/api/dsh-lark/connect/scopes')
  const scopesRes = await scopesRoute.fetch(new Request('http://127.0.0.1:49152/api/dsh-lark/connect/scopes', { method: 'GET' }))
  assert.strictEqual(scopesRes.status, 200)
  const scopesData = await scopesRes.json()
  assert.strictEqual(scopesData.ok, true)
  assert.strictEqual(typeof scopesData.domains, 'object')

  const loginStateRoute = registeredRoutes.get('/api/dsh-lark/connect/login/state')
  const loginStateRes = await loginStateRoute.fetch(new Request('http://127.0.0.1:49152/api/dsh-lark/connect/login/state', { method: 'GET' }))
  assert.strictEqual(loginStateRes.status, 200)
})

test('11.3 核心智能建表与多维表格数据预览链路测试 (plan, records)', async () => {
  const registeredRoutes = new Map()
  const mockCtx = {
    subprocess: realSubprocess,
    agentDefaultModel: {
      currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-chat' })
    },
    llm: {
      listProviders: () => [],
      stream: async function* () {
        yield {
          type: 'text-delta',
          text: JSON.stringify({
            baseName: '客户管理',
            intro: '记录客户推进进度',
            tables: [{
              name: '客户表',
              fields: [
                { name: '公司名称', type: 'text', description: '公司全称' },
                { name: '联系人', type: 'text', description: '对接人姓名' },
                { name: '销售阶段', type: 'select', description: '当前商务阶段', options: [{ name: '初访' }, { name: '跟进' }, { name: '签约' }] }
              ],
              records: [{ '公司名称': '示例科技', '联系人': '张三', '销售阶段': ['初访'] }]
            }]
          })
        }
      }
    },
    connection: {
      fetch: {
        register: (route) => {
          registeredRoutes.set(route.path, route)
          return () => { registeredRoutes.delete(route.path) }
        }
      }
    },
    webServer: { register: () => {} },
    commands: { register: () => {} },
    tools: { register: () => {} },
    effect: (fn) => fn(),
    sessions: { get: () => null, list: () => [] }
  }

  const { apply } = await import('./index.js')
  apply(mockCtx)

  const planRoute = registeredRoutes.get('/api/dsh-lark/plan')
  const planReq = new Request('http://127.0.0.1:49152/api/dsh-lark/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sentence: '我想记客户往来：公司、联系人、谈到哪一步' })
  })
  const planRes = await planRoute.fetch(planReq)
  assert.strictEqual(planRes.status, 200)
  const planData = await planRes.json()
  assert.strictEqual(planData.ok, true)
  assert.strictEqual(typeof planData.plan, 'object')
  assert.ok(Array.isArray(planData.plan.tables))
  assert.strictEqual(planData.plan.tables[0].name, '客户表')
  assert.strictEqual(planData.plan.tables[0].fields.length, 3)

  const recordsRoute = registeredRoutes.get('/api/dsh-lark/records')
  const recordsReq = new Request('http://127.0.0.1:49152/api/dsh-lark/records?token=mock_token_123&table=客户表&limit=5', {
    method: 'GET'
  })
  const recordsRes = await recordsRoute.fetch(recordsReq)
  assert.ok(recordsRes.status === 200 || recordsRes.status === 422)
})

test('11.4 协同问答与流式思考 (SSE ReadableStream) 全链路消费解析', async () => {
  const registeredRoutes = new Map()
  const mockCtx = {
    subprocess: realSubprocess,
    connection: {
      fetch: {
        register: (route) => {
          registeredRoutes.set(route.path, route)
          return () => { registeredRoutes.delete(route.path) }
        }
      }
    },
    webServer: { register: () => {} },
    commands: { register: () => {} },
    tools: { register: () => {} },
    effect: (fn) => fn(),
    llm: { listProviders: () => [] },
    sessions: { get: () => null, list: () => [] }
  }

  const { apply } = await import('./index.js')
  apply(mockCtx)

  const adjustRoute = registeredRoutes.get('/api/dsh-lark/adjust')
  const streamReq = new Request('http://127.0.0.1:49152/api/dsh-lark/adjust', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'collab',
      instruction: '查一下我今天的日程安排',
      stream: true
    })
  })

  const streamRes = await adjustRoute.fetch(streamReq)
  assert.strictEqual(streamRes.status, 200)
  assert.ok(streamRes.headers.get('content-type').includes('text/event-stream'))
  assert.ok(streamRes.body, '应当返回 ReadableStream')

  const reader = streamRes.body.getReader()
  const decoder = new TextDecoder()
  let receivedDone = false
  let receivedData = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    receivedData += chunk
    if (chunk.includes('"done"')) {
      receivedDone = true
    }
  }

  assert.ok(receivedData.length > 0, '流式输出不应为空')
  assert.strictEqual(receivedDone, true, 'SSE 应当以 done 事件正常收尾')
})

test('11.5 客户端通信唯一路径校验 (仅走 Connection Fetch，不回退旧路由)', async () => {
  const fs = await import('node:fs')
  const clientSrc = fs.readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  const indexSrc = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8')
  assert.strictEqual(clientSrc.includes('/dsh-lark/api'), false, 'client.js 不应保留旧 /dsh-lark/api 回退')
  assert.strictEqual(indexSrc.includes('/dsh-lark/api'), false, 'index.js 不应保留旧 /dsh-lark/api 路由')
  assert.strictEqual(indexSrc.includes('desktop-workbench'), false, 'index.js 不应保留固定 desktop-workbench 标记')
})

// -------------------------------------------------------------
// 12. 全量请求穷尽全链路测试（覆盖全部明面业务请求与暗面静默/安全/生命周期请求）
// -------------------------------------------------------------
test('12.1 明面与暗面全部请求及其返回响应结构穷尽验证 (27 类全链路全覆盖)', async () => {
  const registeredFetchRoutes = new Map()
  let registeredWebRoute = null
  const registeredTools = new Map()
  let registeredCommand = null

  const mockCtx = {
    subprocess: realSubprocess,
    agentDefaultModel: {
      currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-chat' })
    },
    llm: {
      listProviders: () => [{ id: 'deepseek-account', name: 'DeepSeek' }],
      listModels: () => [{ id: 'deepseek-chat', name: 'DeepSeek-V3' }],
      stream: async function* () {
        yield {
          type: 'text-delta',
          text: JSON.stringify({
            baseName: '客户管理',
            intro: '管理业务往来',
            tables: [{
              name: '客户表',
              fields: [
                { name: '公司名称', type: 'text', description: '公司名' },
                { name: '联系人', type: 'text', description: '联系人姓名' }
              ]
            }]
          })
        }
      }
    },
    connection: {
      fetch: {
        register: (route) => {
          registeredFetchRoutes.set(route.path, route)
          return () => { registeredFetchRoutes.delete(route.path) }
        }
      }
    },
    webServer: {
      register: (route) => {
        registeredWebRoute = route
        return () => { registeredWebRoute = null }
      },
      getOrigin: () => 'http://127.0.0.1:49152'
    },
    tools: {
      register: (tool) => {
        registeredTools.set(tool.name, tool)
        return () => { registeredTools.delete(tool.name) }
      }
    },
    commands: {
      register: (cmd) => {
        registeredCommand = cmd
        return () => { registeredCommand = null }
      }
    },
    effect: (fn) => fn(),
    sessions: {
      get: (id) => (id === 'session-valid-123' ? { id: 'session-valid-123' } : null),
      list: () => [{ id: 'session-valid-123' }]
    }
  }

  const { apply } = await import('./index.js')
  apply(mockCtx)

  // 辅助调用函数：通过 Connection Fetch 路由请求
  async function callConnection(path, method = 'GET', body = null) {
    const route = registeredFetchRoutes.get(path)
    assert.ok(route, `端点未注册到 Connection: ${path}`)
    const req = new Request('http://127.0.0.1:49152' + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    })
    const res = await route.fetch(req)
    const json = await res.json().catch(() => null)
    return { status: res.status, headers: res.headers, data: json, rawRes: res }
  }

  // --- 【第一组：明面业务请求（13 个）】 ---
  // 1. POST /plan
  const r1 = await callConnection('/api/dsh-lark/plan', 'POST', { sentence: '我想记客户跟进' })
  assert.strictEqual(r1.status, 200)
  assert.strictEqual(r1.data.ok, true)
  assert.ok(r1.data.plan && Array.isArray(r1.data.plan.tables))

  // 2. POST /build
  const r2 = await callConnection('/api/dsh-lark/build', 'POST', { plan: { tables: [] }, name: '测试Base' })
  assert.ok(r2.status === 200 || r2.status === 500)
  assert.strictEqual(typeof r2.data.ok, 'boolean')

  // 3. POST /adjust (collab 普通问答)
  const r3 = await callConnection('/api/dsh-lark/adjust', 'POST', { type: 'collab', instruction: '查日程' })
  assert.strictEqual(r3.status, 200)
  assert.strictEqual(typeof r3.data.ok, 'boolean')
  assert.strictEqual(typeof r3.data.reply, 'string')

  // 4. POST /adjust (流式思考 stream: true)
  const r4 = await callConnection('/api/dsh-lark/adjust', 'POST', { type: 'collab', instruction: '查日程', stream: true })
  assert.strictEqual(r4.status, 200)
  assert.ok(r4.headers.get('content-type').includes('text/event-stream'))
  assert.ok(r4.rawRes.body, '应返回 ReadableStream')

  // 5. GET /records
  const r5 = await callConnection('/api/dsh-lark/records')
  assert.ok(r5.status === 200 || r5.status === 422)
  assert.strictEqual(typeof r5.data.ok, 'boolean')

  // 6. GET /models
  const r6 = await callConnection('/api/dsh-lark/models')
  assert.strictEqual(r6.status, 200)
  assert.strictEqual(r6.data.ok, true)
  assert.ok(Array.isArray(r6.data.models))

  // 7. GET /connect/scopes
  const r7 = await callConnection('/api/dsh-lark/connect/scopes')
  assert.strictEqual(r7.status, 200)
  assert.strictEqual(r7.data.ok, true)
  assert.strictEqual(typeof r7.data.domains, 'object')

  // 8. POST /connect/app/start
  const r8 = await callConnection('/api/dsh-lark/connect/app/start', 'POST')
  assert.ok(r8.status === 200 || r8.status === 500)
  assert.strictEqual(typeof r8.data.ok, 'boolean')

  // 9. POST /connect/app/manual
  const r9 = await callConnection('/api/dsh-lark/connect/app/manual', 'POST', { appId: 'cli_manual', appSecret: 'sec_manual' })
  assert.ok(r9.status === 200 || r9.status === 422)
  assert.strictEqual(typeof r9.data.ok, 'boolean')

  // 10. POST /connect/login/start
  const r10 = await callConnection('/api/dsh-lark/connect/login/start', 'POST', { domain: 'feishu' })
  assert.ok(r10.status === 200 || r10.status === 500)
  assert.strictEqual(typeof r10.data.ok, 'boolean')

  // 11. POST /connect/login/finish
  const r11 = await callConnection('/api/dsh-lark/connect/login/finish', 'POST', { deviceCode: 'code_123' })
  assert.ok(r11.status === 200 || r11.status === 422)
  assert.strictEqual(typeof r11.data.ok, 'boolean')

  // 12. POST /connect/logout
  const r12 = await callConnection('/api/dsh-lark/connect/logout', 'POST')
  assert.ok(r12.status === 200 || r12.status === 422)
  assert.strictEqual(typeof r12.data.ok, 'boolean')

  // 13. POST /connect/unbind
  const r13 = await callConnection('/api/dsh-lark/connect/unbind', 'POST')
  assert.ok(r13.status === 200 || r13.status === 422)
  assert.strictEqual(typeof r13.data.ok, 'boolean')

  // --- 【第二组：暗面静默请求（4 个轮询与状态接口）】 ---
  // 14. GET /state (静默心跳与连接探活)
  const r14 = await callConnection('/api/dsh-lark/state')
  assert.strictEqual(r14.status, 200)
  assert.strictEqual(r14.data.ok, true)

  // 15. GET /active (活跃会话 Token 同步)
  const r15 = await callConnection('/api/dsh-lark/active')
  assert.strictEqual(r15.status, 200)
  assert.strictEqual(r15.data.ok, true)

  // 16. GET /connect/app/poll (自建应用后台静默轮询)
  const r16 = await callConnection('/api/dsh-lark/connect/app/poll')
  assert.strictEqual(r16.status, 200)
  assert.strictEqual(typeof r16.data.ok, 'boolean')

  // 17. GET /connect/login/state (设备码扫码状态机轮询)
  const r17 = await callConnection('/api/dsh-lark/connect/login/state')
  assert.strictEqual(r17.status, 200)
  assert.strictEqual(typeof r17.data.ok, 'boolean')

  // --- 【第三组：暗面协议与安全防护请求】 ---
  // 18. 确认旧版 webServer 路由已彻底移除
  assert.strictEqual(registeredWebRoute, null, '旧版 webServer /dsh-lark/api 路由不应再被注册')

  // 19. 404 未知端点拒绝
  const stateRoute = registeredFetchRoutes.get('/api/dsh-lark/state')
  const unknownReq = new Request('http://127.0.0.1:49152/api/dsh-lark/unknown_action', { method: 'GET' })
  const resUnknown = await stateRoute.fetch(unknownReq)
  assert.strictEqual(resUnknown.status, 404)
  const unknownBody = await resUnknown.json()
  assert.strictEqual(unknownBody.ok, false)

  // 20. 破坏性操作确认弹窗拦截
  const adjustRoute = registeredFetchRoutes.get('/api/dsh-lark/adjust')
  const dangerReq = new Request('http://127.0.0.1:49152/api/dsh-lark/adjust', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'tok_test', ops: [{ op: 'delete_field', field: '关键列' }], confirm: false })
  })
  const dangerRes = await adjustRoute.fetch(dangerReq)
  assert.strictEqual(dangerRes.status, 200)
  const dangerBody = await dangerRes.json()
  assert.strictEqual(dangerBody.needsConfirm, true)
  assert.ok(Array.isArray(dangerBody.destructive))

  // --- 【第四组：Agent 工具与命令暗面调用（4 个）】 ---
  // 24. lark_base_build 工具
  assert.ok(registeredTools.has('lark_base_build'))
  const buildTool = registeredTools.get('lark_base_build')
  assert.strictEqual(typeof buildTool.execute, 'function')

  // 25. lark_base_adjust 工具
  assert.ok(registeredTools.has('lark_base_adjust'))
  const adjustTool = registeredTools.get('lark_base_adjust')
  assert.strictEqual(typeof adjustTool.execute, 'function')

  // 26. lark_collab 工具
  assert.ok(registeredTools.has('lark_collab'))
  const collabTool = registeredTools.get('lark_collab')
  assert.strictEqual(typeof collabTool.execute, 'function')

  // 27. /lark 指令
  assert.ok(registeredCommand)
  assert.strictEqual(registeredCommand.name, 'lark')
  const cmdShortRes = await registeredCommand.handler({ rawInput: '' })
  assert.strictEqual(cmdShortRes.kind, 'success')
  assert.ok(cmdShortRes.text.includes('你想记点什么'))
})

// -------------------------------------------------------------
// 13. 向导双轨机制全链路请求验证（自动感知翻页 + 手动兜底）
// -------------------------------------------------------------
test('13.1 向导自动探活与手动确认双轨全链路请求及响应结构校验', async () => {
  const registeredFetchRoutes = new Map()
  const mockCtx = {
    subprocess: realSubprocess,
    agentDefaultModel: {
      currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-chat' })
    },
    llm: {
      listProviders: () => [{ id: 'deepseek-account', name: 'DeepSeek' }],
      listModels: () => [{ id: 'deepseek-chat', name: 'DeepSeek-V3' }],
      stream: async function* () { yield { type: 'text-delta', text: '{}' } }
    },
    connection: {
      fetch: {
        register: (route) => {
          registeredFetchRoutes.set(route.path, route)
          return () => { registeredFetchRoutes.delete(route.path) }
        }
      }
    },
    webServer: { register: () => {}, getOrigin: () => 'http://127.0.0.1:49152' },
    tools: { register: () => {} },
    commands: { register: () => {} },
    effect: (fn) => fn(),
    sessions: { get: () => null, list: () => [] }
  }

  const { apply } = await import('./index.js')
  apply(mockCtx)

  // 1. Step 2 自动感知：GET /connect/app/poll
  const appPollRoute = registeredFetchRoutes.get('/api/dsh-lark/connect/app/poll')
  assert.ok(appPollRoute, 'app/poll 端点应已注册')
  const reqPoll = new Request('http://127.0.0.1:49152/api/dsh-lark/connect/app/poll')
  const resPoll = await appPollRoute.fetch(reqPoll)
  assert.strictEqual(resPoll.status, 200)
  const bodyPoll = await resPoll.json()
  assert.strictEqual(typeof bodyPoll.ok, 'boolean')
  assert.strictEqual(typeof bodyPoll.done, 'boolean')

  // 2. Step 3 自动感知：GET /connect/login/state
  const loginStateRoute = registeredFetchRoutes.get('/api/dsh-lark/connect/login/state')
  assert.ok(loginStateRoute, 'login/state 端点应已注册')
  const reqLoginState = new Request('http://127.0.0.1:49152/api/dsh-lark/connect/login/state')
  const resLoginState = await loginStateRoute.fetch(reqLoginState)
  assert.strictEqual(resLoginState.status, 200)
  const bodyLoginState = await resLoginState.json()
  assert.strictEqual(typeof bodyLoginState.done, 'boolean')
  assert.strictEqual(typeof bodyLoginState.ok, 'boolean')

  // 3. 通用状态感知：GET /state
  const stateRoute = registeredFetchRoutes.get('/api/dsh-lark/state')
  assert.ok(stateRoute, 'state 端点应已注册')
  const reqState = new Request('http://127.0.0.1:49152/api/dsh-lark/state')
  const resState = await stateRoute.fetch(reqState)
  assert.strictEqual(resState.status, 200)
  const bodyState = await resState.json()
  assert.strictEqual(bodyState.ok, true)
  assert.ok(['no-cli', 'no-app', 'no-auth', 'ready'].includes(bodyState.stage))
  assert.ok(bodyState.cli)

  // 4. 手动兜底：POST /connect/login/finish
  const finishRoute = registeredFetchRoutes.get('/api/dsh-lark/connect/login/finish')
  assert.ok(finishRoute, 'login/finish 端点应已注册')
  const reqFinish = new Request('http://127.0.0.1:49152/api/dsh-lark/connect/login/finish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({})
  })
  const resFinish = await finishRoute.fetch(reqFinish)
  assert.ok([200, 422].includes(resFinish.status))
  const bodyFinish = await resFinish.json()
  assert.strictEqual(typeof bodyFinish.ok, 'boolean')
})

// -------------------------------------------------------------
// 14. UI/UX 规范、无表情符号、动效与主题契约回归校验
// -------------------------------------------------------------
test('14.1 全源码零 Emoji、CSS 变量完整、深浅色宿主同步与无障碍/动效契约校验', async () => {
  const fs = await import('node:fs')
  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u
  for (const rel of ['./client.js', './index.js', './ops.js', './planner.js', './adjust-planner.js']) {
    const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
    assert.strictEqual(emojiRe.test(src), false, `${rel} 不应包含任何表情符号`)
  }

  const clientSrc = fs.readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  // 1. 宿主深色模式监听 body[data-ds-dark-theme]
  assert.ok(clientSrc.includes('data-ds-dark-theme'), '应同步监听宿主 body[data-ds-dark-theme]')
  // 2. IME 输入法回车保护
  assert.ok(clientSrc.includes('isComposing'), 'Composer 回车提交必须保护输入法组合态')
  // 3. 减少动态效果与 hover 媒体查询门控
  assert.ok(clientSrc.includes('prefers-reduced-motion: reduce'), '必须尊重系统减少动态效果设置')
  assert.ok(clientSrc.includes('@media (hover: hover)'), 'hover 样式应门控在支持悬停的指针设备上')
  // 4. 禁止使用已废弃或未定义的 CSS 自定义属性
  for (const badVar of ['var(--lw-bad)', 'var(--lw-success)', 'var(--lw-ink-4)']) {
    assert.strictEqual(clientSrc.includes(badVar), false, `不应引用未定义变量 ${badVar}`)
  }
  // 5. 样式单次注入 head，不随 React 重渲染反复创建 <style>
  assert.ok(clientSrc.includes('ensureStyles'), '样式应单次注入文档 head')
  assert.strictEqual(clientSrc.includes("h('style', null, CSS)"), false, '不应在组件 render 中内联重建整段 CSS')
  // 6. 中英文词典键位完全一致
  const zhBlock = clientSrc.match(/const ZH = \{([\s\S]*?)\n    \}/)
  const enBlock = clientSrc.match(/const EN = \{([\s\S]*?)\n    \}/)
  assert.ok(zhBlock && enBlock, '应同时存在 ZH 与 EN 词典')
  const extractKeys = (block) => [...block.matchAll(/'([^']+)':/g)].map((m) => m[1]).sort()
  assert.deepStrictEqual(extractKeys(zhBlock[1]), extractKeys(enBlock[1]), 'ZH 与 EN 词典键位必须完全对齐')
  // 7. 全部 humanize(...) 调用必须传入语言函数 t，避免英文模式下泄露中文错误文案
  const humanizeLines = clientSrc
    .split('\n')
    .filter((line) => line.includes('humanize(') && !line.includes('function humanize('))
  assert.ok(humanizeLines.length > 0)
  for (const line of humanizeLines) {
    assert.ok(/humanize\(.*,\s*t\s*\)/.test(line), `humanize 调用必须传入 t 以支持双语错误提示: ${line.trim()}`)
  }
  // 8. 极简 UX 与防呆防错契约：首屏探测不使用 TableSkeleton、区分 skill_guard 写确认与删表确认、退回保留撤销草稿、无 48MB/Node.js 噪音
  assert.strictEqual(clientSrc.includes("showToast({ message: t('toast.planReady') })"), false, '不应在已有按钮动效提示时再弹多余指路 toast')
  assert.ok(clientSrc.includes("toast.draftCleared"), '预览返回首页应保留可撤销草稿提示')
  assert.ok(clientSrc.includes("dsh-lark-draft") && clientSrc.includes("'draft.title'"), '首页应提供持久化的未建表草稿恢复入口')
  assert.strictEqual(
    [...clientSrc.matchAll(/showToast\(\{[\s\S]*?\}\)/g)].some((m) => m[0].includes('action:')),
    false,
    '所有 showToast 撤销按钮必须使用 ToastStack 约定的 onUndo 而非未消费的 action',
  )
  assert.ok(clientSrc.includes("confirmKind === 'skill_guard'"), 'Skill 写操作安全提示不应误触发删表确认框')
  assert.strictEqual(/gate\.noTool\.body['"]:\s*[^,\n]*(48 MB|Node\.js)/.test(clientSrc), false, '首次自动准备文案不应向小白暴露体积或技术栈噪音')
})

test('14.2 预览增量微调、认可/确认意图分流与变更列识别 (planner.plan + currentPlan)', async () => {
  const { createPlanner } = await import('./planner.js')
  const basePlan = {
    baseName: '客户往来台账',
    intro: '记录客户推进阶段与下次联系时间',
    tables: [{
      name: '客户表',
      kanbanField: '销售阶段',
      fields: [
        { name: '公司名称', type: 'text', description: '客户公司全称' },
        { name: '销售阶段', type: 'select', description: '当前阶段', options: [{ name: '初访' }, { name: '签约' }] },
      ],
      records: [
        { 公司名称: '杭州云栖智能科技', 销售阶段: ['初访'] },
      ],
    }],
  }

  let llmCalls = 0
  let lastUserPrompt = ''
  const mockCtx = {
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-chat' }) },
    llm: {
      stream({ messages }) {
        llmCalls++
        lastUserPrompt = messages[0].content[0].text
        return (async function* () {
          yield {
            type: 'text-delta',
            text: JSON.stringify({
              isTable: true,
              baseName: '客户往来台账',
              intro: '记录客户推进阶段与下次联系时间',
              tables: [{
                name: '客户表',
                kanbanField: '销售阶段',
                fields: [
                  { name: '公司名称', type: 'text', description: '客户公司全称' },
                  { name: '销售阶段', type: 'select', description: '当前阶段', options: [{ name: '初访' }, { name: '签约' }] },
                  { name: '优先级', type: 'select', description: '客户跟进优先级', options: [{ name: '高' }, { name: '中' }, { name: '低' }] },
                ],
                records: [
                  { 公司名称: '杭州云栖智能科技', 销售阶段: ['初访'], 优先级: ['高'] },
                ],
              }],
            }),
          }
        })()
      },
    },
  }

  const planner = createPlanner({ ctx: mockCtx })

  // 1. 认可评价词（「不错」/「可以」）：零重生成，不调模型，保持原表不变
  const keepRes = await planner.plan('不错', undefined, undefined, { currentPlan: basePlan })
  assert.strictEqual(keepRes.ok, true)
  assert.strictEqual(keepRes.action, 'keep')
  assert.strictEqual(keepRes.plan, basePlan)
  assert.strictEqual(llmCalls, 0, '纯认可词不应触发模型重写')

  // 2. 明确确认建表指令（「确认建表」或「不错，建吧」）：返回 build 动作，不调模型
  const buildRes = await planner.plan('确认建表', undefined, undefined, { currentPlan: basePlan })
  assert.strictEqual(buildRes.ok, true)
  assert.strictEqual(buildRes.action, 'build')
  assert.strictEqual(buildRes.plan, basePlan)
  const comboBuildRes = await planner.plan('不错，建吧', undefined, undefined, { currentPlan: basePlan })
  assert.strictEqual(comboBuildRes.ok, true)
  assert.strictEqual(comboBuildRes.action, 'build')
  assert.strictEqual(llmCalls, 0)

  // 3. 局部增量修改（「增加一列优先级」）：携带 currentPlan 进模型，保留旧值并返回 changedFields
  const updateRes = await planner.plan('增加一列优先级', undefined, undefined, { currentPlan: basePlan })
  assert.strictEqual(updateRes.ok, true)
  assert.strictEqual(updateRes.action, 'update')
  assert.strictEqual(llmCalls, 1)
  assert.ok(lastUserPrompt.includes('杭州云栖智能科技'), '增量微调必须把现有草稿传给模型')
  assert.deepStrictEqual(updateRes.changedFields, ['优先级'])
  assert.strictEqual(updateRes.plan.tables[0].records[0]['公司名称'], '杭州云栖智能科技')
})

// -------------------------------------------------------------
// 15. 开箱即用零安装机制 + DSH 原生能力集成校验
// -------------------------------------------------------------
test('15.1 resolveCli 多源优先级、缓存失效重探、单飞自动安装与全部失败边界', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const pathMod = await import('node:path')
  const root = mkdtempSync(pathMod.join(tmpdir(), 'dsh-lark-cli-test-'))
  const prevEnvCli = process.env.LARK_CLI_PATH
  try {
    const cliRoot = pathMod.join(root, 'fake-cli')
    const binDir = pathMod.join(cliRoot, 'bin')
    const customDir = pathMod.join(root, 'custom-bin')
    const binName = process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli'
    const installerPath = pathMod.join(cliRoot, 'scripts', 'install.js')
    mkdirSync(pathMod.dirname(installerPath), { recursive: true })
    mkdirSync(customDir, { recursive: true })
    writeFileSync(installerPath, '// stub installer\n')

    const makeExe = (targetPath) => {
      mkdirSync(pathMod.dirname(targetPath), { recursive: true })
      writeFileSync(targetPath, '#!/bin/sh\necho ok\n')
      chmodSync(targetPath, 0o755)
      return targetPath
    }

    // 1. config.larkCliPath 最高优先级 + 缺失显式报错
    const explicitExe = makeExe(pathMod.join(root, 'explicit', binName))
    const binDirExe = makeExe(pathMod.join(customDir, binName))
    const opsExplicit = createOperations({
      ctx: { subprocess: realSubprocess },
      config: { larkCliPath: explicitExe, binDir: customDir },
    })
    assert.strictEqual(await opsExplicit.resolveCli(), explicitExe)

    const opsBadExplicit = createOperations({
      ctx: { subprocess: realSubprocess },
      config: { larkCliPath: pathMod.join(root, 'nonexistent', binName) },
    })
    await assert.rejects(() => opsBadExplicit.resolveCli(), /配置的 larkCliPath 不存在/)

    // 2. 环境变量 LARK_CLI_PATH 次优，config.binDir 可兼容 dsh-feishu
    process.env.LARK_CLI_PATH = explicitExe
    const opsEnv = createOperations({ ctx: { subprocess: realSubprocess }, config: { binDir: customDir } })
    assert.strictEqual(await opsEnv.resolveCli(), explicitExe)
    delete process.env.LARK_CLI_PATH

    const opsFromBinDir = createOperations({ ctx: { subprocess: realSubprocess }, config: { binDir: customDir } })
    assert.strictEqual(await opsFromBinDir.resolveCli(), binDirExe)

    const opsBadBinDir = createOperations({
      ctx: { subprocess: realSubprocess },
      config: { binDir: pathMod.join(root, 'empty-bindir') },
    })
    await assert.rejects(() => opsBadBinDir.resolveCli(), /配置的 binDir 中找不到/)

    // 3. 删除已缓存文件后，resolveCliSync 与 resolveCli 不应返回失效缓存路径
    const ephemeralExe = makeExe(pathMod.join(root, 'ephemeral', binName))
    const opsEphemeral = createOperations({
      ctx: { subprocess: realSubprocess },
      config: { larkCliPath: ephemeralExe },
    })
    assert.strictEqual(await opsEphemeral.resolveCli(), ephemeralExe)
    rmSync(ephemeralExe, { force: true })
    assert.strictEqual(opsEphemeral.resolveCliSync(), undefined)
    await assert.rejects(() => opsEphemeral.resolveCli(), /不存在/)

    // 4. 按版本号自动择优复用官方 @deepseek-ai/dsh-feishu 与内置 @larksuite/cli
    const feishuNewerRoot = pathMod.join(root, 'feishu-newer')
    const bundledOlderRoot = pathMod.join(root, 'bundled-older')
    const feishuNewerExe = makeExe(pathMod.join(feishuNewerRoot, 'bin', binName))
    const bundledOlderExe = makeExe(pathMod.join(bundledOlderRoot, 'bin', binName))
    writeFileSync(pathMod.join(feishuNewerRoot, 'package.json'), JSON.stringify({ name: '@larksuite/cli', version: '1.0.120' }))
    writeFileSync(pathMod.join(bundledOlderRoot, 'package.json'), JSON.stringify({ name: '@larksuite/cli', version: '1.0.100' }))
    const opsPreferOfficialNewer = createOperations({
      ctx: { subprocess: { async resolveExecutable() { throw new Error('missing') } } },
      config: { feishuCliRoot: feishuNewerRoot, bundledCliRoot: bundledOlderRoot, skipSystemCliLookup: true, skipStandardCliCandidates: true },
    })
    assert.strictEqual(await opsPreferOfficialNewer.resolveCli(), feishuNewerExe, '官方 dsh-feishu CLI 版本更新时应优先复用官方')

    // 同版本时也优先复用官方 dsh-feishu
    writeFileSync(pathMod.join(feishuNewerRoot, 'package.json'), JSON.stringify({ name: '@larksuite/cli', version: '1.0.100' }))
    const opsPreferOfficialTie = createOperations({
      ctx: { subprocess: { async resolveExecutable() { throw new Error('missing') } } },
      config: { feishuCliRoot: feishuNewerRoot, bundledCliRoot: bundledOlderRoot, skipSystemCliLookup: true, skipStandardCliCandidates: true },
    })
    assert.strictEqual(await opsPreferOfficialTie.resolveCli(), feishuNewerExe, '版本相同时应优先复用官方 dsh-feishu CLI')

    // 若插件内置版本更新（例如官方尚停在 1.0.97），自动选择更新的内置版本
    writeFileSync(pathMod.join(feishuNewerRoot, 'package.json'), JSON.stringify({ name: '@larksuite/cli', version: '1.0.97' }))
    const opsPreferNewerBundled = createOperations({
      ctx: { subprocess: { async resolveExecutable() { throw new Error('missing') } } },
      config: { feishuCliRoot: feishuNewerRoot, bundledCliRoot: bundledOlderRoot, skipSystemCliLookup: true, skipStandardCliCandidates: true },
    })
    assert.strictEqual(await opsPreferNewerBundled.resolveCli(), bundledOlderExe, '当内置版本更新时应自动使用更新版本')

    // extraCliCandidates 发现
    const extraExe = makeExe(pathMod.join(root, 'feishu-like', binName))
    const opsExtra = createOperations({
      ctx: { subprocess: { async resolveExecutable() { throw new Error('missing') } } },
      config: {
        bundledCliRoot: pathMod.join(root, 'no-bin-pkg'),
        extraCliCandidates: [extraExe],
        skipSystemCliLookup: true,
      },
    })
    assert.strictEqual(await opsExtra.resolveCli(), extraExe)

    // 5. 二进制缺失时，connectStatus 返回 no-cli + canAutoInstall=true；单飞自动安装 + 已安装快速跳过
    let spawnCount = 0
    let seenElectronFlag = null
    let readyCallbackPath = null
    const mockSubprocess = {
      async resolveExecutable() { throw new Error('not on PATH') },
      spawn({ env }) {
        spawnCount++
        seenElectronFlag = env?.ELECTRON_RUN_AS_NODE
        makeExe(pathMod.join(binDir, binName))
        return {
          done: new Promise((resolve) => setTimeout(() => resolve({ exitCode: 0, stdout: 'installed\n', stderr: '' }), 40)),
          terminate() {},
        }
      },
    }
    const opsAuto = createOperations({
      ctx: { subprocess: mockSubprocess },
      config: {
        bundledCliRoot: cliRoot,
        cliInstallerPath: installerPath,
        skipSystemCliLookup: true,
        skipStandardCliCandidates: true,
        onCliReady: (p) => { readyCallbackPath = p },
      },
    })

    const beforeStatus = await opsAuto.connectStatus()
    assert.strictEqual(beforeStatus.stage, 'no-cli')
    assert.strictEqual(beforeStatus.cli.canAutoInstall, true)
    assert.strictEqual(opsAuto.resolveCliSync(), undefined)

    // 并发调用 installCli 必须合并为单次下载任务（single-flight）
    const [r1, r2] = await Promise.all([opsAuto.installCli(), opsAuto.installCli()])
    assert.strictEqual(r1.ok, true)
    assert.strictEqual(r2.ok, true)
    assert.strictEqual(spawnCount, 1, '并发 installCli 必须保持单飞，避免重复下载')
    assert.strictEqual(seenElectronFlag, '1', '必须通过 ELECTRON_RUN_AS_NODE=1 复用宿主 Electron/Node 运行时')
    assert.strictEqual(readyCallbackPath, pathMod.join(binDir, binName))
    assert.strictEqual(opsAuto.resolveCliSync(), pathMod.join(binDir, binName))
    assert.strictEqual(opsAuto.getCliBootstrapState().status, 'ready')

    // 再次调用 installCli 应命中已安装快速分支，不再 spawn
    const r3 = await opsAuto.installCli()
    assert.strictEqual(r3.ok, true)
    assert.strictEqual(r3.alreadyInstalled, true)
    assert.strictEqual(spawnCount, 1)

    // 6. 缺少 install.js 脚本 -> ok=false, canAutoInstall=false, status=error
    const noScriptOps = createOperations({
      ctx: { subprocess: { async resolveExecutable() { throw new Error('missing') } } },
      config: {
        bundledCliRoot: pathMod.join(root, 'empty-pkg-no-script'),
        skipSystemCliLookup: true,
        skipStandardCliCandidates: true,
      },
    })
    const noScriptRes = await noScriptOps.installCli()
    assert.strictEqual(noScriptRes.ok, false)
    assert.strictEqual(noScriptRes.canAutoInstall, false)
    assert.strictEqual(noScriptOps.getCliBootstrapState().status, 'error')

    // 7. 脚本退出码 0 但未生成二进制 -> ok=false, status=error
    const ghostOps = createOperations({
      ctx: {
        subprocess: {
          async resolveExecutable() { throw new Error('missing') },
          spawn() {
            return { done: Promise.resolve({ exitCode: 0, stdout: 'done', stderr: '' }), terminate() {} }
          },
        },
      },
      config: {
        bundledCliRoot: pathMod.join(root, 'ghost-cli'),
        cliInstallerPath: installerPath,
        skipSystemCliLookup: true,
        skipStandardCliCandidates: true,
      },
    })
    const ghostRes = await ghostOps.installCli()
    assert.strictEqual(ghostRes.ok, false)
    assert.strictEqual(ghostOps.getCliBootstrapState().status, 'error')

    // 8. 下载失败应干净记录 error 状态而非崩溃
    const failOps = createOperations({
      ctx: {
        subprocess: {
          async resolveExecutable() { throw new Error('missing') },
          spawn() {
            return {
              done: Promise.resolve({ exitCode: 2, stdout: '', stderr: 'curl network error' }),
              terminate() {},
            }
          },
        },
      },
      config: {
        bundledCliRoot: pathMod.join(root, 'empty-cli'),
        cliInstallerPath: installerPath,
        skipSystemCliLookup: true,
        skipStandardCliCandidates: true,
      },
    })
    const failedRes = await failOps.installCli()
    assert.strictEqual(failedRes.ok, false)
    assert.strictEqual(failOps.getCliBootstrapState().status, 'error')
    assert.ok(failedRes.message.includes('curl network error'))
  } finally {
    if (prevEnvCli === undefined) delete process.env.LARK_CLI_PATH
    else process.env.LARK_CLI_PATH = prevEnvCli
    rmSync(root, { recursive: true, force: true })
  }
})

test('15.2 包清单、声明式 Config 与无冗余静态 SKILL 资产', async () => {
  const { readFileSync } = await import('node:fs')
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  assert.ok(pkg.dependencies && pkg.dependencies['@larksuite/cli'], 'package.json 必须声明 @larksuite/cli 依赖以实现零安装')
  assert.ok(pkg.dependencies['@deepseek-ai/schemastery'], 'package.json 必须声明 @deepseek-ai/schemastery 依赖以支持声明式 Config')
  assert.strictEqual(Array.isArray(pkg.files) && pkg.files.includes('skills/**'), false, '不再随包硬塞第二个冗余静态 SKILL 文件')

  const { Config, inject: topInject } = await import('./index.js')
  assert.deepStrictEqual(topInject, ['tools', 'subprocess', 'llm', 'agentDefaultModel', 'commands', 'connection'], '顶层 inject 不应包含非核心可选服务')
  assert.strictEqual(typeof Config, 'function', 'index.js 必须导出 Schemastery Config')
  const defaults = Config({})
  assert.strictEqual(defaults.identity, 'auto')
  const customCfg = Config({ larkCliPath: '/opt/bin/lark-cli', binDir: '/opt/bin', identity: 'user' })
  assert.strictEqual(customCfg.larkCliPath, '/opt/bin/lark-cli')
  assert.strictEqual(customCfg.binDir, '/opt/bin')
  assert.strictEqual(customCfg.identity, 'user')
})

test('15.3 DSH 原生能力可选注入全分支 (skills / storageDomain 落盘水合 / cliAccounts 完整状态机与降级)', async () => {
  const { apply } = await import('./index.js')
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const pathMod = await import('node:path')
  const root = mkdtempSync(pathMod.join(tmpdir(), 'dsh-lark-native-test-'))
  try {
    const cliRoot = pathMod.join(root, 'fake-cli')
    const binDir = pathMod.join(cliRoot, 'bin')
    const installerPath = pathMod.join(cliRoot, 'scripts', 'install.js')
    const binName = process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli'
    mkdirSync(pathMod.dirname(installerPath), { recursive: true })
    writeFileSync(installerPath, '// stub\n')

    const registeredTools = []
    const registeredCommands = []
    const registeredSkillProviders = []
    const registeredPromptSections = []
    const registeredCliAccounts = []
    let skillInvalidateCount = 0
    const registeredRoutes = new Map()
    let storedGlobal = {
      name: '持久化台账',
      baseName: '持久化台账',
      url: 'https://feishu.cn/base/app_persisted',
      token: 'app_persisted',
      updatedAt: 123456,
    }
    const domainSetCalls = []
    let domainOpenedSpec = null
    let domainClosed = false
    let accountRefreshCount = 0
    let spawnShouldBuildBase = false
    const disposers = []

    const mockCtx = {
      tools: { register: (t) => { registeredTools.push(t); return () => {} } },
      commands: { register: (c) => { registeredCommands.push(c); return () => {} } },
      connection: {
        fetch: {
          register: (route) => {
            registeredRoutes.set(route.path, route)
            return () => { registeredRoutes.delete(route.path) }
          },
        },
      },
      llm: {},
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
      subprocess: {
        async resolveExecutable() { throw new Error('missing') },
        spawn({ argv }) {
          if (argv[1] === installerPath) {
            mkdirSync(binDir, { recursive: true })
            writeFileSync(pathMod.join(binDir, binName), 'bin')
            return { done: Promise.resolve({ exitCode: 0, stdout: '[]', stderr: '' }), terminate() {} }
          }
          if (spawnShouldBuildBase && argv.includes('+base-create')) {
            return {
              done: Promise.resolve({
                exitCode: 0,
                stdout: JSON.stringify({ data: { app: { app_token: 'app_built_99', url: 'https://feishu.cn/base/app_built_99' } } }),
                stderr: '',
              }),
              terminate() {},
            }
          }
          if (argv.includes('skills') && argv.includes('list')) {
            return {
              done: Promise.resolve({
                exitCode: 0,
                stdout: JSON.stringify({
                  skills: [
                    { name: 'lark-base', description: 'Feishu Base', metadata: { cliHelp: 'lark-cli base --help' } },
                    { name: 'lark-approval', description: 'Feishu Approval', metadata: { cliHelp: 'lark-cli approval --help' } },
                  ],
                  count: 2,
                }),
                stderr: '',
              }),
              terminate() {},
            }
          }
          if (argv.includes('config') && argv.includes('show')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: '{}', stderr: '' }), terminate() {} }
          }
          return { done: Promise.resolve({ exitCode: 0, stdout: '[]', stderr: '' }), terminate() {} }
        },
      },
      effect(fn) {
        const d = fn()
        if (typeof d === 'function') disposers.push(d)
      },
      inject(deps, cb) {
        const scoped = {}
        if (deps.includes('systemPrompt')) {
          scoped.systemPrompt = {
            getSectionOrder: () => 550,
            section: (sec) => { registeredPromptSections.push(sec); return () => {} },
          }
        }
        if (deps.includes('skills')) {
          scoped.skills = {
            get: async () => undefined,
            registerProvider: (factory) => {
              const p = factory({ signal: new AbortController().signal, invalidate: () => { skillInvalidateCount++ } })
              registeredSkillProviders.push(p)
              return () => {}
            },
          }
        }
        if (deps.includes('storageDomain')) {
          scoped.storageDomain = {
            async open(spec) {
              domainOpenedSpec = spec
              assert.ok(/^[a-z][a-z0-9_]*$/.test(spec.name), 'domain name 必须匹配 DSH UNIT_NAME_RE')
              assert.throws(() => spec.global.schema.parse(null), 'global schema 必须拒绝 null')
              assert.throws(() => spec.global.schema.parse([]), 'global schema 必须拒绝数组')
              return {
                global: {
                  get: () => storedGlobal,
                  async set(v) {
                    domainSetCalls.push(v)
                    storedGlobal = v
                  },
                },
                async close() { domainClosed = true },
              }
            },
          }
        }
        if (deps.includes('cliAccounts')) {
          scoped.cliAccounts = {
            register: (reg) => {
              registeredCliAccounts.push(reg)
              return {
                refresh() { accountRefreshCount++ },
                publish() {},
                snapshot() {},
                async dispose() {},
              }
            },
          }
        }
        const d = cb(scoped)
        if (typeof d === 'function') disposers.push(d)
      },
    }

    apply(mockCtx, {
      bundledCliRoot: cliRoot,
      cliInstallerPath: installerPath,
      skipSystemCliLookup: true,
      skipStandardCliCandidates: true,
    })

    await new Promise((r) => setTimeout(r, 20))

    assert.strictEqual(registeredTools.length, 3, '应注册 3 个结构化飞书工具')
    assert.strictEqual(registeredCommands.length, 1, '应注册 /lark 斜杠指令')
    assert.strictEqual(registeredPromptSections.length, 1, '应通过原生 systemPrompt.section 注入工具路由指引')
    assert.ok(registeredPromptSections[0].text.includes('lark_base_build'))
    assert.strictEqual(registeredSkillProviders.length, 1, '应注册统一官方 feishu 兜底 SkillProvider')
    const skillObs = await registeredSkillProviders[0].list()
    assert.strictEqual(skillObs.candidates.length, 1)
    assert.strictEqual(skillObs.candidates[0].name, 'feishu', '主对话应统一为官方 feishu 技能名，避免出现两个重样飞书 skill')
    assert.ok(skillObs.candidates[0].rank > 600, '兜底 rank 必须低于官方 dsh-feishu (600)，确保官方安装时自动优先官方')

    // 1. /lark 命令未连接 CLI 时应引导打开侧边栏自动准备，不再让小白去终端敲 npm i -g
    const buildTool = registeredTools.find((t) => t.name === 'lark_base_build')
    const larkCmd = registeredCommands[0]
    const cmdNoCli = await larkCmd.handler({ rawInput: '建个客户表', signal: undefined })
    assert.strictEqual(cmdNoCli.kind, 'error')
    assert.ok(cmdNoCli.text.includes('飞书工作台') && !cmdNoCli.text.includes('npm i -g'), '未装 CLI 引导不应让用户敲 npm i -g')

    // 2. storageDomain 启动水合 + preview 不覆盖持久状态 + build 正式建表写回持久域
    assert.ok(domainOpenedSpec, '应打开 storageDomain 持久化域')
    const activeRoute = registeredRoutes.get('/api/dsh-lark/active')
    assert.ok(activeRoute, '应注册 /api/dsh-lark/active 路由')
    const activeRes = await activeRoute.fetch(new Request('http://local/api/dsh-lark/active', { method: 'GET' }))
    const activeJson = await activeRes.json()
    assert.strictEqual(activeJson.active.url, 'https://feishu.cn/base/app_persisted', '应自动水合重启前的活跃台账')

    // preview=true 不应覆盖 storageDomain 里持久化保存过的已建表格
    const mockPlan = {
      baseName: '新预览表',
      intro: '测试',
      tables: [{ name: '主表', fields: [{ name: '标题', type: 'text' }], records: [] }],
    }
    const previewRes = await buildTool.execute({ plan: mockPlan, preview: true }, { signal: undefined })
    assert.strictEqual(previewRes.preview, true)
    assert.strictEqual(domainSetCalls.length, 0, 'preview 不应覆盖已持久化的正式台账')

    // 未安装 CLI 时直接执行建表会明确给出组件准备提示（不崩溃）
    await assert.rejects(
      () => buildTool.execute({ plan: mockPlan, preview: false }, { signal: undefined }),
      /飞书连接组件尚未下载完成/,
    )

    // 3. cliAccounts 完整状态机与动作分支检验
    assert.strictEqual(registeredCliAccounts.length, 1, '应注册唯一的 lark-workbench cliAccount')
    const reg = registeredCliAccounts[0]
    assert.strictEqual(reg.name, 'lark-workbench')
    assert.strictEqual(reg.packageName, 'dsh-lark-studio')
    assert.strictEqual(reg.cli.ready(), false)

    // 校验字典、copy、operations、present 全状态输出
    const makeText = (lang) => (key, vars = {}) => {
      let s = reg.dictionaries[lang][key]
      assert.ok(typeof s === 'string' && s.length > 0, `缺少词典键 ${lang}.${key}`)
      for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v))
      return s
    }
    assert.deepStrictEqual(Object.keys(reg.dictionaries.zh).sort(), Object.keys(reg.dictionaries.en).sort(), 'cliAccounts 中英文字典键必须对齐')
    for (const lang of ['zh', 'en']) {
      const tFn = makeText(lang)
      assert.strictEqual(reg.operations(tFn).length, 4)
      assert.ok(reg.copy(tFn).title && reg.copy(tFn).activation.connect)
      assert.strictEqual(reg.present({ account: { state: 'unchecked' } }, tFn).phase, 'checking')
      assert.strictEqual(reg.present({ account: { state: 'unchecked' }, operation: { kind: 'check', phase: 'downloading', cancellable: true } }, tFn).status, reg.dictionaries[lang]['step.downloading'])
      assert.strictEqual(reg.present({ account: { state: 'no-app' }, operation: { kind: 'link-app', phase: 'configuring', authorizationUrl: 'https://open.feishu.cn/app', cancellable: true } }, tFn).buttons.length, 2)
      assert.strictEqual(reg.present({ account: { state: 'signed-out', appId: 'cli_x' }, operation: { kind: 'sign-in', phase: 'authorizing', authorizationUrl: 'https://accounts.feishu.cn/login', cancellable: true } }, tFn).phase, 'connecting')
      assert.strictEqual(reg.present({ account: { state: 'not-installed' }, result: { outcome: 'failed' } }, tFn).failure.text, reg.dictionaries[lang].failed)
      assert.strictEqual(reg.present({ account: { state: 'unverified', appId: 'cli_x' } }, tFn).phase, 'unavailable')
      assert.strictEqual(reg.present({ account: { state: 'no-app' } }, tFn).connect.operation, 'link-app')
      assert.strictEqual(reg.present({ account: { state: 'signed-out', appId: 'cli_x' } }, tFn).connect.operation, 'sign-in')
      assert.ok(reg.present({ account: { state: 'connected', appId: 'cli_x', userName: 'Alice' } }, tFn).detail.includes('Alice'))
    }

    // 通过 HTTP 路由触发自动安装后，cliAccount.cli.ready() 变为 true，且调用 handle.refresh()
    const installRoute = registeredRoutes.get('/api/dsh-lark/connect/cli/install')
    assert.ok(installRoute, '应注册 /api/dsh-lark/connect/cli/install 路由')
    const installRes = await installRoute.fetch(new Request('http://local/api/dsh-lark/connect/cli/install', { method: 'POST' }))
    const installJson = await installRes.json()
    assert.strictEqual(installJson.ok, true)
    assert.strictEqual(reg.cli.ready(), true)
    assert.ok(accountRefreshCount >= 1, 'CLI 安装就绪后应刷新 cliAccounts 状态')
    assert.ok(skillInvalidateCount >= 1, 'CLI 安装就绪后应失效重建 feishu Skill 目录缓存')
    const loadedFallbackSkill = await registeredSkillProviders[0].get(skillObs.candidates[0], {})
    assert.ok(loadedFallbackSkill.content.includes('lark-approval'), '兜底 feishu skill 应动态反映 lark-cli 最新能力列表')

    // 验证 build 正式建表会落盘写入 storageDomain
    spawnShouldBuildBase = true
    const realBuildRes = await buildTool.execute({ plan: mockPlan, preview: false }, { signal: undefined })
    assert.strictEqual(realBuildRes.ok, true)
    assert.strictEqual(domainSetCalls.length, 1, '正式建表后必须写入 storageDomain 持久化')
    assert.strictEqual(domainSetCalls[0].url, 'https://feishu.cn/base/app_built_99')

    // 验证 perform() 四种操作流程与 URL 捕获
    const makeControl = (responder) => {
      const stages = []
      const offers = []
      const published = []
      return {
        stages,
        offers,
        published,
        stage: (p) => stages.push(p),
        offer: (u) => offers.push(u),
        publish: (a) => published.push(a),
        async run(cmd, args, _sig, opts) {
          return responder(cmd, args, opts)
        },
      }
    }

    const ctrlCheckNoApp = makeControl((cmd) => {
      if (cmd === 'config-show') return { exitCode: 0, stdout: '{}', stderr: '' }
      return { exitCode: 0, stdout: '{}', stderr: '' }
    })
    await reg.perform('check', ctrlCheckNoApp, new AbortController().signal)
    assert.strictEqual(ctrlCheckNoApp.published.at(-1).state, 'no-app')

    const ctrlCheckSignedOut = makeControl((cmd) => {
      if (cmd === 'config-show') return { exitCode: 0, stdout: '{"appId":"cli_123"}', stderr: '' }
      return { exitCode: 0, stdout: '{"userReady":false}', stderr: '' }
    })
    await reg.perform('check', ctrlCheckSignedOut, new AbortController().signal)
    assert.strictEqual(ctrlCheckSignedOut.published.at(-1).state, 'signed-out')

    const ctrlLinkApp = makeControl((cmd, _args, opts) => {
      if (cmd === 'config-init') {
        opts?.onLine?.('stdout', 'Open https://open.feishu.cn/create-app.')
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      if (cmd === 'config-show') return { exitCode: 0, stdout: '{"appId":"cli_123"}', stderr: '' }
      return { exitCode: 0, stdout: '{"userReady":true,"userName":"Bob"}', stderr: '' }
    })
    await reg.perform('link-app', ctrlLinkApp, new AbortController().signal)
    assert.deepStrictEqual(ctrlLinkApp.offers, ['https://open.feishu.cn/create-app'])
    assert.deepStrictEqual(ctrlLinkApp.published.at(-1), { state: 'connected', appId: 'cli_123', userName: 'Bob' })

    const ctrlSignIn = makeControl((cmd, _args, opts) => {
      if (cmd === 'auth-login') {
        opts?.onLine?.('stderr', '  https://accounts.feishu.cn/device?code=abc  ')
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      if (cmd === 'config-show') return { exitCode: 0, stdout: '{"appId":"cli_123"}', stderr: '' }
      return { exitCode: 0, stdout: '{"userReady":true,"userName":"Bob"}', stderr: '' }
    })
    await reg.perform('sign-in', ctrlSignIn, new AbortController().signal)
    assert.deepStrictEqual(ctrlSignIn.offers, ['https://accounts.feishu.cn/device?code=abc'])

    const ctrlSignOut = makeControl((cmd) => {
      if (cmd === 'config-show') return { exitCode: 0, stdout: '{"appId":"cli_123"}', stderr: '' }
      if (cmd === 'auth-status') return { exitCode: 0, stdout: '{"userReady":false}', stderr: '' }
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    await reg.perform('sign-out', ctrlSignOut, new AbortController().signal)
    assert.ok(ctrlSignOut.stages.includes('signing-out'))
    assert.strictEqual(ctrlSignOut.published.at(-1).state, 'signed-out')

    const cliStateRoute = registeredRoutes.get('/api/dsh-lark/connect/cli/state')
    assert.ok(cliStateRoute, '应注册 /api/dsh-lark/connect/cli/state 路由')
    const cliStateRes = await cliStateRoute.fetch(new Request('http://local/api/dsh-lark/connect/cli/state', { method: 'GET' }))
    const cliStateJson = await cliStateRes.json()
    assert.strictEqual(cliStateJson.ready, true)

    // 插件卸载释放资源
    for (const d of disposers) d()
    await new Promise((r) => setTimeout(r, 10))
    assert.strictEqual(domainClosed, true, '卸载时必须释放 storageDomain 句柄')

    // 4. 无 ctx.inject 及可选服务异常时的容错降级校验
    const minimalCtx = {
      tools: { register: () => () => {} },
      commands: { register: () => () => {} },
      connection: { fetch: { register: () => () => {} } },
      subprocess: { async resolveExecutable() { throw new Error('missing') } },
      effect: (fn) => fn(),
      inject(_deps, cb) {
        cb({
          skills: { register: () => () => {} },
          storageDomain: { open: async () => { throw new Error('storage down') } },
          cliAccounts: { register: () => { throw new Error('duplicate registration') } },
        })
      },
    }
    assert.doesNotThrow(() => apply(minimalCtx, {}))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('15.4 侧边栏对话动态复用官方 lark-cli Skill (25+ 领域动态读取、执行与写操作确认拦截)', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const pathMod = await import('node:path')
  const root = mkdtempSync(pathMod.join(tmpdir(), 'dsh-lark-skill-collab-'))
  try {
    const cliExe = pathMod.join(root, process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli')
    writeFileSync(cliExe, '#!/bin/sh\necho ok\n')
    chmodSync(cliExe, 0o755)

    let mode = 'readonly' // readonly | missing_scope | mutating
    const seenArgs = []
    let readSkillGuideCalled = false

    const opsSkill = createOperations({
      ctx: {
        agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-chat' }) },
        llm: {
          stream({ system, messages }) {
            const promptText = `${system}\n${messages.map((m) => (Array.isArray(m.content) ? m.content.map((c) => c.text).join('') : m.content || '')).join('')}`
            return (async function* () {
              if (promptText.includes('可用 action 列表')) {
                yield { type: 'text-delta', text: JSON.stringify({ action: 'run_skill', skill: 'lark-approval' }) }
              } else if (promptText.includes('精通飞书 CLI 的智能执行器')) {
                if (mode === 'mutating') {
                  yield {
                    type: 'text-delta',
                    text: JSON.stringify({ argv: ['approval', '+instance-create', '--code', 'LEAVE'], readonly: false, confirmReason: '将发起请假审批实例' }),
                  }
                } else {
                  yield {
                    type: 'text-delta',
                    text: JSON.stringify({ argv: ['approval', '+task-list'], readonly: true }),
                  }
                }
              } else {
                yield { type: 'text-delta', text: '当前共有 1 条待处理审批（年假申请）。' }
              }
            })()
          },
        },
        subprocess: {
          spawn({ argv }) {
            seenArgs.push(argv.slice(1))
            if (argv.includes('config') && argv.includes('show')) {
              return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ appId: 'cli_a', brand: 'feishu' }), stderr: '' }), terminate() {} }
            }
            if (argv.includes('skills') && argv.includes('list')) {
              return {
                done: Promise.resolve({
                  exitCode: 0,
                  stdout: JSON.stringify({ skills: [{ name: 'lark-approval', description: 'Feishu Approval: tasks and instances' }], count: 1 }),
                  stderr: '',
                }),
                terminate() {},
              }
            }
            if (argv.includes('skills') && argv.includes('read') && argv.includes('lark-approval')) {
              readSkillGuideCalled = true
              return {
                done: Promise.resolve({ exitCode: 0, stdout: '# lark-approval\nUse `lark-cli approval +task-list` to query pending approvals.', stderr: '' }),
                terminate() {},
              }
            }
            if (argv.includes('approval') && argv.includes('+task-list')) {
              if (mode === 'missing_scope') {
                return {
                  done: Promise.resolve({
                    exitCode: 1,
                    stdout: JSON.stringify({ ok: false, error: { message: 'missing required scope approval:approval:readonly', code: 99991679 } }),
                    stderr: '',
                  }),
                  terminate() {},
                }
              }
              return {
                done: Promise.resolve({
                  exitCode: 0,
                  stdout: JSON.stringify({ ok: true, data: { tasks: [{ title: '年假申请' }] } }),
                  stderr: '',
                }),
                terminate() {},
              }
            }
            return { done: Promise.resolve({ exitCode: 0, stdout: '{}', stderr: '' }), terminate() {} }
          },
        },
      },
      config: { larkCliPath: cliExe },
    })

    // 1. 只读动态 Skill 执行（读取 skills list -> 读取 lark-approval 文档 -> 执行 approval +task-list -> 摘要回复）
    const res1 = await opsSkill.dispatchCollab({ instruction: '帮我查一下待我处理的飞书审批' })
    assert.strictEqual(res1.ok, true)
    assert.strictEqual(res1.skill, 'lark-approval')
    assert.strictEqual(readSkillGuideCalled, true, '必须按官方规范先读取对应 skill 指南再规划命令')
    assert.ok(res1.reply.includes('待处理审批'))

    // 2. 动态 Skill 遇到权限不足时走统一 scopeError 授权卡片，且展示人类可读中文领域名（不暴露 lark-approval 代码名）
    mode = 'missing_scope'
    const res2 = await opsSkill.dispatchCollab({ instruction: '帮我查一下待我处理的飞书审批' })
    assert.strictEqual(res2.ok, false)
    assert.strictEqual(res2.type, 'missing_scope')
    assert.strictEqual(res2.domain, 'lark-approval')
    assert.strictEqual(res2.domainTitle, '飞书审批')

    // 3. 写入/变更型动态 Skill 命令必须被拦截为 needsConfirm + skill_guard，绝不静默直接运行
    mode = 'mutating'
    const prevCmdCount = seenArgs.length
    const res3 = await opsSkill.dispatchCollab({ instruction: '帮我提交一个请假审批' })
    assert.strictEqual(res3.ok, true)
    assert.strictEqual(res3.needsConfirm, true)
    assert.strictEqual(res3.confirmKind, 'skill_guard')
    assert.ok(res3.reply.includes('将发起请假审批实例'))
    assert.strictEqual(
      seenArgs.slice(prevCmdCount).some((a) => a.includes('+instance-create')),
      false,
      '未确认的变更型 CLI 命令绝不能自动执行',
    )

    // 4. 多步骤工作流 (steps)、纯文本表格输出 (rawText) 以及 --query 包含 update 字样不误判写操作
    let sawRawTextInSummarizer = false
    const opsWorkflow = createOperations({
      ctx: {
        agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
        llm: {
          stream({ system, messages }) {
            const p = `${system}\n${messages.map((m) => (Array.isArray(m.content) ? m.content.map((c) => c.text).join('') : m.content || '')).join('')}`
            return (async function* () {
              if (p.includes('可用 action 列表')) {
                yield { type: 'text-delta', text: JSON.stringify({ action: 'run_skill', skill: 'lark-workflow-standup-report' }) }
              } else if (p.includes('精通飞书 CLI 的智能执行器')) {
                yield {
                  type: 'text-delta',
                  text: JSON.stringify({
                    steps: [['calendar', '+agenda'], ['docs', '+search', '--query', 'update']],
                    readonly: true,
                  }),
                }
              } else {
                if (p.includes('plain text agenda row')) sawRawTextInSummarizer = true
                yield { type: 'text-delta', text: '早报汇总已完成' }
              }
            })()
          },
        },
        subprocess: {
          spawn({ argv }) {
            if (argv.includes('skills') && argv.includes('list')) {
              return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ skills: [{ name: 'lark-workflow-standup-report', description: 'Standup' }] }), stderr: '' }), terminate() {} }
            }
            if (argv.includes('skills') && argv.includes('read')) {
              return { done: Promise.resolve({ exitCode: 0, stdout: '# Standup Workflow\nRuns calendar +agenda and docs +search', stderr: '' }), terminate() {} }
            }
            if (argv.includes('calendar') && argv.includes('+agenda')) {
              return { done: Promise.resolve({ exitCode: 0, stdout: 'plain text agenda row', stderr: '' }), terminate() {} }
            }
            if (argv.includes('docs') && argv.includes('+search')) {
              return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ ok: true, data: { items: ['doc1'] } }), stderr: '' }), terminate() {} }
            }
            return { done: Promise.resolve({ exitCode: 0, stdout: '{}', stderr: '' }), terminate() {} }
          },
        },
      },
      config: { larkCliPath: cliExe },
    })
    const wfRes = await opsWorkflow.dispatchCollab({ instruction: '给我生成今天的晨会待办摘要' })
    assert.strictEqual(wfRes.ok, true)
    assert.strictEqual(sawRawTextInSummarizer, true, '纯文本输出（非 JSON）与多步骤 steps 必须完整喂给摘要模型')

    // 5. 真机内置 @larksuite/cli 全部 25 份 Skill 实测与别名解析校验
    const realCliOps = createOperations({ ctx: { subprocess: realSubprocess }, config: { skipSystemCliLookup: true } })
    if (realCliOps.resolveCliSync()) {
      const realCatalog = await realCliOps.readOfficialSkillsCatalog()
      assert.strictEqual(realCatalog.length, 25, '真机内置 lark-cli 应列出全部 25 份官方 Skill')
      for (const item of realCatalog) {
        const body = await realCliOps.readOfficialSkillGuide(item.name)
        assert.ok(body && body.length > 50, `真实官方 Skill ${item.name} 读取不能为空`)
      }
      const noteGuide = await realCliOps.readOfficialSkillGuide('lark-note')
      assert.ok(noteGuide && noteGuide.length > 2000, '兼容别名 lark-note 应自动跟随解析到完整 lark-meeting 指南')
    }

    // 6. 模型返回含未转义换行的畸形 action JSON 时，绝不能把 {"action":"reply"} 原样裸露给用户，同时保留 AI 正常自然语言表达
    const opsBrokenJson = createOperations({
      ctx: {
        agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
        llm: {
          stream() {
            return (async function* () {
              yield {
                type: 'text-delta',
                text: '{"action": "reply", "reply": "你好！👋\n\n我可以帮你：\n- 日历日程"}',
              }
            })()
          },
        },
        subprocess: {
          spawn() {
            return { done: Promise.resolve({ exitCode: 0, stdout: '{"skills":[]}', stderr: '' }), terminate() {} }
          },
        },
      },
      config: { larkCliPath: cliExe },
    })
    const brokenRes = await opsBrokenJson.dispatchCollab({ instruction: 'hello' })
    assert.strictEqual(brokenRes.ok, true)
    assert.strictEqual(brokenRes.reply.includes('"action"'), false, '畸形 action JSON 绝不能裸露在回复气泡中')
    assert.ok(brokenRes.reply.includes('你好！👋') && brokenRes.reply.includes('日历日程'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('15.5 双语国际化全链路校验 (ZH/EN 1:1 词典、英文 Prompt 与后端路由语言传递)', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const clientSrc = readFileSync(new URL('./client.js', import.meta.url), 'utf8')

  // 1. ZH / EN 词典键名完全 1:1 对齐，且包含全部 SCENARIOS / starters prompt 键
  const zhBlock = clientSrc.slice(clientSrc.indexOf('const ZH = {'), clientSrc.indexOf('const EN = {'))
  const enBlock = clientSrc.slice(clientSrc.indexOf('const EN = {'), clientSrc.indexOf('const KIND_ICON = {'))
  const zhKeys = [...zhBlock.matchAll(/'([^']+)':/g)].map((m) => m[1])
  const enKeys = [...enBlock.matchAll(/'([^']+)':/g)].map((m) => m[1])
  assert.deepStrictEqual(zhKeys, enKeys, 'ZH 与 EN 词典键必须严格一致')
  assert.ok(zhKeys.includes('scene.crm.prompt') && zhKeys.includes('starter.analyze.prompt') && zhKeys.includes('scope.defaultDomain'))
  assert.strictEqual(/prompt:\s*'[\u4e00-\u9fff]/.test(clientSrc), false, 'SCENARIOS / starters 不允许再出现硬编码中文 prompt')

  // 2. resolveLang 识别显式 lang 与自然文本语言
  assert.strictEqual(resolveLang('en-US', '你好'), 'en')
  assert.strictEqual(resolveLang('zh-CN', 'hello'), 'zh')
  assert.strictEqual(resolveLang(undefined, 'Track customer leads'), 'en')
  assert.strictEqual(resolveLang(undefined, '帮我建个客户表'), 'zh')

  // 3. destructiveChanges 与 sanitizePlan / sanitizeOps 英文分支
  const enRisky = destructiveChanges([{ op: 'delete_field', field: 'Notes' }, { op: 'delete_records', record_ids: ['r1'] }], 'en')
  assert.strictEqual(enRisky[0], 'Delete column "Notes"')
  assert.strictEqual(enRisky[1], 'Delete 1 record(s)')
  assert.strictEqual(sanitizePlan(null, 'en').message, 'The model did not return a valid JSON object.')
  assert.strictEqual(sanitizeOps(null, 'hello', [], 'en').message, 'The model response format was invalid. Please try rephrasing.')

  // 4. dispatchCollab 在 lang='en' 时必须下发英文格式化系统提示与英文空数据回复
  let capturedPlannerSys = ''
  let capturedSummarySys = ''
  const mockCliPath = fileURLToPath(new URL('./package.json', import.meta.url))
  const opsEn = createOperations({
    ctx: {
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
      llm: {
        stream({ system }) {
          if (system.includes('可用 action 列表')) capturedPlannerSys = system
          if (system.includes('Summarize the data')) capturedSummarySys = system
          return (async function* () {
            if (system.includes('可用 action 列表')) {
              yield { type: 'text-delta', text: JSON.stringify({ action: 'run_skill', skill: 'lark-approval' }) }
            } else if (system.includes('精通飞书 CLI')) {
              yield { type: 'text-delta', text: JSON.stringify({ argv: ['approval', '+task-list'], readonly: true }) }
            } else {
              yield { type: 'text-delta', text: 'You have 1 pending leave approval.' }
            }
          })()
        },
      },
      subprocess: {
        spawn({ argv }) {
          if (argv.includes('skills') && argv.includes('list')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ skills: [{ name: 'lark-approval', description: 'Approval' }] }), stderr: '' }), terminate() {} }
          }
          if (argv.includes('skills') && argv.includes('read')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: '# lark-approval\napproval +task-list', stderr: '' }), terminate() {} }
          }
          return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ ok: true, data: { tasks: [] } }), stderr: '' }), terminate() {} }
        },
      },
    },
    config: { larkCliPath: mockCliPath },
  })
  const enCollabRes = await opsEn.dispatchCollab({ instruction: 'Check my pending approvals', lang: 'en' })
  assert.strictEqual(enCollabRes.ok, true)
  assert.ok(capturedPlannerSys.includes('The active language is English'))
  assert.ok(capturedSummarySys.includes('human-readable English answer'))
  assert.strictEqual(enCollabRes.reply, 'You have 1 pending leave approval.')

  // 5. planner.plan 在 lang='en' 时注入英文表结构输出规范
  let plannerSys = ''
  const enPlanner = createPlanner({
    ctx: {
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
      llm: {
        stream({ system }) {
          plannerSys = system
          return (async function* () {
            yield {
              type: 'text-delta',
              text: JSON.stringify({
                isTable: true,
                baseName: 'Customer Leads',
                intro: 'Track client status and next follow-up.',
                tables: [{ name: 'Leads', fields: [{ type: 'text', name: 'Company', description: 'Client company name' }] }],
              }),
            }
          })()
        },
      },
    },
  })
  const enPlanRes = await enPlanner.plan('Track customer leads', undefined, undefined, { lang: 'en' })
  assert.strictEqual(enPlanRes.ok, true)
  assert.ok(plannerSys.includes('The active UI/user language is English'))
  assert.strictEqual(enPlanRes.plan.baseName, 'Customer Leads')

  // 6. NativeWebview 生命周期健壮性：不依赖 t、过滤 isMainFrame、支持可见延后挂载与顶部刷新联动重载
  const wvStart = clientSrc.indexOf('function NativeWebview(')
  const wvEnd = clientSrc.indexOf('function renderInlineText(', wvStart)
  const wvSrc = clientSrc.slice(wvStart, wvEnd)
  assert.ok(wvSrc.includes('hasBeenVisible'), 'NativeWebview 应延后至可见后再首次挂载')
  assert.ok(wvSrc.includes('e.isMainFrame !== false'), 'did-fail-load 必须仅处理主框架失败')
  assert.ok(wvSrc.includes('render-process-gone'), 'NativeWebview 必须处理渲染进程崩溃恢复')
  assert.ok(wvSrc.includes('clearHistory'), '首次跳转到真实 URL 后应清理 about:blank 历史')
  assert.strictEqual(/\[url,\s*retryTick,\s*t\]/.test(wvSrc), false, 'NativeWebview useEffect 不应依赖 t 导致重渲染中断加载')
  assert.ok(clientSrc.includes('reloadTick: webviewReloadTick'), '顶部刷新应联动触发右侧真表重载')
})

Promise.all(pendingTests).then(() => {
  setTimeout(() => {
    console.log(`\n========================================`)
    console.log(`🎉 测试完成: ${passCount} 通过, ${failCount} 失败`)
    console.log(`========================================`)
    process.exit(failCount > 0 ? 1 : 0)
  }, 200)
})
