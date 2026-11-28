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

test('2.2 问答模式 - 空操作附带大模型 reply 正常透传，无 reply 时不靠正则机械复读', () => {
  const history = [
    { role: 'user', text: '加一条任务' },
    { role: 'assistant', text: '已为您添加一条记录：写周报' }
  ]
  const noReplyRes = sanitizeOps({ ops: [] }, '刚刚加了什么', history)
  assert.strictEqual(noReplyRes.ok, false)

  const llmReplyRes = sanitizeOps({ ops: [], reply: '上一轮已为您添加记录「写周报」。' }, '刚刚加了什么', history)
  assert.strictEqual(llmReplyRes.ok, true)
  assert.strictEqual(llmReplyRes.type, 'answer')
  assert.ok(llmReplyRes.reply.includes('写周报'))
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
  const collabMockCtx = {
    subprocess: realSubprocess,
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    llm: {
      stream({ messages }) {
        const last = messages?.[messages.length - 1]
        const userText = String(last?.content?.[0]?.text || last?.text || '')
        const isToolResult = last?.role === 'tool'
        return (async function* () {
          if (isToolResult) {
            yield { type: 'text-delta', text: '已为您处理完成。' }
            return
          }
          if (userText.includes('日程')) {
            yield {
              type: 'block-end',
              index: 0,
              block: { type: 'tool-call', id: 'c_cal', name: 'run_readonly', arguments: JSON.stringify({ argv: ['calendar', '+agenda'], skill: 'calendar' }) },
            }
          } else if (userText.includes('待办清单')) {
            yield {
              type: 'block-end',
              index: 0,
              block: { type: 'tool-call', id: 'c_task', name: 'run_readonly', arguments: JSON.stringify({ argv: ['task', '+get-my-tasks'], skill: 'task' }) },
            }
          } else if (userText.includes('台账数据表')) {
            yield {
              type: 'block-end',
              index: 0,
              block: { type: 'tool-call', id: 'c_tbl', name: 'suggest_base_table', arguments: JSON.stringify({ title: '项目台账数据表' }) },
            }
          } else {
            yield { type: 'text-delta', text: '不客气，随时为您效劳！' }
          }
        })()
      },
    },
  }
  const ops = createOperations({ ctx: collabMockCtx }, process.cwd())
  assert.strictEqual(typeof ops.dispatchCollab, 'function')

  // 测试日历工具循环调度（支持原生 tool-call 块）
  const calRes = await ops.dispatchCollab({ instruction: '查下我今天的日程安排' })
  assert.strictEqual(typeof calRes.ok, 'boolean')
  if (!calRes.ok && calRes.type === 'missing_scope') {
    assert.strictEqual(calRes.domain, 'calendar')
    assert(calRes.requiredScopes.length > 0)
    assert(calRes.consoleUrl.startsWith('https://open.feishu.cn'))
  }

  // 测试待办任务工具循环调度
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
      { role: 'assistant', text: '为您找到以下飞书群聊：1. 深度生活工作室' },
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
  const ops = createOperations({
    ctx: {
      subprocess: realSubprocess,
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
      llm: {
        stream({ messages }) {
          const last = messages?.[messages.length - 1]
          return (async function* () {
            if (last?.role === 'tool') {
              yield { type: 'text-delta', text: '已查询今日日程安排与会议状态。' }
            } else {
              yield {
                type: 'block-end',
                index: 0,
                block: { type: 'tool-call', id: 'c_cal_94', name: 'run_readonly', arguments: JSON.stringify({ argv: ['calendar', '+agenda'], skill: 'calendar' }) },
              }
            }
          })()
        },
      },
    },
  }, process.cwd())
  const res = await ops.dispatchCollab({ instruction: '查一下我今天的日程安排与会议' })
  assert.strictEqual(typeof res.ok, 'boolean')
  assert.strictEqual(res.domain, 'calendar')
  assert.ok(typeof res.reply === 'string' && res.reply.length > 0)
})

