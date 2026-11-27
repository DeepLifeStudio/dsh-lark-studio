/**
 * Introspection-First ReAct Tool Loop for Feishu Workbench.
 *
 * Replaces static multi-stage JSON pipelines (`skillPlan -> lookupPlan -> materialize -> repair`)
 * and hardcoded 1-7 shortcut branches with one bounded, tool-driven agent loop backed by live
 * CLI introspection (`--help` Risk/flags, `schema`, `skills read` including `references/*.md`).
 *
 * Architectural invariants:
 * - Zero guessed parameters: unfamiliar flags/payloads are verified via `read_skill` / `inspect_cli`.
 * - Read safety fails closed: `run_readonly` executes ONLY commands verified as `Risk: read` by `--help`
 *   with zero disallowed export/bypass flags (`--output`, `--params`, `--page-all`, `--include-values`, `@file`).
 * - Single write barrier: mutations/exports/high-risk actions converge strictly through `propose_write`,
 *   which verifies placeholders & required flags BEFORE popping `skill_guard` confirmation cards.
 */

import { hasDisallowedExportOrBypassFlag } from './cli-introspect.js'

const MAX_LOOP_STEPS = 8

export const COLLAB_TOOL_SCHEMAS = [
  {
    name: 'read_skill',
    description:
      'Read an official Feishu lark-cli skill guide or a referenced sub-document (e.g. references/lark-task-get-related-tasks.md). Always load referenced guides when exact workflow rules or flags are not shown in the main table.',
    parameters: {
      type: 'object',
      properties: {
        skill: {
          type: 'string',
          description: 'Official skill name, e.g. "lark-task", "lark-calendar", "lark-im", "lark-approval", "lark-contact", "lark-doc".',
        },
        path: {
          type: 'string',
          description: 'Optional relative path inside the skill, e.g. "references/lark-task-get-related-tasks.md". Omit to read the main SKILL.md.',
        },
      },
      required: ['skill'],
    },
  },
  {
    name: 'inspect_cli',
    description:
      'Zero-side-effect inspection of live lark-cli metadata. Use mode="help" for exact command Risk (read/write/high-risk-write) and CLI flags; use mode="schema" for OpenAPI JSON Schema, required fields, and required scopes.',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['help', 'schema'],
          description: '"help" runs `lark-cli <cmd> --help`; "schema" runs `lark-cli schema <service.resource.method>`.',
        },
        target: {
          type: 'string',
          description: 'For mode="help": space-separated subcommand tokens (e.g. "task +get-related-tasks" or "approval tasks query"). For mode="schema": dotpath (e.g. "task.tasks.delete").',
        },
      },
      required: ['mode', 'target'],
    },
  },
  {
    name: 'run_readonly',
    description:
      'Execute a verified read-only lark-cli query (`Risk: read` per live --help, without --output/--params/--page-all/@file/--as). Returns real JSON output or real CLI error/help hints so you can chain multi-step queries (e.g. contact open_id -> tasks/calendar) or self-correct.',
    parameters: {
      type: 'object',
      properties: {
        argv: {
          type: 'array',
          items: { type: 'string' },
          description: 'Command tokens without leading "lark-cli" or "--as", e.g. ["task", "+get-my-tasks", "--complete=false"].',
        },
        dryRun: {
          type: 'boolean',
          description: 'Pass true to validate arguments via `--dry-run` without executing.',
        },
        skill: {
          type: 'string',
          description: 'Associated official skill name (e.g. "lark-task") for domain normalization and scope prompts.',
        },
      },
      required: ['argv'],
    },
  },
  {
    name: 'propose_write',
    description:
      'Submit finalized, non-read-only commands (create, update, delete, send, reply, approve, cancel, upload, download/export) for user confirmation. Must NOT contain placeholders or missing required flags — resolve target IDs/GUIDs via run_readonly and inspect_cli first. Never call this for pure read-only queries.',
    parameters: {
      type: 'object',
      properties: {
        skill: {
          type: 'string',
          description: 'Primary official skill name (e.g. "lark-task", "lark-calendar").',
        },
        steps: {
          type: 'array',
          items: {
            type: 'array',
            items: { type: 'string' },
          },
          description: 'Concrete command steps (1 to 50), each an argv array without leading "lark-cli".',
        },
        reason: {
          type: 'string',
          description: '1-2 concise sentences in the user language describing exact objects and impact WITHOUT technical CLI flags.',
        },
      },
      required: ['steps', 'reason'],
    },
  },
  {
    name: 'suggest_base_table',
    description:
      'Switch to / trigger Feishu Bitable Base blueprint planning when the user explicitly wants to design and create a new multi-dimensional Base / ledger / tracking table.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short suggested Base topic.',
        },
      },
      required: [],
    },
  },
]

