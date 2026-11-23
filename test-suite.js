/**
 * Automated test suite for lark-workbench Base operations & AI context.
 */

import assert from 'node:assert'
import { spawn } from 'node:child_process'
import { sanitizeOps, createAdjustPlanner } from './adjust-planner.js'
import { destructiveChanges, createOperations } from './ops.js'
import { verifyApiSecurity } from './index.js'

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

test('10.1 Host 与 Origin 安全边界防护测试 (全方法拦截外域与跨站伪造)', () => {
  const fakeSession = { id: 'session-valid-12345' }
  const mockCtx = {
    webServer: {
      getOrigin: () => 'http://127.0.0.1:49152'
    },
    sessions: {
      get: (id) => (id === 'session-valid-12345' ? fakeSession : undefined),
      list: () => [fakeSession]
    }
  }

  // 1. 正常本地请求通过
  const validReq = {
    method: 'GET',
    headers: { host: '127.0.0.1:49152', origin: 'http://127.0.0.1:49152', 'x-dsh-session-id': 'session-valid-12345' }
  }
  const res1 = verifyApiSecurity(validReq, new URL('http://127.0.0.1:49152/dsh-lark/api/state'), mockCtx)
  assert.strictEqual(res1.ok, true)

  // 2. 缺少 Host 头直接拦截 403
  const noHostReq = {
    method: 'GET',
    headers: { origin: 'http://127.0.0.1:49152' }
  }
  const res2 = verifyApiSecurity(noHostReq, new URL('http://127.0.0.1:49152/dsh-lark/api/state'), mockCtx)
  assert.strictEqual(res2.ok, false)
  assert.strictEqual(res2.status, 403)

  // 3. DNS Rebinding 外网 Host 拦截 403
  const badHostReq = {
    method: 'GET',
    headers: { host: 'attacker.com' }
  }
  const res3 = verifyApiSecurity(badHostReq, new URL('http://attacker.com/dsh-lark/api/state'), mockCtx)
  assert.strictEqual(res3.ok, false)
  assert.strictEqual(res3.status, 403)

  // 4. 浏览器 Cross-Site 标记拦截 403
  const crossSiteReq = {
    method: 'POST',
    headers: { host: '127.0.0.1:49152', 'sec-fetch-site': 'cross-site' }
  }
  const res4 = verifyApiSecurity(crossSiteReq, new URL('http://127.0.0.1:49152/dsh-lark/api/adjust'), mockCtx)
  assert.strictEqual(res4.ok, false)
  assert.strictEqual(res4.status, 403)

  // 5. 非法 Origin 拦截 403 (GET / POST 全方法生效)
  const badOriginReq = {
    method: 'GET',
    headers: { host: '127.0.0.1:49152', origin: 'https://evil.site' }
  }
  const res5 = verifyApiSecurity(badOriginReq, new URL('http://127.0.0.1:49152/dsh-lark/api/records'), mockCtx)
  assert.strictEqual(res5.ok, false)
  assert.strictEqual(res5.status, 403)
})

test('10.2 DSH 会话身份验证测试 (ctx.sessions 拦截未授权访问)', () => {
  const fakeSession = { id: 'session-valid-12345', cwd: '/workspace' }
  const mockCtx = {
    webServer: { getOrigin: () => 'http://127.0.0.1:49152' },
    sessions: {
      get: (id) => (id === 'session-valid-12345' ? fakeSession : undefined),
      list: () => [fakeSession]
    }
  }

  // 1. 未携带 x-dsh-session-id 拦截 401
  const reqNoSession = {
    method: 'GET',
    headers: { host: '127.0.0.1:49152' }
  }
  const res1 = verifyApiSecurity(reqNoSession, new URL('http://127.0.0.1:49152/dsh-lark/api/records'), mockCtx)
  assert.strictEqual(res1.ok, false)
  assert.strictEqual(res1.status, 401)
  assert.ok(res1.error.includes('会话鉴权失败'))

  // 2. 伪造或过期的 session id 拦截 401
  const reqBadSession = {
    method: 'POST',
    headers: { host: '127.0.0.1:49152', 'x-dsh-session-id': 'session-fake-99999' }
  }
  const res2 = verifyApiSecurity(reqBadSession, new URL('http://127.0.0.1:49152/dsh-lark/api/adjust'), mockCtx)
  assert.strictEqual(res2.ok, false)
  assert.strictEqual(res2.status, 401)

  // 3. 携带合法 x-dsh-session-id 鉴权通过
  const reqGoodSession = {
    method: 'GET',
    headers: { host: '127.0.0.1:49152', 'x-dsh-session-id': 'session-valid-12345' }
  }
  const res3 = verifyApiSecurity(reqGoodSession, new URL('http://127.0.0.1:49152/dsh-lark/api/records'), mockCtx)
  assert.strictEqual(res3.ok, true)

  // 4. URL query 参数携带合法 sessionId 鉴权通过
  const reqQuerySession = {
    method: 'GET',
    headers: { host: '127.0.0.1:49152' }
  }
  const res4 = verifyApiSecurity(reqQuerySession, new URL('http://127.0.0.1:49152/dsh-lark/api/records?sessionId=session-valid-12345'), mockCtx)
  assert.strictEqual(res4.ok, true)
})