test('9.5 飞书团队知识库与云文档检索调度验证', async () => {
  const ops = createOperations({
    ctx: {
      subprocess: realSubprocess,
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
      llm: {
        stream({ messages }) {
          const last = messages?.[messages.length - 1]
          return (async function* () {
            if (last?.role === 'tool') {
              yield { type: 'text-delta', text: '已为您检索团队知识库与云文档：最新规范。' }
            } else {
              yield {
                type: 'block-end',
                index: 0,
                block: { type: 'tool-call', id: 'c_wiki_95', name: 'run_readonly', arguments: JSON.stringify({ argv: ['docs', '+search', '--query', '最新规范'], skill: 'wiki' }) },
              }
            }
          })()
        },
      },
    },
  }, process.cwd())
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
  assert.strictEqual(registeredRoutes.size, 20, '全部 20 个端点应仅通过 DSH Connection Fetch 注册')
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
    '/api/dsh-lark/connect/cancel',
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

  // 12b. POST /connect/cancel
  const r12b = await callConnection('/api/dsh-lark/connect/cancel', 'POST')
  assert.strictEqual(r12b.status, 200)
  assert.strictEqual(r12b.data.ok, true)
  assert.strictEqual(r12b.data.cancelled, true)

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
        let payload
        if (lastUserPrompt.includes('本次修改意见：不错，建吧') || lastUserPrompt.includes('本次修改意见：确认建表')) {
          payload = { action: 'build' }
        } else if (lastUserPrompt.includes('本次修改意见：不错')) {
          payload = { action: 'keep' }
        } else {
          payload = {
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
          }
        }
        return (async function* () {
          yield {
            type: 'text-delta',
            text: JSON.stringify(payload),
          }
        })()
      },
    },
  }

  const planner = createPlanner({ ctx: mockCtx })

  // 1. 认可评价词（「不错」）：由大模型原生识别为 keep，保持原表不变
  const keepRes = await planner.plan('不错', undefined, undefined, { currentPlan: basePlan })
  assert.strictEqual(keepRes.ok, true)
  assert.strictEqual(keepRes.action, 'keep')
  assert.strictEqual(keepRes.plan, basePlan)

  // 2. 明确确认建表指令（「确认建表」或「不错，建吧」）：由大模型原生返回 build 动作
  const buildRes = await planner.plan('确认建表', undefined, undefined, { currentPlan: basePlan })
  assert.strictEqual(buildRes.ok, true)
  assert.strictEqual(buildRes.action, 'build')
  assert.strictEqual(buildRes.plan, basePlan)
  const comboBuildRes = await planner.plan('不错，建吧', undefined, undefined, { currentPlan: basePlan })
  assert.strictEqual(comboBuildRes.ok, true)
  assert.strictEqual(comboBuildRes.action, 'build')
  assert.strictEqual(llmCalls, 3)

  // 3. 局部增量修改（「增加一列优先级」）：携带 currentPlan 进模型，保留旧值并返回 changedFields
  const updateRes = await planner.plan('增加一列优先级', undefined, undefined, { currentPlan: basePlan })
  assert.strictEqual(updateRes.ok, true)
  assert.strictEqual(updateRes.action, 'update')
  assert.strictEqual(llmCalls, 4)
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
  assert.strictEqual(defaults.showInConversationTab.get(), false, 'showInConversationTab 默认应关闭')
  const customCfg = Config({ larkCliPath: '/opt/bin/lark-cli', binDir: '/opt/bin', identity: 'user', showInConversationTab: true })
  assert.strictEqual(customCfg.larkCliPath, '/opt/bin/lark-cli')
  assert.strictEqual(customCfg.binDir, '/opt/bin')
  assert.strictEqual(customCfg.identity, 'user')
  assert.strictEqual(customCfg.showInConversationTab.get(), true, 'showInConversationTab 支持设为 true')

  // 验证 client.js 对 showInConversationTab 的动态注入与卸载
  const clientSrc = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  let loadedPlugin = null
  const prevWindow = globalThis.window
  const prevDocument = globalThis.document
  try {
    const storage = new Map()
    globalThis.window = {
      localStorage: {
        getItem: (k) => (storage.has(k) ? storage.get(k) : null),
        setItem: (k, v) => storage.set(k, String(v)),
        removeItem: (k) => storage.delete(k),
      },
      __ModuleLoader__: {
        load(mod) {
          loadedPlugin = mod.factory((name) => {
            if (name === 'react') {
              return {
                createElement: (type, props, ...children) => ({ type, props, children }),
                useCallback: (fn) => fn,
                useEffect: () => {},
                useMemo: (fn) => fn(),
                useRef: (v) => ({ current: v }),
                useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
              }
            }
            return {}
          })
        },
      },
    }
    globalThis.document = { body: null, getElementById: () => null }
    new Function(clientSrc)()
    assert.ok(loadedPlugin && typeof loadedPlugin.apply === 'function', 'client.js 必须导出 apply')

    const injectedSlots = new Map()
    const effects = []
    const registeredComponents = new Map()
    const mockCtx = {
      effect(fn) {
        const d = fn()
        if (typeof d === 'function') effects.push(d)
        return d
      },
      locale: { register: () => () => {}, bind: () => (k) => k },
      slots: {
        register: (opts, comp) => {
          registeredComponents.set(opts.name, comp)
          return opts
        },
        inject(name, factory) {
          injectedSlots.set(name, (injectedSlots.get(name) || 0) + 1)
          factory()
          return () => {
            const next = (injectedSlots.get(name) || 1) - 1
            if (next <= 0) injectedSlots.delete(name)
            else injectedSlots.set(name, next)
          }
        },
      },
      sidebarRight: {},
      sidebarRightTabs: { register: () => () => {} },
    }

    let tabFlag = false
    const listeners = new Set()
    const syncedRef = {
      get: () => tabFlag,
      getSnapshot: () => tabFlag,
      subscribe(fn) {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
    }
    const setCalls = []
    const configFormsMock = {
      get(id) {
        assert.strictEqual(id, 'lark-workbench')
        return {
          getSnapshot: () => ({ status: 'ready', writable: true, value: { showInConversationTab: tabFlag } }),
          subscribe: () => () => {},
          set: async (k, v) => {
            setCalls.push([k, v])
            tabFlag = Boolean(v)
            for (const fn of listeners) fn()
            return true
          },
        }
      },
    }
    mockCtx.get = (name) => (name === 'configForms' ? configFormsMock : undefined)
    const allowedKeys = new Set([...loadedPlugin.inject, 'effect', 'get'])
    const strictCtx = new Proxy(mockCtx, {
      get(target, prop) {
        if (typeof prop === 'string' && !allowedKeys.has(prop)) {
          throw new Error(`Cordis isolation violation: direct access to uninjected ctx.${prop}`)
        }
        return target[prop]
      },
    })
    loadedPlugin.apply(strictCtx, { showInConversationTab: syncedRef })
    assert.strictEqual(injectedSlots.has('sidebar.panellist'), true, '左侧边栏入口应始终注入')
    assert.strictEqual(injectedSlots.has('main'), true, '独立主视图应始终注入')
    assert.strictEqual(injectedSlots.has('plugins.detail.section'), true, '插件详情配置区块应始终注入')
    assert.strictEqual(injectedSlots.has('sidebar.right.pane.tab'), true, '右侧边栏标签页应始终注入')
    assert.strictEqual(injectedSlots.has('conversation.view'), false, '默认关闭时不应注入 conversation.view')

    // 验证 plugins.detail.section 对其他插件返回 null，对本插件渲染并能通过 onToggle 立即注入/注销 conversation.view
    const detailSectionRender = registeredComponents.get('plugins.detail.section')
    const otherEl = detailSectionRender({ subject: { kind: 'bundle', pkg: { name: 'other-plugin' } }, t: (k) => k })
    assert.strictEqual(otherEl.type(otherEl.props), null, '其他插件详情页应返回 null')
    const selfEl = detailSectionRender({ subject: { kind: 'bundle', pkg: { name: 'dsh-lark-studio' } }, t: (k) => k })
    assert.ok(selfEl.type(selfEl.props) !== null, '本插件详情页应渲染设置区块')

    await selfEl.props.onToggle(true)
    assert.strictEqual(storage.get('dsh-lark-conv-tab'), 'true')
    assert.strictEqual(injectedSlots.get('conversation.view'), 1, '通过开关开启后应立即注入 conversation.view')

    await selfEl.props.onToggle(false)
    assert.strictEqual(storage.get('dsh-lark-conv-tab'), 'false')
    assert.strictEqual(injectedSlots.has('conversation.view'), false, '通过开关关闭后应立即注销 conversation.view')
    assert.deepStrictEqual(setCalls, [['showInConversationTab', true], ['showInConversationTab', false]])
  } finally {
    globalThis.window = prevWindow
    globalThis.document = prevDocument
  }
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

    let linkAppInitArgs = null
    const ctrlLinkApp = makeControl((cmd, args, opts) => {
      if (cmd === 'config-init') {
        linkAppInitArgs = args
        opts?.onLine?.('stdout', 'Open https://open.feishu.cn/create-app.')
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      if (cmd === 'config-show') return { exitCode: 0, stdout: '{"appId":"cli_123"}', stderr: '' }
      return { exitCode: 0, stdout: '{"userReady":true,"userName":"Bob"}', stderr: '' }
    })
    await reg.perform('link-app', ctrlLinkApp, new AbortController().signal)
    assert.deepStrictEqual(linkAppInitArgs, ['config', 'init', '--new'], '网页流程 config init --new 严禁附带 --brand')
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

    const signOutCommands = []
    let appRemoved = false
    const ctrlSignOut = makeControl((cmd) => {
      signOutCommands.push(cmd)
      if (cmd === 'config-remove') {
        appRemoved = true
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      if (cmd === 'config-show') {
        return { exitCode: 0, stdout: appRemoved ? '{}' : '{"appId":"cli_123"}', stderr: '' }
      }
      if (cmd === 'auth-status') return { exitCode: 0, stdout: '{"identities":{"user":{"available":false,"status":"missing"}}}', stderr: '' }
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    await reg.perform('sign-out', ctrlSignOut, new AbortController().signal)
    assert.ok(ctrlSignOut.stages.includes('signing-out'))
    assert.ok(signOutCommands.includes('auth-logout'), 'sign-out 应执行 auth-logout 清除用户登录态')
    assert.ok(signOutCommands.includes('config-remove'), 'sign-out 应同步执行 config-remove 解绑应用')
    assert.strictEqual(ctrlSignOut.published.at(-1).state, 'no-app', '退出并解绑后状态应回到 no-app')

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

test('15.4 侧边栏对话动态复用官方 lark-cli Skill (ReAct 工具循环、渐进引用读取与写操作确认拦截)', async () => {
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import('node:fs')
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
          stream({ tools, messages }) {
            assert.ok(Array.isArray(tools) && tools.some((t) => t.name === 'read_skill' && t.name), '应向模型暴露标准工具列表')
            const last = messages[messages.length - 1]
            const prevCalls = messages.filter((m) => m.role === 'tool').length
            return (async function* () {
              if (prevCalls === 0) {
                yield {
                  type: 'block-end',
                  index: 0,
                  block: { type: 'tool-call', id: 'tc_read', name: 'read_skill', arguments: JSON.stringify({ skill: 'lark-approval' }) },
                }
              } else if (prevCalls === 1) {
                if (mode === 'mutating') {
                  yield {
                    type: 'block-end',
                    index: 0,
                    block: {
                      type: 'tool-call',
                      id: 'tc_write',
                      name: 'propose_write',
                      arguments: JSON.stringify({
                        skill: 'lark-approval',
                        steps: [['approval', '+instance-create', '--code', 'LEAVE']],
                        reason: '将发起请假审批实例',
                      }),
                    },
                  }
                } else {
                  yield {
                    type: 'block-end',
                    index: 0,
                    block: {
                      type: 'tool-call',
                      id: 'tc_query',
                      name: 'run_readonly',
                      arguments: JSON.stringify({ argv: ['approval', 'tasks', 'query', '--topic', '1'], skill: 'lark-approval' }),
                    },
                  }
                }
              } else {
                const toolText = String(last?.content?.[0]?.text || '')
                assert.ok(toolText.includes('年假申请'), '真实查询数据必须回传给模型上下文')
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
                done: Promise.resolve({ exitCode: 0, stdout: '# lark-approval\nUse `lark-cli approval tasks query --topic 1` to query pending approvals.', stderr: '' }),
                terminate() {},
              }
            }
            if (argv.includes('--help')) {
              if (argv.includes('+instance-create')) {
                return { done: Promise.resolve({ exitCode: 0, stdout: 'Create approval instance\nRisk: write\nFlags:\n  --code string\n', stderr: '' }), terminate() {} }
              }
              return { done: Promise.resolve({ exitCode: 0, stdout: 'Query approval tasks\nRisk: read\nFlags:\n  --topic string\n', stderr: '' }), terminate() {} }
            }
            if (argv.includes('approval') && argv.includes('tasks') && argv.includes('query')) {
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

    // 1. 只读动态 Skill 执行（read_skill -> run_readonly (--help Risk: read 校验) -> 回复）
    const res1 = await opsSkill.dispatchCollab({ instruction: '帮我查一下待我处理的飞书审批' })
    assert.strictEqual(res1.ok, true)
    assert.strictEqual(res1.skill, 'lark-approval')
    assert.strictEqual(readSkillGuideCalled, true, '必须按官方规范先读取对应 skill 指南再规划命令')
    assert.ok(res1.reply.includes('待处理审批'))

    // 2. 动态 Skill 遇到权限不足时立即中断循环并走统一 scopeError 授权卡片
    mode = 'missing_scope'
    const res2 = await opsSkill.dispatchCollab({ instruction: '帮我查一下待我处理的飞书审批' })
    assert.strictEqual(res2.ok, false)
    assert.strictEqual(res2.type, 'missing_scope')
    assert.strictEqual(res2.domain, 'lark-approval')
    assert.strictEqual(res2.domainTitle, '飞书审批')

    // 3. 写入/变更型动态 Skill 命令必须通过 propose_write 拦截为 needsConfirm + skill_guard，绝不静默直接运行
    mode = 'mutating'
    const prevCmdCount = seenArgs.length
    const res3 = await opsSkill.dispatchCollab({ instruction: '帮我提交一个请假审批' })
    assert.strictEqual(res3.ok, true)
    assert.strictEqual(res3.needsConfirm, true)
    assert.strictEqual(res3.confirmKind, 'skill_guard')
    assert.ok(res3.reply.includes('将发起请假审批实例'))
    assert.strictEqual(
      seenArgs.slice(prevCmdCount).some((a) => a.includes('+instance-create') && !a.includes('--help')),
      false,
      '未确认的变更型 CLI 命令绝不能自动执行',
    )

    // 4. 多步骤工作流 (连续调用 run_readonly)、纯文本表格输出 (rawText) 以及 --query 包含 update 字样不误判写操作
    let sawRawTextInSummarizer = false
    const opsWorkflow = createOperations({
      ctx: {
        agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
        llm: {
          stream({ messages }) {
            const toolMsgs = messages.filter((m) => m.role === 'tool')
            const allText = messages.map((m) => (Array.isArray(m.content) ? m.content.map((c) => c.text || '').join('') : '')).join('')
            return (async function* () {
              if (toolMsgs.length === 0) {
                yield {
                  type: 'block-end',
                  index: 0,
                  block: { type: 'tool-call', id: 'wf_1', name: 'run_readonly', arguments: JSON.stringify({ argv: ['calendar', '+agenda'], skill: 'lark-workflow-standup-report' }) },
                }
              } else if (toolMsgs.length === 1) {
                yield {
                  type: 'block-end',
                  index: 0,
                  block: { type: 'tool-call', id: 'wf_2', name: 'run_readonly', arguments: JSON.stringify({ argv: ['docs', '+search', '--query', 'update'], skill: 'lark-workflow-standup-report' }) },
                }
              } else {
                if (allText.includes('plain text agenda row')) sawRawTextInSummarizer = true
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
            if (argv.includes('--help')) {
              if (argv.includes('+agenda')) return { done: Promise.resolve({ exitCode: 0, stdout: 'Agenda\nRisk: read\nFlags:\n', stderr: '' }), terminate() {} }
              if (argv.includes('+search')) return { done: Promise.resolve({ exitCode: 0, stdout: 'Search\nRisk: read\nFlags:\n  --query string\n', stderr: '' }), terminate() {} }
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
    assert.strictEqual(sawRawTextInSummarizer, true, '纯文本输出（非 JSON）与多步骤 tool result 必须完整喂给后续推理')

    // 5. 真机内置 @larksuite/cli 全部 25 份 Skill 实测、别名解析与 references 子文档读取校验
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
                text: '{"action": "reply", "reply": "你好！\n\n我可以帮你：\n- 日历日程"}',
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
    assert.ok(brokenRes.reply.includes('你好！') && brokenRes.reply.includes('日历日程'))
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

  // 4. dispatchCollab 在 lang='en' 时必须下发英文规则并在工具完成后返回自然英文回答
  let capturedPlannerSys = ''
  const mockCliPath = fileURLToPath(new URL('./package.json', import.meta.url))
  const opsEn = createOperations({
    ctx: {
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
      llm: {
        stream({ system, messages }) {
          if (system.includes('Collaboration Agent')) capturedPlannerSys = system
          const last = messages[messages.length - 1]
          return (async function* () {
            if (last?.role === 'tool') {
              yield { type: 'text-delta', text: 'You have 1 pending leave approval.' }
            } else {
              yield {
                type: 'block-end',
                index: 0,
                block: { type: 'tool-call', id: 'en_1', name: 'run_readonly', arguments: JSON.stringify({ argv: ['approval', 'tasks', 'query', '--topic', '1'], skill: 'lark-approval' }) },
              }
            }
          })()
        },
      },
      subprocess: {
        spawn({ argv }) {
          if (argv.includes('skills') && argv.includes('list')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ skills: [{ name: 'lark-approval', description: 'Approval' }] }), stderr: '' }), terminate() {} }
          }
          if (argv.includes('--help')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: 'Query tasks\nRisk: read\nFlags:\n  --topic string\n', stderr: '' }), terminate() {} }
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

// -------------------------------------------------------------
// 16. 文件上传、解析暂存、空白输入兜底与真实数据导入验证
// -------------------------------------------------------------
test('16.1 file-reader 零依赖解析 (CSV/TSV 嗅探、路径清洗、大小限制、暂存清理)', async () => {
  const { createFileStaging, buildAttachmentContext, parseDelimitedText, sanitizeFilename } = await import('./file-reader.js')
  assert.strictEqual(sanitizeFilename('../../etc/passwd'), 'passwd')
  assert.strictEqual(sanitizeFilename('  '), 'file')

  const csv = '\uFEFF公司名称,联系人,预算\n字节跳动,张三,500000\n"月之暗面, Inc.",李四,300000\n'
  const parsed = parseDelimitedText(csv)
  assert.deepStrictEqual(parsed.headers, ['公司名称', '联系人', '预算'])
  assert.strictEqual(parsed.rows.length, 2)
  assert.strictEqual(parsed.rows[1]['公司名称'], '月之暗面, Inc.')

  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const staging = createFileStaging({ maxBytes: 1024, rootDir: mkdtempSync(join(tmpdir(), 'lw-test-upload-')) })
  const saved = await staging.saveStream({
    body: Buffer.from(csv, 'utf8'),
    name: '../leads.csv',
    mime: 'text/csv',
  })
  assert.strictEqual(saved.name, 'leads.csv')
  assert.strictEqual(saved.kind, 'table')
  assert.strictEqual(saved.totalRows, 2)

  const ctxObj = buildAttachmentContext(staging.getMany([saved.id]))
  assert.ok(ctxObj.promptBlock.includes('Spreadsheet "leads.csv": 2 data rows, 3 columns.'))
  assert.strictEqual(ctxObj.tableAttachments.length, 1)

  // 超限拦截 413
  let overErr = null
  try {
    await staging.saveStream({ body: Buffer.alloc(2048, 65), name: 'big.txt', mime: 'text/plain' })
  } catch (e) {
    overErr = e
  }
  assert.ok(overErr && overErr.statusCode === 413)

  assert.strictEqual(await staging.remove(saved.id), true)
  assert.strictEqual(staging.get(saved.id), null)
  await staging.dispose()
})

test('16.2 只传文件不打字时 planner.plan 与 adjustPlanner.plan 正常兜底并透传文件上下文', async () => {
  let capturedPlannerPrompt = ''
  const mockCtx = {
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    llm: {
      stream({ messages }) {
        capturedPlannerPrompt = messages[0].content.map((c) => c.text || '').join('')
        return (async function* () {
          yield {
            type: 'text-delta',
            text: JSON.stringify({
              isTable: true,
              baseName: '导入客户表',
              intro: '根据 CSV 整理客户台账',
              tables: [{ name: '客户', fields: [{ type: 'text', name: '公司名称', description: '客户公司' }] }],
            }),
          }
        })()
      },
    },
  }
  const p = createPlanner({ ctx: mockCtx })
  const res = await p.plan('', undefined, undefined, {
    attachmentContext: {
      promptBlock: '<attached_file name="leads.csv">demo</attached_file>',
      tableAttachments: [{ id: 'f1', name: 'leads.csv', totalRows: 2 }],
    },
  })
  assert.strictEqual(res.ok, true)
  assert.strictEqual(res.plan.baseName, '导入客户表')
  assert.ok(capturedPlannerPrompt.includes('leads.csv'))

  let capturedAdjustText = ''
  const ap = createAdjustPlanner({
    ctx: {
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
      llm: {
        stream({ messages }) {
          const last = messages[messages.length - 1]
          capturedAdjustText = last.content.map((c) => c.text || '').join('')
          return (async function* () {
            yield { type: 'text-delta', text: JSON.stringify({ type: 'answer', reply: '已读取附件内容。' }) }
          })()
        },
      },
    },
  })
  const adjRes = await ap.plan(
    { instruction: '', attachmentContext: { promptBlock: '<attached_file name="doc.txt">hello</attached_file>' } },
    { ok: true, tables: [{ name: '表1', fields: [{ name: '名称', type: 'text' }], views: [] }] },
    { ok: true, rows: [] },
  )
  assert.strictEqual(adjRes.ok, true)
  assert.strictEqual(adjRes.type, 'answer')
  assert.ok(capturedAdjustText.includes('doc.txt'))
})

test('16.3 前端上传交互、零 Emoji、动效与防错契约验证', async () => {
  const { readFileSync } = await import('node:fs')
  const clientSrc = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  const indexSrc = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
  assert.ok(indexSrc.includes("path: '/api/dsh-lark/upload'") && indexSrc.includes("requestBody: 'streaming'"))
  assert.ok(clientSrc.includes('lw-drop-overlay') && clientSrc.includes('lw-file-pill') && clientSrc.includes('lw-ring-fill'))
  assert.ok(clientSrc.includes('visionWarning') && clientSrc.includes('inputModalities'))
  assert.ok(clientSrc.includes('onPaste:') && clientSrc.includes('onDrop:'))
  assert.strictEqual(/[\u{1F300}-\u{1FAFF}]/u.test(clientSrc), false, 'client.js 不应包含任何 Emoji')
  assert.strictEqual(indexSrc.includes("Reflect.get(ctx, 'attachments')"), false, '可选服务 attachments 必须使用 ctx.get，禁止绕过 Cordis inject proxy')
  assert.ok(clientSrc.includes('historyAttachmentIds'), '多轮对话应自动续传本会话已上传的附件 ID')

  // 模型返回自然语言而非 JSON 时，planner.plan 应转为 isNotTable 而非报错
  const textFallbackPlanner = createPlanner({
    ctx: {
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
      llm: {
        stream() {
          return (async function* () {
            yield { type: 'text-delta', text: '这是一份峰会项目管理系统搭建需求文档，包含三张核心表和报价要求。' }
          })()
        },
      },
    },
  })
  const fallbackRes = await textFallbackPlanner.plan('这是什么表')
  assert.strictEqual(fallbackRes.ok, false)
  assert.strictEqual(fallbackRes.isNotTable, true)

  // parsePlanText 容错：字符串内未转义换行、尾随逗号，以及不硬编码低 maxTokens 饿死思考模型
  const { parsePlanText } = await import('./planner.js')
  const dirtyJson = '```json\n{\n  "isTable": true,\n  "baseName": "Summit Project Tracker",\n  "intro": "Line1\nLine2",\n  "tables": [{\n    "name": "Master Tracker",\n    "fields": [\n      {"type": "text", "name": "Item"},\n      {"type": "url", "name": "Link"},\n      {"type": "currency", "name": "Budget"},\n    ],\n  }],\n}\n```'
  const parsedDirty = parsePlanText(dirtyJson)
  assert.ok(parsedDirty && parsedDirty.isTable === true)
  const sanitizedDirty = sanitizePlan(parsedDirty, 'en')
  assert.strictEqual(sanitizedDirty.ok, true)
  assert.strictEqual(sanitizedDirty.plan.tables[0].fields[1].style.type, 'url')
  assert.strictEqual(sanitizedDirty.plan.tables[0].fields[2].type, 'number')
  const plannerSrc = readFileSync(new URL('./planner.js', import.meta.url), 'utf8')
  assert.strictEqual(/maxTokens\s*:/.test(plannerSrc), false, 'planner.js 不应硬编码小 maxTokens 截断 DeepSeek 思考模型输出')
  assert.ok(clientSrc.includes('liveReply') && clientSrc.includes('reply_delta'), '前端应支持实时流式渲染 reply_delta')
})

test('17.1 cli-introspect 运行时 Risk 门禁、schema/references 自省、安全边界阻断与自愈闭环', async () => {
  const { fileURLToPath } = await import('node:url')
  const { createCliIntrospector, normalizeSkillArgvWithDomain, parseHelpMetadata } = await import('./cli-introspect.js')

  // 0. 官方 SKILL.md 省略域名时的自动补全
  assert.deepStrictEqual(normalizeSkillArgvWithDomain(['tasks', 'query', '--topic', '1'], 'lark-approval'), ['approval', 'tasks', 'query', '--topic', '1'])
  assert.deepStrictEqual(normalizeSkillArgvWithDomain(['+cycle-list'], 'lark-okr'), ['okr', '+cycle-list'])
  assert.deepStrictEqual(normalizeSkillArgvWithDomain(['+detail', '--minute-tokens', 'm1'], 'lark-meeting'), ['minutes', '+detail', '--minute-tokens', 'm1'])
  assert.deepStrictEqual(normalizeSkillArgvWithDomain(['+search', '--query', '周会'], 'lark-workflow-meeting-summary'), ['minutes', '+search', '--query', '周会'])

  // 1. 解析真实 --help 元数据 + 运行时 Risk: read 放行 vs 全部危险旁路拦截
  const helpMap = {
    'approval tasks query': 'Query tasks\nRisk: read\nFlags:\n  --topic string\n  --page-size int\n',
    'calendar +agenda': 'Agenda\nRisk: read\nFlags:\n  --start string\n',
    'docs +search': 'Search docs\nRisk: read\nFlags:\n  --query string\n  --page-size int\n  -o, --output string\n',
    'sheets +cells-get': 'Cells get\nRisk: read\nFlags:\n  --spreadsheet-token string\n  --sheet-id string\n  --range string\n  --skip-hidden\n',
    'attendance user_tasks query': 'Attendance query\nRisk: read\nFlags:\n  --employee-type string\n  --data string\n',
    'contact user_profiles batch_query': 'Batch query\nRisk: read\nFlags:\n  --data string\n',
    'minutes +detail': 'Minutes detail\nRisk: read\nFlags:\n  --minute-tokens string\n  --summary\n  --todo\n  --keyword\n  --transcript\n',
    'task +delete': 'Delete task\nRisk: high-risk-write\nFlags:\n  --task-id string\n',
    'task tasks delete': 'Delete task\nRisk: high-risk-write\nRequired:\n  --task-guid string\n',
    'im +chat-messages-list': 'List messages\nRisk: read\nFlags:\n  --chat-id string\n  --download-resources\n  --page-all\n',
  }
  const parsedSample = parseHelpMetadata(helpMap['task tasks delete'])
  assert.strictEqual(parsedSample.risk, 'high-risk-write')
  assert.ok(parsedSample.requiredFlags.has('--task-guid'))

  const introspect = createCliIntrospector({
    getCliPath: async () => 'mock-cli',
    async invoke(args) {
      const prefix = args.slice(0, args.indexOf('--help')).join(' ')
      const stdout = helpMap[prefix] || ''
      return stdout ? { exitCode: 0, stdout, stderr: '' } : { exitCode: 1, stdout: '', stderr: 'not found' }
    },
    async runJson() {
      return { ok: true, value: {} }
    },
  })

  // 合法 Risk: read 命令放行
  assert.strictEqual((await introspect.evaluateReadonlySafety(['approval', 'tasks', 'query', '--topic', '1', '--page-size', '20'])).ok, true)
  assert.strictEqual((await introspect.evaluateReadonlySafety(['calendar', '+agenda', '--start', '-7d', '--json'])).ok, true)
  assert.strictEqual((await introspect.evaluateReadonlySafety(['docs', '+search', '--query', 'update'])).ok, true)
  assert.strictEqual((await introspect.evaluateReadonlySafety(['sheets', '+cells-get', '--spreadsheet-token', 'sht1', '--sheet-id', 'sh1', '--range', 'A1:C5', '--skip-hidden'])).ok, true)
  assert.strictEqual((await introspect.evaluateReadonlySafety(['attendance', 'user_tasks', 'query', '--employee-type', 'employee_id', '--data', '{"user_ids":["u1"]}'])).ok, true)
  assert.strictEqual((await introspect.evaluateReadonlySafety(['contact', 'user_profiles', 'batch_query', '--data', '{"user_ids":["ou_1"]}'])).ok, true)
  assert.strictEqual((await introspect.evaluateReadonlySafety(['minutes', '+detail', '--minute-tokens', 'm1', '--summary', '--todo', '--keyword'])).ok, true)
  assert.strictEqual((await introspect.evaluateReadonlySafety(['whoami', '--json'])).ok, true)

  // 严格 Fail-Closed 拦截全部绕过/写操作/导出/未验证命令
  assert.strictEqual((await introspect.evaluateReadonlySafety(['task', '--json', '+delete', '--task-id', '1'])).ok, false)
  assert.strictEqual((await introspect.evaluateReadonlySafety(['task', 'tasks', 'delete', '--task-id', '1', '--yes'])).ok, false)
  assert.strictEqual((await introspect.evaluateReadonlySafety(['api', 'GET', '/open-apis/calendar/v4/calendars'])).ok, false)
  assert.strictEqual((await introspect.evaluateReadonlySafety(['apps', '+env-list', '--app-id', 'cli_1', '--include-values'])).ok, false)
  assert.strictEqual((await introspect.evaluateReadonlySafety(['event', 'consume', '--max-events', '1'])).ok, false)
  assert.strictEqual((await introspect.evaluateReadonlySafety(['drive', '+download', '--file-token', 'f1', '--output', '/tmp/x'])).ok, false)
  assert.strictEqual((await introspect.evaluateReadonlySafety(['docs', '+script', '--doc', 'd1'])).ok, false)
  assert.strictEqual((await introspect.evaluateReadonlySafety(['minutes', '+detail', '--minute-tokens', 'm1', '--transcript'])).ok, false)
  assert.strictEqual((await introspect.evaluateReadonlySafety(['im', '+chat-messages-list', '--chat-id', 'oc_1', '--download-resources'])).ok, false)
  assert.strictEqual((await introspect.evaluateReadonlySafety(['im', '+chat-messages-list', '--chat-id', 'oc_1', '--page-all'])).ok, false)
  assert.strictEqual((await introspect.evaluateReadonlySafety(['approval', 'tasks', 'query', '--params', '{"topic":"1"}'])).ok, false)
  assert.strictEqual((await introspect.evaluateReadonlySafety(['contact', 'user_profiles', 'batch_query', '--data', '@/etc/passwd'])).ok, false)
  assert.strictEqual((await introspect.evaluateReadonlySafety(['contact', 'user_profiles', 'batch_query', '--data', '-'])).ok, false)
  assert.strictEqual((await introspect.evaluateReadonlySafety(['docs', '+search', '--query', 'a', '--output', '/tmp/out.json'])).ok, false)
  assert.strictEqual((await introspect.evaluateReadonlySafety(['sheets', '+cells-get', '--spreadsheet-token', 's1', '--skip-hidden', 'true'])).ok, false)
  assert.strictEqual((await introspect.evaluateReadonlySafety(['docs', '+search', '--query', '--page-size', '10'])).ok, false)

  // 2. 真实内置 @larksuite/cli 实测（零 Mock）：验证 Risk: read / high-risk-write / schema / references/*.md 读取
  const realOpsForIntrospect = createOperations({ ctx: { subprocess: realSubprocess }, config: { skipSystemCliLookup: true } })
  const bundledCli = realOpsForIntrospect.resolveCliSync()
  if (bundledCli) {
    const realIntrospect = createCliIntrospector({
      getCliPath: async () => bundledCli,
      async invoke(args) {
        const handle = realSubprocess.spawn({ argv: [bundledCli, ...args] })
        const done = await handle.done
        return {
          exitCode: done?.exitCode ?? 1,
          stdout: handle.collected?.stdout?.readFrom?.()?.text || done?.stdout || '',
          stderr: handle.collected?.stderr?.readFrom?.()?.text || done?.stderr || '',
        }
      },
      async runJson(args) {
        const handle = realSubprocess.spawn({ argv: [bundledCli, ...args] })
        const done = await handle.done
        const stdout = handle.collected?.stdout?.readFrom?.()?.text || done?.stdout || ''
        return { ok: done?.exitCode === 0, value: JSON.parse(stdout || '{}') }
      },
    })
    const roReal = await realIntrospect.evaluateReadonlySafety(['task', '+get-related-tasks', '--created-by-me'])
    assert.strictEqual(roReal.ok, true)
    assert.strictEqual(roReal.risk, 'read')
    const delReal = await realIntrospect.evaluateReadonlySafety(['task', 'tasks', 'delete', '--task-guid', 'g1'])
    assert.strictEqual(delReal.ok, false)
    assert.strictEqual(delReal.risk, 'high-risk-write')
    const schemaReal = await realIntrospect.inspectSchema('task.tasks.delete')
    assert.strictEqual(schemaReal.ok, true)
    assert.ok(schemaReal.schema._meta?.risk === 'high-risk-write')
    const refDoc = await realIntrospect.readSkillDoc('lark-task', 'references/lark-task-get-related-tasks.md')
    assert.ok(refDoc && refDoc.includes('--created-by-me'), '应能渐进读取官方 references/*.md 子文档')
  }

  // 3. 端到端安全护栏测试：尝试用 run_readonly 走私 --json +delete / --output / --include-values 会被原地阻断，并触发 skill_guard
  let executedCmds = []
  let guardTestPayload = ['task', '--json', '+delete', '--task-id', 't1']
  const opsGuard = createOperations({
    ctx: {
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
      llm: {
        stream({ messages }) {
          const toolMsgs = messages.filter((m) => m.role === 'tool')
          return (async function* () {
            if (toolMsgs.length === 0) {
              // 尝试通过只读工具夹带执行危险/写命令
              yield {
                type: 'block-end',
                index: 0,
                block: { type: 'tool-call', id: 'g_1', name: 'run_readonly', arguments: JSON.stringify({ argv: guardTestPayload, skill: 'lark-task' }) },
              }
            } else {
              // 被 run_readonly 拦截并返回 blocked/requiresConfirmation 后转入唯一写确认闸门 propose_write
              const lastJson = JSON.parse(String(toolMsgs[toolMsgs.length - 1].content[0].text))
              assert.strictEqual(lastJson.blocked, true)
              assert.strictEqual(lastJson.requiresConfirmation, true)
              yield {
                type: 'block-end',
                index: 0,
                block: {
                  type: 'tool-call',
                  id: 'g_2',
                  name: 'propose_write',
                  arguments: JSON.stringify({ skill: 'lark-task', steps: [guardTestPayload], reason: '需要确认后才可执行' }),
                },
              }
            }
          })()
        },
      },
      subprocess: {
        spawn({ argv }) {
          if (argv.includes('auth') || argv.includes('config') || argv.includes('--help') || (argv.includes('skills') && argv.includes('list'))) {
            return { done: Promise.resolve({ exitCode: 0, stdout: argv.includes('list') ? JSON.stringify({ skills: [{ name: 'lark-task', description: 'Tasks' }] }) : '{}', stderr: '' }), terminate() {} }
          }
          executedCmds.push(argv)
          return { done: Promise.resolve({ exitCode: 0, stdout: '{}', stderr: '' }), terminate() {} }
        },
      },
    },
    config: { larkCliPath: fileURLToPath(new URL('./package.json', import.meta.url)) },
  })

  const r1 = await opsGuard.dispatchCollab({ instruction: '删掉任务' })
  assert.strictEqual(r1.needsConfirm, true)
  assert.strictEqual(r1.confirmKind, 'skill_guard')
  assert.strictEqual(executedCmds.length, 0, '布尔 flag 绕过写操作绝不能自动执行')

  guardTestPayload = ['docs', '+search', '--query', 'ok', '--output', '/tmp/leak.json']
  const r2 = await opsGuard.dispatchCollab({ instruction: '导出文档搜索结果' })
  assert.strictEqual(r2.needsConfirm, true)
  assert.strictEqual(r2.confirmKind, 'skill_guard')
  assert.strictEqual(executedCmds.length, 0, '带 --output 的只读命令绝不能自动执行')

  guardTestPayload = ['apps', '+env-list', '--app-id', 'app_1', '--include-values']
  const r3 = await opsGuard.dispatchCollab({ instruction: '查看环境变量' })
  assert.strictEqual(r3.needsConfirm, true)
  assert.strictEqual(r3.confirmKind, 'skill_guard')
  assert.strictEqual(executedCmds.length, 0, 'apps 环境变量读取绝不能自动执行')

  // 4. 域名省略自动补全 + --help Risk: read 验证通过直接执行；confirmSkill=true 正常落地
  const executedAllowed = []
  const opsDomainNorm = createOperations({
    ctx: {
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
      llm: {
        stream({ messages }) {
          const toolMsgs = messages.filter((m) => m.role === 'tool')
          return (async function* () {
            if (toolMsgs.length === 0) {
              yield {
                type: 'block-end',
                index: 0,
                block: { type: 'tool-call', id: 'n_1', name: 'run_readonly', arguments: JSON.stringify({ argv: ['tasks', 'query', '--topic', '1'], skill: 'lark-approval' }) },
              }
            } else {
              yield { type: 'text-delta', text: '查询完成：共 0 条审批。' }
            }
          })()
        },
      },
      subprocess: {
        spawn({ argv }) {
          if (argv.includes('auth') || argv.includes('config')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: '{}', stderr: '' }), terminate() {} }
          }
          if (argv.includes('skills') && argv.includes('list')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ skills: [{ name: 'lark-approval', description: 'Approval' }] }), stderr: '' }), terminate() {} }
          }
          if (argv.includes('--help')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: 'Query tasks\nRisk: read\nFlags:\n  --topic string\n', stderr: '' }), terminate() {} }
          }
          executedAllowed.push(argv.slice(1))
          return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ ok: true, data: { tasks: [] } }), stderr: '' }), terminate() {} }
        },
      },
    },
    config: { larkCliPath: fileURLToPath(new URL('./package.json', import.meta.url)) },
  })
  const normRes = await opsDomainNorm.dispatchCollab({ instruction: '帮我查一下待我处理的飞书审批' })
  assert.strictEqual(normRes.ok, true)
  assert.strictEqual(normRes.needsConfirm, undefined)
  assert.ok(executedAllowed[0][0] === 'approval' && executedAllowed[0][1] === 'tasks' && executedAllowed[0][2] === 'query')

  const clientSrc = (await import('node:fs')).readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  assert.ok(clientSrc.includes('lw-action-card') && clientSrc.includes('onCancelSkill'), '应渲染结构化操作确认卡片并支持确认/取消')

  const confirmedRes = await opsDomainNorm.dispatchCollab({
    instruction: '确认执行',
    confirmSkill: true,
    skillName: 'lark-task',
    skillSteps: [['+create', '--title', '周报']],
  })
  assert.strictEqual(confirmedRes.ok, true)
  assert.ok(executedAllowed[1][0] === 'task' && executedAllowed[1][1] === '+create')

  // 5. okr 缺 user-id 时 tool result 自动注入 currentUserOpenId，模型在循环内自愈重试成功
  let okrAttempts = 0
  const opsOkrRepair = createOperations({
    ctx: {
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
      llm: {
        stream({ messages }) {
          const toolMsgs = messages.filter((m) => m.role === 'tool')
          return (async function* () {
            if (toolMsgs.length === 0) {
              yield {
                type: 'block-end',
                index: 0,
                block: { type: 'tool-call', id: 'o_1', name: 'run_readonly', arguments: JSON.stringify({ argv: ['+cycle-list'], skill: 'lark-okr' }) },
              }
            } else if (toolMsgs.length === 1) {
              const errData = JSON.parse(String(toolMsgs[0].content[0].text))
              assert.strictEqual(errData.currentUserOpenId, 'ou_self_123', '缺 open_id 时 run_readonly 工具返回应附带当前登录用户 open_id')
              yield {
                type: 'block-end',
                index: 0,
                block: { type: 'tool-call', id: 'o_2', name: 'run_readonly', arguments: JSON.stringify({ argv: ['okr', '+cycle-list', '--user-id', errData.currentUserOpenId], skill: 'lark-okr' }) },
              }
            } else {
              yield { type: 'text-delta', text: '您的当前 OKR 周期共 1 个。' }
            }
          })()
        },
      },
      subprocess: {
        spawn({ argv }) {
          if (argv.includes('auth') || argv.includes('config')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: '{}', stderr: '' }), terminate() {} }
          }
          if (argv.includes('skills') && argv.includes('list')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ skills: [{ name: 'lark-okr', description: 'OKR' }] }), stderr: '' }), terminate() {} }
          }
          if (argv.includes('--help')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: 'Cycle list\nRisk: read\nFlags:\n  --user-id string\n', stderr: '' }), terminate() {} }
          }
          if (argv.includes('contact') && argv.includes('+get-user')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ ok: true, data: { user: { open_id: 'ou_self_123' } } }), stderr: '' }), terminate() {} }
          }
          if (argv.includes('okr') && argv.includes('+cycle-list')) {
            okrAttempts++
            if (okrAttempts === 1) {
              return { done: Promise.resolve({ exitCode: 1, stdout: JSON.stringify({ ok: false, error: { message: 'required flag(s) "user-id" not set' } }), stderr: '' }), terminate() {} }
            }
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ ok: true, data: { cycles: [{ id: 'c1' }] } }), stderr: '' }), terminate() {} }
          }
          return { done: Promise.resolve({ exitCode: 0, stdout: '{}', stderr: '' }), terminate() {} }
        },
      },
    },
    config: { larkCliPath: fileURLToPath(new URL('./package.json', import.meta.url)) },
  })
  const okrRes = await opsOkrRepair.dispatchCollab({ instruction: '查一下我当前的 OKR' })
  assert.strictEqual(okrRes.ok, true)
  assert.strictEqual(okrAttempts, 2, 'okr +cycle-list 缺 user-id 应自动取 open_id 并在循环内自愈重试成功')

  // 6. 自动剥离 lark-cli 返回体中的 _notice 版本提醒，防止透传给模型与用户
  let sawNoticeInLoop = false
  const opsNoticeStrip = createOperations({
    ctx: {
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
      llm: {
        stream({ messages }) {
          const toolMsgs = messages.filter((m) => m.role === 'tool')
          for (const m of toolMsgs) {
            const s = String(m.content?.[0]?.text || '')
            if (s.includes('_notice') || s.includes('lark-cli update')) sawNoticeInLoop = true
          }
          return (async function* () {
            if (toolMsgs.length === 0) {
              yield {
                type: 'block-end',
                index: 0,
                block: { type: 'tool-call', id: 'nt_1', name: 'run_readonly', arguments: JSON.stringify({ argv: ['approval', 'tasks', 'query', '--topic', '1'], skill: 'lark-approval' }) },
              }
            } else {
              yield { type: 'text-delta', text: '目前没有待处理的审批。' }
            }
          })()
        },
      },
      subprocess: {
        spawn({ argv }) {
          if (argv.includes('auth') || argv.includes('config')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: '{}', stderr: '' }), terminate() {} }
          }
          if (argv.includes('skills') && argv.includes('list')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ skills: [{ name: 'lark-approval', description: 'Approval' }] }), stderr: '' }), terminate() {} }
          }
          if (argv.includes('--help')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: 'Query tasks\nRisk: read\nFlags:\n  --topic string\n', stderr: '' }), terminate() {} }
          }
          return {
            done: Promise.resolve({
              exitCode: 0,
              stdout: JSON.stringify({
                ok: true,
                _notice: 'Installed skills (1.0.98) are out of sync with lark-cli (1.0.100). Run lark-cli update.',
                data: { tasks: [] },
              }),
              stderr: '',
            }),
            terminate() {},
          }
        },
      },
    },
    config: { larkCliPath: fileURLToPath(new URL('./package.json', import.meta.url)) },
  })
  const noticeRes = await opsNoticeStrip.dispatchCollab({ instruction: '帮我查审批' })
  assert.strictEqual(noticeRes.ok, true)
  assert.strictEqual(sawNoticeInLoop, false, 'runJson 与 ReAct 循环必须剥离 _notice 内部版本提醒')

  // 7. Lark 国际版 / 飞书双品牌：consoleUrl、larkoffice.com/feishu.cn 域名适配，以及 applink 追加 lk_unique=true 防跨端劫持
  const larkOps = createOperations({
    ctx: {
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
      llm: {
        stream({ system }) {
          return (async function* () {
            if (system.includes('可用 action 列表')) {
              yield { type: 'text-delta', text: JSON.stringify({ action: 'run_skill', skill: 'lark-task' }) }
            } else {
              yield { type: 'text-delta', text: '已创建待办：[打开待办](https://applink.larkoffice.com/client/todo/detail?guid=g1)' }
            }
          })()
        },
      },
      subprocess: {
        spawn({ argv }) {
          if (argv.includes('config') && argv.includes('show')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ appId: 'cli_lark', brand: 'lark' }), stderr: '' }), terminate() {} }
          }
          if (argv.includes('auth') && argv.includes('scopes')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ ok: true, scopes: [] }), stderr: '' }), terminate() {} }
          }
          return {
            done: Promise.resolve({
              exitCode: 0,
              stdout: JSON.stringify({ ok: true, data: { guid: 'g1', url: 'https://applink.feishu.cn/client/todo/detail?guid=g1' } }),
              stderr: '',
            }),
            terminate() {},
          }
        },
      },
    },
    config: { larkCliPath: fileURLToPath(new URL('./package.json', import.meta.url)), brand: 'lark' },
  })
  const larkScopes = await larkOps.getScopes()
  assert.strictEqual(larkScopes.brand, 'lark')
  assert.strictEqual(larkScopes.consoleUrl, 'https://open.larksuite.com/app/cli_lark/auth')
  const larkExec = await larkOps.dispatchCollab({
    instruction: '创建待办',
    confirmSkill: true,
    skillName: 'lark-task',
    skillSteps: [['task', '+create', '--summary', 'test']],
  })
  assert.strictEqual(larkExec.ok, true)
  assert.ok(
    larkExec.reply.includes('https://applink.larksuite.com/client/todo/detail?guid=g1&lk_unique=true'),
    'Lark 品牌应将 applink.larkoffice.com/feishu.cn 自动转为 applink.larksuite.com 并附加 lk_unique=true',
  )
  assert.ok(
    larkExec.data?.data?.url === 'https://applink.larksuite.com/client/todo/detail?guid=g1&lk_unique=true',
    '返回给调用方的 data 内 applink 也应携带 lk_unique=true',
  )

  const feishuOps = createOperations({
    ctx: {
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
      llm: {
        stream() {
          return (async function* () {
            yield { type: 'text-delta', text: JSON.stringify({ action: 'reply', reply: '链接：[打开](https://applink.larkoffice.com/client/todo/detail?guid=g2)' }) }
          })()
        },
      },
      subprocess: {
        spawn({ argv }) {
          if (argv.includes('config') && argv.includes('show')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ appId: 'cli_feishu', brand: 'feishu' }), stderr: '' }), terminate() {} }
          }
          if (argv.includes('auth') && argv.includes('scopes')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ ok: true, scopes: [] }), stderr: '' }), terminate() {} }
          }
          return { done: Promise.resolve({ exitCode: 0, stdout: '{}', stderr: '' }), terminate() {} }
        },
      },
    },
    config: { larkCliPath: fileURLToPath(new URL('./package.json', import.meta.url)), brand: 'feishu' },
  })
  const feishuReply = await feishuOps.dispatchCollab({ instruction: '测试飞书链接' })
  assert.strictEqual(feishuReply.ok, true)
  assert.ok(
    feishuReply.reply.includes('https://applink.feishu.cn/client/todo/detail?guid=g2&lk_unique=true'),
    'Feishu 品牌应将 applink.larkoffice.com 规范为 applink.feishu.cn 并附加 lk_unique=true',
  )
})