function tryParseJsonObject(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {}
  return null
}

/**
 * Fallback parser only when an adapter/mock returns tool calls inside plain text instead of native tool-call blocks.
 */
function parseFallbackTextToolCall(text, parseModelJson) {
  const raw = String(text || '').trim()
  if (!raw || (!raw.startsWith('{') && !raw.startsWith('```'))) return null
  const parsed = typeof parseModelJson === 'function' ? parseModelJson(raw) : tryParseJsonObject(raw)
  if (!parsed || typeof parsed !== 'object') return null

  const toolName = parsed.tool || parsed.tool_name || parsed.call
  if (typeof toolName === 'string' && COLLAB_TOOL_SCHEMAS.some((t) => t.name === toolName)) {
    const args = parsed.args || parsed.arguments || parsed.input || {}
    return { kind: 'tool', id: `fallback_${Date.now()}`, name: toolName, args: (args && typeof args === 'object') ? args : {} }
  }
  if (parsed.action === 'suggest_create_table') {
    return { kind: 'tool', id: `fallback_${Date.now()}`, name: 'suggest_base_table', args: { title: parsed.title || '' } }
  }
  if (parsed.action === 'reply' && typeof (parsed.reply || parsed.text || parsed.content) === 'string') {
    return { kind: 'reply', reply: parsed.reply || parsed.text || parsed.content }
  }
  return null
}

function buildCollabSystemPrompt({ isEn, brand, officialSkills, scopesInfo }) {
  const catalogBlock = Array.isArray(officialSkills) && officialSkills.length > 0
    ? officialSkills.map((s) => `- ${s.name}: ${String(s.description || '').slice(0, 140)}`).join('\n')
    : '(Catalog unavailable; common skills: lark-calendar, lark-task, lark-im, lark-mail, lark-contact, lark-doc, lark-drive, lark-wiki, lark-approval, lark-sheets, lark-slides, lark-meeting, lark-okr, lark-attendance, lark-base, lark-apps.)'

  const brandUrlRule = brand === 'lark'
    ? 'Use larksuite.com for Lark links (never feishu.cn or larkoffice.com) and preserve query parameters verbatim.'
    : 'Preserve returned Feishu links and query parameters (such as lk_unique=true) verbatim.'

  const appNote = scopesInfo?.appId ? `Configured appId: ${scopesInfo.appId}.` : ''
  const langRule = isEn
    ? '\nIMPORTANT: The active language is English. Always write all user-facing replies and confirmation reasons in natural, concise English.'
    : ''

  return `You are a Principal Feishu/Lark Collaboration Agent inside DeepSeek Harness.
Solve the user's request accurately using real tool exploration — NEVER guess CLI subcommands, flag names, or object IDs.
${appNote}${langRule}

Available official Feishu skills (load via \`read_skill\` before guessing unfamiliar commands):
${catalogBlock}

Strict Operating Protocol:
1. **Direct Reply (No Unnecessary API Calls)**: If the user asks about uploaded images/files/attachments, asks to reformat/summarize data already in history, asks general questions, or says thanks/greetings, answer directly in ${isEn ? 'natural concise English' : '简洁清晰的中文'} without calling Feishu CLI tools.
2. **Discover Contract Before Calling**:
   - Call \`read_skill\` for the domain first when unsure of the subcommand (e.g. \`lark-task\`, \`lark-approval\`). If the guide points to \`references/*.md\`, call \`read_skill\` with \`path\` to read that reference file!
   - Call \`inspect_cli(mode="help", target="...")\` (and \`mode="schema"\` for OpenAPI resource params/JSON payloads) before calling an unfamiliar command or mutating operation. Never invent flags like \`--creator\` when \`+get-related-tasks --help\` actually defines \`--created-by-me\`.
   - Never pass \`--as user\`/\`--as bot\` or output-file flags (\`--output\`, \`--params\`, \`--page-all\`, \`--include-values\`, \`@file\`) into \`run_readonly\`.
3. **Autonomous Multi-Step Read Exploration**:
   - Call \`run_readonly\` to query Feishu data. You may chain multiple reads across domains (e.g., search user via \`contact +search-user\` to get \`open_id\`, then query calendar/tasks; handle pagination tokens if needed).
   - If \`run_readonly\` returns a flag error or empty result, inspect the returned hint/\`--help\` or try the companion capability (for instance, in \`lark-task\`, \`+get-my-tasks\` lists tasks assigned to the user whereas \`+get-related-tasks\` lists tasks created/followed by the user).
   - If a tool reports \`missing_scope\`, stop immediately (the system will surface the authorization card).
4. **User-Authorized Writes via Single Write Barrier**:
   - The user is signed in and authorized. Never refuse create/update/delete/send/approve/export requests verbally.
   - First resolve ALL target GUIDs/IDs/Tokens via \`run_readonly\` and verify required flags via \`inspect_cli\`. If matching items are empty (e.g. 0 tasks to delete), tell the user directly instead of calling \`propose_write\`.
   - Once targets & exact arguments are verified, call \`propose_write(skill, steps, reason)\` ONCE to present the confirmation card. NEVER pass pure read-only queries to \`propose_write\`.
5. **Base Creation**: If the user explicitly wants to design and create a new Feishu Bitable Base, call \`suggest_base_table\`.
6. **Output Hygiene**: ${brandUrlRule} Never mention internal CLI update notices (\`lark-cli update\`) or expose raw CLI flags in user-facing confirmation reasons or answers.`
}

