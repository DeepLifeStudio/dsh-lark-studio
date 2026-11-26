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
import { normalizeSkillArgvWithDomain, validateReadonlySkillArgv } from './readonly-allowlist.js'

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

  async function runJson(argv, signal) {
    const { exitCode, stdout, stderr } = await invoke(argv, signal)
    const trimmed = stdout.trim()
    let payload
    try {
      payload = trimmed ? JSON.parse(trimmed) : undefined
    } catch {
      payload = firstJsonObject(trimmed)
    }
    if (payload && typeof payload === 'object') {
      payload = stripCliNotices(payload)
    }
    if (payload === undefined && exitCode !== 0) {
      return {
        ok: false,
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
      return { ok: false, step: argv.slice(0, 2).join(' '), message, code: error && error.code, error }
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

    const auth = await authStatus(signal)
    const effectiveBrand = configuredBrand || normalizeBrand(auth.brand) || normalizeBrand(config.brand) || 'feishu'
    if (normalizeBrand(auth.brand) || normalizeBrand(config.brand)) {
      detectedBrandCache = normalizeBrand(auth.brand) || normalizeBrand(config.brand)
    }
    const base = {
      cli: { available: true, path: cliPath },
      app: { appId: config.appId, brand: effectiveBrand },
      installCommand: INSTALL_COMMAND,
    }
    return (auth.ready && auth.userReady) ? { stage: 'ready', ...base, auth } : { stage: 'no-auth', ...base, auth }
  }

  /** Step 1 for a brand-new user: create the Feishu/Lark app in a browser flow. */
  let appInit = null

  async function startAppInit(signal, requestedBrand) {
    if (appInit && !appInit.done) {
      if (appInit.url) return { ok: true, url: appInit.url, pending: true }
    }
    const targetBrand = normalizeBrand(requestedBrand) || configuredBrand || 'feishu'
    const executable = await resolveCli(signal)
    const handle = ctx.subprocess.spawn({
      argv: [executable, 'config', 'init', '--new', '--brand', targetBrand],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: MAX_STDERR_BYTES },
        stderr: { maxBytes: MAX_STDERR_BYTES },
      },
      graceMs: 4000,
      env: childEnv(),
    })
    const record = { handle, url: undefined, done: false, exitCode: null, timer: undefined }
    appInit = record
    handle.done.then((outcome) => {
      record.done = true
      record.exitCode = outcome.exitCode
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

  async function pollAppInit() {    if (!appInit) {
      const config = await readConfig(undefined)
      return { ok: true, done: Boolean(config && config.appId), url: undefined }
    }
    return { ok: true, done: appInit.done, url: appInit.url, exitCode: appInit.exitCode }
  }

  /** Step 2: device-flow authorization. Returns a link, then completes it. */
  async function startLogin(signal, domain) {
    const args = ['auth', 'login', '--no-wait', '--json']
    if (domain) {
      args.push('--domain', domain)
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
        if (result.ok) {
          const auth = await authStatus(undefined).catch(() => undefined)
          record.ok = true
          record.auth = auth
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
    return { ok: true, auth: await authStatus(signal) }
  }

  async function logout(signal) {
    const result = await runJson(['auth', 'logout', '--json'], signal)
    if (!result.ok) {
      const raw = await invoke(['auth', 'logout'], signal)
      if (raw.exitCode === 0) return { ok: true }
      return { ok: false, message: result.message || raw.stderr || '退出登录失败' }
    }
    return { ok: true }
  }

  async function unbindApp(signal) {
    const raw = await invoke(['config', 'remove'], signal)
    if (raw.exitCode === 0) return { ok: true }
    return { ok: false, message: raw.stderr || raw.stdout || '解绑应用失败' }
  }

  async function getScopes(signal) {
    const raw = await runJson(['auth', 'scopes', '--json'], signal)
    const conf = (await readConfig(signal).catch(() => ({}))) || {}
    const appId = conf?.appId || (raw.ok && raw.value?.appId) || ''
    const userScopes = new Set(
      raw.ok && Array.isArray(raw.value?.userScopes) ? raw.value.userScopes : []
    )
    const count = userScopes.size

    const hasAny = (prefixes) => prefixes.some((p) => {
      for (const s of userScopes) if (s.startsWith(p)) return true
      return false
    })

    const domains = {
      base: {
        id: 'base',
        name: '多维表格与云文档',
        desc: '数据表、字段、看板、仪表盘、云文档与文件',
        icon: 'table',
        ready: hasAny(['base:', 'docs:', 'docx:', 'drive:', 'wiki:']),
        count: Array.from(userScopes).filter((s) => /^(base|docs|docx|drive|wiki|sheets|slides):/.test(s)).length,
        requiredCategory: '多维表格 / 云文档',
      },
      calendar: {
        id: 'calendar',
        name: '日历与日程',
        desc: '查看日程、预定会议、排查时间冲突',
        icon: 'calendar',
        ready: hasAny(['calendar:calendar']),
        missingScopes: ['calendar:calendar:readonly', 'calendar:calendar'],
        requiredCategory: '日历',
      },
      task: {
        id: 'task',
        name: '任务与待办',
        desc: '查看待办事项、更新完成状态、指派责任人',
        icon: 'check',
        ready: hasAny(['task:task']),
        missingScopes: ['task:task:readonly', 'task:task'],
        requiredCategory: '任务',
      },
      im: {
        id: 'im',
        name: '即时消息与群聊',
        desc: '检索群聊、发送卡片消息、工作群协同',
        icon: 'people',
        ready: hasAny(['im:message', 'im:chat']),
        missingScopes: ['im:chat:read', 'im:message:send_as_bot'],
        requiredCategory: '消息与群聊',
      },
      mail: {
        id: 'mail',
        name: '飞书邮箱',
        desc: '查阅未读邮件、搜索往来邮件、起草回复',
        icon: 'receipt',
        ready: hasAny(['mail:user_mailbox']),
        missingScopes: ['mail:user_mailbox.messages:readonly'],
        requiredCategory: '邮箱',
      },
      contact: {
        id: 'contact',
        name: '通讯录与组织',
        desc: '查询同事部门、工号、邮箱与联系方式',
        icon: 'user',
        ready: hasAny(['contact:user']),
        missingScopes: ['contact:user.base:readonly'],
        requiredCategory: '通讯录',
      },
      approval: {
        id: 'approval',
        name: '审批与流程',
        desc: '查询待审批任务、发起请假与报销流程',
        icon: 'shieldCheck',
        ready: hasAny(['approval:approval']),
        missingScopes: ['approval:approval:readonly'],
        requiredCategory: '审批',
      },
    }

    const cfg = await readConfig(signal).catch(() => null)
    const brand = await resolveEffectiveBrand(signal, cfg)
    return {
      ok: true,
      appId,
      brand,
      totalGranted: count,
      consoleUrl: consoleUrlFor(brand, appId),
      domains,
    }
  }

  async function calendarList(signal) {
    return runJson(['calendar', '+agenda', '--json', ...asArgs()], signal)
  }

  async function calendarCreate({ summary, start, end, attendees = [] }, signal) {
    const args = ['calendar', '+create', '--summary', summary || '新建日程']
    if (start) args.push('--start', start)
    if (end) args.push('--end', end)
    for (const a of attendees) args.push('--attendee', a)
    args.push('--json', ...asArgs())
    return runJson(args, signal)
  }

  async function calendarDelete({ eventId, calendarId }, signal) {
    const args = ['calendar', '+delete', '--event-id', eventId]
    if (calendarId) args.push('--calendar-id', calendarId)
    args.push('--yes', '--json', ...asArgs())
    return runJson(args, signal)
  }

  async function taskList(signal) {
    return runJson(['task', '+get-my-tasks', '--json', ...asArgs()], signal)
  }

  async function taskCreate({ title, due, description }, signal) {
    const args = ['task', '+create', '--title', title || '新建待办']
    if (due) args.push('--due', due)
    if (description) args.push('--description', description)
    args.push('--json', ...asArgs())
    return runJson(args, signal)
  }

  async function taskComplete(taskId, signal) {
    return runJson(['task', '+complete', '--task-id', taskId, '--json', ...asArgs()], signal)
  }

  async function taskDelete(taskId, signal) {
    return runJson(['task', 'tasks', 'delete', '--task-guid', taskId, '--yes', '--json', ...asArgs()], signal)
  }

  async function chatList(signal) {
    return runJson(['im', '+chat-list', '--json', ...asArgs()], signal)
  }

  async function messageSend({ chatId, userId, text }, signal) {
    const args = ['im', '+messages-send', '--text', text || '']
    if (chatId) args.push('--chat-id', chatId)
    else if (userId) args.push('--user-id', userId)
    args.push('--json', ...asArgs())
    return runJson(args, signal)
  }

  async function mailList(signal) {
    return runJson(['mail', '+triage', '--json', ...asArgs()], signal)
  }

  async function mailSend({ to, subject, body }, signal) {
    const args = ['mail', '+send', '--to', to, '--subject', subject || '无主题', '--body', body || '', '--confirm-send', '--json', ...asArgs()]
    return runJson(args, signal)
  }

  async function mailReply({ messageId, body }, signal) {
    const args = ['mail', '+reply', '--message-id', messageId, '--body', body || '', '--confirm-send', '--json', ...asArgs()]
    return runJson(args, signal)
  }

  async function contactSearch(query, signal) {
    return runJson(['contact', '+search-user', '--query', query || '', '--json', ...asArgs()], signal)
  }

  async function docsSearch(query, signal) {
    return runJson(['docs', '+search', '--query', query || '', '--json', ...asArgs()], signal)
  }

  async function wikiSpaceList(signal) {
    return runJson(['wiki', '+space-list', '--json', ...asArgs()], signal)
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

  async function callLlm({ system, messages = [], model, provider, temperature = 0.3, onDelta }, signal) {
    if (!ctx.llm?.stream) return null
    try {
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
      p = p || 'deepseek-account'
      m = m || 'deepseek-flash'

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

  // ---- Live Official Skills Catalog & Execution Helpers --------------------
  let skillsCatalogCache = { cliPath: null, items: null }
  const skillGuideCache = new Map()

  function invalidateOfficialSkillsCache() {
    skillsCatalogCache = { cliPath: null, items: null }
    skillGuideCache.clear()
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

  async function readOfficialSkillGuide(skillName, signal, depth = 0) {
    if (!skillName || !/^[a-z0-9-]+$/.test(skillName) || depth > 2) return null
    const cliPath = await resolveCli(signal).catch(() => null)
    if (!cliPath) return null
    const cacheKey = `${cliPath}:${skillName}`
    if (skillGuideCache.has(cacheKey)) return skillGuideCache.get(cacheKey)
    const raw = await invoke(['skills', 'read', skillName], signal).catch(() => null)
    if (!raw || raw.exitCode !== 0 || !raw.stdout?.trim()) return null
    let text = raw.stdout.trim()
    // Follow compatibility alias skills (e.g. `lark-note` defers to `../lark-meeting/SKILL.md`)
    if (text.length < 900) {
      const aliasMatch = text.match(/\.\.\/(lark-[a-z0-9-]+)\/SKILL\.md/)
      if (aliasMatch && aliasMatch[1] !== skillName) {
        const targetText = await readOfficialSkillGuide(aliasMatch[1], signal, depth + 1)
        if (targetText) text = targetText
      }
    }
    skillGuideCache.set(cacheKey, text)
    return text
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

  /**
   * Incrementally extracts and unescapes the JSON `"reply"` string field as
   * text deltas arrive, only when `"action"` is `"reply"`. Non-reply actions
   * (such as `suggest_create_table` or `get_calendar`) emit zero reply deltas.
   */
  function createJsonReplyStreamForwarder(onDelta) {
    if (typeof onDelta !== 'function') return undefined
    let raw = ''
    let active = false
    let plainMode = false
    let finished = false
    let cursor = 0
    let pendingBackslash = false
    let unicodeBuf = null

    const emitDecoded = (chunkStart) => {
      let out = ''
      for (let i = chunkStart; i < raw.length; i++) {
        const ch = raw[i]
        if (unicodeBuf !== null) {
          unicodeBuf += ch
          if (unicodeBuf.length === 4) {
            const code = parseInt(unicodeBuf, 16)
            if (!Number.isNaN(code)) out += String.fromCharCode(code)
            unicodeBuf = null
          }
          continue
        }
        if (pendingBackslash) {
          pendingBackslash = false
          if (ch === 'n') out += '\n'
          else if (ch === 'r') out += '\r'
          else if (ch === 't') out += '\t'
          else if (ch === 'u') unicodeBuf = ''
          else out += ch
          continue
        }
        if (ch === '\\') {
          pendingBackslash = true
          continue
        }
        if (ch === '"') {
          finished = true
          cursor = i + 1
          break
        }
        out += ch
        cursor = i + 1
      }
      if (!finished) cursor = raw.length
      if (out) onDelta({ type: 'reply_delta', delta: out })
    }

    return (evt) => {
      if (!evt) return
      if (evt.type !== 'text') {
        onDelta(evt)
        return
      }
      if (finished) return
      const piece = evt.delta || ''
      if (!piece) return
      if (plainMode) {
        onDelta({ type: 'reply_delta', delta: piece })
        return
      }
      raw += piece
      if (!active) {
        const trimmedStart = raw.trimStart()
        if (!trimmedStart) return
        // Model bypassed JSON and replied directly in plain prose/Markdown
        if (trimmedStart[0] !== '{' && trimmedStart[0] !== '`') {
          plainMode = true
          onDelta({ type: 'reply_delta', delta: raw })
          return
        }
        // If another non-reply action is already declared, stay silent for reply_delta
        const actionMatch = /"action"\s*:\s*"([^"]+)"/.exec(raw)
        if (actionMatch && actionMatch[1] !== 'reply') {
          onDelta(evt)
          return
        }
        const m = /"reply"\s*:\s*"/.exec(raw)
        if (!m) {
          onDelta(evt)
          return
        }
        active = true
        cursor = m.index + m[0].length
        emitDecoded(cursor)
        return
      }
      emitDecoded(cursor)
    }
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
    if (/required flag|missing required (?:query )?parameter/i.test(raw)) {
      return isEn
        ? `Missing required parameter (${raw}). Try adding more details in your request.`
        : `缺少必要查询参数（${raw}），请在提问中补充具体对象或条件后重试。`
    }
    return raw
  }

  async function executeSkillSteps(skillName, label, plannedSteps, text, { model, provider, activeLang, isEn, onDelta, allowAutoRepair = false }, signal) {
    const stepOutputs = []
    for (let idx = 0; idx < plannedSteps.slice(0, 4).length; idx++) {
      let stepArgv = plannedSteps[idx]
      let cliResult = await runJson([...stepArgv, ...asArgs()], signal)
      if (!cliResult.ok && allowAutoRepair && cliResult.error?.subtype !== 'missing_scope' && !/missing required scope/i.test(cliResult.message || '')) {
        const checked = validateReadonlySkillArgv(stepArgv)
        const prefixLen = checked.ok && checked.prefixLen ? checked.prefixLen : 2
        const helpOut = await invoke([...stepArgv.slice(0, prefixLen), '--help'], signal).catch(() => null)
        const helpText = helpOut?.stdout?.trim() || ''
        let selfOpenId = ''
        if (/user-id|user_id|open_id/i.test(cliResult.message || '')) {
          const selfRes = await runJson(['contact', '+get-user', ...asArgs()], signal).catch(() => null)
          const u = selfRes?.value?.data?.user || selfRes?.value?.user || selfRes?.value?.data || selfRes?.value
          if (u && typeof u.open_id === 'string' && u.open_id) selfOpenId = u.open_id
        }
        if (helpText && ctx.llm && typeof ctx.llm.stream === 'function') {
          const repairRaw = await callLlm({
            system: `根据 lark-cli 命令真实 --help 修复失败的只读命令参数（禁止使用 --output、--params、--page-all、@file）。只返回 JSON：{"argv": ["domain", ...]}`,
            messages: [
              {
                role: 'user',
                text: `用户请求：${text}\n失败命令：${JSON.stringify(stepArgv)}\n错误信息：${cliResult.message}${selfOpenId ? `\n当前登录用户 open_id：${selfOpenId}` : ''}\n\n命令真实 --help：\n${helpText.slice(0, 6000)}`,
              },
            ],
            model,
            provider,
            temperature: 0,
          }, signal).catch(() => null)
          const repaired = repairRaw ? parseModelJson(repairRaw) : null
          if (repaired && Array.isArray(repaired.argv)) {
            const normalized = normalizeSkillArgvWithDomain(repaired.argv, skillName)
            if (validateReadonlySkillArgv(normalized).ok) {
              stepArgv = normalized
              cliResult = await runJson([...stepArgv, ...asArgs()], signal)
            }
          }
        }
      }
      if (!cliResult.ok) {
        if (cliResult.error?.subtype === 'missing_scope' || /missing required scope/i.test(cliResult.message || '')) {
          const scopesInfo = await getScopes(signal)
          const appId = scopesInfo.appId || ''
          const brand = scopesInfo.brand || (await resolveEffectiveBrand(signal))
          const consoleUrl = scopesInfo.consoleUrl || consoleUrlFor(brand, appId)
          const domainTitle = skillLabel(skillName, activeLang)
          return {
            ok: false,
            type: 'missing_scope',
            domain: skillName,
            domainTitle,
            requiredScopes: cliResult.error?.missing_scopes || [],
            categoryName: skillLabel(skillName, activeLang, '飞书服务', 'Feishu Service'),
            consoleUrl,
            reply: isEn
              ? `Authorization for "${domainTitle}" is required to load this data. Click "Authorize & continue" below.`
              : `需要授权访问「${domainTitle}」以获取相关数据，请点击下方「授权并继续」。`,
            summary: isEn ? `Permission required: ${domainTitle}` : `需要「${domainTitle}」访问授权`,
          }
        }
        const friendlyMsg = humanizeCliError(cliResult.message, isEn)
        return {
          ok: false,
          type: 'answer',
          domain: skillName,
          reply: isEn
            ? `Failed to run ${label}: ${friendlyMsg}`
            : `${label}查询未能完成：${friendlyMsg}`,
        }
      }
      stepOutputs.push({
        command: stepArgv.slice(0, 2).join(' '),
        data: cliResult.value !== undefined ? cliResult.value : (cliResult.rawText || ''),
      })
    }

    const brand = await resolveEffectiveBrand(signal)
    const rawPayload = stripCliNotices(stepOutputs.length === 1 ? stepOutputs[0].data : stepOutputs)
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
    const finalReply = adaptUrlTextForBrand(
      summarized
        ? (summarized.text || summarized)
        : (isEn
            ? `Fetched via official skill **${label}**:\n${typeof payloadForModel === 'string' ? payloadText.slice(0, 2000) : `\`\`\`json\n${payloadText.slice(0, 2000)}\n\`\`\``}`
            : `已通过官方技能 **${label}** 获取数据：\n${typeof payloadForModel === 'string' ? payloadText.slice(0, 2000) : `\`\`\`json\n${payloadText.slice(0, 2000)}\n\`\`\``}`),
      brand,
    )
    return {
      ok: true,
      type: 'collab',
      domain: skillName,
      skill: skillName,
      reply: finalReply,
      reasoning: summarized?.reasoning || null,
      summary: isEn ? `Completed query via ${skillName}` : `已通过 ${skillName} 完成查询`,
      data: payloadForModel,
    }
  }

  async function dispatchCollab({ instruction, history = [], model, provider, lang, attachmentContext, imageBlocks = [], confirmSkill = false, skillSteps, skillName: confirmedSkillName, onDelta }, signal) {
    const rawText = (instruction || '').trim()
    const activeLang = resolveLang(lang, rawText)
    const isEn = activeLang === 'en'

    if (confirmSkill === true && Array.isArray(skillSteps) && skillSteps.length > 0) {
      const sName = String(confirmedSkillName || 'feishu').trim() || 'feishu'
      const label = skillLabel(sName, activeLang, sName, sName)
      const safeConfirmedSteps = skillSteps
        .map((s) => normalizeSkillArgvWithDomain(s, sName))
        .filter((s) => isWellFormedSkillArgv(s) && s[0].toLowerCase() !== 'skills')
      if (safeConfirmedSteps.length === 0) {
        return {
          ok: false,
          type: 'answer',
          domain: sName,
          reply: isEn ? 'No valid Feishu command steps to execute.' : '没有可执行的合法飞书命令。',
        }
      }
      return await executeSkillSteps(sName, label, safeConfirmedSteps, rawText || label, { model, provider, activeLang, isEn, onDelta, allowAutoRepair: false }, signal)
    }
    const attachPrompt = attachmentContext?.promptBlock || ''
    const hasAttachments = Boolean(attachPrompt) || imageBlocks.length > 0
    const text = rawText || (hasAttachments
      ? (isEn
          ? 'Please read the attached file(s), summarize the key points clearly, and suggest next actions (such as turning it into a Feishu Base, creating tasks, or drafting a message).'
          : '请阅读我上传的文件，先用清晰简洁的语言提炼重点内容，并告诉我可以帮你做哪些后续处理（例如整理成飞书多维表格、创建待办或起草消息/邮件）。')
      : '')
    const scopesInfo = await getScopes(signal)
    const appId = scopesInfo.appId || ''
    const brand = scopesInfo.brand || (await resolveEffectiveBrand(signal))
    const consoleUrl = scopesInfo.consoleUrl || consoleUrlFor(brand, appId)

    const scopeError = (domainKey, requiredScopes, domainTitleZh, categoryNameZh, domainTitleEn, categoryNameEn) => {
      const domainTitle = isEn ? (domainTitleEn || domainTitleZh) : domainTitleZh
      const cat = isEn ? (categoryNameEn || categoryNameZh || domainTitle) : (categoryNameZh || domainTitle)
      return {
        ok: false,
        type: 'missing_scope',
        domain: domainKey,
        domainTitle,
        requiredScopes,
        categoryName: cat,
        consoleUrl,
        reply: isEn
          ? `Authorization for "${domainTitle}" is required to load this data. Click "Authorize & continue" below.`
          : `需要授权访问「${domainTitle}」以获取相关数据，请点击下方「授权并继续」。`,
        summary: isEn ? `Permission required: ${domainTitle}` : `需要「${domainTitle}」访问授权`,
      }
    }

    // 1. 大模型规划与决策（LLM-Native Agent 架构）
    // 优先交由大模型完整理解用户意图与多轮对话上下文：
    // - 若需要飞书数据，大模型输出对应 action (get_calendar, get_tasks, get_chats, get_mails, search_contacts, suggest_create_table)
    // - 其余所有正常交流、问答、致谢、闲聊、格式化表格整理或建议，大模型直接在 reply 中作答或以自然语言回答
    const formattedHistory = history
      .filter((h) => h && h.text)
      .map((h) => ({
        role: h.role === 'user' ? 'user' : 'assistant',
        text: h.text,
      }))

    let officialSkills = []
    if (ctx.llm && typeof ctx.llm.stream === 'function') {
      officialSkills = await readOfficialSkillsCatalog(signal).catch(() => [])
    }
    const hostFeishuSkill = typeof config.getHostFeishuSkill === 'function'
      ? await Promise.resolve(config.getHostFeishuSkill()).catch(() => null)
      : null
    const extraSkillCatalogText = officialSkills.length > 0
      ? `\n\n官方 lark-cli 动态技能目录（当上述常用动作不足以覆盖用户需求时，可选 action: "run_skill" 并填入对应 skill 名称）：\n${officialSkills.map((s) => `- ${s.name}: ${s.description.slice(0, 140)}`).join('\n')}`
      : ''
    const hostSkillNote = hostFeishuSkill?.content
      ? '\n（已连接宿主原生 feishu 技能索引，可协同覆盖飞书全领域。）'
      : ''

    let agentDecision = null
    let agentRaw = null
    try {
      const langInstruction = isEn
        ? '\n\nIMPORTANT OUTPUT LANGUAGE RULE:\nThe active language is English. When "action" is "reply", write the "reply" content strictly in natural, concise English.'
        : ''
      const agentSystem = `你是一个智能、专业的飞书全能协同助手。你的任务是分析用户的指令与历史对话，规划最精准的动作并返回 JSON。${hostSkillNote}${langInstruction}

可用 action 列表：
1. "get_calendar": 查询日历日程、会议安排、今天/明天的安排或空闲时间。
2. "get_tasks": 查询待办清单、任务、TODO、未完成事项。
3. "get_chats": 查询或搜索用户加入的飞书群聊、讨论组、项目群。
4. "get_mails": 查询邮件速览、近期重要邮件、收件箱。
5. "search_contacts": 查找企业通讯录中的联系人/同事/邮箱/部门。需提供 "query" 字段（人名或关键词）。
6. "search_wiki": 搜索飞书团队知识库、云文档、在线规范、规章制度、文档内容。需提供 "query" 字段（关键词，如“规范”、“指南”等）。
7. "list_spaces": 查询或列出团队拥有的知识库空间列表。
8. "suggest_create_table": 用户明确想要“新建/创建”一张飞书多维表格（Bitable Base）或业务数据表、台账。
9. "run_skill": 调用官方飞书 Skill 处理扩展领域（例如审批 lark-approval、会议纪要 lark-meeting / lark-workflow-meeting-summary、站会汇报 lark-workflow-standup-report、电子表格 lark-sheets、幻灯片 lark-slides、云盘 lark-drive、OKR lark-okr、考勤 lark-attendance 等）；需同时提供 "skill" 字段。
10. "reply": 不需要调用飞书 API，直接基于上下文回答用户。场景包括：
   - 正常问答交流、日常对话、寒暄、致谢（如用户说“谢谢”、“好的”、“你好”等，请自然友好地回应）；
   - 格式化与排版需求（如“以表格的形式给出”、“转成Markdown表格”、“排成表格”）：必须在 "reply" 字段中，将上文中的飞书数据整理为美观整洁的 Markdown 表格！
   - 上下文追问、提问与统计（如“第二封邮件讲了什么”、“哪个会议最早”、“帮我写个回复”）；
   - 协作撰写建议、办公咨询等。${extraSkillCatalogText}

核心推理规则：
- 日常高频日程/待办/群聊/邮件/联系人/知识库搜索优先使用第 1-7 项快捷动作；
- 只有当请求属于快捷动作之外的飞书能力（如审批、会议纪要、OKR、电子表格、幻灯片、云盘、考勤等），才选择 "run_skill"；
- 如果用户是在追问、质疑或要求重查上一轮数据（例如“确定吗？你再重新查一次”、“刷新一下”、“再搜搜”、“没有吗”、“你不查了吗”），请回溯对话历史，选择上一轮查询对应的 action（如 get_chats/get_calendar/get_mails/get_tasks/search_wiki 等）！
- 如果用户要求“以表格的形式给出”或类似排版指令，动作必须为 "reply"，并在 "reply" 字段中输出包含 Markdown 表格的回答，严禁选 suggest_create_table。
- 如果用户只是在进行正常问答、对话或致谢，动作必须为 "reply"，直接给出自然对话回复，绝对不要调用任何飞书查询工具！

请只输出合法的 JSON 对象（字符串内换行必须转义为 \\n），不要输出代码块外部的文字：
{
  "action": "get_calendar" | "get_tasks" | "get_chats" | "get_mails" | "search_contacts" | "search_wiki" | "list_spaces" | "suggest_create_table" | "run_skill" | "reply",
  "skill": "当 action 为 run_skill 时的官方 skill 名称（例如 lark-approval）",
  "query": "搜索关键词（search_contacts 与 search_wiki 需要）",
  "reply": "当 action 为 reply 时的回答内容（支持 Markdown）"
}`

      const userContentText = attachPrompt ? `${text}\n\n${attachPrompt}` : text
      const jsonReplyForwarder = createJsonReplyStreamForwarder(onDelta)
      agentRaw = await callLlm({
        system: agentSystem,
        messages: [
          ...formattedHistory,
          { role: 'user', content: [{ type: 'text', text: userContentText }, ...imageBlocks] },
        ],
        model,
        provider,
        temperature: 0.2,
        onDelta: jsonReplyForwarder,
      }, signal)

      if (agentRaw) {
        agentDecision = parseModelJson(agentRaw)
      }
    } catch (e) {
      console.warn('[dsh-lark] agentDecision fallback:', e?.message || e)
    }

    // 2. 处理大模型的回答决策（支持结构化 reply 与自然语言直接回复）
    if (agentDecision && agentDecision.action) {
      if (agentDecision.action === 'suggest_create_table' || agentDecision.action === 'create_table') {
        let planFailureMsg = ''
        if (planner && typeof planner.plan === 'function') {
          onDelta?.({ type: 'stage', stage: 'planning_table' })
          try {
            const planned = await planner.plan(text, signal, undefined, {
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
                sentence: text,
                reply: isEn
                  ? `Drafted "${planned.plan.baseName}". Review the fields in the preview screen and click Create Base.`
                  : `已为您规划好「${planned.plan.baseName}」！请在预览界面确认字段并一键建表。`,
                summary: isEn ? `Planned "${planned.plan.baseName}"` : `已规划「${planned.plan.baseName}」`,
                reasoning: agentRaw?.reasoning || null,
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
                : `检测到您想创建多维表格。请告诉我需要包含什么字段或业务场景，我直接为您规划生成！`),
          summary: isEn ? 'Suggest creating a Base' : '建议前往多维表格模式',
        }
      }

      if (agentDecision.action === 'run_skill' && typeof agentDecision.skill === 'string') {
        const skillName = agentDecision.skill.trim()
        const label = skillLabel(skillName, activeLang, skillName, skillName)
        const guide = await readOfficialSkillGuide(skillName, signal)
        if (guide) {
          const skillPlanRaw = await callLlm({
            system: `你是一名精通飞书 CLI 的智能执行器。请严格依据下面这份官方 Skill 文档，把用户请求翻译为安全、只读查询的 lark-cli 子命令参数（不含 lark-cli 本身与 --as 等全局参数）。
- argv/steps 的第 1 个元素**必须**是飞书域名（如 "approval"、"attendance"、"okr"、"minutes"、"vc"、"sheets"、"docs"、"task"），不能省略！例如 ["approval", "tasks", "query", "--topic", "1"] 或 ["okr", "+cycle-list"]；
- 若用户请求包含多个不相关领域，只聚焦处理当前 Skill（${skillName}）对应的部分，不要强行跨领域拼装无关命令；
- 若属于单一查询命令，填 "argv": ["domain", "subcommand", "..."]；
- 若属于组合工作流（如站会摘要/会议纪要汇总需连续查多个接口），填 "steps": [["domain", "subcommand1", ...], ["domain", "subcommand2", ...]]；
- 只读查询必须使用具体的 typed flags（例如 attendance 必须带 "--employee-type", "employee_no"），严禁使用 --output、--output-dir、--output-path、--overwrite、--download-resources、--params、--page-all 或 @file 参数；
- 若该需求需要修改/新建/删除/发送/下载写盘等操作，或无法用纯只读查询完成，请把 "readonly" 设为 false，并用 1-2 句简洁通俗的人话填写 "confirmReason"（说明将对飞书做什么、有何影响，绝不要出现 lark-cli、--xxx 参数名等技术术语）。${isEn ? '\n- Always write confirmReason and reply in natural English.' : ''}

官方 Skill（${skillName}）文档：
${guide.slice(0, 28000)}

仅返回 JSON：
{
  "argv": ["domain", "subcommand", "..."],
  "steps": [["domain", "subcommand1", "..."]],
  "readonly": true | false,
  "confirmReason": "当 readonly=false 时，用通俗人话说明即将执行的操作及影响（不含技术参数）",
  "reply": "当文档提示无法直接运行或需要用户在主对话/特定链接操作时的直接回答"
}`,
            messages: [
              ...formattedHistory,
              { role: 'user', text },
            ],
            model,
            provider,
            temperature: 0.1,
          }, signal)
          const skillPlan = skillPlanRaw ? parseModelJson(skillPlanRaw) : null
          const rawSteps = Array.isArray(skillPlan?.steps) && skillPlan.steps.length > 0
            ? skillPlan.steps
            : (skillPlan && Array.isArray(skillPlan.argv) ? [skillPlan.argv] : [])
          const plannedSteps = rawSteps
            .map((s) => normalizeSkillArgvWithDomain(s, skillName))
            .filter((s) => isWellFormedSkillArgv(s))

          if (plannedSteps.length > 0) {
            const allAllowlistedReadonly = plannedSteps.every((step) => validateReadonlySkillArgv(step).ok)
            if (skillPlan.readonly === false || !allAllowlistedReadonly) {
              const firstCmd = plannedSteps.map((s) => `lark-cli ${s.join(' ')}`).join(' && ')
              const fallbackReason = isEn
                ? `This action (${label}) will modify or export Feishu data and requires your confirmation before running.`
                : `即将执行「${label}」相关操作，可能变更数据或产生外部影响，请确认后继续。`
              const reason = skillPlan.confirmReason || fallbackReason
              return {
                ok: true,
                type: 'answer',
                domain: skillName,
                needsConfirm: true,
                confirmKind: 'skill_guard',
                skill: skillName,
                skillLabel: label,
                confirmReason: reason,
                commandPreview: firstCmd,
                argv: plannedSteps[0],
                steps: plannedSteps,
                reply: isEn
                  ? `${reason}\n\nCommand: \`${firstCmd}\``
                  : `${reason}`,
                summary: isEn ? `Confirm action (${label})` : `待确认操作（${label}）`,
              }
            }

            return await executeSkillSteps(skillName, label, plannedSteps, text, { model, provider, activeLang, isEn, onDelta, allowAutoRepair: true }, signal)
          }
          if (skillPlan?.reply) {
            return {
              ok: true,
              type: 'collab',
              domain: skillName,
              skill: skillName,
              reply: skillPlan.reply,
              summary: isEn ? `Checked ${skillName}` : `已参考 ${skillName}`,
            }
          }
        }
      }

      const replyText = agentDecision.reply || agentDecision.text || agentDecision.content
      if (agentDecision.action === 'reply' && replyText) {
        return {
          ok: true,
          type: 'collab',
          reply: adaptUrlTextForBrand(String(replyText).trim(), brand),
          reasoning: agentRaw?.reasoning || null,
          summary: isEn ? 'Replied' : '已回复',
        }
      }
    } else if (agentRaw && agentRaw.text && !/^\s*\{[\s\S]*"action"\s*:/.test(agentRaw.text)) {
      // 仅当模型确实返回了纯自然语言（而非内部 action JSON）时才直接透传
      return {
        ok: true,
        type: 'collab',
        reply: adaptUrlTextForBrand(String(agentRaw.text).trim(), brand),
        reasoning: agentRaw.reasoning || null,
        summary: isEn ? 'Replied' : '已回复',
      }
    }

    // 3. 大模型结构化调度分支（无硬编码关键词兜底）
    const chosenAction = agentDecision?.action

    // 日程与会议查询
    if (chosenAction === 'get_calendar') {
      const res = await calendarList(signal)
      if (!res.ok) {
        if (res.error?.subtype === 'missing_scope' || /missing required scope/i.test(res.message || '')) {
          return scopeError('calendar', res.error?.missing_scopes || ['calendar:calendar.event:read'], '飞书日历与日程', '日历', 'Feishu Calendar', 'Calendar')
        }
        return {
          ok: false,
          type: 'answer',
          domain: 'calendar',
          reply: isEn ? `Failed to load calendar: ${humanizeCliError(res.message, isEn)}` : `查询日程失败：${humanizeCliError(res.message, isEn)}`,
        }
      }
      const events = res.value?.events || res.value?.data?.events || res.value?.data?.items || res.value?.items || []
      if (!Array.isArray(events) || events.length === 0) {
        return {
          ok: true,
          type: 'collab',
          domain: 'calendar',
          reply: isEn
            ? 'Today’s Agenda:\n\nNo upcoming events or meetings scheduled for today.'
            : '今日日程安排：\n\n今天暂无待进行的日程或会议，可以专注处理其他工作。',
          summary: isEn ? 'No events today' : '今日暂无日程安排',
        }
      }
      const lines = events.map((ev, i) => `${i + 1}. ${ev.summary || (isEn ? 'Untitled meeting' : '未命名会议')} (${ev.start_time || (isEn ? 'TBD' : '时间待定')})`)
      return {
        ok: true,
        type: 'collab',
        domain: 'calendar',
        reply: isEn ? `Today’s events:\n\n${lines.join('\n')}` : `为您找到以下日程安排：\n\n${lines.join('\n')}`,
        summary: isEn ? `Found ${events.length} event(s)` : `已查询到 ${events.length} 项日程`,
        data: events,
      }
    }

    // 5. 任务与待办清单
    if (chosenAction === 'get_tasks') {
      const res = await taskList(signal)
      if (!res.ok) {
        if (res.error?.subtype === 'missing_scope' || /missing required scope/i.test(res.message || '')) {
          return scopeError('task', res.error?.missing_scopes || ['task:task:read'], '飞书任务与待办', '任务', 'Feishu Tasks', 'Tasks')
        }
        return {
          ok: false,
          type: 'answer',
          domain: 'task',
          reply: isEn ? `Failed to load tasks: ${humanizeCliError(res.message, isEn)}` : `查询待办失败：${humanizeCliError(res.message, isEn)}`,
        }
      }
      const tasks = res.value?.tasks || res.value?.data?.tasks || res.value?.data?.items || res.value?.items || []
      if (!Array.isArray(tasks) || tasks.length === 0) {
        return {
          ok: true,
          type: 'collab',
          domain: 'task',
          reply: isEn ? 'My Tasks:\n\nYou have no open tasks right now.' : '我的待办清单：\n\n当前没有未完成的待办事项。',
          summary: isEn ? 'No open tasks' : '暂无未完成待办',
        }
      }
      const lines = tasks.map((tk, i) => `${i + 1}. [ ] ${tk.summary || tk.title || (isEn ? 'Untitled task' : '待办事项')}`)
      return {
        ok: true,
        type: 'collab',
        domain: 'task',
        reply: isEn ? `Open tasks:\n\n${lines.join('\n')}` : `为您找到以下待办事项：\n\n${lines.join('\n')}`,
        summary: isEn ? `Found ${tasks.length} task(s)` : `已查询到 ${tasks.length} 项待办`,
        data: tasks,
      }
    }

    // 6. 即时消息与群聊检索
    if (chosenAction === 'get_chats') {
      const res = await chatList(signal)
      if (!res.ok) {
        if (res.error?.subtype === 'missing_scope' || /missing required scope/i.test(res.message || '')) {
          return scopeError('im', res.error?.missing_scopes || ['im:chat:read'], '即时消息与群聊', '消息与群聊', 'Chats & Messages', 'Chats')
        }
        return {
          ok: false,
          type: 'answer',
          reply: isEn ? `Failed to load chats: ${humanizeCliError(res.message, isEn)}` : `查询群聊失败：${humanizeCliError(res.message, isEn)}`,
        }
      }
      const chats = res.value?.data?.chats || res.value?.chats || res.value?.items || res.value?.data?.items || []
      if (!Array.isArray(chats) || chats.length === 0) {
        return {
          ok: true,
          type: 'collab',
          domain: 'im',
          reply: isEn
            ? 'Group Chats:\n\nNo accessible chats found. For private chats, add the Feishu app bot to the group first.'
            : '群聊列表：\n\n未检索到您加入的公开群聊。如果您所在的群聊为私密群，需先将飞书机器人拉入该群。',
          summary: isEn ? 'No chats found' : '暂无群聊',
        }
      }
      const lines = chats.slice(0, 10).map((c, i) => `${i + 1}. ${c.name || (isEn ? 'Untitled group' : '未命名群聊')}`)
      return {
        ok: true,
        type: 'collab',
        domain: 'im',
        reply: isEn ? `Feishu group chats:\n\n${lines.join('\n')}` : `为您找到以下飞书群聊：\n\n${lines.join('\n')}`,
        summary: isEn ? `Found ${chats.length} chat(s)` : `已查询到 ${chats.length} 个群聊`,
        data: chats,
      }
    }

    // 7. 邮件速览
    if (chosenAction === 'get_mails') {
      const res = await mailList(signal)
      if (!res.ok) {
        if (res.error?.subtype === 'missing_scope' || /missing required scope/i.test(res.message || '')) {
          return scopeError('mail', res.error?.missing_scopes || ['mail:user_mailbox.messages:readonly'], '飞书邮箱', '邮箱', 'Feishu Mail', 'Mail')
        }
        return {
          ok: false,
          type: 'answer',
          domain: 'mail',
          reply: isEn ? `Failed to load mail: ${humanizeCliError(res.message, isEn)}` : `查询邮件失败：${humanizeCliError(res.message, isEn)}`,
        }
      }
      const mails = res.value?.messages || res.value?.data?.messages || []
      if (!Array.isArray(mails) || mails.length === 0) {
        return {
          ok: true,
          type: 'collab',
          domain: 'mail',
          reply: isEn ? 'Inbox:\n\nNo recent messages found.' : '飞书邮件速览：\n\n最近暂无新邮件。',
          summary: isEn ? 'No recent mail' : '暂无新邮件',
        }
      }

      const lines = mails.slice(0, 5).map((m, i) => `${i + 1}. ${m.subject || (isEn ? '(No subject)' : '无主题')} (${isEn ? 'From' : '发件人'}: ${m.from || (isEn ? 'Unknown' : '未知')})`)
      return {
        ok: true,
        type: 'collab',
        domain: 'mail',
        reply: isEn ? `Recent mail:\n\n${lines.join('\n')}` : `为您找到以下近期邮件：\n\n${lines.join('\n')}`,
        summary: isEn ? `Found ${mails.length} message(s)` : `已查询到 ${mails.length} 封邮件`,
        data: mails,
      }
    }

    // 8. 通讯录联系人检索
    if (chosenAction === 'search_contacts') {
      const q = String(agentDecision?.query || text || '').trim() || 'me'
      const res = await contactSearch(q, signal)
      if (!res.ok) {
        if (res.error?.subtype === 'missing_scope' || /missing required scope/i.test(res.message || '')) {
          return scopeError('contact', res.error?.missing_scopes || ['contact:contact:readonly'], '飞书通讯录', '通讯录', 'Contacts', 'Contacts')
        }
        return {
          ok: false,
          type: 'answer',
          domain: 'contact',
          reply: isEn ? `Failed to search contacts: ${humanizeCliError(res.message, isEn)}` : `查询通讯录失败：${humanizeCliError(res.message, isEn)}`,
        }
      }
      const users = res.value?.data?.users || res.value?.users || []
      if (!Array.isArray(users) || users.length === 0) {
        return {
          ok: true,
          type: 'collab',
          domain: 'contact',
          reply: isEn ? `Contacts:\n\nNo contacts matched "${q}".` : `通讯录检索：\n\n未检索到与「${q}」相关的联系人。`,
          summary: isEn ? 'No contacts found' : '未找到联系人',
        }
      }
      const lines = users.slice(0, 5).map((u, i) => `${i + 1}. ${u.localized_name || u.name || (isEn ? 'Unknown' : '未知姓名')}${u.department ? ` · ${u.department}` : ''}${u.enterprise_email || u.email ? ` (${u.enterprise_email || u.email})` : ''}`)
      return {
        ok: true,
        type: 'collab',
        domain: 'contact',
        reply: isEn ? `Matching contacts:\n\n${lines.join('\n')}` : `为您找到以下飞书联系人：\n\n${lines.join('\n')}`,
        summary: isEn ? `Found ${users.length} contact(s)` : `已找到 ${users.length} 位联系人`,
        data: users,
      }
    }

    // 9. 知识库与云文档检索
    if (chosenAction === 'search_wiki') {
      const q = String(agentDecision?.query || text || '').trim() || (isEn ? 'guide' : '规范')
      const res = await docsSearch(q, signal)
      if (!res.ok) {
        if (res.error?.subtype === 'missing_scope' || /missing required scope/i.test(res.message || '')) {
          return scopeError('docs', res.error?.missing_scopes || ['wiki:space:read', 'search:docs:read'], '知识库与云文档', '文档', 'Docs & Wiki', 'Docs')
        }
        return {
          ok: false,
          type: 'answer',
          domain: 'wiki',
          reply: isEn ? `Failed to search docs & wiki: ${humanizeCliError(res.message, isEn)}` : `检索知识库与文档失败：${humanizeCliError(res.message, isEn)}`,
        }
      }
      const results = res.value?.data?.results || res.value?.results || []
      if (!Array.isArray(results) || results.length === 0) {
        return {
          ok: true,
          type: 'collab',
          domain: 'wiki',
          reply: isEn
            ? `Docs & Wiki:\n\nNo results found for "${q}". Try another keyword.`
            : `知识库与文档检索：\n\n未检索到与「${q}」相关的文档或知识库内容。建议更换关键词重试。`,
          summary: isEn ? 'No docs found' : '未找到相关文档',
        }
      }
      const lines = results.slice(0, 5).map((item, i) => {
        const title = (item.title_highlighted || item.result_meta?.title || (isEn ? 'Untitled doc' : '未命名文档')).replace(/<\/?h>/g, '')
        const url = adaptUrlTextForBrand(item.result_meta?.url || '', brand)
        const summary = (item.summary_highlighted || '').replace(/<\/?h>/g, '')
        const link = url ? `[${title}](${url})` : title
        return `${i + 1}. **${link}**\n   ${summary || (isEn ? 'No preview available' : '暂无摘要')}`
      })
      return {
        ok: true,
        type: 'collab',
        domain: 'wiki',
        reply: isEn
          ? `Found in Feishu Docs & Wiki for "${q}":\n\n${lines.join('\n\n')}`
          : `为您在飞书知识库与云文档中找到以下与「${q}」相关的内容：\n\n${lines.join('\n\n')}`,
        summary: isEn ? `Found ${results.length} doc(s)` : `已找到 ${results.length} 篇相关文档`,
        data: results,
      }
    }

    if (chosenAction === 'list_spaces') {
      const res = await wikiSpaceList(signal)
      if (!res.ok) {
        if (res.error?.subtype === 'missing_scope' || /missing required scope/i.test(res.message || '')) {
          return scopeError('wiki', res.error?.missing_scopes || ['wiki:space:read'], '飞书知识库', '知识库', 'Feishu Wiki', 'Wiki')
        }
        return {
          ok: false,
          type: 'answer',
          domain: 'wiki',
          reply: isEn ? `Failed to list Wiki spaces: ${humanizeCliError(res.message, isEn)}` : `查询知识库失败：${humanizeCliError(res.message, isEn)}`,
        }
      }
      if (res.ok && res.value?.data?.spaces) {
        const spaces = res.value.data.spaces
        const lines = spaces.map((sp, i) => `${i + 1}. **${sp.name}** (${sp.space_type === 'team' ? (isEn ? 'Team Wiki' : '团队知识库') : (isEn ? 'Personal Wiki' : '个人知识库')})`)
        return {
          ok: true,
          type: 'collab',
          domain: 'wiki',
          reply: isEn ? `Feishu Wiki spaces:\n\n${lines.join('\n')}` : `为您找到以下飞书知识库空间：\n\n${lines.join('\n')}`,
          summary: isEn ? `Found ${spaces.length} space(s)` : `已查询到 ${spaces.length} 个知识库`,
          data: spaces,
        }
      }
    }

    // 10. 通用上下文追问 / 协同答疑 / 自然对话（彻底告别复读机）
    const generalLlmReply = await callLlm({
      system: isEn
        ? `You are a helpful, concise Feishu/Lark assistant.
You help users check calendar events, manage tasks, search group chats, triage mail, look up contacts, and collaborate across Feishu.
Always answer in natural, friendly English using Markdown lists or tables when helpful. Never output raw internal JSON.`
        : `你是一个专业、贴心、高效的飞书全能协同助手。
你可以协助用户查阅日程、整理待办任务、检索飞书群聊、速览邮件、查找企业通讯录，或提供办公协作建议。
请结合上下文中的飞书数据和用户的最新提问，给出亲切、准确、高情商的回答。
如果用户要求表格呈现，请输出标准的 Markdown 表格。严禁输出内部 JSON 结构，严禁给出机械重复的套话。`,
      messages: [
        ...formattedHistory,
        { role: 'user', content: [{ type: 'text', text: attachPrompt ? `${text}\n\n${attachPrompt}` : text }, ...imageBlocks] },
      ],
      model,
      provider,
      onDelta: createPlainReplyForwarder(onDelta),
    }, signal)

    if (generalLlmReply) {
      return {
        ok: true,
        type: 'collab',
        reply: String(generalLlmReply.text || generalLlmReply).trim(),
        reasoning: generalLlmReply.reasoning || null,
        summary: isEn ? 'Replied' : '已回复',
      }
    }

    return {
      ok: true,
      type: 'collab',
      reply: isEn
        ? `Received "${text}". Ask me to check today’s agenda, list open tasks, search chats, or summarize recent mail.`
        : `已收到您的指令：「${text}」。\n您可以告诉我具体的需求，例如「查今天日程」、「列出待办清单」、「搜我加入的群聊」或「速览近期邮件」。`,
      summary: isEn ? 'Processed request' : '已处理协同指令',
    }
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
    exchangeState,
    getScopes,
    calendarList,
    calendarCreate,
    calendarDelete,
    taskList,
    taskCreate,
    taskComplete,
    taskDelete,
    chatList,
    messageSend,
    mailList,
    mailSend,
    mailReply,
    contactSearch,
    docsSearch,
    wikiSpaceList,
    dispatchCollab,
    installCommand: INSTALL_COMMAND,
  }
}
