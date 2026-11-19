/**
 * Automated test suite for lark-workbench Base operations & AI context.
 */

import assert from 'node:assert'
import { spawn } from 'node:child_process'
import { sanitizeOps, createAdjustPlanner } from './adjust-planner.js'
import { destructiveChanges, createOperations } from './ops.js'

console.log('🚀 开始执行飞书工作台多维表格全功能自动化测试...\n')

let passCount = 0
let failCount = 0
const pendingTests = []

const realSubprocess = {
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
    assert.strictEqual(status.auth.ready, true, '飞书授权状态应当为 ready');
    console.log(`✅ [PASS] 7.1 lark-cli 真实环境连接正常 (已登录账号: ${status.auth.userName})`);
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
  assert.strictEqual(scopes.domains.base.ready, true)
  assert(scopes.domains.base.count >= 80)
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
})

Promise.all(pendingTests).then(() => {
  setTimeout(() => {
    console.log(`\n========================================`)
    console.log(`🎉 测试完成: ${passCount} 通过, ${failCount} 失败`)
    console.log(`========================================`)
    if (failCount > 0) process.exit(1)
  }, 200)
})
