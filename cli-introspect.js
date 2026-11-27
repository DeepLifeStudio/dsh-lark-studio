/**
 * Runtime CLI introspection, progressive skill-doc loader, and Risk-based
 * read/write safety classifier for `@larksuite/cli`.
 *
 * Replaces static hand-maintained command allowlists with live truth from:
 *   1) `lark-cli <cmd> --help` (`Risk: read | write | high-risk-write`, flags, Required)
 *   2) `lark-cli schema <service.resource.method>` (`inputSchema`, `_meta.risk`, `_meta.scopes`)
 *   3) `lark-cli skills read <skill> [relative-path]` (main SKILL.md + `references/*.md`)
 *   4) Universal non-overridable security boundary (no raw `api`/`apps`/`event`, no `-o`/`--output*`/`--params`/`@file`/`--page-all`)
 */

export const KNOWN_AUTH_DOMAINS = new Set([
  'base',
  'calendar',
  'task',
  'im',
  'mail',
  'contact',
  'approval',
  'docs',
  'drive',
  'wiki',
  'sheets',
  'slides',
  'markdown',
  'mindnotes',
  'whiteboard',
  'vc',
  'minutes',
  'note',
  'okr',
  'attendance',
  'apps',
  'event',
  'application',
])

export const SKILL_DOMAIN_CANDIDATES = Object.freeze({
  'lark-approval': ['approval'],
  'lark-apps': ['apps'],
  'lark-attendance': ['attendance'],
  'lark-base': ['base'],
  'lark-calendar': ['calendar'],
  'lark-contact': ['contact'],
  'lark-doc': ['docs', 'mindnotes'],
  'lark-drive': ['drive'],
  'lark-event': ['event'],
  'lark-im': ['im'],
  'lark-mail': ['mail'],
  'lark-markdown': ['markdown'],
  'lark-meeting': ['minutes', 'vc', 'note'],
  'lark-minutes': ['minutes', 'vc', 'note'],
  'lark-note': ['minutes', 'vc', 'note'],
  'lark-okr': ['okr'],
  'lark-sheets': ['sheets'],
  'lark-slides': ['slides'],
  'lark-task': ['task'],
  'lark-vc': ['vc', 'minutes'],
  'lark-vc-agent': ['vc', 'minutes'],
  'lark-whiteboard': ['whiteboard'],
  'lark-wiki': ['wiki', 'docs'],
  'lark-workflow-meeting-summary': ['minutes', 'vc', 'note'],
  'lark-workflow-standup-report': ['calendar', 'task'],
})

const TOP_LEVEL_SAFE_READ_COMMANDS = new Set(['whoami'])
const DISALLOWED_READONLY_ROOTS = new Set([
  'api',
  'apps',
  'event',
  'auth',
  'config',
  'profile',
  'update',
  'skills',
  'schema',
  'help',
  'doctor',
])
const FORBIDDEN_READONLY_SUBCOMMANDS = new Set([
  'docs +script',
  'drive +download',
  'event consume',
])
const DANGEROUS_GLOBAL_FLAGS = new Set([
  '-o',
  '--o',
  '--output',
  '--output-dir',
  '--output-path',
  '--overwrite',
  '--download-resources',
  '--params',
  '--page-all',
  '--include-values',
  '--transcript',
  '--force',
  '--yes',
  '-y',
])
const SHARED_READ_VALUE_FLAGS = new Set(['--format', '--jq', '--as', '--profile'])
const SHARED_READ_BOOL_FLAGS = new Set(['--json', '--dry-run'])
const ALLOWED_FORMATS = new Set(['json', 'ndjson', 'table', 'csv', 'pretty', 'data'])
const COBRA_VALUE_TYPES = new Set([
  'string',
  'strings',
  'int',
  'int32',
  'int64',
  'uint',
  'float',
  'float32',
  'float64',
  'duration',
  'json',
  'array',
  'object',
  'map',
  'slice',
  'stringArray',
  'stringToString',
])