export function createCollabRunner({
  ctx,
  introspect,
  invoke,
  runJson,
  asArgs,
  stripCliNotices,
  adaptBrandData,
  adaptUrlTextForBrand,
  resolveEffectiveBrand,
  getScopes,
  readOfficialSkillsCatalog,
  skillLabel,
  humanizeCliError,
  isMissingScopeResult,
  buildSkillScopeError,
  extractConfirmFlagFromError,
  parseModelJson,
  createPlainReplyForwarder,
  callLlm,
  resolveModelSelection,
  suggestCreateTable,
}) {
  /**
   * Collect one model step with native `tools` streaming (`tool-call-delta`, `block-end`, `text-delta`, `reasoning-delta`),
   * gracefully falling back to plain JSON text mode if an adapter rejects `tools`.
   */
  async function runModelTurn({ system, messages, tools, model, provider, temperature = 0.2, onDelta }, signal) {
    if (!ctx.llm || typeof ctx.llm.stream !== 'function') return null
    const { provider: p, model: m } = resolveModelSelection(provider, model)

    const runStreamOnce = async (withTools) => {
      const stream = ctx.llm.stream({
        provider: p,
        model: m,
        system,
        messages,
        ...(withTools && Array.isArray(tools) && tools.length > 0 ? { tools } : {}),
        temperature,
        signal,
      })

      const finalizedBlocks = new Map()
      const partialToolCalls = new Map()
      let rawText = ''
      let rawReasoning = ''
      let replayState = undefined
      let sawNativeBlockEnd = false
      let textLeadBuffer = ''
      let decidedTextForward = false

      const flushTextDelta = (delta) => {
        if (!delta) return
        if (!decidedTextForward) {
          textLeadBuffer += delta
          const trimmed = textLeadBuffer.trimStart()
          if (!trimmed) return
          if (trimmed.startsWith('{') || trimmed.startsWith('```')) {
            // Buffer potential fallback JSON envelope instead of leaking raw JSON to live reply UI
            return
          }
          decidedTextForward = true
          onDelta?.({ type: 'text', delta: textLeadBuffer })
          textLeadBuffer = ''
          return
        }
        onDelta?.({ type: 'text', delta })
      }

      for await (const chunk of stream) {
        if (!chunk) continue
        if (typeof chunk === 'string') {
          rawText += chunk
          flushTextDelta(chunk)
        } else if (chunk.type === 'reasoning-delta' || chunk.type === 'thinking_delta') {
          const delta = chunk.text || chunk.thinking || ''
          rawReasoning += delta
          if (delta) onDelta?.({ type: 'reasoning', delta })
        } else if (chunk.type === 'text-delta') {
          const delta = chunk.text || ''
          rawText += delta
          flushTextDelta(delta)
        } else if (chunk.type === 'text') {
          const delta = chunk.text || ''
          rawText += delta
          flushTextDelta(delta)
        } else if (chunk.text && !chunk.type) {
          rawText += chunk.text
          flushTextDelta(chunk.text)
        } else if (chunk.type === 'tool-call-delta') {
          const idx = chunk.index ?? 0
          const existing = partialToolCalls.get(idx) || {
            type: 'tool-call',
            id: chunk.id || `call_${idx}_${Date.now()}`,
            name: chunk.name || '',
            arguments: '',
          }
          if (chunk.id) existing.id = chunk.id
          if (chunk.name) existing.name = chunk.name
          if (chunk.argumentsDelta) existing.arguments += chunk.argumentsDelta
          partialToolCalls.set(idx, existing)
        } else if (chunk.type === 'block-end' && chunk.block) {
          sawNativeBlockEnd = true
          finalizedBlocks.set(chunk.index ?? finalizedBlocks.size, chunk.block)
        } else if (chunk.type === 'finish' && chunk.replayState !== undefined) {
          replayState = chunk.replayState
        }
      }

      // Check inline <think>...</think> fallback
      const thinkMatch = rawText.match(/<think>([\s\S]*?)<\/think>/i)
      if (thinkMatch) {
        rawReasoning = (rawReasoning ? `${rawReasoning}\n` : '') + thinkMatch[1].trim()
        rawText = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
      }

      const assistantBlocks = []
      if (sawNativeBlockEnd && finalizedBlocks.size > 0) {
        const ordered = [...finalizedBlocks.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1])
        assistantBlocks.push(...ordered)
      } else {
        if (rawReasoning.trim()) assistantBlocks.push({ type: 'reasoning', text: rawReasoning.trim() })
        if (rawText.trim()) assistantBlocks.push({ type: 'text', text: rawText.trim() })
        const orderedTools = [...partialToolCalls.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1])
        assistantBlocks.push(...orderedTools)
      }

      const toolCalls = assistantBlocks.filter((b) => b && b.type === 'tool-call')
      const textContent = assistantBlocks
        .filter((b) => b && b.type === 'text')
        .map((b) => b.text || '')
        .join('')
        .trim() || rawText.trim()

      // If text was buffered at leading `{` but was NOT a fallback tool JSON (e.g. normal prose starting with something), emit it cleanly only if no toolCalls
      const fallbackAction = toolCalls.length === 0 ? parseFallbackTextToolCall(textContent, parseModelJson) : null
      if (textLeadBuffer && !decidedTextForward && toolCalls.length === 0 && !fallbackAction) {
        onDelta?.({ type: 'text', delta: textLeadBuffer })
      }

      return {
        provider: p,
        model: m,
        assistantBlocks,
        toolCalls,
        textContent,
        reasoning: rawReasoning.trim() || null,
        replayState,
        fallbackAction,
      }
    }

    try {
      return await runStreamOnce(true)
    } catch (err) {
      const msg = String(err?.message || err || '')
      if (Array.isArray(tools) && tools.length > 0 && /tool|function|schema|unsupported/i.test(msg)) {
        return await runStreamOnce(false).catch(() => null)
      }
      console.warn('[dsh-lark] collab turn error:', msg)
      return null
    }
  }

  async function summarizeOutputs({ skillName, label, text, stepOutputs, stepErrors = [], isConfirmedAction = false, model, provider, isEn, onDelta }, signal) {
    const brand = await resolveEffectiveBrand(signal)
    const rawPayload = stripCliNotices(
      stepErrors.length > 0
        ? { completed: stepOutputs, failed: stepErrors }
        : (stepOutputs.length === 1 ? stepOutputs[0].data : stepOutputs),
    )
    const payloadForModel = adaptBrandData(rawPayload, brand)
    const payloadText = typeof payloadForModel === 'string'
      ? payloadForModel
      : JSON.stringify(payloadForModel ?? {}, null, 2)
    const brandHint = brand === 'lark'
      ? 'Use larksuite.com for Lark URLs (never feishu.cn or larkoffice.com), and preserve query parameters (such as lk_unique=true) verbatim.'
      : 'Preserve returned URLs and query parameters (such as lk_unique=true) verbatim.'

    const summarized = await callLlm({
      system: isEn
        ? `Summarize the data returned by the official Feishu CLI (${skillName}) into a concise, clear, human-readable English answer (using Markdown lists or tables where helpful). Never mention internal CLI version notices or suggest running \`lark-cli update\`. ${brandHint}`
        : `请把官方飞书命令（${skillName}）返回的数据整理成简洁清晰、人类易读的中文回答（支持 Markdown 列表或表格）。绝不要提及内部 CLI 版本提示或建议用户运行 \`lark-cli update\`。${brand === 'lark' ? '请使用 larksuite.com 域名链接（不要使用 feishu.cn 或 larkoffice.com），并完整保留链接中的查询参数（如 lk_unique=true）。' : '请完整保留返回链接及其查询参数（如 lk_unique=true）。'}`,
      messages: [
        { role: 'user', text: `${isEn ? 'User request' : '用户问题'}：${text}\n${isEn ? 'Returned data' : '返回数据'}：\n${payloadText.slice(0, 12000)}` },
      ],
      model,
      provider,
      onDelta: createPlainReplyForwarder(onDelta),
    }, signal)

    const fallbackSummary = isConfirmedAction
      ? (isEn
          ? `Completed ${stepOutputs.length} action(s) via **${label}**${stepErrors.length > 0 ? ` (${stepErrors.length} failed: ${stepErrors[0].message})` : ''}.`
          : `已通过 **${label}** 执行 ${stepOutputs.length} 项操作${stepErrors.length > 0 ? `（另有 ${stepErrors.length} 项未完成：${stepErrors[0].message}）` : ''}。`)
      : (isEn
          ? `Fetched via official skill **${label}**:\n${typeof payloadForModel === 'string' ? payloadText.slice(0, 2000) : `\`\`\`json\n${payloadText.slice(0, 2000)}\n\`\`\``}`
          : `已通过官方技能 **${label}** 获取数据：\n${typeof payloadForModel === 'string' ? payloadText.slice(0, 2000) : `\`\`\`json\n${payloadText.slice(0, 2000)}\n\`\`\``}`)
    const finalReply = adaptUrlTextForBrand(
      summarized ? (summarized.text || summarized) : fallbackSummary,
      brand,
    )
    return {
      ok: stepErrors.length === 0 || stepOutputs.length > 0,
      type: 'collab',
      domain: skillName,
      skill: skillName,
      reply: finalReply,
      reasoning: summarized?.reasoning || null,
      summary: isConfirmedAction
        ? (isEn ? `Executed ${skillName}` : `已完成 ${label} 操作`)
        : (isEn ? `Completed query via ${skillName}` : `已通过 ${skillName} 完成查询`),
      data: payloadForModel,
    }
  }

  /**
   * Confirmed batch execution (up to 50 steps) with automatic `--yes` / exit-10 retry and scope/error localization.
   */
  async function executeConfirmedSteps(skillName, rawSteps, text, { model, provider, activeLang, isEn, onDelta }, signal) {
    const label = skillLabel(skillName, activeLang, skillName, skillName)
    const stepsToRun = rawSteps
      .map((s) => introspect.normalizeCliArgv(s, skillName))
      .filter((s) => s.length > 0 && s[0].toLowerCase() !== 'skills')
      .slice(0, 50)

    if (stepsToRun.length === 0) {
      return {
        ok: false,
        type: 'answer',
        domain: skillName,
        reply: isEn ? 'No valid Feishu command steps to execute.' : '没有可执行的合法飞书命令。',
      }
    }

    const stepOutputs = []
    const stepErrors = []

    for (let idx = 0; idx < stepsToRun.length; idx++) {
      let activeArgv = [...stepsToRun[idx]]
      const helpMeta = await introspect.inspectCommand(activeArgv, signal)
      if (helpMeta) {
        activeArgv = introspect.normalizeCliArgv(activeArgv, skillName, helpMeta)
        if (helpMeta.risk === 'high-risk-write' && !activeArgv.includes('--yes')) {
          activeArgv.push('--yes')
        }
      }
      let cliResult = await runJson([...activeArgv, ...asArgs()], signal)
      if (!cliResult.ok) {
        const confirmFlag = extractConfirmFlagFromError(cliResult)
        if (confirmFlag && !activeArgv.includes(confirmFlag)) {
          activeArgv = [...activeArgv, confirmFlag]
          cliResult = await runJson([...activeArgv, ...asArgs()], signal)
        }
      }
      if (!cliResult.ok) {
        if (isMissingScopeResult(cliResult)) {
          const scopesInfo = await getScopes(signal)
          const brand = scopesInfo.brand || (await resolveEffectiveBrand(signal))
          return buildSkillScopeError(skillName, cliResult, activeLang, isEn, scopesInfo, brand)
        }
        const friendlyMsg = humanizeCliError(cliResult.message, isEn)
        stepErrors.push({ command: activeArgv.slice(0, 3).join(' '), message: friendlyMsg })
        if (stepsToRun.length === 1) {
          return {
            ok: false,
            type: 'answer',
            domain: skillName,
            reply: isEn
              ? `Failed to execute ${label}: ${friendlyMsg}`
              : `${label}操作未能完成：${friendlyMsg}`,
          }
        }
        continue
      }
      stepOutputs.push({
        command: activeArgv.slice(0, 2).join(' '),
        data: cliResult.value !== undefined ? cliResult.value : (cliResult.rawText || ''),
      })
    }

    if (stepOutputs.length === 0 && stepErrors.length > 0) {
      return {
        ok: false,
        type: 'answer',
        domain: skillName,
        reply: isEn
          ? `Failed to execute ${label}: ${stepErrors[0].message}`
          : `${label}操作未能完成：${stepErrors[0].message}`,
      }
    }

    return await summarizeOutputs({
      skillName,
      label,
      text,
      stepOutputs,
      stepErrors,
      isConfirmedAction: true,
      model,
      provider,
      isEn,
      onDelta,
    }, signal)
  }

  /**
   * Execute one ReAct tool call and return either `{ terminal }` (stop loop immediately)
   * or `{ resultText, isError }` (feed observation back into model context).
   */
  async function executeToolCall(name, rawArgs, state, signal) {
    const args = (rawArgs && typeof rawArgs === 'object') ? rawArgs : {}
    const { isEn, brand, text, model, provider, scopesInfo } = state

    if (name === 'suggest_base_table') {
      const terminal = await suggestCreateTable(args.title || text)
      return { terminal }
    }

    if (name === 'read_skill') {
      const skill = String(args.skill || state.activeSkillName || '').trim()
      if (skill) state.activeSkillName = skill
      const doc = await introspect.readSkillDoc(skill, args.path, signal)
      if (!doc) {
        return {
          isError: true,
          resultText: JSON.stringify({
            ok: false,
            error: `Skill guide not found for "${skill}"${args.path ? ` path "${args.path}"` : ''}. Verify the skill name or omit path to read SKILL.md.`,
          }),
        }
      }
      const truncated = doc.length > 24000
        ? `${doc.slice(0, 24000)}\n\n[Truncated at 24000 chars; read specific references/*.md files via read_skill(skill, path) if needed]`
        : doc
      return { isError: false, resultText: truncated }
    }

    if (name === 'inspect_cli') {
      const mode = String(args.mode || 'help').toLowerCase()
      const targetStr = String(args.target || '').trim()
      if (mode === 'schema') {
        const schemaRes = await introspect.inspectSchema(targetStr, signal)
        return {
          isError: !schemaRes.ok,
          resultText: JSON.stringify(schemaRes).slice(0, 14000),
        }
      }
      const tokens = targetStr.split(/\s+/).filter(Boolean)
      const norm = introspect.normalizeCliArgv(tokens, state.activeSkillName)
      const helpMeta = await introspect.inspectCommand(norm, signal)
      if (!helpMeta) {
        return {
          isError: true,
          resultText: JSON.stringify({
            ok: false,
            error: `No --help found for "${norm.join(' ')}". Check domain + subcommand via read_skill first.`,
          }),
        }
      }
      return {
        isError: false,
        resultText: JSON.stringify({
          ok: true,
          command: norm.join(' '),
          risk: helpMeta.risk,
          schemaPath: helpMeta.schemaPath,
          requiredFlags: Array.from(helpMeta.requiredFlags),
          boolFlags: Array.from(helpMeta.boolFlags),
          valueFlags: Array.from(helpMeta.valueFlags),
          help: helpMeta.rawHelp.slice(0, 8000),
        }),
      }
    }

    if (name === 'run_readonly') {
      const argSkill = String(args.skill || state.activeSkillName || '').trim()
      if (argSkill) state.activeSkillName = argSkill
      const rawArgv = Array.isArray(args.argv) ? args.argv : []
      // Strip `--as` & collapse `--bool true/false` after peeking `--help` if available
      const preNorm = introspect.normalizeCliArgv(rawArgv, argSkill)
      const peekHelp = await introspect.inspectCommand(preNorm, signal).catch(() => null)
      const normalized = peekHelp ? introspect.normalizeCliArgv(preNorm, argSkill, peekHelp) : preNorm

      const safety = await introspect.evaluateReadonlySafety(normalized, signal)
      if (!safety.ok) {
        const isConfirmedTypeBlock = safety.risk === 'write'
          || safety.risk === 'high-risk-write'
          || safety.risk === 'restricted'
          || hasDisallowedExportOrBypassFlag(normalized)
        return {
          isError: true,
          resultText: JSON.stringify({
            ok: false,
            blocked: true,
            risk: safety.risk,
            requiresConfirmation: isConfirmedTypeBlock,
            reason: safety.reason,
            nextStep: isConfirmedTypeBlock
              ? 'This operation mutates, exports, or accesses restricted parameters and CANNOT run in run_readonly. If intended, call propose_write(skill, steps, reason) after resolving all real target IDs.'
              : 'Fix the command/flags using the help details below and call run_readonly again.',
            ...(safety.helpMeta ? {
              availableBoolFlags: Array.from(safety.helpMeta.boolFlags),
              availableValueFlags: Array.from(safety.helpMeta.valueFlags),
              requiredFlags: Array.from(safety.helpMeta.requiredFlags),
              help: safety.helpMeta.rawHelp.slice(0, 4000),
            } : {}),
          }),
        }
      }

      const execArgv = [...normalized]
      if (args.dryRun === true && !execArgv.includes('--dry-run')) execArgv.push('--dry-run')
      const cliResult = await runJson([...execArgv, ...asArgs()], signal)

      if (!cliResult.ok) {
        if (isMissingScopeResult(cliResult)) {
          const sName = argSkill || preNorm[0] || 'feishu'
          return {
            terminal: buildSkillScopeError(sName, cliResult, state.activeLang, isEn, scopesInfo, brand),
          }
        }
        let selfOpenId = ''
        if (/user-id|user_id|open_id/i.test(cliResult.message || '')) {
          const selfRes = await runJson(['contact', '+get-user', ...asArgs()], signal).catch(() => null)
          const u = selfRes?.value?.data?.user || selfRes?.value?.user || selfRes?.value?.data || selfRes?.value
          if (u && typeof u.open_id === 'string' && u.open_id) selfOpenId = u.open_id
        }
        return {
          isError: true,
          resultText: JSON.stringify({
            ok: false,
            command: normalized.join(' '),
            error: humanizeCliError(cliResult.message, isEn),
            rawMessage: cliResult.message,
            ...(selfOpenId ? { currentUserOpenId: selfOpenId } : {}),
            ...(safety.helpMeta ? { help: safety.helpMeta.rawHelp.slice(0, 3500) } : {}),
          }),
        }
      }

      const cleaned = adaptBrandData(
        stripCliNotices(cliResult.value !== undefined ? cliResult.value : (cliResult.rawText || '')),
        brand,
      )
      state.lastData = cleaned
      const outStr = typeof cleaned === 'string' ? cleaned : JSON.stringify(cleaned ?? {}, null, 2)
      return {
        isError: false,
        resultText: outStr.slice(0, 14000),
      }
    }

    if (name === 'propose_write') {
      const sName = String(args.skill || state.activeSkillName || '').trim() || 'feishu'
      state.activeSkillName = sName
      const rawSteps = Array.isArray(args.steps) ? args.steps : []
      if (rawSteps.length === 0) {
        return { isError: true, resultText: JSON.stringify({ ok: false, error: 'steps array cannot be empty.' }) }
      }
      const readiness = await introspect.validateWriteReadiness(rawSteps, sName, signal)
      if (!readiness.ok) {
        return {
          isError: true,
          resultText: JSON.stringify({
            ok: false,
            error: 'Proposed write steps failed pre-confirmation validation.',
            issues: readiness.issues,
            nextStep: 'Inspect the schema/help via inspect_cli and look up real target GUIDs/IDs via run_readonly BEFORE calling propose_write.',
          }),
        }
      }

      // Hard guard: pure read-only queries with zero dangerous flags must NEVER trigger confirmation cards!
      const anyDangerous = readiness.steps.some(hasDisallowedExportOrBypassFlag)
      if (readiness.allReadonlySafe && !anyDangerous) {
        return {
          isError: true,
          resultText: JSON.stringify({
            ok: false,
            error: 'All steps in propose_write are strictly read-only (`Risk: read`). Do NOT ask confirmation for read-only queries — run them via `run_readonly` and answer the user directly.',
          }),
        }
      }

      const label = skillLabel(sName, state.activeLang, sName, sName)
      const firstCmd = readiness.steps.map((s) => `lark-cli ${s.join(' ')}`).join(' && ')
      const fallbackReason = isEn
        ? `This action (${label}) will modify or export Feishu data and requires your confirmation before running.`
        : `即将执行「${label}」相关操作，可能变更数据或产生外部影响，请确认后继续。`
      const reason = String(args.reason || '').trim() || fallbackReason
      return {
        terminal: {
          ok: true,
          type: 'answer',
          domain: sName,
          needsConfirm: true,
          confirmKind: 'skill_guard',
          skill: sName,
          skillLabel: label,
          confirmReason: reason,
          commandPreview: firstCmd,
          argv: readiness.steps[0],
          steps: readiness.steps,
          reply: isEn ? `${reason}\n\nCommand: \`${firstCmd}\`` : reason,
          summary: isEn ? `Confirm action (${label})` : `待确认操作（${label}）`,
        },
      }
    }

    return {
      isError: true,
      resultText: JSON.stringify({ ok: false, error: `Unknown tool "${name}".` }),
    }
  }

  async function runCollab({ instruction, history = [], model, provider, activeLang, isEn, attachmentContext, imageBlocks = [], onDelta }, signal) {
    const text = instruction || ''
    const scopesInfo = await getScopes(signal)
    const brand = scopesInfo.brand || (await resolveEffectiveBrand(signal))
    const officialSkills = (ctx.llm && typeof ctx.llm.stream === 'function')
      ? await readOfficialSkillsCatalog(signal).catch(() => [])
      : []

    if (!ctx.llm || typeof ctx.llm.stream !== 'function') {
      return {
        ok: true,
        type: 'collab',
        reply: isEn
          ? 'Please connect a model in DeepSeek Harness to use the Feishu workbench assistant.'
          : '请先在 DeepSeek Harness 中配置可用模型以使用飞书工作台助手。',
        summary: isEn ? 'Model unavailable' : '模型不可用',
      }
    }

    const system = buildCollabSystemPrompt({ isEn, brand, officialSkills, scopesInfo })
    const attachPrompt = attachmentContext?.promptBlock || ''
    const userContentText = attachPrompt ? `${text}\n\n${attachPrompt}` : text

    const { provider: selProvider, model: selModel } = resolveModelSelection(provider, model)
    const messages = [
      ...history
        .filter((h) => h && h.text)
        .map((h) => {
          const isAssistant = h.role === 'assistant' || h.role === 'model'
          return {
            role: isAssistant ? 'assistant' : 'user',
            ...(isAssistant ? { source: { kind: 'model', provider: selProvider, model: selModel } } : {}),
            content: [{ type: 'text', text: String(h.text) }],
          }
        }),
      {
        role: 'user',
        content: [
          { type: 'text', text: userContentText },
          ...imageBlocks,
        ],
      },
    ]

    const state = {
      activeLang,
      isEn,
      brand,
      text,
      model,
      provider,
      scopesInfo,
      activeSkillName: '',
      lastData: null,
    }

    const plainForwarder = createPlainReplyForwarder(onDelta)
    let lastReasoning = null

    for (let step = 0; step < MAX_LOOP_STEPS; step++) {
      const isFinalForcedStep = step === MAX_LOOP_STEPS - 1
      const turn = await runModelTurn({
        system,
        messages,
        tools: isFinalForcedStep ? [] : COLLAB_TOOL_SCHEMAS,
        model,
        provider,
        temperature: 0.15,
        onDelta: plainForwarder,
      }, signal)

      if (!turn) break
      if (turn.reasoning) lastReasoning = turn.reasoning

      // 1. Native tool-call batch
      if (turn.toolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          source: {
            kind: 'model',
            provider: turn.provider,
            model: turn.model,
            ...(turn.replayState !== undefined ? { replayState: turn.replayState } : {}),
          },
          content: turn.assistantBlocks,
        })

        let pendingTerminal = null
        for (const call of turn.toolCalls) {
          if (pendingTerminal) {
            // Keep DeepSeek Messages history valid if a batch contains trailing calls after a terminal result
            messages.push({
              role: 'tool',
              toolCallId: call.id,
              source: { kind: 'tool', callId: call.id },
              isError: false,
              content: [{ type: 'text', text: 'Skipped because previous tool terminated the turn.' }],
            })
            continue
          }
          const parsedArgs = tryParseJsonObject(call.arguments) || {}
          const exec = await executeToolCall(call.name, parsedArgs, state, signal)
          if (exec.terminal) {
            pendingTerminal = exec.terminal
            messages.push({
              role: 'tool',
              toolCallId: call.id,
              source: { kind: 'tool', callId: call.id },
              isError: false,
              content: [{ type: 'text', text: 'Completed.' }],
            })
          } else {
            messages.push({
              role: 'tool',
              toolCallId: call.id,
              source: { kind: 'tool', callId: call.id },
              isError: Boolean(exec.isError),
              content: [{ type: 'text', text: String(exec.resultText || '') }],
            })
          }
        }
        if (pendingTerminal) return pendingTerminal
        continue
      }

      // 2. Adapter/mock plain-text JSON tool fallback
      if (turn.fallbackAction?.kind === 'tool') {
        const exec = await executeToolCall(turn.fallbackAction.name, turn.fallbackAction.args, state, signal)
        if (exec.terminal) return exec.terminal
        messages.push({
          role: 'assistant',
          source: { kind: 'model', provider: turn.provider, model: turn.model },
          content: [{ type: 'text', text: turn.textContent }],
        })
        messages.push({
          role: 'user',
          content: [{ type: 'text', text: `[Tool "${turn.fallbackAction.name}" result${exec.isError ? ' (ERROR)' : ''}]:\n${exec.resultText}` }],
        })
        continue
      }

      // 3. Final natural-language answer (from `{ action: 'reply' }` fallback or direct prose)
      const replyRaw = turn.fallbackAction?.kind === 'reply' ? turn.fallbackAction.reply : turn.textContent
      const finalReply = adaptUrlTextForBrand(String(replyRaw || '').trim(), brand)
      if (finalReply) {
        return {
          ok: true,
          type: 'collab',
          ...(state.activeSkillName ? { domain: state.activeSkillName, skill: state.activeSkillName } : {}),
          reply: finalReply,
          reasoning: lastReasoning,
          summary: state.activeSkillName
            ? (isEn ? `Completed via ${state.activeSkillName}` : `已通过 ${state.activeSkillName} 完成处理`)
            : (isEn ? 'Reply complete' : '回复完成'),
          ...(state.lastData !== null ? { data: state.lastData } : {}),
        }
      }
      break
    }

    return {
      ok: true,
      type: 'collab',
      reply: isEn
        ? 'I could not complete the request within the step limit. Please narrow the target and try again.'
        : '本次查询步骤较多未能收敛，请补充更具体的目标名称或范围后重试。',
      summary: isEn ? 'Completed' : '对话处理完成',
    }
  }

  return {
    runCollab,
    executeConfirmedSteps,
  }
}
