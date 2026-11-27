/**
 * One operation layer for two callers: the agent tool and the Workbench panel.
 *
 * Everything here shells out to `lark-cli`, which already knows how to talk to
 * Feishu. This module removes the two-step "read the skill, then type the
 * command" cost and executes a blueprint in one run.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveLang } from './planner.js'
import { KNOWN_AUTH_DOMAINS, SKILL_DOMAIN_CANDIDATES, createCliIntrospector, isWellFormedSkillArgv } from './cli-introspect.js'
import { createCollabRunner } from './collab-loop.js'

const CLI_BIN_NAME = process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli'
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const requireFromModule = createRequire(import.meta.url)

const MAX_STDOUT_BYTES = 4 * 1024 * 1024
const MAX_STDERR_BYTES = 256 * 1024
/** How long an abandoned "create app" browser flow may keep a process alive. */
const APP_INIT_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Directories a GUI-launched process does not have on PATH. A macOS app started
 * from Finder inherits a minimal PATH, so a global npm install is invisible
 * unless we add it back — this is the single most likely "it says not installed
 * but I did install it" complaint.
 */
const EXTRA_BIN_DIRS = [
  '.npm-global/bin',
  '.local/bin',
  '.bun/bin',
  '.n/bin',
  '.volta/bin',
  '.asdf/shims',
  '.fnm/aliases/default/bin',
  '.local/share/pnpm',
  'bin',
]

function expandHome(candidate) {
  return candidate.startsWith('~/') ? path.join(homedir(), candidate.slice(2)) : candidate
}

/** nvm keeps one bin directory per installed Node version. */
function nvmBinDirs() {
  const root = path.join(homedir(), '.nvm', 'versions', 'node')
  try {
    return readdirSync(root).map((version) => path.join(root, version, 'bin'))
  } catch {
    return []
  }
}

function augmentedPath() {
  const home = homedir()
  const dirs = EXTRA_BIN_DIRS.map((dir) => path.join(home, dir))
  dirs.push(...nvmBinDirs())
  dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin')
  const current = process.env.PATH ?? ''
  return [...current.split(path.delimiter), ...dirs].filter(Boolean).join(path.delimiter)
}

function childEnv() {
  return {
    ...process.env,
    PATH: augmentedPath(),
    HOME: process.env.HOME ?? homedir(),
    NO_COLOR: '1',
    TERM: 'dumb',
    PAGER: 'cat',
  }
}