export function isWellFormedSkillArgv(argv) {
  if (!Array.isArray(argv) || argv.length === 0 || argv.length > 48) return false
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]
    if (typeof tok !== 'string') return false
    const trimmed = tok.trim()
    if (!trimmed || /[\0\r\n]/.test(trimmed)) return false
  }
  return true
}

export function normalizeSkillArgvWithDomain(argv, skillName) {
  if (!Array.isArray(argv)) return []
  const cleaned = argv.map((t) => String(t ?? '').trim()).filter(Boolean)
  if (cleaned[0] === 'lark-cli') cleaned.shift()
  if (cleaned.length === 0) return []
  const head = cleaned[0].toLowerCase()
  if (
    KNOWN_AUTH_DOMAINS.has(head)
    || TOP_LEVEL_SAFE_READ_COMMANDS.has(head)
    || DISALLOWED_READONLY_ROOTS.has(head)
  ) {
    cleaned[0] = head
    return cleaned
  }
  const candidates = SKILL_DOMAIN_CANDIDATES[skillName] || []
  if (candidates.length > 0 && cleaned[0] && !cleaned[0].startsWith('-')) {
    return [candidates[0], ...cleaned]
  }
  return cleaned
}

export function hasDisallowedExportOrBypassFlag(argv) {
  if (!Array.isArray(argv)) return true
  for (let i = 0; i < argv.length; i++) {
    const tok = String(argv[i] || '').trim()
    const eq = tok.indexOf('=')
    const flag = (eq >= 0 ? tok.slice(0, eq) : tok).toLowerCase()
    if (DANGEROUS_GLOBAL_FLAGS.has(flag)) return true
    if (tok === '-' || tok.startsWith('@')) return true
  }
  return false
}

export function isPlaceholderToken(tok) {
  const s = String(tok || '').trim()
  if (!s) return true
  if (/^<[a-z0-9_.-]+>$/i.test(s)) return true
  if (/^\{[a-z0-9_.-]+\}$/i.test(s) && !s.includes(':')) return true
  if (/^(placeholder|your_[a-z0-9_]+|todo_id|xxx+)$/i.test(s)) return true
  return false
}

export function hasFlagInArgv(argv, flagNames) {
  for (let i = 0; i < argv.length; i++) {
    const tok = String(argv[i] || '')
    const flagName = tok.includes('=') ? tok.slice(0, tok.indexOf('=')) : tok
    if (flagNames.includes(flagName)) {
      const inlineVal = tok.includes('=') ? tok.slice(tok.indexOf('=') + 1) : argv[i + 1]
      if (inlineVal && !String(inlineVal).startsWith('--')) return true
    }
  }
  return false
}

/**
 * Determine subcommand token count (`prefixLen`) without misclassifying flags as subcommands.
 * Returns null when a flag precedes a subcommand (position injection attempt).
 */
export function extractSubcommandPrefix(argv) {
  if (!Array.isArray(argv) || argv.length === 0) return null
  const head = String(argv[0] || '').toLowerCase()
  if (!head || head.startsWith('-')) return null
  if (TOP_LEVEL_SAFE_READ_COMMANDS.has(head)) {
    return { domain: head, sub1: '', sub2: '', prefixLen: 1, key: head }
  }
  if (argv.length < 2) return null
  const s1 = String(argv[1] || '')
  if (s1.startsWith('-')) return null
  const s2 = argv.length >= 3 ? String(argv[2] || '') : ''
  // `+shortcut` is always 2 tokens (`domain +shortcut`), while raw API resources can be 2 or 3 tokens (`domain resource method`)
  if (!s1.startsWith('+') && s2 && !s2.startsWith('-')) {
    return {
      domain: head,
      sub1: s1,
      sub2: s2,
      prefixLen: 3,
      key: `${head} ${s1} ${s2}`,
    }
  }
  return {
    domain: head,
    sub1: s1,
    sub2: '',
    prefixLen: 2,
    key: `${head} ${s1}`,
  }
}

/**
 * Parse `lark-cli <cmd> --help` text into machine-readable risk, flags, and schema hint.
 */