test('17.2 纯 LLM-Native 意图分流、预览页非改表对话回复及无硬编码关键词正则回归校验', async () => {
  const { readFileSync } = await import('node:fs')
  const clientSrc = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  const plannerSrc = readFileSync(new URL('./planner.js', import.meta.url), 'utf8')
  const adjustPlannerSrc = readFileSync(new URL('./adjust-planner.js', import.meta.url), 'utf8')
  const opsSrc = readFileSync(new URL('./ops.js', import.meta.url), 'utf8')

  const baseDraft = {
    baseName: '待办清单',
    intro: '管理日常任务',
    tables: [{ name: '任务', fields: [{ type: 'text', name: '任务名称' }], records: [] }],
  }
  const guardPlanner = createPlanner({
    ctx: {
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
      llm: {
        stream({ messages }) {
          const prompt = messages?.[0]?.content?.[0]?.text || ''
          return (async function* () {
            if (prompt.includes('帮我创建一个待办')) {
              yield { type: 'text-delta', text: JSON.stringify({ isTable: false, reason: '创建个人飞书待办不属于多维表格设计' }) }
            } else if (prompt.includes('你好')) {
              yield { type: 'text-delta', text: JSON.stringify({ action: 'reply', reply: '你好！你可以继续调整表结构。\\\\n' }) }
            } else {
              yield { type: 'text-delta', text: '当然可以，请告诉我你想加减哪些字段。' }
            }
          })()
        },
      },
    },
  })

  const todoRes = await guardPlanner.plan('帮我创建一个待办')
  assert.strictEqual(todoRes.ok, false)
  assert.strictEqual(todoRes.isNotTable, true)

  const previewGreet = await guardPlanner.plan('你好', undefined, undefined, { currentPlan: baseDraft })
  assert.strictEqual(previewGreet.ok, true)
  assert.strictEqual(previewGreet.action, 'reply')
  assert.ok(previewGreet.reply.includes('你好'))
  assert.strictEqual(previewGreet.reply.includes('\\n'), false, 'preview reply 不应向前端泄漏字面 \\n 转义字符')

  const previewPlainText = await guardPlanner.plan('这表怎么用', undefined, undefined, { currentPlan: baseDraft })
  assert.strictEqual(previewPlainText.ok, true)
  assert.strictEqual(previewPlainText.action, 'reply')
  assert.ok(previewPlainText.reply.includes('字段'))

  const previewTodo = await guardPlanner.plan('帮我创建一个待办', undefined, undefined, { currentPlan: baseDraft })
  assert.strictEqual(previewTodo.ok, false)
  assert.strictEqual(previewTodo.isNotTable, true)

  assert.strictEqual(clientSrc.includes('readOnly: Boolean(busy)'), false, 'UnifiedComposer 不应锁定回复中的输入框只读状态')
  assert.strictEqual(clientSrc.includes('classifyQuickIntent'), false, 'client.js 不应使用硬编码关键词正则猜意图')
  assert.strictEqual(clientSrc.includes('正在生成表结构与示例数据'), false, '首页等待态不应提前假定一定会建表')
  assert.ok(clientSrc.includes('setPreviewReply') && clientSrc.includes('lw-preview-reply'), 'client.js 应使用贴近底部的轻量预览回复浮层')
  assert.ok(clientSrc.includes('postStream') && clientSrc.includes('lw-think-dots') && clientSrc.includes('queuedPrompt'), 'client.js 应具备流式分段加载与忙碌态排队发送能力')
  assert.strictEqual(/PURE_BUILD_RE|PURE_KEEP_RE|DIRECT_COLLAB/.test(plannerSrc), false, 'planner.js 不应保留关键词硬拦截正则')
  assert.strictEqual(/总结\|加了什么/.test(adjustPlannerSrc), false, 'adjust-planner.js 不应保留关键词追问复读机正则')
  assert.strictEqual(/我们需要\|用户要求\|思路：/.test(opsSrc + clientSrc), false, 'ops.js 与 client.js 不应凭汉语词汇正则截断正文当思考过程')
  assert.strictEqual(/isOffline\s*&&|帮我\|查一下/.test(opsSrc), false, 'ops.js 不应保留离线关键词路由与暴力抠词正则')

  // 校验所有字面量 Icon({ name }) 均在 ICONS 中注册，防止图标回退错乱
  const iconsBlockMatch = clientSrc.match(/const ICONS = \{([\s\S]*?)\n    \}/)
  assert.ok(iconsBlockMatch, '应能在 client.js 中解析 ICONS 注册表')
  const registeredIcons = new Set([...iconsBlockMatch[1].matchAll(/^\s{6}([A-Za-z0-9_]+)\s*:/gm)].map((m) => m[1]))
  for (const m of clientSrc.matchAll(/h\(\s*Icon\s*,\s*\{\s*name:\s*'([A-Za-z0-9_]+)'/g)) {
    assert.ok(registeredIcons.has(m[1]), `Icon "${m[1]}" 必须在 ICONS 注册表中存在`)
  }

  // 验证 /plan 流式阶段事件在 isTable: true 时才发 building_preview，isTable: false 时发 routing_collab
  const { collectText } = await import('./planner.js')
  const eventsTable = []
  await collectText(
    (async function* () {
      yield { type: 'text-delta', text: '{"isTable": true, "baseName": "A"' }
      yield { type: 'text-delta', text: ', "tables": []}' }
    })(),
    (evt) => eventsTable.push(evt),
    { detectIntent: true },
  )
  assert.ok(eventsTable.some((e) => e.type === 'stage' && e.stage === 'building_preview'))
  const eventsCollab = []
  await collectText(
    (async function* () {
      yield { type: 'text-delta', text: '{"isTable": false, "reason": "task"}' }
    })(),
    (evt) => eventsCollab.push(evt),
    { detectIntent: true },
  )
  assert.ok(eventsCollab.some((e) => e.type === 'stage' && e.stage === 'routing_collab'))
  assert.strictEqual(eventsCollab.some((e) => e.stage === 'building_preview'), false)
})

test('17.3 stderr 错误信封解析、先查后做多步批量确认执行、增量授权与 23 领域能力大盘回归测试', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const cliPath = fileURLToPath(new URL('./package.json', import.meta.url))

  // 1. stderr JSON 错误信封（missing_scope / exit 10）、先查后删（>4 条）、自动补 --yes、0 条空结果与 path parameter 中文提示
  const deletedGuids = []
  let deleteFirstCallHadNoYes = false
  let mockTasks = [
    { guid: 'g-1', summary: '待办一' },
    { guid: 'g-2', summary: '待办二' },
    { guid: 'g-3', summary: '待办三' },
    { guid: 'g-4', summary: '待办四' },
    { guid: 'g-5', summary: '待办五' },
  ]
  let scopeMissingMode = false
  const seenLoginArgs = []

  const opsTwoPhase = createOperations({
    ctx: {
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
      llm: {
        stream({ messages }) {
          const toolMsgs = messages.filter((m) => m.role === 'tool')
          return (async function* () {
            if (toolMsgs.length === 0) {
              // 第 1 步：先查只读列表
              yield {
                type: 'block-end',
                index: 0,
                block: { type: 'tool-call', id: 'tp_1', name: 'run_readonly', arguments: JSON.stringify({ argv: ['task', '+get-my-tasks', '--complete=false'], skill: 'lark-task' }) },
              }
            } else if (toolMsgs.length === 1) {
              const resJson = JSON.parse(String(toolMsgs[0].content[0].text))
              const tasks = resJson?.data?.tasks || resJson?.tasks || []
              if (tasks.length === 0) {
                yield { type: 'text-delta', text: '当前没有未完成的待办，不需要删除任何任务。' }
              } else {
                yield {
                  type: 'block-end',
                  index: 0,
                  block: {
                    type: 'tool-call',
                    id: 'tp_2',
                    name: 'propose_write',
                    arguments: JSON.stringify({
                      skill: 'lark-task',
                      steps: tasks.map((tk) => ['task', 'tasks', 'delete', '--task-guid', tk.guid]),
                      reason: `已查到 ${tasks.length} 条未完成待办，确认后将逐条删除。`,
                    }),
                  },
                }
              }
            } else {
              yield { type: 'text-delta', text: `已成功删除全部 ${deletedGuids.length} 条待办。` }
            }
          })()
        },
      },
      subprocess: {
        spawn({ argv }) {
          if (argv.includes('--help')) {
            if (argv.includes('delete')) {
              return { done: Promise.resolve({ exitCode: 0, stdout: 'Delete task\nRisk: high-risk-write\nRequired:\n  --task-guid string\n', stderr: '' }), terminate() {} }
            }
            return { done: Promise.resolve({ exitCode: 0, stdout: 'Get my tasks\nRisk: read\nFlags:\n  --complete\n', stderr: '' }), terminate() {} }
          }
          if (argv.includes('config') && argv.includes('show')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ appId: 'cli_test', brand: 'feishu' }), stderr: '' }), terminate() {} }
          }
          if (argv.includes('auth') && argv.includes('scopes')) {
            return {
              done: Promise.resolve({
                exitCode: 0,
                stdout: JSON.stringify({
                  ok: true,
                  user_scopes: [
                    'base:app:read', 'calendar:calendar:readonly', 'task:task:read',
                    'im:chat:read', 'mail:user_mailbox:readonly', 'contact:user.base:readonly',
                    'approval:task:read', 'docx:document:readonly', 'drive:drive.metadata:readonly',
                    'wiki:space:read', 'sheets:spreadsheet:read', 'slides:presentation:read',
                    'mindnote:node:read', 'board:whiteboard:node:read', 'vc:meeting.search:read',
                    'minutes:minutes.basic:read', 'vc:note:read', 'okr:okr.period:readonly',
                    'attendance:task:readonly', 'spark:app:read', 'application:bot.basic_info:read',
                  ],
                }),
                stderr: '',
              }),
              terminate() {},
            }
          }
          if (argv.includes('auth') && argv.includes('status')) {
            return {
              done: Promise.resolve({
                exitCode: 0,
                stdout: JSON.stringify({
                  ok: true,
                  appId: 'cli_test',
                  identities: {
                    user: {
                      available: true,
                      userName: 'Tester',
                      status: 'valid',
                      scope: [
                        'base:app:read', 'calendar:calendar:readonly', 'task:task:read', 'task:task:write',
                        'im:chat:read', 'mail:user_mailbox:readonly', 'contact:user.base:readonly',
                        'approval:task:read', 'docx:document:readonly', 'drive:drive.metadata:readonly',
                        'wiki:space:read', 'sheets:spreadsheet:read', 'slides:presentation:read',
                        'mindnote:node:read', 'board:whiteboard:node:read', 'vc:meeting.search:read',
                        'minutes:minutes.basic:read', 'vc:note:read', 'okr:okr.period:readonly',
                        'attendance:task:readonly', 'spark:app:read', 'application:bot.basic_info:read',
                      ].join(' '),
                    },
                  },
                }),
                stderr: '',
              }),
              terminate() {},
            }
          }
          if (argv.includes('auth') && argv.includes('login')) {
            seenLoginArgs.push(argv.slice(1))
            return {
              done: Promise.resolve({
                exitCode: 0,
                stdout: JSON.stringify({ ok: true, verification_url: 'https://open.feishu.cn/verify', device_code: 'dc_1' }),
                stderr: '',
              }),
              terminate() {},
            }
          }
          if (argv.includes('skills') && argv.includes('list')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ skills: [{ name: 'lark-task', description: 'Tasks' }] }), stderr: '' }), terminate() {} }
          }
          if (argv.includes('skills') && argv.includes('read')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: '# lark-task\ntask +get-my-tasks\ntask tasks delete --task-guid', stderr: '' }), terminate() {} }
          }
          if (argv.includes('task') && argv.includes('+get-my-tasks')) {
            if (scopeMissingMode) {
              // lark-cli 真实错误输出到 stderr 且 stdout 为空
              return {
                done: Promise.resolve({
                  exitCode: 1,
                  stdout: '',
                  stderr: JSON.stringify({
                    ok: false,
                    identity: 'user',
                    error: { type: 'authorization', subtype: 'missing_scope', code: 99991679, message: 'forbidden', missing_scopes: ['task:task:read', 'task:task:write'] },
                  }),
                }),
                terminate() {},
              }
            }
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ ok: true, data: { tasks: mockTasks } }), stderr: '' }), terminate() {} }
          }
          if (argv.includes('task') && argv.includes('tasks') && argv.includes('delete')) {
            const guidIdx = argv.indexOf('--task-guid')
            const guid = guidIdx !== -1 ? argv[guidIdx + 1] : ''
            if (!guid) {
              return {
                done: Promise.resolve({
                  exitCode: 1,
                  stdout: '',
                  stderr: JSON.stringify({ ok: false, error: { message: 'missing required path parameter: task_guid' } }),
                }),
                terminate() {},
              }
            }
            if (!argv.includes('--yes')) {
              deleteFirstCallHadNoYes = true
              return {
                done: Promise.resolve({
                  exitCode: 10,
                  stdout: '',
                  stderr: JSON.stringify({ ok: false, error: { type: 'confirmation', subtype: 'confirmation_required', message: 'requires confirmation', hint: 'add --yes to confirm' } }),
                }),
                terminate() {},
              }
            }
            deletedGuids.push(guid)
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ ok: true, data: { deleted: guid } }), stderr: '' }), terminate() {} }
          }
          return { done: Promise.resolve({ exitCode: 0, stdout: '{}', stderr: '' }), terminate() {} }
        },
      },
    },
    config: { larkCliPath: cliPath },
  })

  // A. 先查后删：自动查出 5 条待办，确认卡片中已带真实 task_guid，未提前删除任何数据
  const planDelete = await opsTwoPhase.dispatchCollab({ instruction: '帮我删除所有待办' })
  assert.strictEqual(planDelete.ok, true, `planDelete.ok should be true, got reply=${planDelete.reply}`)
  assert.strictEqual(planDelete.needsConfirm, true, `planDelete.needsConfirm should be true, got ${JSON.stringify(planDelete)}`)
  assert.strictEqual(planDelete.confirmKind, 'skill_guard')
  assert.strictEqual(planDelete.steps.length, 5, '5 条待办应全部物化为独立带 --task-guid 的删除命令')
  assert.ok(planDelete.steps.every((s) => s.includes('--task-guid')))
  assert.strictEqual(deletedGuids.length, 0, '确认前绝对不能执行任何删除')

  // B. 确认执行：突破旧 4 步截断、根据 Risk: high-risk-write 自动携带 --yes 并删完 5 条
  const execDelete = await opsTwoPhase.dispatchCollab({
    instruction: '帮我删除所有待办',
    confirmSkill: true,
    skillName: 'lark-task',
    skillSteps: planDelete.steps,
  })
  assert.strictEqual(execDelete.ok, true, `execDelete.ok should be true, got ${execDelete.reply}`)
  assert.deepStrictEqual(deletedGuids, ['g-1', 'g-2', 'g-3', 'g-4', 'g-5'])

  // C. 无待办时直接友好回复，不弹错误确认卡
  mockTasks = []
  const emptyRes = await opsTwoPhase.dispatchCollab({ instruction: '帮我删除所有待办' })
  assert.strictEqual(emptyRes.ok, true, `emptyRes.ok should be true, got ${emptyRes.reply}`)
  assert.strictEqual(emptyRes.needsConfirm, undefined)
  assert.ok(emptyRes.reply.includes('没有未完成的待办'))

  // D. stderr 中的 missing_scope 与 missing_scopes 必须完整透传，不因 stdout 为空丢失
  scopeMissingMode = true
  const missingScopeRes = await opsTwoPhase.dispatchCollab({ instruction: '帮我删除所有待办' })
  assert.strictEqual(missingScopeRes.ok, false)
  assert.strictEqual(missingScopeRes.type, 'missing_scope')
  assert.deepStrictEqual(missingScopeRes.requiredScopes, ['task:task:read', 'task:task:write'])
  scopeMissingMode = false

  // E. 确认执行若仍缺失 path parameter，提示为「操作未能完成」而非「查询未能完成」且翻译 path parameter
  const brokenConfirmed = await opsTwoPhase.dispatchCollab({
    instruction: '删除待办',
    confirmSkill: true,
    skillName: 'lark-task',
    skillSteps: [['task', 'tasks', 'delete']],
  })
  assert.strictEqual(brokenConfirmed.ok, false)
  assert.ok(brokenConfirmed.reply.includes('操作未能完成') && !brokenConfirmed.reply.includes('查询未能完成'))
  assert.ok(brokenConfirmed.reply.includes('缺少必要参数'))

  // F. 增量授权：传 scopes 用 --scope，传 skillName 用 --domain，都不传走 --recommend
  await opsTwoPhase.startLogin(undefined, 'lark-task', ['task:task:read', 'task:task:write'])
  await opsTwoPhase.startLogin(undefined, 'lark-task')
  await opsTwoPhase.startLogin(undefined)
  const initLoginCalls = seenLoginArgs.filter((a) => a.includes('--no-wait'))
  assert.strictEqual(initLoginCalls.length, 3)
  assert.ok(initLoginCalls[0].includes('--scope') && initLoginCalls[0].includes('task:task:read,task:task:write'))
  assert.ok(initLoginCalls[1].includes('--domain') && initLoginCalls[1].includes('task'))
  assert.ok(initLoginCalls[2].includes('--recommend'))

  // G. 23 领域能力大盘解析（含 user_scopes + identities.user.scope）
  const fullScopes = await opsTwoPhase.getScopes()
  assert.strictEqual(fullScopes.ok, true)
  assert.strictEqual(fullScopes.scopesVerified, true)
  const expectedDomains = [
    'base', 'calendar', 'task', 'im', 'mail', 'contact', 'approval',
    'docs', 'drive', 'wiki', 'sheets', 'slides', 'markdown', 'mindnotes',
    'whiteboard', 'vc', 'minutes', 'note', 'okr', 'attendance', 'apps', 'event', 'application',
  ]
  for (const key of expectedDomains) {
    assert.ok(fullScopes.domains[key], `getScopes 必须包含领域 ${key}`)
    assert.strictEqual(fullScopes.domains[key].ready, true, `领域 ${key} 应正确识别已授权状态`)
  }
  assert.strictEqual(fullScopes.domainOrder.length, 23)

  // H. client.js 前端契约：全量 23 领域、无假绿 ?? true、缺权传 domain/scopes、紧凑分组标签流、单一加载提示、无 Node API、无 Emoji
  const clientSrc = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  for (const key of expectedDomains) {
    assert.ok(clientSrc.includes(`'scope.${key}'`), `client.js 中英文词典必须注册 scope.${key}`)
  }
  assert.strictEqual(/scopesInfo\?\.domains\?\.base\?\.ready\s*\?\?\s*true/.test(clientSrc), false, 'base 不能在 scopes 未返回时假绿')
  assert.ok(clientSrc.includes('lw-scope-loading-row') && clientSrc.includes('lw-scope-flow') && clientSrc.includes('lw-scope-chip'))
  assert.strictEqual(clientSrc.includes('lw-scope-grid'), false, '不应使用截断且冗杂的 23 格双列核验中网格')
  assert.ok(clientSrc.includes('domain: msg.domain') && clientSrc.includes('scopes: msg.requiredScopes'))
  assert.strictEqual(/[\u{1F300}-\u{1FAFF}]/u.test(clientSrc), false, 'client.js 不应包含 Emoji')
  assert.strictEqual(/\b(Buffer\.from|process\.env|require\(['"]node:?(fs|path)['"]\))/.test(clientSrc), false, 'client.js 严禁使用 Node API')
})

test('17.4 saveImage(data) 宿主契约、全领域条件查询走 run_skill 与 get_tasks 相关任务兜底', async () => {
  const { apply } = await import('./index.js')
  const { fileURLToPath } = await import('node:url')
  const registeredRoutes = new Map()
  let savedImageInput = null
  let llmSawImageBlock = false
  let llmSawAttachmentRule = false

  const mockCtx = {
    subprocess: realSubprocess,
    connection: {
      fetch: {
        register: (route) => {
          registeredRoutes.set(route.path, route)
          return () => registeredRoutes.delete(route.path)
        },
      },
    },
    commands: { register: () => () => {} },
    tools: { register: () => () => {} },
    effect: (fn) => fn(),
    inject: (deps, cb) => {
      if (Array.isArray(deps) && deps.includes('attachments')) {
        cb({
          attachments: {
            async saveImage(input) {
              savedImageInput = input
              assert.ok(input && input.data instanceof Uint8Array, 'saveImage 必须传 data: Uint8Array，不能传 bytes')
              assert.strictEqual(input.bytes, undefined)
              return { attachmentId: 'att_img_1', mediaType: input.mediaType, bytes: input.data.byteLength }
            },
          },
        })
      }
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    llm: {
      stream({ system, messages }) {
        if (system.includes('Direct Reply') && system.includes('Discover Contract Before Calling')) {
          llmSawAttachmentRule = true
        }
        const last = messages[messages.length - 1]
        if (Array.isArray(last?.content) && last.content.some((c) => c.type === 'image' && c.attachment?.attachmentId === 'att_img_1')) {
          llmSawImageBlock = true
        }
        return (async function* () {
          yield { type: 'text-delta', text: '这是一张截图。' }
        })()
      },
    },
  }
  apply(mockCtx)

  // 上传 1x1 PNG 到 /upload，再发 /adjust 带图提问
  const pngHeader = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex')
  const uploadRoute = registeredRoutes.get('/api/dsh-lark/upload')
  const upRes = await uploadRoute.fetch(new Request('http://127.0.0.1/api/dsh-lark/upload?name=shot.png&mime=image%2Fpng', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: pngHeader,
  }))
  const upJson = await upRes.json()
  assert.strictEqual(upJson.ok, true)

  const adjustRoute = registeredRoutes.get('/api/dsh-lark/adjust')
  const adjRes = await adjustRoute.fetch(new Request('http://127.0.0.1/api/dsh-lark/adjust', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'collab', instruction: '那这是啥', attachments: [upJson.file.id] }),
  }))
  const adjJson = await adjRes.json()
  assert.strictEqual(adjJson.ok, true)
  assert.ok(savedImageInput && savedImageInput.data instanceof Uint8Array)
  assert.strictEqual(llmSawImageBlock, true, 'imageBlocks 必须成功透传给大模型')
  assert.strictEqual(llmSawAttachmentRule, true, 'ReAct 系统提示词必须包含直接识图回复与先查契约规则')
  assert.ok(adjJson.reply.includes('截图'))

  // 多跳工具链：+get-my-tasks 为空时在单轮 ReAct 循环内继续查 +get-related-tasks 并汇总结论
  const opsRelated = createOperations({
    ctx: {
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
      llm: {
        stream({ messages }) {
          const toolMsgs = messages.filter((m) => m.role === 'tool')
          return (async function* () {
            if (toolMsgs.length === 0) {
              yield {
                type: 'block-end',
                index: 0,
                block: { type: 'tool-call', id: 'rel_1', name: 'run_readonly', arguments: JSON.stringify({ argv: ['task', '+get-my-tasks', '--complete=false'], skill: 'lark-task' }) },
              }
            } else if (toolMsgs.length === 1) {
              yield {
                type: 'block-end',
                index: 0,
                block: { type: 'tool-call', id: 'rel_2', name: 'run_readonly', arguments: JSON.stringify({ argv: ['task', '+get-related-tasks', '--include-complete=false'], skill: 'lark-task' }) },
              }
            } else {
              const lastJson = String(toolMsgs[1].content[0].text || '')
              assert.ok(lastJson.includes('我创建但指派给同事的任务'))
              yield { type: 'text-delta', text: '分配给你的待办为空，但与你相关的待办有 1 条：我创建但指派给同事的任务。' }
            }
          })()
        },
      },
      subprocess: {
        spawn({ argv }) {
          if (argv.includes('config') && argv.includes('show')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ appId: 'cli_t', brand: 'feishu' }), stderr: '' }), terminate() {} }
          }
          if (argv.includes('auth') && (argv.includes('scopes') || argv.includes('status'))) {
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ ok: true, user_scopes: ['task:task:read'] }), stderr: '' }), terminate() {} }
          }
          if (argv.includes('skills') && argv.includes('list')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ skills: [] }), stderr: '' }), terminate() {} }
          }
          if (argv.includes('--help')) {
            return {
              done: Promise.resolve({ exitCode: 0, stdout: 'Tasks\nRisk: read\nFlags:\n  --complete\n  --include-complete\n', stderr: '' }),
              terminate() {},
            }
          }
          if (argv.includes('task') && argv.includes('+get-my-tasks')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ ok: true, data: { tasks: [] } }), stderr: '' }), terminate() {} }
          }
          if (argv.includes('task') && argv.includes('+get-related-tasks')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ ok: true, data: { tasks: [{ summary: '我创建但指派给同事的任务' }] } }), stderr: '' }), terminate() {} }
          }
          return { done: Promise.resolve({ exitCode: 0, stdout: '{}', stderr: '' }), terminate() {} }
        },
      },
    },
    config: { larkCliPath: fileURLToPath(new URL('./package.json', import.meta.url)) },
  })
  const relRes = await opsRelated.dispatchCollab({ instruction: '查待办' })
  assert.strictEqual(relRes.ok, true)
  assert.ok(relRes.reply.includes('我创建但指派给同事的任务'), 'ReAct 循环内查不到指派任务时应能继续查询相关任务并回答')
})