/** First value in a nested structure matching a key predicate. */
function scan(node, predicate, depth = 0) {
  if (node == null || depth > 8) return undefined
  if (typeof node !== 'object') return undefined
  for (const [key, value] of Object.entries(node)) {
    const hit = predicate(key, value)
    if (hit !== undefined) return hit
    const nested = scan(value, predicate, depth + 1)
    if (nested !== undefined) return nested
  }
  return undefined
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Locate a view's real id by name: creation is eventually consistent. */
function findViewId(payload, name) {
  let found
  scan(payload, (_key, value) => {
    if (found !== undefined) return found
    if (
      value && typeof value === 'object' && !Array.isArray(value)
      && value.name === name && typeof value.id === 'string'
    ) {
      found = value.id
    }
    return undefined
  })
  return found
}

/** Locate a field's real id by name. */
function findFieldId(payload, name) {
  let found
  scan(payload, (_key, value) => {
    if (found !== undefined) return found
    if (
      value && typeof value === 'object' && !Array.isArray(value)
      && value.name === name && typeof value.id === 'string' && value.id.startsWith('fld')
    ) {
      found = value.id
    }
    return undefined
  })
  return found
}

/** Read the current group configuration out of a view payload. */
function extractGroup(payload) {
  const group = scan(payload, (key, value) => {
    if (key !== 'group' || !Array.isArray(value)) return undefined
    return value
  })
  return Array.isArray(group) ? group : []
}

/** Group entries are `{ field: <name> }` objects or bare names. */
function groupCoversField(group, fieldName) {
  return group.some((entry) => {
    if (typeof entry === 'string') return entry === fieldName
    if (entry && typeof entry === 'object') {
      return entry.field === fieldName || entry.field_id === fieldName
    }
    return false
  })
}

/** First table id (or name) out of a `base +table-list` payload. */
function extractTableId(payload) {
  const id = scan(payload, (key, value) => {
    if (key !== 'table_id' && key !== 'tableId') return undefined
    return typeof value === 'string' && /^tbl/.test(value) ? value : undefined
  })
  if (id) return id
  return scan(payload, (_key, value) => {
    if (!Array.isArray(value)) return undefined
    const first = value.find((item) => item && typeof item === 'object' && typeof item.name === 'string' && item.name)
    return first ? first.name : undefined
  })
}

function extractBase(payload) {
  const tokenKeys = /^(app_token|base_token|appToken|baseToken|token)$/i
  const token = scan(payload, (key, value) => {
    if (!tokenKeys.test(key) || typeof value !== 'string') return undefined
    if (value.length < 8 || /^https?:\/\//i.test(value)) return undefined
    return value
  })
  const url = scan(payload, (_key, value) => {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return undefined
    return /\/base\//.test(value) ? value : undefined
  })
  return { token, url }
}

/** Changes a person cannot undo from the panel: always confirm them first. */
const DESTRUCTIVE_OPS = new Set([
  'delete_field', 'delete_view', 'delete_records', 'remove_options',
  'disable_adv_perm', 'delete_role',
])

/**
 * Human lines for the "sure?" step, e.g.
 *   ['删掉列「备注」', '从「状态」删掉选项：已取消']
 * Also used by the agent tool so both entrances warn the same way.
 */
export function destructiveChanges(ops, langInput = 'zh') {
  const isEn = resolveLang(langInput) === 'en'
  const lines = []
  for (const op of Array.isArray(ops) ? ops : []) {
    if (!op || !DESTRUCTIVE_OPS.has(op.op)) continue
    switch (op.op) {
      case 'delete_field':
        lines.push(isEn ? `Delete column "${op.field}"` : `删掉列「${op.field}」`)
        break
      case 'delete_view':
        lines.push(isEn ? `Delete view "${op.view}"` : `删掉视图「${op.view}」`)
        break
      case 'delete_records':
        lines.push(
          op.record_ids
            ? (isEn ? `Delete ${op.record_ids.length} record(s)` : `删掉 ${op.record_ids.length} 条记录`)
            : (isEn ? 'Delete matching records' : '删掉符合条件的记录'),
        )
        break
      case 'remove_options':
        lines.push(
          isEn
            ? `Remove option(s) from "${op.field}": ${op.options.join(', ')}`
            : `从「${op.field}」删掉选项：${op.options.join('、')}`,
        )
        break
      case 'disable_adv_perm':
        lines.push(
          isEn
            ? 'Disable advanced permissions (invalidates existing custom roles)'
            : '关闭多维表格高级权限（会导致已有自定义角色失效）',
        )
        break
      case 'delete_role':
        lines.push(isEn ? `Delete role "${op.role_name || op.role}"` : `删掉角色「${op.role_name || op.role}」`)
        break
      default:
        break
    }
  }
  return lines
}

export function createOperations({ ctx, config = {}, planner }) {
  // An explicit path wins over discovery: config first (larkCliPath or dsh-feishu's
  // binDir), then the environment, so a user with an unusual install location can
  // fix it without code changes.
  const configuredCli = typeof config.larkCliPath === 'string' && config.larkCliPath.trim()
    ? expandHome(config.larkCliPath.trim())
    : (typeof process.env.LARK_CLI_PATH === 'string' && process.env.LARK_CLI_PATH.trim()
        ? expandHome(process.env.LARK_CLI_PATH.trim())
        : undefined)
  const configuredBinDir = typeof config.binDir === 'string' && config.binDir.trim()
    ? expandHome(config.binDir.trim())
    : undefined
  const onCliReady = typeof config.onCliReady === 'function' ? config.onCliReady : undefined
  const identity = typeof config.identity === 'string' && config.identity !== 'auto'
    ? config.identity
    : undefined
  const normalizeBrand = (raw) => {
    const val = String(raw ?? '').trim().toLowerCase()
    if (val === 'lark' || val === 'feishu') return val
    return undefined
  }
  const configuredBrand = normalizeBrand(config.brand)
  let detectedBrandCache = ''

  function consoleUrlFor(brand, appId) {
    const host = brand === 'lark' ? 'open.larksuite.com' : 'open.feishu.cn'
    return appId ? `https://${host}/app/${appId}/auth` : `https://${host}/app`
  }

  function adaptUrlTextForBrand(text, brand) {
    if (typeof text !== 'string' || !text) return text
    let out = text
    if (brand === 'lark') {
      out = out.replace(/https?:\/\/([a-z0-9-]+\.)?(?:feishu\.cn|larkoffice\.com)(?=\/|\?|$|\)|\]|"|'|\s)/gi, (match, sub) => {
        const prefix = match.startsWith('http://') ? 'http://' : 'https://'
        return `${prefix}${sub || ''}larksuite.com`
      })
    } else if (brand === 'feishu') {
      out = out.replace(/https?:\/\/applink\.(?:larksuite\.com|larkoffice\.com)(?=\/|\?|$|\)|\]|"|'|\s)/gi, (match) => {
        const prefix = match.startsWith('http://') ? 'http://' : 'https://'
        return `${prefix}applink.feishu.cn`
      })
    }
    if (brand === 'lark' || brand === 'feishu') {
      // Official applink web redirects to shared `lark://` by default unless `lk_unique=true`
      // is set, which selects `x-lark://` (LarkSuite) vs `x-feishu://` (Feishu) unambiguously.
      out = out.replace(/https?:\/\/applink\.(?:larksuite\.com|feishu\.cn|larkoffice\.com)(?:\/[^\s)"'<>\]\\]*)?/gi, (rawUrl) => {
        try {
          const parsed = new URL(rawUrl)
          if (parsed.searchParams.get('lk_unique') !== 'true') {
            parsed.searchParams.set('lk_unique', 'true')
          }
          return parsed.toString()
        } catch {
          return rawUrl
        }
      })
    }
    return out
  }

  function adaptBrandData(value, brand) {
    if (brand !== 'lark' && brand !== 'feishu') return value
    if (typeof value === 'string') return adaptUrlTextForBrand(value, brand)
    if (Array.isArray(value)) return value.map((item) => adaptBrandData(item, brand))
    if (value && typeof value === 'object') {
      const out = {}
      for (const [k, v] of Object.entries(value)) out[k] = adaptBrandData(v, brand)
      return out
    }
    return value
  }

  async function resolveEffectiveBrand(signal, fallbackCfg) {
    if (configuredBrand) return configuredBrand
    if (detectedBrandCache) return detectedBrandCache
    const cfgBrand = normalizeBrand(fallbackCfg?.brand)
    if (cfgBrand) {
      detectedBrandCache = cfgBrand
      return cfgBrand
    }
    const cfg = await readConfig(signal).catch(() => null)
    const fromCfg = normalizeBrand(cfg?.brand)
    if (fromCfg) {
      detectedBrandCache = fromCfg
      return fromCfg
    }
    return 'feishu'
  }
  const cwd = typeof config.cwd === 'string' && config.cwd ? config.cwd : process.cwd()

  let resolvedCli
  let activeInstallPromise = null
  const bootstrapState = {
    status: 'idle', // 'idle' | 'installing' | 'ready' | 'error'
    source: null,
    error: null,
    startedAt: 0,
    finishedAt: 0,
  }

  function parseSemverTuple(raw) {
    const clean = String(raw || '').trim().replace(/^v/, '')
    const match = clean.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/)
    if (!match) return { major: 0, minor: 0, patch: 0, pre: '' }
    return {
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
      pre: match[4] || '',
    }
  }

  function compareSemver(a, b) {
    const va = parseSemverTuple(a)
    const vb = parseSemverTuple(b)
    if (va.major !== vb.major) return va.major - vb.major < 0 ? -1 : 1
    if (va.minor !== vb.minor) return va.minor < vb.minor ? -1 : 1
    if (va.patch !== vb.patch) return va.patch < vb.patch ? -1 : 1
    if (va.pre === vb.pre) return 0
    if (!va.pre) return 1
    if (!vb.pre) return -1
    return va.pre < vb.pre ? -1 : 1
  }

  function readCliPkgVersion(pkgRoot) {
    if (!pkgRoot) return '0.0.0'
    try {
      const parsed = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'))
      return typeof parsed?.version === 'string' ? parsed.version : '0.0.0'
    } catch {
      return '0.0.0'
    }
  }

  function findBundledPackageInfo() {
    let pkgRoot = typeof config.bundledCliRoot === 'string' && config.bundledCliRoot
      ? expandHome(config.bundledCliRoot)
      : undefined
    if (!pkgRoot) {
      try {
        pkgRoot = path.dirname(requireFromModule.resolve('@larksuite/cli/package.json'))
      } catch {
        const fallbackPkg = path.join(MODULE_DIR, 'node_modules', '@larksuite', 'cli', 'package.json')
        if (existsSync(fallbackPkg)) pkgRoot = path.dirname(fallbackPkg)
      }
    }
    if (!pkgRoot) return { binaryPath: undefined, installerPath: undefined, version: '0.0.0' }
    const binaryPath = path.join(pkgRoot, 'bin', CLI_BIN_NAME)
    const installerPath = typeof config.cliInstallerPath === 'string' && config.cliInstallerPath
      ? expandHome(config.cliInstallerPath)
      : path.join(pkgRoot, 'scripts', 'install.js')
    return {
      pkgRoot,
      binaryPath,
      version: readCliPkgVersion(pkgRoot),
      installerPath: existsSync(installerPath) ? installerPath : undefined,
    }
  }

  function findFeishuPluginCliEntries() {
    const roots = []
    if (typeof config.feishuCliRoot === 'string' && config.feishuCliRoot) {
      roots.push(expandHome(config.feishuCliRoot))
    }
    try {
      const feishuPkg = requireFromModule.resolve('@deepseek-ai/dsh-feishu/package.json')
      roots.push(path.join(path.dirname(feishuPkg), 'node_modules', '@larksuite', 'cli'))
    } catch {}
    roots.push(
      path.resolve(MODULE_DIR, '..', '@deepseek-ai', 'dsh-feishu', 'node_modules', '@larksuite', 'cli'),
      path.resolve(MODULE_DIR, '..', '..', '@deepseek-ai', 'dsh-feishu', 'node_modules', '@larksuite', 'cli'),
    )
    const seen = new Set()
    const entries = []
    for (const cliDir of roots) {
      if (!cliDir || seen.has(cliDir)) continue
      seen.add(cliDir)
      const binaryPath = path.join(cliDir, 'bin', CLI_BIN_NAME)
      if (existsSync(binaryPath)) {
        entries.push({ source: 'feishu', binaryPath, version: readCliPkgVersion(cliDir) })
      }
    }
    return entries
  }

  /**
   * Pick whichever official/bundled @larksuite/cli package binary is newer;
   * on identical versions, prefer the official `@deepseek-ai/dsh-feishu` binary.
   */
  function pickBestManagedCliPath() {
    const candidates = [...findFeishuPluginCliEntries()]
    const bundled = findBundledPackageInfo()
    if (bundled.binaryPath && existsSync(bundled.binaryPath)) {
      candidates.push({ source: 'bundled', binaryPath: bundled.binaryPath, version: bundled.version })
    }
    if (candidates.length === 0) return undefined
    candidates.sort((left, right) => {
      const diff = compareSemver(right.version, left.version)
      if (diff !== 0) return diff
      if (left.source === right.source) return 0
      return left.source === 'feishu' ? -1 : 1
    })
    return candidates[0].binaryPath
  }

  function wellKnownCliCandidates() {
    const extra = Array.isArray(config.extraCliCandidates)
      ? config.extraCliCandidates.map((p) => expandHome(String(p)))
      : []
    const standard = [
      path.join(homedir(), '.npm-global', 'bin', CLI_BIN_NAME),
      '/opt/homebrew/bin/lark-cli',
      '/usr/local/bin/lark-cli',
      path.join(homedir(), '.local', 'bin', CLI_BIN_NAME),
      path.join(homedir(), '.bun', 'bin', CLI_BIN_NAME),
    ].map(expandHome)
    if (process.platform === 'win32' && process.env.APPDATA) {
      standard.push(
        path.join(process.env.APPDATA, 'npm', 'lark-cli.exe'),
        path.join(process.env.APPDATA, 'npm', 'lark-cli.cmd'),
      )
    }
    return [...extra, ...standard]
  }

  /** Fast synchronous check across configured, latest official/bundled, and standard paths. */
  function resolveCliSync() {
    if (resolvedCli && existsSync(resolvedCli)) return resolvedCli
    if (configuredCli) return existsSync(configuredCli) ? configuredCli : undefined
    if (configuredBinDir) {
      const candidate = path.join(configuredBinDir, CLI_BIN_NAME)
      if (existsSync(candidate)) return candidate
    }
    const bestManaged = pickBestManagedCliPath()
    if (bestManaged) return bestManaged
    if (config.skipStandardCliCandidates !== true) {
      return wellKnownCliCandidates().find((candidate) => existsSync(candidate))
    }
    return undefined
  }

  function getCanonicalBundledCliPath() {
    const { binaryPath } = findBundledPackageInfo()
    return binaryPath || path.join(MODULE_DIR, 'node_modules', '@larksuite', 'cli', 'bin', CLI_BIN_NAME)
  }

  function getCliBootstrapState() {
    return { ...bootstrapState }
  }

  async function resolveCli(signal) {
    if (resolvedCli && existsSync(resolvedCli)) return resolvedCli
    resolvedCli = undefined
    if (configuredCli) {
      if (!existsSync(configuredCli)) throw new Error(`配置的 larkCliPath 不存在：${configuredCli}`)
      resolvedCli = configuredCli
      return resolvedCli
    }
    if (configuredBinDir) {
      const candidate = path.join(configuredBinDir, CLI_BIN_NAME)
      if (!existsSync(candidate)) throw new Error(`配置的 binDir 中找不到 ${CLI_BIN_NAME}：${configuredBinDir}`)
      resolvedCli = candidate
      return resolvedCli
    }
    const bestManaged = pickBestManagedCliPath()
    if (bestManaged) {
      resolvedCli = bestManaged
      return resolvedCli
    }
    const { installerPath } = findBundledPackageInfo()
    if (config.skipSystemCliLookup !== true) {
      try {
        resolvedCli = await ctx.subprocess.resolveExecutable('lark-cli', { PATH: augmentedPath() }, signal)
        return resolvedCli
      } catch {
        // fall through to well-known install locations
      }
    }
    const found = config.skipStandardCliCandidates === true
      ? undefined
      : wellKnownCliCandidates().find((candidate) => existsSync(candidate))
    if (!found) {
      throw new Error(
        installerPath
          ? '飞书连接组件尚未下载完成，可点击自动准备或重试。'
          : '找不到 lark-cli。可点击重试自动安装，或在插件设置里配置 larkCliPath。',
      )
    }
    resolvedCli = found
    return resolvedCli
  }

  function readHandleOutput(handle, outcome) {
    const stdout = handle.collected?.stdout ? handle.collected.stdout.readFrom(0).text : (outcome?.stdout || '')
    const stderr = handle.collected?.stderr ? handle.collected.stderr.readFrom(0).text : (outcome?.stderr || '')
    return { stdout, stderr }
  }

  /**
   * Single-flight zero-install bootstrap: uses Electron/DSH's built-in Node runtime
   * (`ELECTRON_RUN_AS_NODE=1`) to run `@larksuite/cli/scripts/install.js` and fetch
   * the official standalone Go binary without requiring user-installed Node/npm.
   */
  async function installCli(signal) {
    const existing = resolveCliSync()
    if (existing) {
      resolvedCli = existing
      bootstrapState.status = 'ready'
      bootstrapState.error = null
      bootstrapState.finishedAt = bootstrapState.finishedAt || Date.now()
      return { ok: true, path: existing, alreadyInstalled: true, bootstrap: getCliBootstrapState() }
    }
    try {
      const systemFound = await resolveCli(signal)
      bootstrapState.status = 'ready'
      bootstrapState.error = null
      return { ok: true, path: systemFound, alreadyInstalled: true, bootstrap: getCliBootstrapState() }
    } catch {}

    if (activeInstallPromise) return activeInstallPromise

    const { pkgRoot, binaryPath, installerPath } = findBundledPackageInfo()
    if (!installerPath) {
      const msg = '内置飞书组件安装脚本缺失，请尝试重新安装插件或通过终端命令安装。'
      bootstrapState.status = 'error'
      bootstrapState.error = msg
      bootstrapState.finishedAt = Date.now()
      return { ok: false, canAutoInstall: false, error: msg, message: msg, installCommand: INSTALL_COMMAND, bootstrap: getCliBootstrapState() }
    }

    bootstrapState.status = 'installing'
    bootstrapState.source = 'bundled'
    bootstrapState.error = null
    bootstrapState.startedAt = Date.now()
    bootstrapState.finishedAt = 0

    activeInstallPromise = (async () => {
      try {
        const nodeExec = typeof config.nodeExecPath === 'string' && config.nodeExecPath
          ? config.nodeExecPath
          : process.execPath
        const installCwd = pkgRoot || path.dirname(path.dirname(installerPath))
        const handle = ctx.subprocess.spawn({
          argv: [nodeExec, installerPath],
          cwd: installCwd,
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes: MAX_STDOUT_BYTES },
            stderr: { maxBytes: MAX_STDERR_BYTES },
          },
          graceMs: 5000,
          env: {
            ...process.env,
            PATH: augmentedPath(),
            ELECTRON_RUN_AS_NODE: '1',
            CI: 'true',
          },
          signal,
        })
        const outcome = await handle.done
        const { stdout, stderr } = readHandleOutput(handle, outcome)
        resolvedCli = undefined
        if (outcome.exitCode !== 0) {
          const msg = tidyMessage(stderr || stdout, `组件自动下载失败（退出码 ${outcome.exitCode}），请检查网络后重试。`)
          bootstrapState.status = 'error'
          bootstrapState.error = msg
          bootstrapState.finishedAt = Date.now()
          return { ok: false, canAutoInstall: true, error: msg, message: msg, installCommand: INSTALL_COMMAND, bootstrap: getCliBootstrapState() }
        }
        const readyPath = (binaryPath && existsSync(binaryPath)) ? binaryPath : await resolveCli(signal).catch(() => undefined)
        if (!readyPath) {
          const msg = '下载完成但未找到可执行文件，请重试或改用手动安装。'
          bootstrapState.status = 'error'
          bootstrapState.error = msg
          bootstrapState.finishedAt = Date.now()
          return { ok: false, canAutoInstall: true, error: msg, message: msg, installCommand: INSTALL_COMMAND, bootstrap: getCliBootstrapState() }
        }
        resolvedCli = readyPath
        bootstrapState.status = 'ready'
        bootstrapState.error = null
        bootstrapState.finishedAt = Date.now()
        try { onCliReady && onCliReady(readyPath) } catch {}
        return { ok: true, path: readyPath, bootstrap: getCliBootstrapState() }
      } catch (error) {
        const msg = tidyMessage(error instanceof Error ? error.message : String(error), '组件自动下载异常，请检查网络后重试。')
        bootstrapState.status = 'error'
        bootstrapState.error = msg
        bootstrapState.finishedAt = Date.now()
        return { ok: false, canAutoInstall: true, error: msg, message: msg, installCommand: INSTALL_COMMAND, bootstrap: getCliBootstrapState() }
      } finally {
        activeInstallPromise = null
      }
    })()

    return activeInstallPromise
  }

  async function invoke(argv, signal) {
    const executable = await resolveCli(signal)
    const handle = ctx.subprocess.spawn({
      argv: [executable, ...argv],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: MAX_STDOUT_BYTES },
        stderr: { maxBytes: MAX_STDERR_BYTES },
      },
      graceMs: 4000,
      env: childEnv(),
      signal,
    })
    const outcome = await handle.done
    const { stdout, stderr } = readHandleOutput(handle, outcome)
    return { exitCode: outcome.exitCode, stdout, stderr }
  }

  /**
   * lark-cli sometimes prints an agent-facing preamble (hints, warnings, even an
   * ASCII QR code) before its JSON, and on failure its stderr carries a page of
   * instructions. Piping that to a user is worse than saying nothing, so every
   * failure is reduced to one short sentence.
   */
  function tidyMessage(text, fallback) {
    const raw = String(text ?? '').trim()
    if (!raw) return fallback
    const match = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.){3,300})"/g)
    if (match && match.length > 0) {
      // The first one is the failure; later ones are version notices.
      return match[0]
        .replace(/^"message"\s*:\s*"/, '')
        .replace(/"$/, '')
        .replace(/\\"/g, '"')
        .replace(/\\n/g, ' ')
        .slice(0, 240)
    }
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('[') && !/^[█▀▄\s]+$/.test(line))
    const meaningful = lines.find((line) => !line.startsWith('{') && !line.startsWith('}'))
    return (meaningful || fallback || '').slice(0, 240)
  }

  function stripCliNotices(value) {
    if (Array.isArray(value)) return value.map((item) => stripCliNotices(item))
    if (value && typeof value === 'object') {
      const out = {}
      for (const [k, v] of Object.entries(value)) {
        if (k === '_notice' || k === 'notice') continue
        out[k] = stripCliNotices(v)
      }
      return out
    }
    return value
  }

  function parseJsonPayload(rawText) {
    const trimmed = String(rawText ?? '').trim()
    if (!trimmed) return undefined
    let parsed
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      parsed = firstJsonObject(trimmed)
    }
    return parsed && typeof parsed === 'object' ? stripCliNotices(parsed) : parsed
  }

  async function runJson(argv, signal) {
    const { exitCode, stdout, stderr } = await invoke(argv, signal)
    const trimmed = stdout.trim()
    // lark-cli writes success JSON to stdout and structured error JSON envelopes to stderr.
    const payload = parseJsonPayload(stdout) ?? parseJsonPayload(stderr)
    if (payload === undefined && exitCode !== 0) {
      return {
        ok: false,
        exitCode,
        step: argv.slice(0, 2).join(' '),
        message: tidyMessage(stderr || stdout, `lark-cli 退出码 ${exitCode}`),
      }
    }
    if (exitCode !== 0 || (payload && payload.ok === false)) {
      const error = payload && payload.error
      const message = typeof error === 'string'
        ? error
        : (error && (error.message || error.msg))
          || tidyMessage(stderr || stdout, `lark-cli 退出码 ${exitCode}`)
      return {
        ok: false,
        exitCode,
        step: argv.slice(0, 2).join(' '),
        message,
        code: error && error.code,
        error,
        value: payload,
      }
    }
    return { ok: true, value: payload, rawText: trimmed }
  }

  const asArgs = () => (identity ? ['--as', identity] : [])

  async function authStatus(signal) {
    const result = await runJson(['auth', 'status'], signal)
    if (!result.ok) return { ready: false, message: result.message }
    const value = result.value ?? {}
    const identities = value.identities ?? {}
    const user = identities.user
    const bot = identities.bot
    return {
      ready: Boolean((user && user.available) || (bot && bot.available)),
      brand: value.brand,
      appId: value.appId,
      identity: value.identity,
      userName: user && user.userName,
      userReady: Boolean(user && user.available),
      userStatus: user && user.status,
      tokenStatus: user && user.tokenStatus,
      userNote: user ? user.message : undefined,
      botReady: Boolean(bot && bot.available),
    }
  }

  async function status(signal) {
    try {
      const cli = { available: true, path: await resolveCli(signal) }
      return { cli, auth: await authStatus(signal) }
    } catch (error) {
      return {
        cli: { available: false, message: error instanceof Error ? error.message : String(error) },
        auth: { ready: false, message: 'lark-cli 不可用' },
      }
    }
  }

  /**
   * Ensure one table has a kanban view grouped by `fieldName`.
   *
   * Creation is eventually consistent: the new view is not addressable by name
   * for a moment, so resolve its id from the view list, group by the field id,
   * then read the grouping back instead of trusting the call's exit status.
   */
  async function ensureKanban({ token, tableName, fieldName, signal, warnings = [] }) {
    const viewName = `${fieldName}看板`
    const view = await runJson(
      [
        'base', '+view-create',
        '--base-token', token,
        '--table-id', tableName,
        '--json', JSON.stringify({ name: viewName, type: 'kanban' }),
        ...asArgs(),
      ],
      signal,
    )
    const nameTaken = !view.ok && /already used this name/i.test(view.message ?? '')
    if (!view.ok && !nameTaken) {
      warnings.push(`表「${tableName}」的看板视图创建失败：${view.message}`)
      return false
    }

    let viewId
    for (let attempt = 0; attempt < 4 && !viewId; attempt += 1) {
      const list = await runJson(
        ['base', '+view-list', '--base-token', token, '--table-id', tableName, ...asArgs()],
        signal,
      )
      if (list.ok) viewId = findViewId(list.value, viewName)
      if (!viewId) await sleep(350)
    }
    if (!viewId) {
      warnings.push(`表「${tableName}」的看板视图已创建，但没能定位到它的 id`)
      return false
    }

    const fieldList = await runJson(
      ['base', '+field-list', '--base-token', token, '--table-id', tableName, ...asArgs()],
      signal,
    )
    const fieldId = fieldList.ok ? findFieldId(fieldList.value, fieldName) : undefined
    const grouped = await runJson(
      [
        'base', '+view-set-group',
        '--base-token', token,
        '--table-id', tableName,
        '--view-id', viewId,
        '--json', JSON.stringify({ group_config: [{ field: fieldId ?? fieldName, desc: false }] }),
        ...asArgs(),
      ],
      signal,
    )
    const current = await runJson(
      ['base', '+view-get-group', '--base-token', token, '--table-id', tableName, '--view-id', viewId, ...asArgs()],
      signal,
    )
    if (current.ok && groupCoversField(extractGroup(current.value), fieldName)) return true
    if (!grouped.ok) {
      warnings.push(`看板「${viewName}」按「${fieldName}」分组失败：${grouped.message}`)
    } else {
      warnings.push(`看板「${viewName}」已创建，但分组字段无法确认`)
    }
    return false
  }

  /**
   * Execute a blueprint. Steps after the Base exists are non-fatal: a partial
   * result plus warnings still lets the user open what was created.
   */
  async function build(plan, options = {}, signal) {
    const tables = Array.isArray(plan && plan.tables) ? plan.tables : []
    if (tables.length === 0) {
      return { ok: false, step: 'plan', message: '表结构是空的，没有可创建的内容。' }
    }
    const withKanban = options.kanban !== false
    const withSamples = options.sample !== false
    const baseName = (options.name && String(options.name).trim()) || plan.baseName || tables[0].name
    const first = tables[0]
    const warnings = []
    const startedAt = Date.now()

    const created = await runJson(
      [
        'base', '+base-create',
        '--name', baseName,
        '--table-name', first.name,
        '--fields', JSON.stringify(first.fields),
        ...asArgs(),
      ],
      signal,
    )
    if (!created.ok) return { ...created, baseName }

    let { token, url } = extractBase(created.value)
    if (!token) {
      return {
        ok: false,
        step: 'base-create',
        message: 'Base 创建成功但没能从输出里解析出 token。',
        raw: JSON.stringify(created.value).slice(0, 1200),
        baseName,
      }
    }

    const createdTables = [{ name: first.name, fields: first.fields.length, records: 0, kanban: false }]

    for (const table of tables.slice(1)) {
      const result = await runJson(
        [
          'base', '+table-create',
          '--base-token', token,
          '--name', table.name,
          '--fields', JSON.stringify(table.fields),
          ...asArgs(),
        ],
        signal,
      )
      if (!result.ok) {
        warnings.push(`表「${table.name}」创建失败：${result.message}`)
        continue
      }
      createdTables.push({ name: table.name, fields: table.fields.length, records: 0, kanban: false })
    }

    for (const table of tables) {
      const entry = createdTables.find((row) => row.name === table.name)
      if (!entry) continue

      if (withKanban && table.kanbanField) {
        entry.kanban = await ensureKanban({
          token,
          tableName: table.name,
          fieldName: table.kanbanField,
          signal,
          warnings,
        })
      }

      const rowsToSeed = table === first && Array.isArray(options.importRecords) && options.importRecords.length > 0
        ? options.importRecords
        : (withSamples && Array.isArray(table.records) ? table.records : [])
      if (rowsToSeed.length > 0) {
        let written = 0
        for (let offset = 0; offset < rowsToSeed.length; offset += 50) {
          const batch = rowsToSeed.slice(offset, offset + 50)
          const seeded = await runJson(
            [
              'base', '+record-batch-create',
              '--base-token', token,
              '--table-id', table.name,
              '--json', JSON.stringify({ create_records: batch }),
              ...asArgs(),
            ],
            signal,
          )
          if (seeded.ok) written += batch.length
          else {
            warnings.push(`表「${table.name}」的${offset > 0 ? '部分' : ''}数据写入失败：${seeded.message}`)
            break
          }
        }
        entry.records = written
      }
    }

    if (!url) {
      const detail = await runJson(['base', '+base-get', '--base-token', token, ...asArgs()], signal)
      if (detail.ok) url = extractBase(detail.value).url
    }

    const brand = await resolveEffectiveBrand(signal)
    url = adaptUrlTextForBrand(url, brand)

    return {
      ok: true,
      baseName,
      url,
      token,
      tables: createdTables,
      warnings,
      tookMs: Date.now() - startedAt,
    }
  }

  // ---- First-run connection -------------------------------------------------
  // A new user has nothing. The only honest path is: install the CLI, let them
  // create an app in Feishu's browser flow, then authorize with a device link.
  // Each step returns something the panel can render as a single button.

  const INSTALL_COMMAND = 'npm i -g @larksuite/cli'

  /** `config show` prints JSON followed by a human line; take the JSON part. */
  function firstJsonObject(text) {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end <= start) return undefined
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      return undefined
    }
  }

  async function readConfig(signal) {
    const { stdout } = await invoke(['config', 'show'], signal)
    return firstJsonObject(stdout)
  }

  let appNameCache = { appId: '', name: '', at: 0, promise: null }
  const APP_NAME_RETRY_MS = 60000

  function extractAppName(payload) {
    if (!payload || typeof payload !== 'object') return ''
    const candidates = [
      payload.bot?.app_name,
      payload.bot?.appName,
      payload.data?.bot?.app_name,
      payload.data?.bot?.appName,
      payload.data?.app_name,
      payload.data?.appName,
      payload.app_name,
      payload.appName,
    ]
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) return c.trim()
    }
    return ''
  }

  async function resolveAppName(appId, signal, fallbackName) {
    if (!appId) return ''
    if (typeof fallbackName === 'string' && fallbackName.trim()) {
      const clean = fallbackName.trim()
      appNameCache = { appId, name: clean, at: Date.now(), promise: null }
      return clean
    }
    if (appNameCache.appId === appId) {
      if (appNameCache.name) return appNameCache.name
      if (appNameCache.promise) return await appNameCache.promise
      if (appNameCache.at > 0 && (Date.now() - appNameCache.at) < APP_NAME_RETRY_MS) return ''
    }
    const task = (async () => {
      try {
        const res = await runJson(['api', 'GET', '/open-apis/bot/v3/info', '--as', 'bot', '--json'], signal)
        const name = res.ok ? extractAppName(res.value) : ''
        appNameCache = { appId, name, at: Date.now(), promise: null }
        return name
      } catch {
        appNameCache = { appId, name: '', at: Date.now(), promise: null }
        return ''
      }
    })()
    appNameCache = { appId, name: '', at: appNameCache.at, promise: task }
    return await task
  }

  /** Where does this installation stand? Drives the panel's whole first screen. */
  async function connectStatus(signal) {
    let cliPath
    try {
      cliPath = await resolveCli(signal)
    } catch (error) {
      const { installerPath } = findBundledPackageInfo()
      return {
        stage: 'no-cli',
        cli: {
          available: false,
          canAutoInstall: Boolean(installerPath),
          bootstrap: getCliBootstrapState(),
          message: error instanceof Error ? error.message : String(error),
        },
        installCommand: INSTALL_COMMAND,
      }
    }

    const config = await readConfig(signal)
    if (!config || !config.appId) {
      return {
        stage: 'no-app',
        cli: { available: true, path: cliPath },
        installCommand: INSTALL_COMMAND,
      }
    }

    const [auth, appName] = await Promise.all([
      authStatus(signal),
      resolveAppName(config.appId, signal, config.appName || config.app_name),
    ])
    const effectiveBrand = configuredBrand || normalizeBrand(auth.brand) || normalizeBrand(config.brand) || 'feishu'
    if (normalizeBrand(auth.brand) || normalizeBrand(config.brand)) {
      detectedBrandCache = normalizeBrand(auth.brand) || normalizeBrand(config.brand)
    }
    const base = {
      cli: { available: true, path: cliPath },
      app: { appId: config.appId, ...(appName ? { appName } : {}), brand: effectiveBrand },
      installCommand: INSTALL_COMMAND,
    }
    return (auth.ready && auth.userReady) ? { stage: 'ready', ...base, auth } : { stage: 'no-auth', ...base, auth }
  }

  /** Step 1 for a brand-new user: create the Feishu/Lark app in a browser flow. */
  let appInit = null

  async function startAppInit(signal) {
    if (appInit && !appInit.done) {
      if (appInit.url) return { ok: true, url: appInit.url, pending: true }
    }
    const executable = await resolveCli(signal)
    const handle = ctx.subprocess.spawn({
      argv: [executable, 'config', 'init', '--new'],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: MAX_STDERR_BYTES },
        stderr: { maxBytes: MAX_STDERR_BYTES },
      },
      graceMs: 4000,
      env: childEnv(),
    })
    const record = { handle, url: undefined, done: false, exitCode: null, error: undefined, timer: undefined }
    appInit = record
    handle.done.then((outcome) => {
      record.done = true
      record.exitCode = outcome.exitCode
      if (outcome.exitCode !== 0) {
        const stderr = handle.collected?.stderr ? handle.collected.stderr.readFrom(0).text : (outcome?.stderr || '')
        const stdout = handle.collected?.stdout ? handle.collected.stdout.readFrom(0).text : (outcome?.stdout || '')
        record.error = tidyMessage(`${stderr}\n${stdout}`, `创建应用流程已结束（退出码 ${outcome.exitCode}）`)
      }
      if (record.timer) clearTimeout(record.timer)
    })
    // If the user walks away, do not leave a process waiting forever.
    record.timer = setTimeout(() => {
      if (!record.done) {
        record.abandoned = true
        record.handle.terminate()
      }
    }, APP_INIT_TIMEOUT_MS)
    record.timer?.unref?.()

    // The process blocks until the user finishes in the browser; the URL shows
    // up in its output within a second or two.
    for (let attempt = 0; attempt < 40 && !record.url; attempt += 1) {
      const read = handle.collected.stdout ? handle.collected.stdout.readFrom(0) : undefined
      const stderr = handle.collected.stderr ? handle.collected.stderr.readFrom(0) : undefined
      const text = `${read ? read.text : ''}\n${stderr ? stderr.text : ''}`
      const match = text.match(/https:\/\/[^\s"'<>]+/)
      if (match) record.url = match[0].replace(/[.,)]+$/, '')
      if (record.url) break
      if (record.done) break
      await sleep(250)
    }

    if (!record.url) {
      if (record.timer) clearTimeout(record.timer)
      if (!record.done) record.handle.terminate()
      appInit = null
      return {
        ok: false,
        message: '没能拿到创建应用的链接。可以手动在终端运行 lark-cli config init --new。',
      }
    }
    return { ok: true, url: record.url, pending: !record.done }
  }

  /**
   * The team path: one person creates the app, everyone else pastes its
   * App ID + Secret once. The secret travels over stdin, never argv, so it
   * does not appear in a process list.
   */
  async function bindApp(appId, appSecret, signal, requestedBrand) {
    const id = String(appId ?? '').trim()
    const secret = String(appSecret ?? '').trim()
    if (!/^cli_[A-Za-z0-9]+$/.test(id)) {
      return { ok: false, message: 'App ID 看着不对，应该是以 cli_ 开头的一串，例如 cli_a1b2c3d4e5f6g7h8。' }
    }
    if (secret.length < 8) {
      return { ok: false, message: 'App Secret 好像没复制完整，再看一眼。' }
    }

    const targetBrand = normalizeBrand(requestedBrand) || configuredBrand || 'feishu'
    const executable = await resolveCli(signal)
    const handle = ctx.subprocess.spawn({
      argv: [executable, 'config', 'init', '--app-id', id, '--app-secret-stdin', '--brand', targetBrand],
      cwd,
      stdio: {
        stdin: { data: `${secret}\n` },
        stdout: { maxBytes: MAX_STDERR_BYTES },
        stderr: { maxBytes: MAX_STDERR_BYTES },
      },
      graceMs: 4000,
      env: childEnv(),
      signal,
    })
    const outcome = await handle.done
    const stdout = handle.collected?.stdout ? handle.collected.stdout.readFrom(0).text : (outcome?.stdout || '')
    const stderr = handle.collected?.stderr ? handle.collected.stderr.readFrom(0).text : (outcome?.stderr || '')
    if (outcome.exitCode !== 0) {
      const detail = (stderr || stdout).replace(/\s+/g, ' ').trim().slice(0, 300)
      return {
        ok: false,
        message: detail || `配置没有保存成功（退出码 ${outcome.exitCode}）。`,
      }
    }
    const config = await readConfig(signal)
    if (!config || !config.appId) {
      return { ok: false, message: '保存之后没读到应用信息，再试一次。' }
    }
    return { ok: true, appId: config.appId }
  }

  async function pollAppInit() {
    const config = await readConfig(undefined).catch(() => null)
    const configured = Boolean(config && config.appId)
    if (!appInit) {
      return { ok: true, done: configured, configured, url: undefined }
    }
    return {
      ok: true,
      done: appInit.done || configured,
      configured,
      url: appInit.url,
      exitCode: appInit.exitCode,
      abandoned: Boolean(appInit.abandoned),
      ...(appInit.error ? { message: appInit.error } : {}),
    }
  }

  function resolveLoginDomains(rawDomain) {
    if (!rawDomain || typeof rawDomain !== 'string') return []
    const tokens = rawDomain.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    const out = []
    for (const tok of tokens) {
      if (KNOWN_AUTH_DOMAINS.has(tok)) {
        out.push(tok)
      } else if (Array.isArray(SKILL_DOMAIN_CANDIDATES[tok])) {
        for (const d of SKILL_DOMAIN_CANDIDATES[tok]) {
          if (KNOWN_AUTH_DOMAINS.has(d)) out.push(d)
        }
      }
    }
    return [...new Set(out)]
  }

  function sanitizeScopeArgs(rawScopes) {
    if (!Array.isArray(rawScopes)) return []
    return [...new Set(
      rawScopes
        .map((s) => String(s ?? '').trim())
        .filter((s) => /^[a-z0-9_.:-]+$/i.test(s) && s.includes(':')),
    )]
  }

  /** Step 2: device-flow authorization. Returns a link, then completes it. */
  async function startLogin(signal, domain, scopes) {
    const args = ['auth', 'login', '--no-wait', '--json']
    const validScopes = sanitizeScopeArgs(scopes)
    const validDomains = resolveLoginDomains(domain)
    if (validScopes.length > 0) {
      args.push('--scope', validScopes.join(','))
    } else if (validDomains.length > 0) {
      args.push('--domain', validDomains.join(','))
    } else {
      args.push('--recommend')
    }
    const result = await runJson(args, signal)
    if (!result.ok) return { ok: false, message: result.message }
    const value = result.value ?? {}
    const url = value.verification_url ?? value.verificationUrl
    const deviceCode = value.device_code ?? value.deviceCode
    if (!url || !deviceCode) {
      return { ok: false, message: '没能拿到授权链接，请稍后再试。' }
    }
    beginExchange(deviceCode)
    return { ok: true, url, deviceCode, expiresIn: value.expires_in ?? 600 }
  }

  /**
   * Exchange the authorized device code for a token — in the background.
   *
   * This must not be owned by the browser request. The user's authorization is
   * valid even if they close the panel, reload it, or the request times out;
   * tying the exchange to that request is exactly how you get "I clicked it and
   * it still says I didn't". The panel polls `exchangeState()` instead.
   */
  let exchange = null

  function beginExchange(deviceCode) {
    if (!deviceCode) return { ok: false, message: '授权码丢了，请重新发起授权。' }
    if (exchange && !exchange.done && exchange.code === deviceCode) {
      return { ok: true, started: false }
    }
    const record = { code: deviceCode, done: false, ok: false, message: undefined, startedAt: Date.now() }
    exchange = record
    runJson(['auth', 'login', '--device-code', deviceCode, '--json'])
      .then(async (result) => {
        const auth = await authStatus(undefined).catch(() => undefined)
        const partialGrantOk = !result.ok && result.exitCode === 3 && Boolean(auth && auth.userReady)
        if (result.ok || partialGrantOk) {
          record.ok = true
          record.auth = auth
          invalidateScopesCache()
        } else {
          record.ok = false
          record.message = result.message
        }
      })
      .catch((error) => {
        record.ok = false
        record.message = error instanceof Error ? error.message : String(error)
      })
      .finally(() => {
        record.done = true
      })
    return { ok: true, started: true }
  }

  function exchangeState() {
    if (!exchange) return { done: true, ok: false, idle: true }
    return {
      done: exchange.done,
      ok: exchange.ok,
      message: exchange.message,
      waitedMs: Date.now() - exchange.startedAt,
      auth: exchange.auth,
    }
  }

  async function finishLogin(deviceCode, signal) {
    const started = beginExchange(deviceCode)
    if (!started.ok) return started
    const deadline = Date.now() + 25000
    while (Date.now() < deadline && !exchange.done) await sleep(300)
    if (!exchange.done) {
      return { ok: false, pending: true, message: '还在等飞书确认。你可以在浏览器里再点一次，或者稍等片刻。' }
    }
    if (!exchange.ok) {
      return { ok: false, message: exchange.message ?? '授权没有完成。', hint: '先在浏览器里点「同意」，再回来。' }
    }
    invalidateScopesCache()
    return { ok: true, auth: await authStatus(signal) }
  }

  function clearConnectionCaches() {
    invalidateScopesCache()
    detectedBrandCache = ''
    appNameCache = { appId: '', name: '', at: 0, promise: null }
    appInit = null
    exchange = null
  }

  async function logout(signal) {
    clearConnectionCaches()
    await runJson(['auth', 'logout', '--json'], signal).catch(() => ({ ok: false }))
    const raw = await invoke(['config', 'remove'], signal)
    clearConnectionCaches()
    if (raw.exitCode === 0) return { ok: true }
    const combined = `${raw.stderr || ''}\n${raw.stdout || ''}`
    if (/not configured|no config|not found|未配置|不存在/i.test(combined)) {
      return { ok: true }
    }
    return { ok: false, message: tidyMessage(combined, '退出登录并解绑应用失败') }
  }

  async function unbindApp(signal) {
    clearConnectionCaches()
    await runJson(['auth', 'logout', '--json'], signal).catch(() => ({ ok: false }))
    const raw = await invoke(['config', 'remove'], signal)
    clearConnectionCaches()
    if (raw.exitCode === 0) return { ok: true }
    const combined = `${raw.stderr || ''}\n${raw.stdout || ''}`
    if (/not configured|no config|not found|未配置|不存在/i.test(combined)) {
      return { ok: true }
    }
    return { ok: false, message: tidyMessage(combined, '解绑应用失败') }
  }

  function collectScopeTokens(value, targetSet) {
    if (!value) return
    if (Array.isArray(value)) {
      for (const item of value) collectScopeTokens(item, targetSet)
      return
    }
    if (typeof value === 'string') {
      for (const tok of value.split(/[\s,]+/)) {
        const clean = tok.trim()
        if (clean && clean.includes(':')) targetSet.add(clean)
      }
      return
    }
    if (typeof value === 'object' && typeof value.name === 'string') {
      collectScopeTokens(value.name, targetSet)
    }
  }

  const CAPABILITY_DOMAIN_DEFS = [
    {
      id: 'base',
      name: '多维表格',
      nameEn: 'Base',
      desc: '数据表、字段、记录、视图、看板与仪表盘',
      icon: 'table',
      prefixes: ['base:', 'bitable:'],
      missingScopes: ['base:app:read', 'bitable:app'],
      requiredCategory: '多维表格',
    },
    {
      id: 'calendar',
      name: '日历日程',
      nameEn: 'Calendar',
      desc: '查看日程、预定会议、排查时间冲突',
      icon: 'calendar',
      prefixes: ['calendar:'],
      missingScopes: ['calendar:calendar:readonly', 'calendar:calendar'],
      requiredCategory: '日历',
    },
    {
      id: 'task',
      name: '任务待办',
      nameEn: 'Tasks',
      desc: '查看待办事项、更新状态、删除与指派责任人',
      icon: 'checkSquare',
      prefixes: ['task:'],
      missingScopes: ['task:task:read', 'task:task:write'],
      requiredCategory: '任务',
    },
    {
      id: 'im',
      name: '消息群聊',
      nameEn: 'Chats',
      desc: '检索群聊、收发消息、卡片协同与置顶',
      icon: 'people',
      prefixes: ['im:'],
      missingScopes: ['im:chat:read', 'im:message:send_as_bot'],
      requiredCategory: '消息与群聊',
    },
    {
      id: 'mail',
      name: '飞书邮箱',
      nameEn: 'Mail',
      desc: '查阅未读邮件、搜索往来邮件、发送与回复',
      icon: 'mail',
      prefixes: ['mail:'],
      missingScopes: ['mail:user_mailbox.messages:readonly'],
      requiredCategory: '邮箱',
    },
    {
      id: 'contact',
      name: '通讯录',
      nameEn: 'Contacts',
      desc: '查询同事部门、工号、邮箱与机器人列表',
      icon: 'user',
      prefixes: ['contact:'],
      missingScopes: ['contact:user.base:readonly'],
      requiredCategory: '通讯录',
    },
    {
      id: 'approval',
      name: '审批流程',
      nameEn: 'Approvals',
      desc: '查询待审批任务、发起与处理审批流程',
      icon: 'shieldCheck',
      prefixes: ['approval:'],
      missingScopes: ['approval:task:read', 'approval:approval:readonly'],
      requiredCategory: '审批',
    },
    {
      id: 'docs',
      name: '云文档',
      nameEn: 'Docs',
      desc: '读取、创建、编辑云文档内容与搜索文档',
      icon: 'fileText',
      prefixes: ['docx:', 'docs:', 'search:docs'],
      missingScopes: ['docx:document:readonly', 'search:docs:read'],
      requiredCategory: '云文档',
    },
    {
      id: 'drive',
      name: '飞书云盘',
      nameEn: 'Drive',
      desc: '管理云盘文件与目录、上传下载与权限',
      icon: 'layout',
      prefixes: ['drive:', 'space:document'],
      missingScopes: ['drive:drive.metadata:readonly', 'drive:file:upload'],
      requiredCategory: '云盘',
    },
    {
      id: 'wiki',
      name: '知识库',
      nameEn: 'Wiki',
      desc: '浏览知识空间、维护文档节点与成员',
      icon: 'book',
      prefixes: ['wiki:'],
      missingScopes: ['wiki:space:read', 'wiki:node:read'],
      requiredCategory: '知识库',
    },
    {
      id: 'sheets',
      name: '电子表格',
      nameEn: 'Sheets',
      desc: '读写工作表单元格、公式、图表与筛选',
      icon: 'chart',
      prefixes: ['sheets:'],
      missingScopes: ['sheets:spreadsheet:read'],
      requiredCategory: '电子表格',
    },
    {
      id: 'slides',
      name: '幻灯片',
      nameEn: 'Slides',
      desc: '创建与读取飞书演示文稿及页面内容',
      icon: 'layout',
      prefixes: ['slides:'],
      missingScopes: ['slides:presentation:read'],
      requiredCategory: '幻灯片',
    },
    {
      id: 'markdown',
      name: 'Markdown',
      nameEn: 'Markdown',
      desc: '读写、创建、比较云端原生 Markdown 文件',
      icon: 'fileText',
      prefixes: ['docs:', 'docx:', 'drive:'],
      missingScopes: ['drive:drive.metadata:readonly', 'docs:document.content:read'],
      requiredCategory: '云文档 / 云盘',
    },
    {
      id: 'mindnotes',
      name: '思维笔记',
      nameEn: 'Mindnotes',
      desc: '列出并创建思维笔记节点内容',
      icon: 'spark',
      prefixes: ['mindnote:'],
      missingScopes: ['mindnote:node:read'],
      requiredCategory: '思维笔记',
    },
    {
      id: 'whiteboard',
      name: '文档画板',
      nameEn: 'Whiteboard',
      desc: '导出画板图片与节点结构、更新画板内容',
      icon: 'image',
      prefixes: ['board:', 'whiteboard:'],
      missingScopes: ['board:whiteboard:node:read'],
      requiredCategory: '画板',
    },
    {
      id: 'vc',
      name: '视频会议',
      nameEn: 'Meetings',
      desc: '查询视频会议记录、实时会议与会中聊天',
      icon: 'people',
      prefixes: ['vc:'],
      missingScopes: ['vc:meeting.search:read', 'vc:record:readonly'],
      requiredCategory: '视频会议',
    },
    {
      id: 'minutes',
      name: '会议妙记',
      nameEn: 'Minutes',
      desc: '搜索、读取与管理会议妙记和逐字稿',
      icon: 'fileText',
      prefixes: ['minutes:'],
      missingScopes: ['minutes:minutes.basic:read'],
      requiredCategory: '妙记',
    },
    {
      id: 'note',
      name: '会议笔记',
      nameEn: 'Meeting Notes',
      desc: '读取会议纪要详情与统一逐字稿记录',
      icon: 'fileText',
      prefixes: ['vc:note', 'minutes:'],
      missingScopes: ['vc:note:read', 'minutes:minutes.basic:read'],
      requiredCategory: '会议纪要',
    },
    {
      id: 'okr',
      name: '飞书 OKR',
      nameEn: 'OKR',
      desc: '查看周期目标、关键结果、对齐与进展',
      icon: 'chart',
      prefixes: ['okr:'],
      missingScopes: ['okr:okr.period:readonly', 'okr:okr.content:readonly'],
      requiredCategory: 'OKR',
    },
    {
      id: 'attendance',
      name: '考勤打卡',
      nameEn: 'Attendance',
      desc: '查询个人考勤打卡任务与出勤记录',
      icon: 'check',
      prefixes: ['attendance:'],
      missingScopes: ['attendance:task:readonly'],
      requiredCategory: '考勤',
    },
    {
      id: 'apps',
      name: '妙搭应用',
      nameEn: 'Miaoda Apps',
      desc: '创建、开发、部署与管理妙搭应用服务',
      icon: 'spark',
      prefixes: ['spark:'],
      missingScopes: ['spark:app:read', 'spark:app:write'],
      requiredCategory: '妙搭应用',
    },
    {
      id: 'event',
      name: '实时事件',
      nameEn: 'Live Events',
      desc: '订阅并消费消息、审批、任务与会议事件',
      icon: 'refresh',
      prefixes: ['event:', 'im:message', 'approval:task', 'task:task'],
      missingScopes: ['im:message:readonly', 'approval:task:read'],
      requiredCategory: '事件订阅',
    },
    {
      id: 'application',
      name: '应用管理',
      nameEn: 'App Admin',
      desc: '应用基本信息与机器人斜杠指令自管理',
      icon: 'shieldCheck',
      prefixes: ['application:'],
      missingScopes: ['application:bot.basic_info:read'],
      requiredCategory: '应用管理',
    },
  ]

  const SCOPES_CACHE_TTL_MS = 15000
  let scopesCache = { at: 0, promise: null, data: null }

  function invalidateScopesCache() {
    scopesCache = { at: 0, promise: null, data: null }
  }

  async function getScopes(signal, options = {}) {
    const force = Boolean(options && options.force)
    if (force) {
      invalidateScopesCache()
    } else {
      if (scopesCache.data && (Date.now() - scopesCache.at) < SCOPES_CACHE_TTL_MS) {
        return scopesCache.data
      }
      if (scopesCache.promise) {
        return await scopesCache.promise
      }
    }

    const fetchTask = (async () => {
      const [statusRes, conf] = await Promise.all([
        runJson(['auth', 'status', '--json'], signal).catch(() => ({ ok: false })),
        readConfig(signal).catch(() => ({})),
      ])
      const statusVal = statusRes.ok && statusRes.value && typeof statusRes.value === 'object' ? statusRes.value : null
      const userIdentity = statusVal?.identities?.user
      const hasExplicitUserState = Boolean(
        (userIdentity && typeof userIdentity.available === 'boolean')
        || typeof statusVal?.userReady === 'boolean',
      )
      const userReady = userIdentity && typeof userIdentity.available === 'boolean'
        ? Boolean(userIdentity.available)
        : typeof statusVal?.userReady === 'boolean'
          ? Boolean(statusVal.userReady)
          : null

      const userTokenScopes = new Set()
      if (userIdentity && userReady !== false) {
        collectScopeTokens(userIdentity.scope, userTokenScopes)
        collectScopeTokens(userIdentity.scopes, userTokenScopes)
      }

      const appIdFromStatus = (statusVal && (statusVal.appId || statusVal.app_id)) || ''
      const hasApp = Boolean(conf?.appId || appIdFromStatus)
      const notConfiguredErr = statusRes.error?.subtype === 'not_configured'

      let raw = { ok: false }
      if (userReady !== false && userTokenScopes.size === 0 && !notConfiguredErr && (hasApp || !hasExplicitUserState)) {
        raw = await runJson(['auth', 'scopes', '--json'], signal).catch(() => ({ ok: false }))
      }

      const appId = conf?.appId
        || appIdFromStatus
        || (raw.ok && (raw.value?.appId || raw.value?.app_id))
        || ''

      const userScopes = new Set()
      if (userReady !== false) {
        if (userTokenScopes.size > 0) {
          for (const s of userTokenScopes) userScopes.add(s)
        } else if (raw.ok && raw.value) {
          collectScopeTokens(raw.value.user_scopes, userScopes)
          collectScopeTokens(raw.value.userScopes, userScopes)
          collectScopeTokens(raw.value.scopes, userScopes)
          collectScopeTokens(raw.value.data?.user_scopes, userScopes)
          collectScopeTokens(raw.value.data?.scopes, userScopes)
        }
      }
      const count = userScopes.size

      const hasAny = (prefixes) => prefixes.some((p) => {
        for (const s of userScopes) if (s.startsWith(p)) return true
        return false
      })

      const domains = {}
      const domainOrder = []
      for (const def of CAPABILITY_DOMAIN_DEFS) {
        domainOrder.push(def.id)
        const matchedCount = Array.from(userScopes).filter((s) => def.prefixes.some((p) => s.startsWith(p))).length
        domains[def.id] = {
          id: def.id,
          name: def.name,
          nameEn: def.nameEn,
          desc: def.desc,
          icon: def.icon,
          ready: hasAny(def.prefixes),
          count: matchedCount,
          missingScopes: def.missingScopes,
          requiredCategory: def.requiredCategory,
        }
      }

      const cfg = conf && typeof conf === 'object' ? conf : await readConfig(signal).catch(() => null)
      const brand = await resolveEffectiveBrand(signal, cfg)
      const effectiveUserReady = userReady !== null ? userReady : Boolean(count > 0)
      const scopesVerified = Boolean(statusRes.ok || raw.ok)
      const result = {
        ok: true,
        scopesVerified,
        userReady: effectiveUserReady,
        ...(!scopesVerified && (statusRes.message || raw.message) ? { scopesError: statusRes.message || raw.message } : {}),
        appId,
        brand,
        totalGranted: count,
        consoleUrl: consoleUrlFor(brand, appId),
        domainOrder,
        domains,
      }
      if (scopesVerified) {
        scopesCache = { at: Date.now(), promise: null, data: result }
      } else {
        scopesCache = { at: 0, promise: null, data: null }
      }
      return result
    })()

    scopesCache = { at: scopesCache.at, promise: fetchTask, data: scopesCache.data }
    try {
      return await fetchTask
    } catch (err) {
      scopesCache = { at: 0, promise: null, data: null }
      throw err
    }
  }

  function escapeControlCharsInsideJsonStrings(raw) {
    let out = ''
    let inString = false
    let escaped = false
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i]
      if (escaped) {
        out += ch
        escaped = false
        continue
      }
      if (ch === '\\') {
        out += ch
        if (inString) escaped = true
        continue
      }
      if (ch === '"') {
        inString = !inString
        out += ch
        continue
      }
      if (inString) {
        if (ch === '\n') { out += '\\n'; continue }
        if (ch === '\r') { out += '\\r'; continue }
        if (ch === '\t') { out += '\\t'; continue }
      }
      out += ch
    }
    return out
  }

  function extractLooseAgentFields(raw) {
    const actionMatch = raw.match(/"action"\s*:\s*"([^"]+)"/)
    if (!actionMatch) return undefined
    const res = { action: actionMatch[1] }
    const skillMatch = raw.match(/"skill"\s*:\s*"([^"]+)"/)
    if (skillMatch) res.skill = skillMatch[1]
    const queryMatch = raw.match(/"query"\s*:\s*"([^"]*)"/)
    if (queryMatch) res.query = queryMatch[1]
    const replyMatch = raw.match(/"reply"\s*:\s*"([\s\S]*)"\s*\}?\s*$/)
    if (replyMatch) {
      res.reply = replyMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
    }
    return res
  }

  function parseModelJson(raw) {
    const text = typeof raw === 'string' ? raw : (raw?.text || raw?.content || '')
    if (!text || !text.trim()) return undefined
    const trimmed = text.trim()
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
    const target = fenced ? fenced[1].trim() : trimmed
    try {
      return JSON.parse(target)
    } catch {}
    const parsedDirect = firstJsonObject(target)
    if (parsedDirect) return parsedDirect
    const repaired = escapeControlCharsInsideJsonStrings(target)
    try {
      return JSON.parse(repaired)
    } catch {}
    const parsedRepaired = firstJsonObject(repaired)
    if (parsedRepaired) return parsedRepaired
    return extractLooseAgentFields(target)
  }

  function resolveModelSelection(provider, model) {
    let p = provider || config.provider
    let m = model || config.model
    if (!p || !m) {
      try {
        const sel = ctx.agentDefaultModel?.currentSelection?.()
        if (sel) {
          p = p || sel.provider || sel.providerId
          m = m || sel.model || sel.modelId
        }
      } catch {}
    }
    return {
      provider: p || 'deepseek-account',
      model: m || 'deepseek-flash',
    }
  }

  async function callLlm({ system, messages = [], model, provider, temperature = 0.3, onDelta }, signal) {
    if (!ctx.llm?.stream) return null
    try {
      const { provider: p, model: m } = resolveModelSelection(provider, model)

      const assistantSource = { kind: 'model', provider: p, model: m }
      const formattedMessages = messages.map((msg) => {
        const isAssistant = msg.role === 'assistant' || msg.role === 'model'
        if (Array.isArray(msg.content) && msg.content.length > 0) {
          return {
            role: isAssistant ? 'assistant' : 'user',
            ...(isAssistant ? { source: assistantSource } : {}),
            content: msg.content,
          }
        }
        const rawText = typeof msg.content === 'string'
          ? msg.content
          : (Array.isArray(msg.content) ? msg.content.map((c) => c?.text || '').join('') : (msg.text || ''))
        return {
          role: isAssistant ? 'assistant' : 'user',
          ...(isAssistant ? { source: assistantSource } : {}),
          content: [{ type: 'text', text: String(rawText || '') }],
        }
      })

      const stream = ctx.llm.stream({
        provider: p,
        model: m,
        system: system || 'You are a capable Feishu/Lark assistant. Respond concisely and clearly in the same language as the user (using Markdown lists or tables when helpful).',
        messages: formattedMessages,
        temperature,
        signal,
      })

      let contentText = ''
      let reasoningText = ''
      for await (const chunk of stream) {
        if (typeof chunk === 'string') {
          contentText += chunk
          onDelta?.({ type: 'text', delta: chunk })
        } else if (chunk?.type === 'reasoning-delta' || chunk?.type === 'thinking_delta') {
          const delta = chunk.text || chunk.thinking || ''
          reasoningText += delta
          onDelta?.({ type: 'reasoning', delta })
        } else if (chunk?.type === 'text-delta') {
          const delta = chunk.text || ''
          contentText += delta
          onDelta?.({ type: 'text', delta })
        } else if (chunk?.type === 'text') {
          const delta = chunk.text || ''
          contentText += delta
          onDelta?.({ type: 'text', delta })
        } else if (chunk?.text && !chunk?.type) {
          const delta = chunk.text
          contentText += delta
          onDelta?.({ type: 'text', delta })
        }
      }

      // Check for inline <think>...</think> in contentText as well
      const thinkMatch = contentText.match(/<think>([\s\S]*?)<\/think>/i)
      if (thinkMatch) {
        reasoningText = (reasoningText ? reasoningText + '\n' : '') + thinkMatch[1].trim()
        contentText = contentText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
      }

      const resText = contentText.trim()
      const resReasoning = reasoningText.trim()
      if (!resText && !resReasoning) return null
      return {
        text: resText,
        reasoning: resReasoning || null,
        toString() { return resText },
      }
    } catch (err) {
      console.warn('[dsh-lark] callLlm fallback error:', err?.message || err)
      return null
    }
  }

  // ---- Live Official Skills Catalog & CLI Introspection -------------------
  const introspect = createCliIntrospector({
    invoke,
    runJson,
    getCliPath: (signal) => resolveCli(signal).catch(() => null),
  })
  let skillsCatalogCache = { cliPath: null, items: null }

  function invalidateOfficialSkillsCache() {
    skillsCatalogCache = { cliPath: null, items: null }
    introspect.clearCaches()
  }

  /**
   * Read the live skill catalog shipped inside the active `lark-cli` binary so
   * Workbench AI automatically inherits every domain added when `@larksuite/cli`
   * or `@deepseek-ai/dsh-feishu` updates.
   */
  async function readOfficialSkillsCatalog(signal) {
    const cliPath = await resolveCli(signal).catch(() => null)
    if (!cliPath) return []
    if (skillsCatalogCache.cliPath === cliPath && Array.isArray(skillsCatalogCache.items)) {
      return skillsCatalogCache.items
    }
    const res = await runJson(['skills', 'list'], signal).catch(() => null)
    const rawList = res?.ok ? (res.value?.skills || res.value?.data?.skills || res.value?.items) : null
    if (!Array.isArray(rawList)) return []
    const normalized = rawList
      .filter((s) => s && typeof s.name === 'string' && /^[a-z0-9-]+$/.test(s.name))
      .map((s) => ({
        name: s.name,
        description: String(s.description || '').replace(/\s+/g, ' ').trim(),
        cliHelp: String(s.metadata?.cliHelp || '').trim(),
      }))
    skillsCatalogCache = { cliPath, items: normalized }
    return normalized
  }

  async function readOfficialSkillGuide(skillName, signal) {
    return await introspect.readSkillDoc(skillName, '', signal)
  }

  const OFFICIAL_SKILL_LABELS = {
    'lark-approval': { zh: '飞书审批', en: 'Feishu Approvals' },
    'lark-apps': { zh: '妙搭应用', en: 'Feishu Apps' },
    'lark-attendance': { zh: '考勤打卡', en: 'Attendance' },
    'lark-base': { zh: '飞书多维表格', en: 'Feishu Base' },
    'lark-calendar': { zh: '飞书日历', en: 'Feishu Calendar' },
    'lark-contact': { zh: '企业通讯录', en: 'Contacts' },
    'lark-doc': { zh: '飞书云文档', en: 'Feishu Docs' },
    'lark-drive': { zh: '飞书云盘', en: 'Feishu Drive' },
    'lark-event': { zh: '实时事件', en: 'Live Events' },
    'lark-im': { zh: '即时消息与群聊', en: 'Chats & Messages' },
    'lark-mail': { zh: '飞书邮箱', en: 'Feishu Mail' },
    'lark-markdown': { zh: '飞书文档', en: 'Feishu Docs' },
    'lark-meeting': { zh: '飞书视频会议', en: 'Feishu Meetings' },
    'lark-note': { zh: '会议纪要', en: 'Meeting Notes' },
    'lark-okr': { zh: '飞书 OKR', en: 'Feishu OKR' },
    'lark-openapi-explorer': { zh: '开放平台接口', en: 'Open Platform API' },
    'lark-shared': { zh: '飞书账号与权限', en: 'Account & Scopes' },
    'lark-sheets': { zh: '飞书电子表格', en: 'Feishu Sheets' },
    'lark-skill-maker': { zh: '技能工具', en: 'Skill Maker' },
    'lark-slides': { zh: '飞书幻灯片', en: 'Feishu Slides' },
    'lark-task': { zh: '飞书任务与待办', en: 'Feishu Tasks' },
    'lark-whiteboard': { zh: '文档画板', en: 'Whiteboard' },
    'lark-wiki': { zh: '飞书知识库', en: 'Feishu Wiki' },
    'lark-workflow-meeting-summary': { zh: '会议纪要汇总', en: 'Meeting Summary' },
    'lark-workflow-standup-report': { zh: '日程待办摘要', en: 'Standup Digest' },
  }

  function skillLabel(skillName, lang = 'zh', fallbackZh = '飞书扩展能力', fallbackEn = 'Feishu Feature') {
    const entry = OFFICIAL_SKILL_LABELS[skillName]
    if (entry) return lang === 'en' ? entry.en : entry.zh
    return lang === 'en' ? fallbackEn : fallbackZh
  }

  function isWellFormedSkillArgv(argv) {
    if (!Array.isArray(argv) || argv.length === 0) return false
    if (!argv.every((tok) => typeof tok === 'string' && tok.length > 0 && !/[\r\n\0]/.test(tok))) return false
    const domain = argv[0].toLowerCase()
    if (/^(config|auth|update|upgrade)$/.test(domain)) return false
    return /^[a-z0-9_-]+$/i.test(domain)
  }

  function createPlainReplyForwarder(onDelta) {
    if (typeof onDelta !== 'function') return undefined
    return (evt) => {
      if (!evt) return
      if (evt.type === 'text') {
        if (evt.delta) onDelta({ type: 'reply_delta', delta: evt.delta })
      } else {
        onDelta(evt)
      }
    }
  }

  function humanizeCliError(rawMessage, isEn = false) {
    const raw = String(rawMessage || '').trim()
    if (!raw) return isEn ? 'Unknown error' : '未知错误'
    if (/user access token not support/i.test(raw)) {
      return isEn
        ? `Feishu does not support personal user-token calls for this endpoint (${raw}).`
        : `飞书平台暂不支持以个人用户身份调用该接口（${raw}）。`
    }
    if (/resolved identity "bot"|tenant_access_token.*not support|bot.*not supported/i.test(raw)) {
      return isEn
        ? 'This Feishu action requires a signed-in personal user account. Please sign in and retry.'
        : '该飞书操作需要个人账号授权身份，请先在右上角完成飞书登录。'
    }
    if (/not_configured|not configured/i.test(raw)) {
      return isEn
        ? 'Feishu app or login is not configured yet. Complete setup in the top-right badge.'
        : '尚未完成飞书应用或账号连接，请先在右上角完成授权配置。'
    }
    if (/required flag|missing required (?:path |query )?parameter/i.test(raw)) {
      return isEn
        ? `Missing required parameter (${raw}). Try adding more details in your request.`
        : `缺少必要参数（${raw}），请补充具体对象或先查询定位目标后重试。`
    }
    if (/confirmation_required|requires confirmation/i.test(raw)) {
      return isEn
        ? `This high-risk action requires explicit confirmation (${raw}).`
        : `该高风险操作需要明确确认后才能执行（${raw}）。`
    }
    if (/needs_refresh|token.*expired|expired.*token|invalid.*access_token/i.test(raw)) {
      return isEn
        ? 'Your Feishu authorization expired. Please re-authorize in the connection modal (enable "Refresh user_access_token" in Feishu Console to avoid 2-hour expiry).'
        : '飞书登录凭据已过期，请重新授权登录（若每 2 小时频繁过期，请在飞书开放平台应用安全设置中开启「刷新 user_access_token」）。'
    }
    return raw
  }

  function extractConfirmFlagFromError(cliResult) {
    if (!cliResult || cliResult.ok) return null
    const subtype = cliResult.error?.subtype || ''
    const hint = String(cliResult.error?.hint || '')
    const msg = String(cliResult.message || '')
    const isConfirmErr = cliResult.exitCode === 10
      || subtype === 'confirmation_required'
      || /requires confirmation|add --yes|--confirm-send/i.test(`${msg} ${hint}`)
    if (!isConfirmErr) return null
    const match = hint.match(/--[a-z0-9-]+/i)
    return match ? match[0] : '--yes'
  }

  function isMissingScopeResult(cliResult) {
    if (!cliResult || cliResult.ok) return false
    return cliResult.error?.subtype === 'missing_scope'
      || /missing required scope/i.test(cliResult.message || '')
  }

  function buildSkillScopeError(skillName, cliResult, activeLang, isEn, scopesInfo, brand) {
    const appId = scopesInfo?.appId || ''
    const resolvedBrand = scopesInfo?.brand || brand || 'feishu'
    const consoleUrl = scopesInfo?.consoleUrl || consoleUrlFor(resolvedBrand, appId)
    const domainTitle = skillLabel(skillName, activeLang)
    return {
      ok: false,
      type: 'missing_scope',
      domain: skillName,
      domainTitle,
      requiredScopes: cliResult?.error?.missing_scopes || [],
      categoryName: skillLabel(skillName, activeLang, '飞书服务', 'Feishu Service'),
      consoleUrl,
      reply: isEn
        ? `Authorization for "${domainTitle}" is required to continue. Click "Authorize & continue" below.`
        : `需要授权访问「${domainTitle}」以继续处理，请点击下方「立即授权并继续」。`,
      summary: isEn ? `Permission required: ${domainTitle}` : `需要「${domainTitle}」访问授权`,
    }
  }

  let collabRunner = null
  function ensureCollabRunner() {
    if (collabRunner) return collabRunner
    collabRunner = createCollabRunner({
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
      async suggestCreateTable(goalTitle) {
        return { _suggestTableTitle: goalTitle }
      },
    })
    return collabRunner
  }

  async function dispatchCollab({ instruction, history = [], model, provider, lang, attachmentContext, imageBlocks = [], confirmSkill = false, skillSteps, skillName: confirmedSkillName, onDelta }, signal) {
    const rawText = (instruction || '').trim()
    const activeLang = resolveLang(lang, rawText)
    const isEn = activeLang === 'en'
    const runner = ensureCollabRunner()

    if (confirmSkill === true && Array.isArray(skillSteps) && skillSteps.length > 0) {
      const sName = String(confirmedSkillName || 'feishu').trim() || 'feishu'
      const label = skillLabel(sName, activeLang, sName, sName)
      return await runner.executeConfirmedSteps(
        sName,
        skillSteps,
        rawText || label,
        { model, provider, activeLang, isEn, onDelta },
        signal,
      )
    }

    const attachPrompt = attachmentContext?.promptBlock || ''
    const hasAttachments = Boolean(attachPrompt) || imageBlocks.length > 0
    const text = rawText || (hasAttachments
      ? (isEn
          ? 'Please read the attached file(s), summarize the key points clearly, and suggest next actions (such as turning it into a Feishu Base, creating tasks, or drafting a message).'
          : '请阅读我上传的文件，先用清晰简洁的语言提炼重点内容，并告诉我可以帮你做哪些后续处理（例如整理成飞书多维表格、创建待办或起草消息/邮件）。')
      : '')

    const loopResult = await runner.runCollab({
      instruction: text,
      history,
      model,
      provider,
      activeLang,
      isEn,
      attachmentContext,
      imageBlocks,
      onDelta,
    }, signal)

    if (loopResult && loopResult._suggestTableTitle !== undefined) {
      const goalText = loopResult._suggestTableTitle || text
      const formattedHistory = history
        .filter((h) => h && h.text)
        .map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', text: h.text }))
      let planFailureMsg = ''
      if (planner && typeof planner.plan === 'function') {
        onDelta?.({ type: 'stage', stage: 'planning_table' })
        try {
          const planned = await planner.plan(goalText, signal, undefined, {
            model,
            provider,
            lang: activeLang,
            history: formattedHistory,
            forceTable: true,
            attachmentContext,
            imageBlocks,
            onDelta,
          })
          if (planned && planned.ok && planned.plan) {
            const primarySource = attachmentContext?.tableAttachments?.[0]
            return {
              ok: true,
              type: 'table_plan',
              plan: planned.plan,
              ...(primarySource ? { sourceAttachment: { id: primarySource.id, name: primarySource.name, totalRows: primarySource.totalRows } } : {}),
              sentence: goalText,
              reply: isEn
                ? `Drafted "${planned.plan.baseName}". Review the fields in the preview screen and click Create Base.`
                : `已为您规划好「${planned.plan.baseName}」！请在预览界面确认字段并一键建表。`,
              summary: isEn ? `Planned "${planned.plan.baseName}"` : `已规划「${planned.plan.baseName}」`,
            }
          }
          if (planned && planned.message) {
            planFailureMsg = planned.message
          }
        } catch (e) {
          planFailureMsg = e?.message || String(e)
          console.warn('[dsh-lark] planner.plan error:', planFailureMsg)
        }
      }
      return {
        ok: true,
        type: 'suggest_table',
        reply: planFailureMsg
          ? (isEn
              ? `Could not finish the table blueprint yet: ${planFailureMsg}`
              : `尝试生成表结构时未完成：${planFailureMsg}`)
          : (isEn
              ? 'Looks like you want to create a Base. Tell me what columns or workflow you want to track and I will design it for you.'
              : '检测到您想创建多维表格。请告诉我需要包含什么字段或业务场景，我直接为您规划生成！'),
        summary: isEn ? 'Suggest creating a Base' : '建议前往多维表格模式',
      }
    }

    return loopResult
  }

  /**
   * Read a small slice of a Base so the panel can show the real table instead
   * of a mock. Read-only and bounded — never used for analysis.
   */
  async function peek(token, table, limit, signal) {
    if (!token) return { ok: false, message: '缺少表格标识，回飞书里打开看看。' }
    const size = Math.min(Math.max(Number(limit) || 6, 1), 50)

    // `record-list` needs a table. Entries saved before the panel kept one
    // would otherwise fail on a raw "required flag(s)" error, so resolve the
    // Base's first table when the caller only has the token.
    let tableArg = table ? String(table) : ''
    if (!tableArg) {
      const listed = await runJson(
        ['base', '+table-list', '--base-token', String(token), '--format', 'json', ...asArgs()],
        signal,
      )
      if (!listed.ok) return { ok: false, message: listed.message }
      tableArg = extractTableId(listed.value) || ''
      if (!tableArg) return { ok: false, message: '这张表还没定位到，回飞书里打开看看。' }
    }

    const result = await runJson(
      [
        'base', '+record-list',
        '--base-token', String(token),
        '--table-id', tableArg,
        '--format', 'json',
        '--limit', String(size),
        ...asArgs(),
      ],
      signal,
    )
    if (!result.ok) return { ok: false, message: result.message }
    const data = (result.value && result.value.data) || {}
    const names = Array.isArray(data.fields) ? data.fields : []
    const types = Array.isArray(data.field_type_list) ? data.field_type_list : []
    const rows = Array.isArray(data.data) ? data.data : []
    return {
      ok: true,
      table: tableArg,
      fields: names.map((name, index) => ({ name, type: types[index] ?? 'text' })),
      rows,
      ids: Array.isArray(data.record_id_list) ? data.record_id_list : [],
      more: data.has_more === true,
    }
  }

  // ---- Adjusting a Base ----------------------------------------------------
  // Creation is one shot; real use is iterative ("再加一列"、"状态改成…").
  // Every change is a small ordered operation, so one failure still leaves the
  // table usable and the reply can name exactly what did not apply.

  const ADJUST_MAX_OPS = 20

  const ADJUST_OPS = new Set([
    'add_field', 'rename_field', 'add_options', 'remove_options', 'delete_field',
    'add_view', 'rename_view', 'delete_view',
    'add_records', 'update_records', 'delete_records',
    'rename_table', 'add_table', 'describe',
    'enable_adv_perm', 'disable_adv_perm', 'create_role', 'update_role', 'delete_role',
    'set_field_ai_extension', 'trigger_field_ai',
    'set_view_visible_fields',
    'add_dashboard', 'add_form',
  ])

  const VIEW_TYPES = new Set(['grid', 'kanban', 'gallery', 'calendar', 'gantt'])

  const VIEW_TYPE_NAMES = {
    grid: '表格视图',
    kanban: '看板视图',
    gallery: '画册视图',
    calendar: '日历视图',
    gantt: '甘特视图',
  }

  function cleanText(value, limit = 60) {
    if (typeof value !== 'string') return ''
    return value.trim().replace(/\s+/g, ' ').slice(0, limit)
  }

  function cleanNames(value) {
    return (Array.isArray(value) ? value : [])
      .map((entry) => cleanText(typeof entry === 'string' ? entry : entry && entry.name, 30))
      .filter(Boolean)
  }

  /** "改张三那条" — a field/value pair a person would say out loud. */
  function normalizeWhere(raw, where) {
    const conditions = []
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue
        const field = cleanText(entry.field ?? entry.column, 40)
        if (!field) continue
        conditions.push({ field, value: entry.value, op: cleanText(entry.op, 20) || '==' })
      }
    } else if (raw && typeof raw === 'object') {
      for (const [field, value] of Object.entries(raw)) {
        const name = cleanText(field, 40)
        if (name) conditions.push({ field: name, value, op: '==' })
      }
    }
    if (conditions.length === 0) throw new Error(`${where}的筛选条件不完整。`)
    return conditions
  }

  function normalizeFieldDef(raw, where) {
    if (!raw || typeof raw !== 'object') throw new Error(`${where}里的列定义不完整。`)
    const name = cleanText(raw.name, 40)
    const type = cleanText(raw.type, 20)
    if (!name || !type) throw new Error(`${where}里的列需要 name 和 type。`)
    const field = { ...raw, name, type }
    if (type === 'select') {
      const options = [...new Set(cleanNames(raw.options))]
      if (options.length === 0) throw new Error(`单选列「${name}」至少要有一个选项。`)
      field.options = options.map((option) => ({ name: option }))
      field.multiple = raw.multiple === true
    } else {
      delete field.options
    }
    if (type === 'formula') {
      const expr = cleanText(raw.expression || raw.formula_expression || '', 300)
      if (expr) field.expression = expr
    }
    if (type === 'link') {
      if (raw.link_table) field.link_table = cleanText(raw.link_table, 60)
      if (raw.bidirectional != null) field.bidirectional = Boolean(raw.bidirectional)
      if (raw.bidirectional_link_field_name) field.bidirectional_link_field_name = cleanText(raw.bidirectional_link_field_name, 60)
    }
    if (type === 'lookup') {
      if (raw.from) field.from = cleanText(raw.from, 60)
      if (raw.select) field.select = cleanText(raw.select, 60)
      if (raw.where) field.where = cleanText(raw.where, 60)
      if (raw.aggregate) field.aggregate = cleanText(raw.aggregate, 40)
    }
    if (type === 'user' || type === 'group_chat') {
      if (raw.multiple != null) field.multiple = Boolean(raw.multiple)
    }
    return field
  }

  /** Model output is untrusted: keep only the documented operation shapes. */
  function normalizeOps(raw, defaultTable) {
    const list = Array.isArray(raw) ? raw : []
    if (list.length === 0) throw new Error('没有可执行的修改。')
    if (list.length > ADJUST_MAX_OPS) throw new Error(`一次最多改 ${ADJUST_MAX_OPS} 件事，分几次来吧。`)

    const ops = []
    list.forEach((entry, index) => {
      const where = `第 ${index + 1} 条改动`
      if (!entry || typeof entry !== 'object') throw new Error(`${where}格式不对。`)
      const name = cleanText(entry.op, 40)
      if (!ADJUST_OPS.has(name)) throw new Error(`${where}用了不支持的改动「${name || '空'}」。`)

      const op = { op: name }
      const needsTable = name !== 'add_table' && name !== 'describe'
      const table = cleanText(entry.table, 40) || defaultTable || ''
      if (needsTable) {
        if (!table) throw new Error(`${where}没说是哪张表；这张表里有多张表时请带上表名。`)
        op.table = table
      }

      switch (name) {
        case 'add_field': {
          const fields = (Array.isArray(entry.fields) ? entry.fields : [entry.field]).filter(Boolean)
          if (fields.length === 0) throw new Error(`${where}缺少要加的列。`)
          op.fields = fields.map((field) => normalizeFieldDef(field, where))
          break
        }
        case 'rename_field':
          op.field = cleanText(entry.field, 40)
          op.name = cleanText(entry.name, 40)
          if (!op.field || !op.name) throw new Error(`${where}需要旧列名和新列名。`)
          break
        case 'add_options':
        case 'remove_options':
          op.field = cleanText(entry.field, 40)
          op.options = cleanNames(entry.options)
          if (!op.field || op.options.length === 0) throw new Error(`${where}需要列名和选项。`)
          break
        case 'delete_field':
          op.field = cleanText(entry.field, 40)
          if (!op.field) throw new Error(`${where}需要列名。`)
          break
        case 'add_view': {
          op.name = cleanText(entry.name, 40)
          const type = cleanText(entry.type, 20)
          op.type = VIEW_TYPES.has(type) ? type : 'grid'
          if (!op.name) throw new Error(`${where}需要视图名。`)
          const groupBy = cleanText(entry.group_by, 40)
          if (groupBy) op.group_by = groupBy
          break
        }
        case 'rename_view':
          op.view = cleanText(entry.view, 40)
          op.name = cleanText(entry.name, 40)
          if (!op.view || !op.name) throw new Error(`${where}需要旧视图名和新视图名。`)
          break
        case 'delete_view':
          op.view = cleanText(entry.view, 40)
          if (!op.view) throw new Error(`${where}需要视图名。`)
          break
        case 'add_records': {
          const records = (Array.isArray(entry.records) ? entry.records : [])
            .filter((record) => record && typeof record === 'object')
          if (records.length === 0) throw new Error(`${where}没有记录。`)
          op.records = records.slice(0, 50)
          break
        }
        case 'update_records': {
          let entries = []
          if (Array.isArray(entry.records)) {
            entries = entry.records.filter((record) => record && typeof record === 'object')
          } else if (entry.updates && typeof entry.updates === 'object') {
            entries = Object.entries(entry.updates).map(([id, fields]) => ({ record_id: id, fields }))
          }
          if (entries.length > 0) {
            op.records = entries.map((record) => {
              const id = cleanText(record.record_id ?? record.id, 40)
              if (!id) throw new Error(`${where}里的记录缺少 record_id。`)
              return { record_id: id, fields: record.fields && typeof record.fields === 'object' ? record.fields : {} }
            })
          } else if (entry.where) {
            op.where = normalizeWhere(entry.where, where)
            if (!entry.fields || typeof entry.fields !== 'object' || Array.isArray(entry.fields)) {
              throw new Error(`${where}需要给出要改成的值。`)
            }
            op.fields = entry.fields
          } else {
            throw new Error(`${where}没说改哪些记录。`)
          }
          break
        }
        case 'delete_records': {
          const ids = (Array.isArray(entry.record_ids) ? entry.record_ids : [])
            .map((id) => cleanText(id, 40)).filter(Boolean)
          if (ids.length > 0) op.record_ids = ids
          else if (entry.where) op.where = normalizeWhere(entry.where, where)
          else throw new Error(`${where}没说删哪些记录。`)
          break
        }
        case 'rename_table':
          op.name = cleanText(entry.name, 40)
          if (!op.name) throw new Error(`${where}需要新表名。`)
          break
        case 'add_table': {
          op.name = cleanText(entry.name, 40)
          const fields = (Array.isArray(entry.fields) ? entry.fields : [])
            .filter((field) => field && typeof field === 'object')
          if (!op.name || fields.length === 0) throw new Error(`${where}需要新表名和至少一列。`)
          op.fields = fields.map((field) => normalizeFieldDef(field, where))
          if (Array.isArray(entry.records) && entry.records.length > 0) {
            op.records = entry.records.filter((record) => record && typeof record === 'object').slice(0, 50)
          }
          break
        }
        case 'describe':
          break
        case 'enable_adv_perm':
        case 'disable_adv_perm':
          break
        case 'create_role': {
          op.role_name = cleanText(entry.role_name || entry.name, 40)
          if (!op.role_name) throw new Error(`${where}需要角色名称。`)
          op.table_perm = entry.table_perm && typeof entry.table_perm === 'object' ? entry.table_perm : {}
          op.field_perm = entry.field_perm && typeof entry.field_perm === 'object' ? entry.field_perm : {}
          op.copy = entry.copy === true
          op.download = entry.download === true
          break
        }
        case 'update_role': {
          op.role_name = cleanText(entry.role_name || entry.name, 40)
          if (!op.role_name) throw new Error(`${where}需要角色名称。`)
          if (entry.table_perm) op.table_perm = entry.table_perm
          if (entry.field_perm) op.field_perm = entry.field_perm
          if (entry.copy != null) op.copy = Boolean(entry.copy)
          if (entry.download != null) op.download = Boolean(entry.download)
          break
        }
        case 'delete_role': {
          op.role_name = cleanText(entry.role_name || entry.name || entry.role, 40)
          if (!op.role_name) throw new Error(`${where}需要角色名称。`)
          break
        }
        case 'set_field_ai_extension': {
          op.field = cleanText(entry.field, 40)
          if (!op.field) throw new Error(`${where}需要指定要配置 AI 的字段名。`)
          op.prompt = cleanText(entry.prompt || entry.instruction, 300)
          op.ref_fields = cleanNames(entry.ref_fields || entry.refs)
          break
        }
        case 'trigger_field_ai': {
          op.field = cleanText(entry.field, 40)
          if (!op.field) throw new Error(`${where}需要指定要执行 AI 的字段名。`)
          break
        }
        case 'set_view_visible_fields': {
          op.view = cleanText(entry.view, 40)
          op.visible_fields = cleanNames(entry.visible_fields || entry.fields)
          if (!op.view || op.visible_fields.length === 0) throw new Error(`${where}需要视图名和可见列列表。`)
          break
        }
        case 'add_dashboard': {
          op.name = cleanText(entry.name, 40)
          if (!op.name) throw new Error(`${where}需要仪表盘名称。`)
          break
        }
        case 'add_form': {
          op.name = cleanText(entry.name, 40)
          if (!op.name) throw new Error(`${where}需要表单名称。`)
          break
        }
        default:
          throw new Error(`${where}还缺参数。`)
      }
      ops.push(op)
    })
    return ops
  }

  function viewTypeName(type) {
    return VIEW_TYPE_NAMES[type] || '视图'
  }

  function describeSchema(schema) {
    return schema.tables.map((table) => {
      const fields = table.fields.length > 0
        ? table.fields.map((field) => (
            Array.isArray(field.options) && field.options.length > 0
              ? `${field.name}（${field.type}：${field.options.join('/')}）`
              : `${field.name}（${field.type}）`
          )).join('、')
        : '还没有列'
      const views = table.views.length > 0
        ? `；视图：${table.views.map((view) => `${view.name}[${view.type}]`).join('、')}`
        : ''
      return `- ${table.name}：${fields}${views}`
    }).join('\n')
  }

  /** How many tables/fields/views exist — the context an adjustment needs. */
  async function readSchema(token, signal) {
    if (!token) throw new Error('缺少表格标识。')
    const listed = await runJson(['base', '+table-list', '--base-token', token, ...asArgs()], signal)
    if (!listed.ok) throw new Error(listed.message)

    const tables = (listed.value?.data?.tables ?? []).slice(0, 8).map((table) => ({
      id: table.id,
      name: table.name,
    }))

    for (const table of tables) {
      const fields = await runJson(
        ['base', '+field-list', '--base-token', token, '--table-id', table.id, ...asArgs()],
        signal,
      )
      table.fields = fields.ok
        ? (fields.value?.data?.fields ?? []).map((field) => ({
            id: field.id,
            name: field.name,
            type: field.type,
            ...(Array.isArray(field.options) ? { options: field.options.map((option) => option.name) } : {}),
          }))
        : []
      const views = await runJson(
        ['base', '+view-list', '--base-token', token, '--table-id', table.id, ...asArgs()],
        signal,
      )
      table.views = views.ok
        ? (views.value?.data?.views ?? []).map((view) => ({ id: view.id, name: view.name, type: view.type }))
        : []
    }
    return { tables }
  }

  /** A link, a token, or a title a person would actually type. */
  async function resolveBase(input, signal) {
    const raw = String(input ?? '').trim()
    if (!raw) throw new Error('缺少表格标识：把表格链接或创建时拿到的 token 发给我。')

    if (/^https?:\/\//i.test(raw)) {
      const resolved = await runJson(['base', '+url-resolve', '--url', raw, ...asArgs()], signal)
      if (!resolved.ok) throw new Error(`这个链接没能定位到表格：${resolved.message}`)
      const token = resolved.value?.data?.base_token || extractBase(resolved.value).token
      if (!token) throw new Error('这个链接里没找到多维表格，可能是其他的文档。')
      return { token, url: raw }
    }

    if (/^[A-Za-z0-9]{8,}$/.test(raw)) return { token: raw }

    const titled = await runJson(['base', '+title-resolve', '--title', raw, ...asArgs()], signal)
    if (titled.ok) {
      const token = extractBase(titled.value).token
      if (token) return { token }
    }
    const searched = await runJson(
      ['drive', '+search', '--query', raw, '--doc-types', 'bitable', ...asArgs()],
      signal,
    )
    if (searched.ok) {
      const token = extractBase(searched.value).token
      if (token) return { token }
    }
    throw new Error(`没找到叫「${raw}」的多维表格。把表在飞书里的链接发给我，或者在「最近创建」里打开它。`)
  }

  async function loadField(token, table, field, signal) {
    const result = await runJson(
      ['base', '+field-get', '--base-token', token, '--table-id', table, '--field-id', field, ...asArgs()],
      signal,
    )
    if (!result.ok) throw new Error(`没找到列「${field}」：${result.message}`)
    const definition = { ...(result.value?.data?.field ?? {}) }
    delete definition.id
    return definition
  }

  function saveField(token, table, field, definition, signal) {
    return runJson(
      [
        'base', '+field-update',
        '--base-token', token,
        '--table-id', table,
        '--field-id', field,
        '--json', JSON.stringify(definition),
        '--yes',
        ...asArgs(),
      ],
      signal,
    )
  }

  /**
   * "把张三那条改成已完成" — resolve records by field/value instead of asking a
   * non-technical user for record ids.
   */
  async function findRecordIds(token, table, where, signal) {
    const rawConditions = Array.isArray(where) ? where : []
    const conditions = rawConditions.map((entry) => {
      let op = entry.op
      if (!op) {
        if (Array.isArray(entry.value)) op = 'intersects'
        else op = '=='
      }
      return [entry.field, op, entry.value]
    })
    if (conditions.length === 0) throw new Error('缺少筛选条件。')

    // 1. Try standard CLI filtered query
    try {
      const result = await runJson(
        [
          'base', '+record-list',
          '--base-token', token,
          '--table-id', table,
          '--format', 'json',
          '--filter-json', JSON.stringify({ logic: 'and', conditions }),
          '--limit', '200',
          ...asArgs(),
        ],
        signal,
      )
      const ids = result.value?.data?.record_id_list
      if (result.ok && Array.isArray(ids) && ids.length > 0) {
        return ids
      }
    } catch {
      // CLI filter failed or threw, fall back to in-memory matching below
    }

    // 2. In-memory matching fallback using peeked rows
    try {
      const peeked = await peek(token, table, 200, signal)
      if (peeked.ok && Array.isArray(peeked.rows) && Array.isArray(peeked.ids)) {
        const matched = []
        peeked.rows.forEach((row, idx) => {
          const recId = peeked.ids[idx]
          if (!recId) return
          const bag = (row && typeof row === 'object' && row.fields) ? row.fields : row
          const allMatch = rawConditions.every((cond) => {
            const actual = bag ? bag[cond.field] : undefined
            if (actual == null) return cond.value == null
            const actualStr = Array.isArray(actual)
              ? actual.map((item) => (typeof item === 'object' ? item.name || item.text || '' : String(item))).join(',')
              : (typeof actual === 'object' ? actual.name || actual.text || '' : String(actual))
            const valStr = Array.isArray(cond.value)
              ? cond.value.map(String).join(',')
              : String(cond.value)
            const op = cond.op || (Array.isArray(cond.value) ? 'intersects' : '==')
            if (op === '==' || op === 'intersects') {
              return actualStr.toLowerCase().includes(valStr.toLowerCase()) || valStr.toLowerCase().includes(actualStr.toLowerCase())
            }
            if (op === '!=') return actualStr !== valStr
            return actualStr == valStr
          })
          if (allMatch) matched.push(recId)
        })
        if (matched.length > 0) return matched
      }
    } catch {
      // fallback matching failed
    }

    return []
  }

  function fail(message, text) {
    return { ok: false, message, text: text || message }
  }

  /** One operation, one CLI call sequence. Never throws for a CLI failure. */
  async function applyOp(token, op, signal) {
    const table = op.table
    switch (op.op) {
      case 'add_field': {
        const payload = op.fields.length === 1 ? op.fields[0] : op.fields
        const result = await runJson(
          [
            'base', '+field-create',
            '--base-token', token,
            '--table-id', table,
            '--json', JSON.stringify(payload),
            ...asArgs(),
          ],
          signal,
        )
        if (!result.ok) return fail(result.message)
        return {
          ok: true,
          text: `加了 ${op.fields.length} 列：${op.fields.map((field) => `${field.name}（${field.type}）`).join('、')}`,
        }
      }

      case 'rename_field': {
        const definition = await loadField(token, table, op.field, signal)
        definition.name = op.name
        const saved = await saveField(token, table, op.field, definition, signal)
        if (!saved.ok) return fail(saved.message)
        return { ok: true, text: `把「${op.field}」改名成「${op.name}」` }
      }

      case 'add_options':
      case 'remove_options': {
        const definition = await loadField(token, table, op.field, signal)
        const existing = Array.isArray(definition.options) ? [...definition.options] : []
        if (op.op === 'add_options') {
          for (const option of op.options) {
            if (!existing.some((entry) => entry.name === option)) existing.push({ name: option })
          }
        } else {
          const removed = new Set(op.options)
          const kept = existing.filter((entry) => !removed.has(entry.name))
          if (kept.length === 0) return fail('单选列不能把选项删光。', `「${op.field}」的选项删光了，没执行。`)
          existing.splice(0, existing.length, ...kept)
        }
        definition.options = existing
        const saved = await saveField(token, table, op.field, definition, signal)
        if (!saved.ok) return fail(saved.message)
        return {
          ok: true,
          text: op.op === 'add_options'
            ? `给「${op.field}」加了选项：${op.options.join('、')}`
            : `「${op.field}」删掉了选项：${op.options.join('、')}`,
        }
      }

      case 'delete_field': {
        const result = await runJson(
          [
            'base', '+field-delete',
            '--base-token', token,
            '--table-id', table,
            '--field-id', op.field,
            '--yes',
            ...asArgs(),
          ],
          signal,
        )
        if (!result.ok) return fail(result.message)
        return { ok: true, text: `删掉了列「${op.field}」` }
      }

      case 'add_view': {
        const created = await runJson(
          [
            'base', '+view-create',
            '--base-token', token,
            '--table-id', table,
            '--json', JSON.stringify({ name: op.name, type: op.type }),
            ...asArgs(),
          ],
          signal,
        )
        if (!created.ok) return fail(created.message)
        if (!op.group_by) return { ok: true, text: `加了${viewTypeName(op.type)}「${op.name}」` }

        let viewId = created.value?.data?.views?.[0]?.id
        for (let attempt = 0; attempt < 3 && !viewId; attempt += 1) {
          const listed = await runJson(
            ['base', '+view-list', '--base-token', token, '--table-id', table, ...asArgs()],
            signal,
          )
          if (listed.ok) viewId = findViewId(listed.value, op.name)
          if (!viewId) await sleep(350)
        }
        if (!viewId) {
          return fail(
            '视图创建了，但没能定位到它的 id',
            `加了${viewTypeName(op.type)}「${op.name}」，但没能设置分组。`,
          )
        }

        const fields = await runJson(
          ['base', '+field-list', '--base-token', token, '--table-id', table, ...asArgs()],
          signal,
        )
        const fieldId = fields.ok ? findFieldId(fields.value, op.group_by) : undefined
        const grouped = await runJson(
          [
            'base', '+view-set-group',
            '--base-token', token,
            '--table-id', table,
            '--view-id', viewId,
            '--json', JSON.stringify({ group_config: [{ field: fieldId ?? op.group_by, desc: false }] }),
            ...asArgs(),
          ],
          signal,
        )
        const current = await runJson(
          ['base', '+view-get-group', '--base-token', token, '--table-id', table, '--view-id', viewId, ...asArgs()],
          signal,
        )
        if (current.ok && groupCoversField(extractGroup(current.value), op.group_by)) {
          return { ok: true, text: `加了${viewTypeName(op.type)}「${op.name}」，按「${op.group_by}」分栏` }
        }
        if (!grouped.ok) return fail(grouped.message, `视图建好了，但按「${op.group_by}」分组失败：${grouped.message}`)
        return { ok: true, text: `加了${viewTypeName(op.type)}「${op.name}」` }
      }

      case 'rename_view': {
        const result = await runJson(
          [
            'base', '+view-rename',
            '--base-token', token,
            '--table-id', table,
            '--view-id', op.view,
            '--name', op.name,
            ...asArgs(),
          ],
          signal,
        )
        if (!result.ok) return fail(result.message)
        return { ok: true, text: `把视图「${op.view}」改名成「${op.name}」` }
      }

      case 'delete_view': {
        const result = await runJson(
          [
            'base', '+view-delete',
            '--base-token', token,
            '--table-id', table,
            '--view-id', op.view,
            '--yes',
            ...asArgs(),
          ],
          signal,
        )
        if (!result.ok) return fail(result.message)
        return { ok: true, text: `删掉了视图「${op.view}」` }
      }

      case 'add_records': {
        const records = op.records.map((record) => ({
          fields: record.fields && typeof record.fields === 'object' && !Array.isArray(record.fields)
            ? record.fields
            : record,
        }))
        const result = await runJson(
          [
            'base', '+record-batch-create',
            '--base-token', token,
            '--table-id', table,
            '--json', JSON.stringify({ create_records: records }),
            ...asArgs(),
          ],
          signal,
        )
        if (!result.ok) return fail(result.message)
        const details = records
          .map((r) => Object.entries(r.fields).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('/') : v}`).join(', '))
          .filter(Boolean)
          .join('；')
        return { ok: true, text: `加了 ${records.length} 条记录${details ? `（内容：${details}）` : ''}` }
      }

      case 'update_records': {
        const update_records = {}
        if (op.records) {
          for (const record of op.records) update_records[record.record_id] = record.fields
        } else {
          const ids = await findRecordIds(token, table, op.where, signal)
          if (ids.length === 0) return fail('没有找到匹配的记录。', '没有匹配的记录，没改。')
          for (const id of ids) update_records[id] = op.fields
        }
        const result = await runJson(
          [
            'base', '+record-batch-update',
            '--base-token', token,
            '--table-id', table,
            '--json', JSON.stringify({ update_records }),
            ...asArgs(),
          ],
          signal,
        )
        if (!result.ok) return fail(result.message)
        const count = Object.keys(update_records).length
        const fieldDetails = op.fields
          ? Object.entries(op.fields).map(([k, v]) => `${k} -> ${Array.isArray(v) ? v.join('/') : v}`).join(', ')
          : ''
        return { ok: true, text: `改了 ${count} 条记录${fieldDetails ? `（更新为：${fieldDetails}）` : ''}` }
      }

      case 'delete_records': {
        const ids = op.record_ids ?? await findRecordIds(token, table, op.where, signal)
        if (ids.length === 0) return fail('没有找到匹配的记录。', '没有匹配的记录，没删。')
        const result = await runJson(
          [
            'base', '+record-delete',
            '--base-token', token,
            '--table-id', table,
            '--json', JSON.stringify({ record_id_list: ids }),
            '--yes',
            ...asArgs(),
          ],
          signal,
        )
        if (!result.ok) return fail(result.message)
        return { ok: true, text: `删了 ${ids.length} 条记录` }
      }

      case 'rename_table': {
        const result = await runJson(
          [
            'base', '+table-update',
            '--base-token', token,
            '--table-id', table,
            '--name', op.name,
            ...asArgs(),
          ],
          signal,
        )
        if (!result.ok) return fail(result.message)
        return { ok: true, text: `表「${table}」改名成「${op.name}」` }
      }

      case 'add_table': {
        const created = await runJson(
          [
            'base', '+table-create',
            '--base-token', token,
            '--name', op.name,
            '--fields', JSON.stringify(op.fields),
            ...asArgs(),
          ],
          signal,
        )
        if (!created.ok) return fail(created.message)
        if (Array.isArray(op.records) && op.records.length > 0) {
          const seeded = await runJson(
            [
              'base', '+record-batch-create',
              '--base-token', token,
              '--table-id', op.name,
              '--json', JSON.stringify({ create_records: op.records.map((record) => ({ fields: record })) }),
              ...asArgs(),
            ],
            signal,
          )
          if (!seeded.ok) {
            return {
              ok: true,
              text: `加了一张表「${op.name}」（${op.fields.length} 列），但示例数据没写进去`,
            }
          }
        }
        return { ok: true, text: `加了一张表「${op.name}」（${op.fields.length} 列）` }
      }

      case 'describe':
        return { ok: true, text: describeSchema(await readSchema(token, signal)) }

      case 'enable_adv_perm': {
        const result = await runJson(['base', '+advperm-enable', '--base-token', token, ...asArgs()], signal)
        if (!result.ok) return fail(result.message)
        return { ok: true, text: '已成功开启多维表格高级权限' }
      }

      case 'disable_adv_perm': {
        const result = await runJson(['base', '+advperm-disable', '--base-token', token, '--yes', ...asArgs()], signal)
        if (!result.ok) return fail(result.message)
        return { ok: true, text: '已关闭多维表格高级权限' }
      }

      case 'create_role': {
        // 1. 确保高级权限开启
        try {
          const baseInfo = await runJson(['base', '+base-get', '--base-token', token, ...asArgs()], signal)
          if (baseInfo.ok && baseInfo.value?.data?.base?.is_advanced === false) {
            await runJson(['base', '+advperm-enable', '--base-token', token, ...asArgs()], signal)
          }
        } catch {}

        const targetTable = op.table || table || '默认表'
        const perm = op.table_perm?.[targetTable] || 'edit'
        const hasSpecificFields = op.field_perm && Object.keys(op.field_perm).length > 0
        const fieldPermMode = hasSpecificFields ? 'specify' : (perm === 'edit' ? 'all_edit' : 'all_read')

        const rolePayload = {
          role_name: op.role_name,
          role_type: 'custom_role',
          base_rule_map: {
            copy: Boolean(op.copy),
            download: Boolean(op.download),
          },
          table_rule_map: {
            [targetTable]: {
              perm,
              view_rule: {
                allow_edit: perm === 'edit',
                visibility: { all_visible: true },
              },
              record_rule: {
                record_operations: perm === 'edit' ? ['add', 'delete'] : [],
                other_record_all_read: true,
              },
              field_rule: {
                field_perm_mode: fieldPermMode,
                ...(hasSpecificFields ? { field_perms: op.field_perm } : {}),
                allow_edit_and_modify_option_fields: [],
                allow_edit_and_download_file_fields: [],
              },
            },
          },
        }

        const result = await runJson(
          [
            'base', '+role-create',
            '--base-token', token,
            '--json', JSON.stringify(rolePayload),
            ...asArgs(),
          ],
          signal,
        )
        if (!result.ok) return fail(result.message)
        return { ok: true, text: `已创建自定义权限角色「${op.role_name}」（表权限：${perm}）` }
      }

      case 'update_role': {
        const listRes = await runJson(['base', '+role-list', '--base-token', token, '--format', 'json', ...asArgs()], signal)
        const roles = listRes.value?.data?.role_list || []
        const found = roles.find((r) => r.role_name === op.role_name)
        if (!found) return fail(`未找到名为「${op.role_name}」的角色`)
        const roleId = found.role_id || found.id

        const updatePayload = {
          role_name: op.role_name,
          role_type: found.role_type || 'custom_role',
        }
        if (op.copy != null || op.download != null) {
          updatePayload.base_rule_map = {
            copy: op.copy != null ? op.copy : Boolean(found.base_rule_map?.copy),
            download: op.download != null ? op.download : Boolean(found.base_rule_map?.download),
          }
        }
        const result = await runJson(
          [
            'base', '+role-update',
            '--base-token', token,
            '--role-id', roleId,
            '--json', JSON.stringify(updatePayload),
            '--yes',
            ...asArgs(),
          ],
          signal,
        )
        if (!result.ok) return fail(result.message)
        return { ok: true, text: `已更新角色「${op.role_name}」的配置` }
      }

      case 'delete_role': {
        const listRes = await runJson(['base', '+role-list', '--base-token', token, '--format', 'json', ...asArgs()], signal)
        const roles = listRes.value?.data?.role_list || []
        const found = roles.find((r) => r.role_name === op.role_name)
        if (!found) return fail(`未找到名为「${op.role_name}」的角色`)
        const roleId = found.role_id || found.id

        const result = await runJson(
          [
            'base', '+role-delete',
            '--base-token', token,
            '--role-id', roleId,
            '--yes',
            ...asArgs(),
          ],
          signal,
        )
        if (!result.ok) return fail(result.message)
        return { ok: true, text: `已删除自定义角色「${op.role_name}」` }
      }

      case 'set_field_ai_extension': {
        const fieldsRes = await runJson(['base', '+field-list', '--base-token', token, '--table-id', table, ...asArgs()], signal)
        const fieldId = fieldsRes.ok ? findFieldId(fieldsRes.value, op.field) : undefined
        if (!fieldId) return fail(`未找到列「${op.field}」，请先创建该列。`)

        const promptSegments = []
        if (op.ref_fields && op.ref_fields.length > 0) {
          promptSegments.push({ type: 'text', text: '请根据 ' })
          op.ref_fields.forEach((rf, i) => {
            if (i > 0) promptSegments.push({ type: 'text', text: '、' })
            promptSegments.push({ type: 'field_ref', field: rf })
          })
          promptSegments.push({ type: 'text', text: ` 进行分析处理：${op.prompt || '生成内容'}` })
        } else {
          promptSegments.push({ type: 'text', text: op.prompt || '自动处理并生成内容' })
        }

        const extPayload = {
          extension_id: 'builtin_llm_completion',
          inputs: { prompt: promptSegments },
        }

        const result = await runJson(
          [
            'base', '+field-extension-update',
            '--base-token', token,
            '--table-id', table,
            '--field-id', fieldId,
            '--json', JSON.stringify(extPayload),
            '--as', 'user',
            '--yes',
            ...asArgs(),
          ],
          signal,
        )
        if (!result.ok) return fail(result.message)
        return { ok: true, text: `已成功为列「${op.field}」安装并配置了字段 AI 插件` }
      }

      case 'trigger_field_ai': {
        const fieldsRes = await runJson(['base', '+field-list', '--base-token', token, '--table-id', table, ...asArgs()], signal)
        const fieldId = fieldsRes.ok ? findFieldId(fieldsRes.value, op.field) : undefined
        if (!fieldId) return fail(`未找到列「${op.field}」`)

        const result = await runJson(
          [
            'base', '+field-extension-update-cells',
            '--base-token', token,
            '--table-id', table,
            '--field-id', fieldId,
            '--type', 'column',
            '--as', 'user',
            '--yes',
            ...asArgs(),
          ],
          signal,
        )
        if (!result.ok) return fail(result.message)
        return { ok: true, text: `已触发列「${op.field}」的整列 AI 单元格自动填充任务` }
      }

      case 'set_view_visible_fields': {
        const viewsRes = await runJson(['base', '+view-list', '--base-token', token, '--table-id', table, ...asArgs()], signal)
        const viewId = viewsRes.ok ? findViewId(viewsRes.value, op.view) : undefined
        if (!viewId) return fail(`未找到视图「${op.view}」`)

        const fieldsRes = await runJson(['base', '+field-list', '--base-token', token, '--table-id', table, ...asArgs()], signal)
        const fieldIds = op.visible_fields.map((fName) => findFieldId(fieldsRes.value, fName) || fName)

        const result = await runJson(
          [
            'base', '+view-set-visible-fields',
            '--base-token', token,
            '--table-id', table,
            '--view-id', viewId,
            '--json', JSON.stringify({ visible_field_list: fieldIds }),
            '--as', 'user',
            ...asArgs(),
          ],
          signal,
        )
        if (!result.ok) return fail(result.message)
        return { ok: true, text: `已将视图「${op.view}」设置为只显示 ${op.visible_fields.length} 列` }
      }

      case 'add_dashboard': {
        const result = await runJson(
          [
            'base', '+dashboard-create',
            '--base-token', token,
            '--name', op.name,
            ...asArgs(),
          ],
          signal,
        )
        if (!result.ok) return fail(result.message)
        return { ok: true, text: `已创建统计仪表盘「${op.name}」` }
      }

      case 'add_form': {
        const result = await runJson(
          [
            'base', '+form-create',
            '--base-token', token,
            '--table-id', table,
            '--name', op.name,
            ...asArgs(),
          ],
          signal,
        )
        if (!result.ok) return fail(result.message)
        return { ok: true, text: `已为表「${table}」创建数据收集表单「${op.name}」` }
      }

      default:
        return fail(`不支持的改动「${op.op}」。`)
    }
  }

  /**
   * Apply an ordered list of changes to an existing Base.
   * `options.table` is the default table when an op omits one.
   */
  async function adjust(baseInput, rawOps, options = {}, signal) {
    const base = await resolveBase(baseInput, signal)
    const wanted = (Array.isArray(rawOps) ? rawOps : []).slice()
    if (wanted.length === 0) throw new Error('没有要改的内容。')

    let defaultTable = cleanText(options.table, 40) || ''
    const needsDefault = wanted.some((op) => (
      op && typeof op === 'object' && op.op !== 'add_table' && !cleanText(op.table, 40)
    ))
    if (!defaultTable && needsDefault) {
      const listed = await runJson(['base', '+table-list', '--base-token', base.token, ...asArgs()], signal)
      const tables = listed.ok ? (listed.value?.data?.tables ?? []) : []
      defaultTable = tables.length === 1 ? tables[0].name : ''
    }

    const ops = normalizeOps(wanted, defaultTable)
    const results = []
    const warnings = []
    for (const op of ops) {
      let outcome
      try {
        outcome = await applyOp(base.token, op, signal)
      } catch (error) {
        outcome = {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          text: error instanceof Error ? error.message : String(error),
        }
      }
      results.push({ op: op.op, ok: outcome.ok !== false, text: outcome.text })
      if (outcome.ok === false) warnings.push(outcome.message || outcome.text)
      // Later ops should keep pointing at a table that was just renamed.
      if (op.op === 'rename_table' && outcome.ok !== false) {
        for (const other of ops) if (other.table === op.table) other.table = op.name
      }
    }

    let baseName
    let url = base.url
    try {
      const detail = await runJson(['base', '+base-get', '--base-token', base.token, ...asArgs()], signal)
      if (detail.ok) {
        baseName = detail.value?.data?.base?.name
        url = url || detail.value?.data?.base?.url
      }
    } catch {
      // the summary still works without the Base name
    }
    const brand = await resolveEffectiveBrand(signal)
    url = adaptUrlTextForBrand(url, brand)

    const allOk = results.every((entry) => entry.ok)
    const onlyDescribe = results.length === 1 && results[0].op === 'describe'
    const isEn = resolveLang(options.lang) === 'en'
    const summary = onlyDescribe
      ? results[0].text
      : [
          isEn
            ? `${allOk ? 'Updated' : 'Partially updated'}${baseName ? `: "${baseName}"` : ''}`
            : `${allOk ? '改好了' : '改好了一部分'}${baseName ? `：「${baseName}」` : ''}`,
          ...results.map((entry) => `${entry.ok ? '·' : '×'} ${entry.text}`),
        ].join('\n')

    return {
      ok: allOk,
      baseName,
      token: base.token,
      url,
      results,
      warnings,
      summary,
    }
  }

  return {
    status,
    build,
    peek,
    adjust,
    readSchema,
    resolveBase,
    ensureKanban,
    resolveCli,
    resolveCliSync,
    getCanonicalBundledCliPath,
    installCli,
    getCliBootstrapState,
    readOfficialSkillsCatalog,
    readOfficialSkillGuide,
    invalidateOfficialSkillsCache,
    compareSemver,
    connectStatus,
    startAppInit,
    pollAppInit,
    bindApp,
    startLogin,
    finishLogin,
    logout,
    unbindApp,
    clearConnectionCaches,
    exchangeState,
    getScopes,
    dispatchCollab,
    installCommand: INSTALL_COMMAND,
  }
}