export function parseHelpMetadata(helpText) {
  const text = String(helpText || '')
  const riskMatch = text.match(/^\s*Risk:\s*(high-risk-write|write|read)\b/im)
  const risk = riskMatch ? riskMatch[1].toLowerCase() : 'unknown'
  const schemaMatch = text.match(/Full parameter schema:\s*[\r\n]+\s*(?:lark-cli\s+)?schema\s+([a-z0-9_.]+)/i)
  const schemaPath = schemaMatch ? schemaMatch[1].trim() : null

  const knownFlags = new Set()
  const boolFlags = new Set()
  const valueFlags = new Set()
  const requiredFlags = new Set()
  const shortToLong = new Map()

  let inRequired = false
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    if (/^\s*Required:\s*$/i.test(line)) {
      inRequired = true
      continue
    }
    if (/^\s*(Optional|Flags|Execution|Output|Other|Raw Parameter Input|Usage|Examples|Global Flags):/i.test(line)) {
      inRequired = false
      continue
    }
    if (!line.trim()) {
      inRequired = false
      continue
    }

    // Matches lines like:
    //   -o, --output string   output file path
    //       --created-by-me   Filter tasks created by current user
    //       --task-guid string
    const m = line.match(/^\s+(?:(-[a-zA-Z0-9]),\s*)?(--[a-z0-9][a-z0-9-]*)(?: ([a-zA-Z0-9]+))?(?:\s{2,}|\s*$)/)
    if (m) {
      const shortFlag = m[1] || ''
      const longFlag = m[2]
      const typeToken = m[3] || ''
      knownFlags.add(longFlag)
      if (shortFlag) {
        knownFlags.add(shortFlag)
        shortToLong.set(shortFlag, longFlag)
      }
      if (typeToken && COBRA_VALUE_TYPES.has(typeToken)) {
        valueFlags.add(longFlag)
        if (shortFlag) valueFlags.add(shortFlag)
      } else {
        boolFlags.add(longFlag)
        if (shortFlag) boolFlags.add(shortFlag)
      }
      if (inRequired) {
        requiredFlags.add(longFlag)
      }
    }
  }

  return {
    risk,
    schemaPath,
    knownFlags,
    boolFlags,
    valueFlags,
    requiredFlags,
    shortToLong,
    rawHelp: text,
  }
}

export function normalizeCliArgv(argv, skillName, helpMeta = null) {
  const normalized = normalizeSkillArgvWithDomain(argv, skillName)
  const prefix = extractSubcommandPrefix(normalized)
  if (!prefix) return normalized
  const out = normalized.slice(0, prefix.prefixLen)
  const boolFlags = helpMeta?.boolFlags || null
  for (let i = prefix.prefixLen; i < normalized.length; i++) {
    const tok = normalized[i]
    const next = normalized[i + 1]
    if (tok === '--as' && (next === 'user' || next === 'bot')) {
      i++
      continue
    }
    if (/^--as=(user|bot)$/i.test(tok)) {
      continue
    }
    const flagName = tok.includes('=') ? tok.slice(0, tok.indexOf('=')) : tok
    const isKnownBool = boolFlags
      ? boolFlags.has(flagName)
      : (SHARED_READ_BOOL_FLAGS.has(flagName) || /^--(complete|created-by-me|followed-by-me|include-complete|skip-hidden|summary|todo|keyword)$/i.test(flagName))
    if (isKnownBool && !tok.includes('=') && (next === 'true' || next === 'false')) {
      out.push(`${tok}=${next}`)
      i++
      continue
    }
    out.push(tok)
  }
  return out
}