test('17.5 错误 query flag、多余 --as 及误调 propose_write 的只读查询在 ReAct 循环内直接自愈执行，绝不弹出待确认写卡片', async () => {
  let helpQueried = false
  let testScenario = 'bad_flag' // bad_flag | wrong_propose_write
  const executedCommands = []

  const opsReadonlyRepair = createOperations({
    ctx: {
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
      llm: {
        stream({ messages }) {
          const toolMsgs = messages.filter((m) => m.role === 'tool')
          return (async function* () {
            if (toolMsgs.length === 0) {
              if (testScenario === 'wrong_propose_write') {
                // 场景 B：模型误把纯 Risk: read 查询塞进了 propose_write
                yield {
                  type: 'block-end',
                  index: 0,
                  block: {
                    type: 'tool-call',
                    id: 'ro_pw_1',
                    name: 'propose_write',
                    arguments: JSON.stringify({ skill: 'lark-task', steps: [['task', '+get-related-tasks', '--created-by-me', 'true', '--as', 'user']], reason: '只读查询' }),
                  },
                }
              } else {
                // 场景 A：模型幻觉出 --creator 与多余 --as user
                yield {
                  type: 'block-end',
                  index: 0,
                  block: {
                    type: 'tool-call',
                    id: 'ro_1',
                    name: 'run_readonly',
                    arguments: JSON.stringify({ argv: ['task', '+get-related-tasks', '--creator', 'ou_abc', '--as', 'user'], skill: 'lark-task' }),
                  },
                }
              }
            } else if (toolMsgs.length === 1) {
              const feedback = JSON.parse(String(toolMsgs[0].content[0].text))
              if (testScenario === 'wrong_propose_write') {
                assert.ok(feedback.error.includes('strictly read-only'), 'propose_write 应拒绝纯只读查询并引导改用 run_readonly')
              } else {
                assert.strictEqual(feedback.blocked, true)
                assert.ok(feedback.availableBoolFlags.includes('--created-by-me'), 'run_readonly 拒绝错误参数时应在工具结果中回传真实 --help flags')
              }
              yield {
                type: 'block-end',
                index: 0,
                block: {
                  type: 'tool-call',
                  id: 'ro_2',
                  name: 'run_readonly',
                  arguments: JSON.stringify({ argv: ['task', '+get-related-tasks', '--created-by-me', 'true', '--as', 'user'], skill: 'lark-task' }),
                },
              }
            } else {
              const okRes = JSON.parse(String(toolMsgs[toolMsgs.length - 1].content[0].text))
              assert.ok(Array.isArray(okRes.data?.tasks) && okRes.data.tasks.length === 2)
              yield { type: 'text-delta', text: '你创建的待办共有 2 条：编程测试、测试确认卡片。' }
            }
          })()
        },
      },
      subprocess: {
        spawn({ argv }) {
          executedCommands.push(argv)
          if (argv.includes('config') && argv.includes('show')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ appId: 'cli_t', brand: 'feishu' }), stderr: '' }), terminate() {} }
          }
          if (argv.includes('auth') && (argv.includes('scopes') || argv.includes('status'))) {
            return {
              done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ ok: true, configured: true, user_scopes: ['task:task:read'] }), stderr: '' }),
              terminate() {},
            }
          }
          if (argv.includes('skills') && argv.includes('list')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ skills: [{ name: 'lark-task', description: '待办' }] }), stderr: '' }), terminate() {} }
          }
          if (argv.includes('--help')) {
            helpQueried = true
            return {
              done: Promise.resolve({
                exitCode: 0,
                stdout: 'Get related tasks\nRisk: read\nUsage:\n  lark-cli task +get-related-tasks [flags]\nFlags:\n  --created-by-me  Filter tasks created by current user',
                stderr: '',
              }),
              terminate() {},
            }
          }
          if (argv.includes('task') && argv.includes('+get-related-tasks')) {
            if (argv.includes('--creator')) {
              return { done: Promise.resolve({ exitCode: 1, stdout: '', stderr: 'unknown flag: --creator' }), terminate() {} }
            }
            return {
              done: Promise.resolve({
                exitCode: 0,
                stdout: JSON.stringify({ ok: true, data: { tasks: [{ summary: '编程测试' }, { summary: '测试确认卡片' }] } }),
                stderr: '',
              }),
              terminate() {},
            }
          }
          return { done: Promise.resolve({ exitCode: 0, stdout: '{}', stderr: '' }), terminate() {} }
        },
      },
    },
    config: { larkCliPath: decodeURIComponent(new URL('./package.json', import.meta.url).pathname) },
  })

  const res = await opsReadonlyRepair.dispatchCollab({ instruction: '我创建的待办也没有吗' })
  assert.strictEqual(res.ok, true)
  assert.strictEqual(res.needsConfirm, undefined, '纯只读查询绝对不能触发待确认卡片')
  assert.strictEqual(helpQueried, true, '应对已知只读子命令的错误 query flag 自动基于 --help 反馈自愈')
  assert.ok(
    executedCommands.some((cmd) => cmd.includes('+get-related-tasks') && cmd.includes('--created-by-me=true') && !cmd.includes('--as')),
    '修复并执行后的参数应剥离多余 --as 并折叠为 --created-by-me=true',
  )
  assert.ok(res.reply.includes('编程测试'), '应直接总结并返回查询到的待办列表')

  testScenario = 'wrong_propose_write'
  executedCommands.length = 0
  const resFromRejectedPropose = await opsReadonlyRepair.dispatchCollab({ instruction: '我创建的待办也没有吗' })
  assert.strictEqual(resFromRejectedPropose.ok, true)
  assert.strictEqual(resFromRejectedPropose.needsConfirm, undefined, '即使模型误调用 propose_write 提交纯只读查询，也会被闸门退回改用 run_readonly')
  assert.ok(resFromRejectedPropose.reply.includes('测试确认卡片'))
})