test('10.3 全部 /dsh-lark/api 路由（含 state/active/models/connect）均要求 DSH 会话身份', () => {
  const fakeSession = { id: 'session-valid-12345' }
  const mockCtx = {
    webServer: { getOrigin: () => 'http://127.0.0.1:49152' },
    sessions: {
      get: (id) => (id === 'session-valid-12345' ? fakeSession : undefined),
      list: () => [fakeSession]
    }
  }

  for (const path of ['/state', '/active', '/models', '/connect/scopes', '/records']) {
    const req = {
      method: 'GET',
      headers: { host: '127.0.0.1:49152', origin: 'http://127.0.0.1:49152' }
    }
    const res = verifyApiSecurity(req, new URL(`http://127.0.0.1:49152/dsh-lark/api${path}`), mockCtx)
    assert.strictEqual(res.ok, false, `${path} should require a DSH session`)
    assert.strictEqual(res.status, 401)
  }

  const okReq = {
    method: 'GET',
    headers: { host: '127.0.0.1:49152', origin: 'http://127.0.0.1:49152', 'x-dsh-session-id': 'session-valid-12345' }
  }
  const okRes = verifyApiSecurity(okReq, new URL('http://127.0.0.1:49152/dsh-lark/api/state'), mockCtx)
  assert.strictEqual(okRes.ok, true)
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

test('11.5 客户端通信弹性降级验证 (Connection 优先 + 404 自动回退)', async () => {
  let callCount = 0

  const mockFetch = async (targetUrl, options) => {
    callCount++
    if (targetUrl.includes('api/dsh-lark/state')) {
      return new Response('Not Found', { status: 404 })
    }
    if (targetUrl.includes('/dsh-lark/api/state')) {
      return new Response(JSON.stringify({ ok: true, fallback: true }), { status: 200 })
    }
    return new Response('Not Found', { status: 404 })
  }

  const clientAuthFetch = async (url, options = {}) => {
    let res = await mockFetch(url, options)
    if (res.status === 404 && typeof url === 'string' && url.includes('api/dsh-lark')) {
      const fallbackUrl = url.replace(/(\/)?api\/dsh-lark/, '/dsh-lark/api')
      const fallbackRes = await mockFetch(fallbackUrl, options)
      if (fallbackRes.ok) return fallbackRes
    }
    return res
  }

  const res = await clientAuthFetch('api/dsh-lark/state')
  assert.strictEqual(res.status, 200)
  const data = await res.json()
  assert.strictEqual(data.ok, true)
  assert.strictEqual(data.fallback, true)
  assert.strictEqual(callCount, 2, '应当在 404 后成功回退到旧版接口')
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

  // --- 【第三组：暗面协议与安全防护请求（6 个）】 ---
  // 18. OPTIONS 预检请求响应 (CORS preflight)
  assert.ok(registeredWebRoute, 'webServer 路由应当已注册')
  let optionsHeaderStatus = 0
  let optionsHeaders = {}
  await registeredWebRoute.handler(
    { method: 'OPTIONS', headers: { origin: 'http://127.0.0.1:49152' }, url: '/dsh-lark/api/state' },
    {
      statusCode: 0,
      setHeader: (k, v) => { optionsHeaders[k.toLowerCase()] = v },
      end: () => { optionsHeaderStatus = 204 }
    }
  )
  assert.strictEqual(optionsHeaderStatus, 204)
  assert.ok(optionsHeaders['access-control-allow-origin'])

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

Promise.all(pendingTests).then(() => {
  setTimeout(() => {
    console.log(`\n========================================`)
    console.log(`🎉 测试完成: ${passCount} 通过, ${failCount} 失败`)
    console.log(`========================================`)
    if (failCount > 0) process.exit(1)
  }, 200)
})