export function createCliIntrospector({ invoke, runJson, getCliPath }) {
  const helpCache = new Map()
  const schemaCache = new Map()
  const skillDocCache = new Map()

  function clearCaches() {
    helpCache.clear()
    schemaCache.clear()
    skillDocCache.clear()
  }

  async function resolveCliKey() {
    if (typeof getCliPath !== 'function') return 'default'
    try {
      return (await getCliPath()) || 'default'
    } catch {
      return 'default'
    }
  }

  async function inspectCommand(argv, signal) {
    const prefix = extractSubcommandPrefix(argv)
    if (!prefix) return null
    const cliKey = await resolveCliKey()
    const cacheKey = `${cliKey}:${prefix.key}`
    if (helpCache.has(cacheKey)) return helpCache.get(cacheKey)

    const helpArgs = [...argv.slice(0, prefix.prefixLen), '--help']
    const res = await invoke(helpArgs, signal).catch(() => null)
    const stdout = res?.stdout?.trim() || ''
    if (!res || res.exitCode !== 0 || !stdout) {
      // Fallback: if 3-token command failed `--help`, maybe token 2 wasn't a subcommand? No, prefix rule handles `-` already;
      // some raw commands use 2 tokens where token 2 isn't a valid method, so don't cache hard errors permanently.
      return null
    }
    const parsed = parseHelpMetadata(stdout)
    // Support 2-token `domain +shortcut` or top-level command even if parsed has no explicit Risk in minimal test mocks?
    // Fail-closed security: only trust commands whose `--help` explicitly reports `Risk: read | write | high-risk-write`.
    helpCache.set(cacheKey, parsed)
    return parsed
  }

  async function inspectSchema(dotPath, signal) {
    const clean = String(dotPath || '').trim().replace(/^\s*schema\s+/i, '')
    if (!clean || !/^[a-z0-9_.]+$/i.test(clean)) {
      return { ok: false, message: 'Invalid schema path; expected format like task.tasks.delete' }
    }
    const cliKey = await resolveCliKey()
    const cacheKey = `${cliKey}:${clean}`
    if (schemaCache.has(cacheKey)) return schemaCache.get(cacheKey)
    const res = await runJson(['schema', clean], signal).catch((err) => ({ ok: false, message: String(err?.message || err) }))
    if (res && res.ok && res.value) {
      schemaCache.set(cacheKey, { ok: true, dotPath: clean, schema: res.value })
      return schemaCache.get(cacheKey)
    }
    return {
      ok: false,
      dotPath: clean,
      message: res?.message || `Failed to inspect schema ${clean}`,
    }
  }

  async function readSkillDoc(skillName, relativePath, signal, depth = 0) {
    const cleanSkill = String(skillName || '').trim()
    if (!cleanSkill || !/^[a-z0-9-]+$/.test(cleanSkill) || depth > 2) return null
    let targetSkill = cleanSkill
    let cleanRel = String(relativePath || '').trim().replace(/^\/+/, '')

    // Handle cross-skill relative path like `../lark-meeting/references/...`
    const crossMatch = cleanRel.match(/^\.\.\/(lark-[a-z0-9-]+)\/(.+)$/)
    if (crossMatch) {
      targetSkill = crossMatch[1]
      cleanRel = crossMatch[2]
    } else if (cleanRel.includes('..')) {
      return null
    }

    const cliKey = await resolveCliKey()
    const cacheKey = `${cliKey}:${targetSkill}:${cleanRel || 'SKILL.md'}`
    if (skillDocCache.has(cacheKey)) return skillDocCache.get(cacheKey)

    const args = cleanRel ? ['skills', 'read', targetSkill, cleanRel] : ['skills', 'read', targetSkill]
    const raw = await invoke(args, signal).catch(() => null)
    if (!raw || raw.exitCode !== 0 || !raw.stdout?.trim()) return null
    let text = raw.stdout.trim()

    // Automatically resolve alias skills when reading root SKILL.md (e.g. lark-note -> ../lark-meeting/SKILL.md)
    if (!cleanRel && text.length < 900) {
      const aliasMatch = text.match(/\.\.\/(lark-[a-z0-9-]+)\/SKILL\.md/)
      if (aliasMatch && aliasMatch[1] !== targetSkill) {
        const targetText = await readSkillDoc(aliasMatch[1], '', signal, depth + 1)
        if (targetText) text = targetText
      }
    }

    skillDocCache.set(cacheKey, text)
    return text
  }

  /**
   * Evaluate whether `argv` can be executed silently as a strictly read-only command.
   * Security invariant: fail-closed on any unknown, mutating, write-disk, or bypass pattern.
   */
  async function evaluateReadonlySafety(argv, signal) {
    if (!isWellFormedSkillArgv(argv)) {
      return { ok: false, risk: 'unknown', reason: 'malformed argv' }
    }
    const prefix = extractSubcommandPrefix(argv)
    if (!prefix) {
      return { ok: false, risk: 'restricted', reason: 'flag or malformed token before subcommand' }
    }
    if (DISALLOWED_READONLY_ROOTS.has(prefix.domain)) {
      return { ok: false, risk: 'restricted', reason: `disallowed read-only root domain: ${prefix.domain}` }
    }
    if (FORBIDDEN_READONLY_SUBCOMMANDS.has(`${prefix.domain} ${prefix.sub1}`)) {
      return { ok: false, risk: 'write', reason: `explicitly restricted subcommand: ${prefix.domain} ${prefix.sub1}` }
    }
    if (hasDisallowedExportOrBypassFlag(argv)) {
      return { ok: false, risk: 'write', reason: 'contains disallowed export, bypass, or mutation flag' }
    }

    if (prefix.domain === 'whoami') {
      const rest = argv.slice(prefix.prefixLen)
      for (let i = 0; i < rest.length; i++) {
        const tok = rest[i]
        if (tok === '--json' || tok === '--as=user' || tok === '--as=bot') continue
        if (tok === '--as' && (rest[i + 1] === 'user' || rest[i + 1] === 'bot')) {
          i++
          continue
        }
        return { ok: false, risk: 'unknown', reason: `unexpected flag for whoami: ${tok}` }
      }
      return { ok: true, risk: 'read', prefixLen: prefix.prefixLen, helpMeta: null, schemaPath: null }
    }

    const helpMeta = await inspectCommand(argv, signal)
    if (!helpMeta) {
      return {
        ok: false,
        risk: 'unknown',
        reason: `could not verify command via --help for ${prefix.key}`,
      }
    }
    if (helpMeta.risk !== 'read') {
      return {
        ok: false,
        risk: helpMeta.risk,
        prefixLen: prefix.prefixLen,
        helpMeta,
        schemaPath: helpMeta.schemaPath,
        reason: `command risk is "${helpMeta.risk}", requires user confirmation`,
      }
    }

    // Validate all flags against real `--help` schema + shared read-only flags
    const rest = argv.slice(prefix.prefixLen)
    const presentFlags = new Set()
    for (let i = 0; i < rest.length; i++) {
      const tok = rest[i]
      if (!tok.startsWith('-')) {
        return {
          ok: false,
          risk: 'read',
          prefixLen: prefix.prefixLen,
          helpMeta,
          reason: `unexpected positional argument: ${tok}`,
        }
      }
      const eq = tok.indexOf('=')
      const rawFlag = eq >= 0 ? tok.slice(0, eq) : tok
      const inlineVal = eq >= 0 ? tok.slice(eq + 1) : null
      const canonicalFlag = helpMeta.shortToLong.get(rawFlag) || rawFlag

      if (SHARED_READ_BOOL_FLAGS.has(rawFlag) || helpMeta.boolFlags.has(canonicalFlag)) {
        if (eq >= 0 && inlineVal !== 'true' && inlineVal !== 'false') {
          return { ok: false, risk: 'read', prefixLen: prefix.prefixLen, helpMeta, reason: `invalid boolean value for ${rawFlag}` }
        }
        presentFlags.add(canonicalFlag)
        continue
      }

      if (SHARED_READ_VALUE_FLAGS.has(rawFlag) || helpMeta.valueFlags.has(canonicalFlag)) {
        const val = eq >= 0 ? inlineVal : rest[i + 1]
        if (val === undefined || val === '' || val === '-' || val.startsWith('@') || val.startsWith('--')) {
          return { ok: false, risk: 'read', prefixLen: prefix.prefixLen, helpMeta, reason: `missing or disallowed value for ${rawFlag}` }
        }
        if (rawFlag === '--format' && !ALLOWED_FORMATS.has(val)) {
          return { ok: false, risk: 'read', prefixLen: prefix.prefixLen, helpMeta, reason: `disallowed output format: ${val}` }
        }
        if (rawFlag === '--as' && val !== 'user' && val !== 'bot') {
          return { ok: false, risk: 'read', prefixLen: prefix.prefixLen, helpMeta, reason: `invalid --as identity: ${val}` }
        }
        if (rawFlag === '--data') {
          const trimmed = val.trim()
          if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
            return { ok: false, risk: 'read', prefixLen: prefix.prefixLen, helpMeta, reason: `--data must be inline JSON, got ${trimmed}` }
          }
          try {
            JSON.parse(trimmed)
          } catch {
            return { ok: false, risk: 'read', prefixLen: prefix.prefixLen, helpMeta, reason: 'invalid JSON in --data' }
          }
        }
        presentFlags.add(canonicalFlag)
        if (eq < 0) i++
        continue
      }

      return {
        ok: false,
        risk: 'read',
        prefixLen: prefix.prefixLen,
        helpMeta,
        reason: `unknown flag "${rawFlag}" for ${prefix.key}`,
      }
    }

    for (const reqFlag of helpMeta.requiredFlags) {
      if (!presentFlags.has(reqFlag)) {
        return {
          ok: false,
          risk: 'read',
          prefixLen: prefix.prefixLen,
          helpMeta,
          reason: `missing required flag "${reqFlag}" for ${prefix.key}`,
        }
      }
    }

    return {
      ok: true,
      risk: 'read',
      prefixLen: prefix.prefixLen,
      helpMeta,
      schemaPath: helpMeta.schemaPath,
    }
  }

  /**
   * Pre-validate write/proposed commands against runtime `--help` (and required flags + placeholders)
   * BEFORE popping a `skill_guard` confirmation card so users never confirm broken half-baked commands.
   */
  async function validateWriteReadiness(steps, skillName, signal) {
    const normalizedSteps = []
    const issues = []
    let allReadonlySafe = true

    for (let idx = 0; idx < steps.length; idx++) {
      const rawStep = steps[idx]
      const basicNorm = normalizeCliArgv(rawStep, skillName)
      if (!isWellFormedSkillArgv(basicNorm)) {
        issues.push(`Step ${idx + 1} is empty or malformed.`)
        allReadonlySafe = false
        continue
      }
      if (basicNorm.some(isPlaceholderToken)) {
        issues.push(`Step ${idx + 1} (${basicNorm.slice(0, 3).join(' ')}) still contains an unresolved placeholder token. Query the real ID/GUID/Token first.`)
        allReadonlySafe = false
        continue
      }

      const helpMeta = await inspectCommand(basicNorm, signal)
      const step = helpMeta ? normalizeCliArgv(basicNorm, skillName, helpMeta) : basicNorm
      const roCheck = await evaluateReadonlySafety(step, signal)
      if (!roCheck.ok) {
        allReadonlySafe = false
      }

      if (helpMeta && helpMeta.requiredFlags.size > 0 && !hasFlagInArgv(step, ['--params', '--data'])) {
        const missing = []
        for (const reqFlag of helpMeta.requiredFlags) {
          if (!hasFlagInArgv(step, [reqFlag])) missing.push(reqFlag)
        }
        if (missing.length > 0) {
          issues.push(
            `Step ${idx + 1} (${step.slice(0, 3).join(' ')}) is missing required flag(s): ${missing.join(', ')}. Look up real values via run_readonly or check schema (${helpMeta.schemaPath || step.slice(0, 3).join('.')}).`,
          )
        }
      }
      normalizedSteps.push(step)
    }

    return {
      ok: issues.length === 0 && normalizedSteps.length > 0,
      steps: normalizedSteps,
      issues,
      allReadonlySafe,
    }
  }

  return {
    clearCaches,
    inspectCommand,
    inspectSchema,
    readSkillDoc,
    normalizeCliArgv,
    evaluateReadonlySafety,
    validateWriteReadiness,
  }
}