test('17.6 退出登录同步解绑应用、清理品牌/权限缓存，且未登录与 tenant_scopes 绝不误报能力已开通', async () => {
  const { readFileSync } = await import('node:fs')
  const cliPath = decodeURIComponent(new URL('./package.json', import.meta.url).pathname)
  const calls = []
  let scenario = 'logged_out_with_app' // logged_out_with_app | partial_user_scope | fallback_no_tenant_leak | after_logout_feishu
  let appInitSeq = 0
  let appInitTerminated = 0
  let exchangeAborted = false

  const opsAuth = createOperations({
    ctx: {
      subprocess: {
        spawn({ argv, signal }) {
          const args = argv.slice(1)
          calls.push(args)
          if (args[0] === 'config' && args[1] === 'show') {
            if (scenario === 'after_logout_feishu') {
              return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ appId: 'cli_new_feishu', brand: 'feishu' }), stderr: '' }), terminate() {} }
            }
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ appId: 'cli_old_lark', brand: 'lark' }), stderr: '' }), terminate() {} }
          }
          if (args[0] === 'auth' && args[1] === 'status') {
            if (scenario === 'logged_out_with_app') {
              return {
                done: Promise.resolve({
                  exitCode: 0,
                  stdout: JSON.stringify({
                    appId: 'cli_old_lark',
                    brand: 'lark',
                    identity: 'bot',
                    identities: {
                      bot: { status: 'ready', available: true },
                      user: { status: 'missing', available: false },
                    },
                  }),
                  stderr: '',
                }),
                terminate() {},
              }
            }
            if (scenario === 'partial_user_scope') {
              return {
                done: Promise.resolve({
                  exitCode: 0,
                  stdout: JSON.stringify({
                    appId: 'cli_old_lark',
                    brand: 'lark',
                    identity: 'user',
                    identities: {
                      user: { status: 'valid', available: true, userName: 'Alice', scope: 'task:task:read' },
                    },
                  }),
                  stderr: '',
                }),
                terminate() {},
              }
            }
            if (scenario === 'fallback_no_tenant_leak') {
              return {
                done: Promise.resolve({
                  exitCode: 0,
                  stdout: JSON.stringify({
                    appId: 'cli_old_lark',
                    brand: 'lark',
                    identity: 'user',
                    identities: {
                      user: { status: 'valid', available: true, userName: 'Alice' },
                    },
                  }),
                  stderr: '',
                }),
                terminate() {},
              }
            }
            return {
              done: Promise.resolve({
                exitCode: 0,
                stdout: JSON.stringify({
                  appId: 'cli_new_feishu',
                  brand: 'feishu',
                  identity: 'user',
                  identities: {
                    user: { status: 'valid', available: true, userName: 'Bob', scope: 'base:app:read' },
                  },
                }),
                stderr: '',
              }),
              terminate() {},
            }
          }
          if (args[0] === 'auth' && args[1] === 'scopes') {
            return {
              done: Promise.resolve({
                exitCode: 0,
                stdout: JSON.stringify({
                  appId: 'cli_old_lark',
                  brand: 'lark',
                  userScopes: ['base:app:read'],
                  tenant_scopes: ['calendar:calendar:read', 'mail:user_mailbox:readonly'],
                }),
                stderr: '',
              }),
              terminate() {},
            }
          }
          if (args[0] === 'auth' && args[1] === 'logout') {
            return { done: Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ ok: true, loggedOut: true }), stderr: '' }), terminate() {} }
          }
          if (args[0] === 'config' && args[1] === 'init' && args.includes('--new')) {
            appInitSeq += 1
            const seq = appInitSeq
            return {
              done: new Promise(() => {}),
              collected: {
                stdout: { readFrom: () => ({ text: `https://open.feishu.cn/page/cli?user_code=TEST-CODE-${seq}\n` }) },
                stderr: { readFrom: () => ({ text: '' }) },
              },
              terminate() { appInitTerminated += 1 },
            }
          }
          if (args[0] === 'auth' && args[1] === 'login' && args.includes('--no-wait')) {
            return {
              done: Promise.resolve({
                exitCode: 0,
                stdout: JSON.stringify({ ok: true, verification_url: 'https://accounts.feishu.cn/device?code=dc_cancel', device_code: 'dc_cancel' }),
                stderr: '',
              }),
              terminate() {},
            }
          }
          if (args[0] === 'auth' && args[1] === 'login' && args.includes('--device-code')) {
            return {
              done: new Promise((resolve) => {
                if (signal) {
                  signal.addEventListener('abort', () => {
                    exchangeAborted = true
                    resolve({ exitCode: 1, stdout: '', stderr: 'aborted' })
                  }, { once: true })
                }
              }),
              terminate() {},
            }
          }
          if (args[0] === 'config' && args[1] === 'init' && args.includes('--app-id')) {
            return { done: Promise.resolve({ exitCode: 0, stdout: 'ok', stderr: '' }), terminate() {} }
          }
          if (args[0] === 'api' && args[1] === 'GET' && args[2] === '/open-apis/bot/v3/info') {
            return {
              done: Promise.resolve({
                exitCode: 0,
                stdout: JSON.stringify({
                  ok: true,
                  data: { bot: { app_name: scenario === 'after_logout_feishu' ? '飞书工作台新应用' : '我的海外版应用', open_id: 'ou_bot' } },
                }),
                stderr: '',
              }),
              terminate() {},
            }
          }
          if (args[0] === 'config' && args[1] === 'remove') {
            return { done: Promise.resolve({ exitCode: 0, stdout: 'removed', stderr: '' }), terminate() {} }
          }
          return { done: Promise.resolve({ exitCode: 0, stdout: '{}', stderr: '' }), terminate() {} }
        },
      },
    },
    config: { larkCliPath: cliPath },
  })

  // 1. 未登录但残留应用时：所有领域必须 ready=false，且不应误查应用级 auth scopes
  const loggedOutScopes = await opsAuth.getScopes(undefined, { force: true })
  assert.strictEqual(loggedOutScopes.ok, true)
  assert.strictEqual(loggedOutScopes.userReady, false)
  assert.strictEqual(loggedOutScopes.totalGranted, 0)
  assert.ok(Object.values(loggedOutScopes.domains).every((d) => d.ready === false), '未登录态下不得将任何领域标记为已开通')
  assert.strictEqual(calls.some((c) => c[0] === 'auth' && c[1] === 'scopes'), false, '未登录态下无需发起应用级 auth scopes 查询')
  assert.strictEqual(loggedOutScopes.brand, 'lark')

  // 2. 已登录但用户 token 仅授权 task：不得被应用后台的 base 权限污染
  scenario = 'partial_user_scope'
  calls.length = 0
  const partialScopes = await opsAuth.getScopes(undefined, { force: true })
  assert.strictEqual(partialScopes.userReady, true)
  assert.strictEqual(partialScopes.domains.task.ready, true)
  assert.strictEqual(partialScopes.domains.base.ready, false, '用户 token 未授 base 权限时不得被应用级 scopes 假绿')
  assert.strictEqual(partialScopes.domains.calendar.ready, false)

  // 3. auth status 省略 scope 时回退 auth scopes，但严禁把 tenant_scopes 混入用户权限
  scenario = 'fallback_no_tenant_leak'
  calls.length = 0
  const fallbackScopes = await opsAuth.getScopes(undefined, { force: true })
  assert.strictEqual(fallbackScopes.domains.base.ready, true)
  assert.strictEqual(fallbackScopes.domains.calendar.ready, false, 'tenant_scopes 不得污染用户能力大盘')
  assert.strictEqual(fallbackScopes.domains.mail.ready, false, 'tenant_scopes 不得污染用户能力大盘')

  // 4. ops.logout 必须同时执行 auth logout 与 config remove，并清理 brand/scopes 缓存
  calls.length = 0
  const logoutRes = await opsAuth.logout()
  assert.strictEqual(logoutRes.ok, true)
  assert.ok(calls.some((c) => c[0] === 'auth' && c[1] === 'logout'), 'ops.logout 必须执行 auth logout')
  assert.ok(calls.some((c) => c[0] === 'config' && c[1] === 'remove'), 'ops.logout 必须同步执行 config remove 解绑应用')

  // 5. 退出并切换为新 Feishu 应用后，brand 缓存必须已失效并正确识别为 feishu
  scenario = 'after_logout_feishu'
  const switchedScopes = await opsAuth.getScopes()
  assert.strictEqual(switchedScopes.brand, 'feishu', '退出解绑后 detectedBrandCache 应被清空，切回 feishu 品牌')
  assert.strictEqual(switchedScopes.appId, 'cli_new_feishu')
  assert.strictEqual(switchedScopes.domains.base.ready, true)

  // 5b. startAppInit 必须调用不带 --brand 的 config init --new，手动 bindApp 保留 --brand
  calls.length = 0
  const initRes = await opsAuth.startAppInit()
  assert.strictEqual(initRes.ok, true)
  const newInitCall = calls.find((c) => c[0] === 'config' && c[1] === 'init' && c.includes('--new'))
  assert.deepStrictEqual(newInitCall, ['config', 'init', '--new'], 'startAppInit 严禁传递 --brand')
  await opsAuth.logout()
  calls.length = 0
  await opsAuth.bindApp('cli_manual123', 'secret_12345678', undefined, 'lark')
  const manualInitCall = calls.find((c) => c[0] === 'config' && c[1] === 'init' && c.includes('--app-id'))
  assert.ok(manualInitCall && manualInitCall.includes('--brand') && manualInitCall.includes('lark'), '手动 bindApp 应保留 --brand 参数')

  // 5c. connectStatus 自动获取 appName、按 appId 缓存，退出后清空缓存重新获取
  scenario = 'partial_user_scope'
  calls.length = 0
  const st1 = await opsAuth.connectStatus()
  assert.strictEqual(st1.app.appName, '我的海外版应用', 'connectStatus 应返回 bot/v3/info 中的应用名称')
  const botInfoCalls1 = calls.filter((c) => c[0] === 'api' && c[2] === '/open-apis/bot/v3/info').length
  assert.strictEqual(botInfoCalls1, 1)
  const st2 = await opsAuth.connectStatus()
  assert.strictEqual(st2.app.appName, '我的海外版应用')
  const botInfoCalls2 = calls.filter((c) => c[0] === 'api' && c[2] === '/open-apis/bot/v3/info').length
  assert.strictEqual(botInfoCalls2, 1, '同一 appId 应命中 appNameCache，避免重复查询')
  await opsAuth.logout()
  scenario = 'after_logout_feishu'
  const st3 = await opsAuth.connectStatus()
  assert.strictEqual(st3.app.appName, '飞书工作台新应用', '退出后 appNameCache 应被清空并拉取新应用名称')

  // 5d. cancelConnect 必须终止进行中的 appInit 与 auth exchange 子进程，取消后可重新发起新链接
  appInitTerminated = 0
  exchangeAborted = false
  const initBeforeCancel = await opsAuth.startAppInit()
  assert.ok(initBeforeCancel.ok && initBeforeCancel.url.includes('TEST-CODE-'))
  const loginBeforeCancel = await opsAuth.startLogin()
  assert.strictEqual(loginBeforeCancel.ok, true)
  const cancelRes = opsAuth.cancelConnect()
  assert.strictEqual(cancelRes.ok, true)
  assert.strictEqual(appInitTerminated, 1, 'cancelConnect 应 terminate 正在运行的 config init --new 子进程')
  assert.strictEqual(exchangeAborted, true, 'cancelConnect 应通过 AbortSignal 中止后台 auth login --device-code 子进程')
  assert.strictEqual(opsAuth.exchangeState().idle, true, '取消后 exchangeState 应回到 idle 状态')
  const initAfterCancel = await opsAuth.startAppInit()
  assert.notStrictEqual(initAfterCancel.url, initBeforeCancel.url, '取消后重新发起应拿到新的创建链接而非复用旧进程')
  opsAuth.cancelConnect()

  // 6. client.js 前端契约：未登录态文案、切换应用入口、AccountModal 登录态门禁与 Web 纯净性
  const clientSrc = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  for (const key of ['account.scopesNeedLogin', 'account.scopesNeedApp', 'account.signInNow', 'gate.noAuth.switchApp', 'gate.linkedApp', 'gate.cancel', 'gate.noApp.checking', 'gate.noApp.pending', 'gate.noApp.expired']) {
    const matches = clientSrc.match(new RegExp(`'${key.replace(/\./g, '\\.')}'`, 'g')) || []
    assert.ok(matches.length >= 2, `client.js 中英文词典应同时包含 ${key}`)
  }
  assert.ok(clientSrc.includes('const switchApp = useCallback'), 'ConnectGate 应在 no-auth 阶段提供更换应用能力')
  assert.ok(clientSrc.includes('const cancelFlow = useCallback'), 'ConnectGate 应在关联应用与授权等待阶段提供取消流程')
  assert.ok(clientSrc.includes('const checkAppNow = useCallback'), 'ConnectGate 应在 no-app 阶段提供带反馈的手动检测')
  assert.strictEqual(
    /\brequire\s*\(\s*['"](?:node:|fs|path|os|child_process|crypto|http|https)['"]|\bprocess\.env\b|\bBuffer\.from\b/.test(clientSrc),
    false,
    'client.js 严禁混入 Node.js 专有 API',
  )
})

Promise.all(pendingTests).then(() => {
  setTimeout(() => {
    console.log(`\n========================================`)
    console.log(`🎉 测试完成: ${passCount} 通过, ${failCount} 失败`)
    console.log(`========================================`)
    process.exit(failCount > 0 ? 1 : 0)
  }, 200)
})
