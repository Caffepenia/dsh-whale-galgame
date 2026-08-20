import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import * as nativeFs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { Context, Service, isConstructor } from '@deepseek-ai/cordis'
import * as whalePlugin from '../src/index.ts'
import { apply } from '../src/index.ts'
import { redactSecrets } from '@deepseek-ai/dsh-settings'
import { WhaleHostSettings, installWhaleSettings } from '../src/settings.ts'
import { WHALE_SETTINGS_NS } from '../src/settings-namespace.ts'
import { readFile } from 'node:fs/promises'

function baseConfig(): any {
  return {
    dashscopeBaseUrl: 'https://dashscope.aliyuncs.com',
    dashscopeApiKey: 'entry-key',
    dashscopeModel: 'qwen-image-3.0',
    dashscopeSize: '1920*1080',
    sideStoryRecencyDays: 14,
  }
}

/** A settings service that records the registration and can push a change. */
function fakeSettingsCtx(section: any) {
  const calls: any[] = []
  let watcher: (() => void) | null = null
  const scope = {
    get: () => section,
    watch: (fn: () => void) => { watcher = fn },
  }
  const sctx: any = {
    // installSettingsSection checks ctx.fiber.state before every callback so a
    // disposing plugin stops reacting; a live fiber is neither of those states.
    fiber: { state: 'active' },
    settings: {
      register: (ns: string, schema: any, options: any) => {
        calls.push({ ns, schema, options })
        return scope
      },
    },
    effect: () => {},
    inject: (_names: string[], cb: Function) => cb(sctx),
  }
  return { ctx: sctx, calls, change: (next: any) => { section = next; watcher?.() } }
}

test('registers the namespace the settings card keys itself to', () => {
  // The card renders only where its key matches a served namespace, so the
  // namespace string is load-bearing, not cosmetic.
  const fake = fakeSettingsCtx(baseConfig())
  installWhaleSettings(fake.ctx, baseConfig())
  assert.equal(fake.calls.length, 1)
  assert.equal(String(fake.calls[0].ns), 'dsh-whale-galgame')
  assert.equal(String(WHALE_SETTINGS_NS), 'dsh-whale-galgame')
})

test('a saved change reaches the live config the plugin reads', () => {
  const resolved = baseConfig()
  const fake = fakeSettingsCtx(baseConfig())
  installWhaleSettings(fake.ctx, resolved)
  fake.change({ ...baseConfig(), dashscopeModel: 'qwen-image-4.0', sideStoryRecencyDays: 30 })
  assert.equal(resolved.dashscopeModel, 'qwen-image-4.0')
  assert.equal(resolved.sideStoryRecencyDays, 30)
})

test('a host with no settings service leaves the plugin working as composed', () => {
  // Every dsh before 0.1.0-rc.7 has no settings capability. An unsatisfied
  // cordis injection never calls back, which is exactly what a host without
  // the service does — so the wiring simply does not happen and the entry
  // configuration stands.
  const resolved = baseConfig()
  let injected: string[] = []
  const ctx: any = { inject: (names: string[]) => { injected = names } }
  assert.doesNotThrow(() => installWhaleSettings(ctx, resolved))
  assert.deepEqual(injected, ['settings'], 'the wiring asks for the service rather than assuming it')
  assert.equal(resolved.dashscopeModel, 'qwen-image-3.0')
})

test('cordis sees apply\'s promise, so registration precedes ACTIVE', async () => {
  // What this proves: cordis invokes `apply` as a function and waits for the
  // promise it returns. That hangs on the declaration being `async` — cordis
  // picks its invocation with isConstructor(), true for any function carrying
  // a `prototype`, so a plain `function apply()` is called with `new`, the
  // returned promise becomes the instance, and cordis — finding no
  // [symbols.init] on it — reaches ACTIVE having never seen it. An async
  // function has no `prototype`. It has to be driven through ctx.plugin() with
  // a real Context, because apply(fakeCtx) bypasses that dispatch entirely.
  //
  // What this does NOT prove, and no test here can: that the Settings tab sees
  // the namespace. The tab caches its own settings.describe() and re-reads
  // only on `settings/document-updated` or `connection/reset`, neither of
  // which registration emits. A describe landing while this fiber is still
  // importing caches a list without this plugin. ACTIVE is the barrier this
  // plugin controls, not the one the tab consumes; see the comment at the
  // import in src/index.ts.
  assert.equal(isConstructor(apply), false, 'a constructible apply has its promise discarded by cordis')

  const registered: string[] = []
  class FakeSettings extends Service {
    constructor(ctx: any) { super(ctx, 'settings') }
    register(ns: string) {
      registered.push(String(ns))
      return { get: () => baseConfig(), watch: () => undefined }
    }
  }
  class FakeWebServer extends Service {
    constructor(ctx: any) { super(ctx, 'webServer') }
    register() { return undefined }
  }
  class FakeLlm extends Service {
    constructor(ctx: any) { super(ctx, 'llm') }
    listProviders() { return [] }
    async listModels() { return [] }
    async resolveModelInfo() { return {} }
  }

  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-cordis-'))
  const originalConsoleError = console.error
  console.error = () => undefined
  try {
    const root: any = new Context()
    root.plugin((ctx: any) => { void new FakeSettings(ctx) })
    root.plugin((ctx: any) => { void new FakeWebServer(ctx) })
    root.plugin((ctx: any) => { void new FakeLlm(ctx) })
    root.dshHomePath = (...segments: string[]) => join(dshHome, ...segments)

    const ACTIVE = 2
    const activations: number[] = []
    root.on('internal/status', (changed: any) => {
      if (changed.runtime && changed.runtime.name === 'whale-galgame' && changed.state === ACTIVE) {
        activations.push(registered.length)
      }
    })

    root.plugin(whalePlugin, baseConfig())
    for (let attempt = 0; attempt < 200 && activations.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.deepEqual(registered, ['dsh-whale-galgame'], 'the namespace was registered')
    assert.deepEqual(activations, [1], 'and it existed before this plugin was ACTIVE')
  } finally {
    console.error = originalConsoleError
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('the settings module is loaded dynamically, or an old host loses the whole plugin', async () => {
  // src/settings.ts imports two packages that live in the Host's module tree
  // and are absent before dsh 0.1.0-rc.7 (dsh profiles are created with
  // autoInstallPeers: false, so a peer declaration does not put them there).
  // Static imports resolve before any code runs, so a static import here does
  // not cost an old host the settings card — it costs it the plugin, with
  // ERR_MODULE_NOT_FOUND and no pet and no galgame tab.
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.match(source, /import\('\.\/settings\.ts'\)/, 'the module is reached through a dynamic import')
  assert.doesNotMatch(source, /^import .*from '\.\/settings\.ts'/m, 'and never through a static one')
})

test('the API key is declared a secret so it never crosses to the browser', () => {
  // The settings service strips role('secret') fields before the value leaves
  // the Host; without the role the key would be shipped to every client.
  const dict = (WhaleHostSettings as any).dict
  assert.ok(dict, 'schema exposes its fields')
  assert.equal(dict.dashscopeApiKey.meta.role, 'secret')
  assert.notEqual(dict.dashscopeBaseUrl.meta.role, 'secret')
})

test('the redacted wire value carries no key, and neither does the schema', () => {
  // DSH documents two ways a secret still escapes: one reachable only through
  // a union, intersection or transform comes back verbatim, and toJSON()
  // carries a secret's default to every client. Asserting the meta flag alone
  // would not notice either, so this runs the Host's own redaction over this
  // exact schema and reads what actually crosses.
  const KEY = 'sk-this-must-never-cross'
  const { value, secrets } = redactSecrets(WhaleHostSettings, { ...baseConfig(), dashscopeApiKey: KEY })
  assert.equal(JSON.stringify(value).includes(KEY), false, JSON.stringify(value))
  assert.equal((value as any).dashscopeApiKey, undefined, 'the field is dropped, not blanked')
  assert.deepEqual(secrets, [{ path: ['dashscopeApiKey'], set: true }])
  assert.deepEqual(
    redactSecrets(WhaleHostSettings, baseConfig() as any).secrets,
    [{ path: ['dashscopeApiKey'], set: true }],
  )
  // A non-empty default would be published to every client through toJSON.
  assert.equal(JSON.stringify(WhaleHostSettings.toJSON()).includes(KEY), false)
  assert.equal((WhaleHostSettings as any).dict.dashscopeApiKey.meta.default, '')
})


test('the settings payload says whether a key is configured, never the key', async () => {
  // The card has to render "configured" without a secret reaching the browser,
  // so the plugin answers with a boolean. This asserts the whole response, not
  // just the field, because a leak anywhere in it is the same leak.
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-secret-'))
  const KEY = 'sk-this-must-never-cross'
  const root = 'E:\\workspace\\secret'
  const files = new Map<string, string>()
  const sessions = [{
    header: { version: 0, id: 'secret-session', cwd: root, createdAt: 1_000 },
    live: true,
    persisted: true,
    events: [],
  }]
  let routeHandler: any = null
  const services: any = {
    fs: {
      resolve: async () => root + '\\.whale-girl-save.json',
      stat: async (target: string) => files.has(target) ? { type: 'file', version: 1 } : undefined,
      readText: async (target: string) => {
        if (!files.has(target)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        return files.get(target)!
      },
      writeText: async (target: string, value: string) => {
        const existed = files.has(target)
        files.set(target, value)
        return { operation: existed ? 'update' : 'create', version: 1 }
      },
    },
    sandboxPolicy: { resolve: () => undefined },
    sessions: { list: () => sessions },
    workspaceRegistry: { list: () => [{ path: root }] },
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    dshHomePath: (...segments: string[]) => join(dshHome, ...segments),
    sessionQuery: { listSessions: async () => sessions, listEvents: async () => [], filterSessions: async () => sessions },
  }
  const ctx: any = {
    dshHomePath: services.dshHomePath,
    webServer: { register: (route: any) => { routeHandler = route.handler } },
    llm: {
      listProviders: () => [{ id: 'p', name: 'P' }],
      listModels: async () => [{ id: 'm', name: 'M', inputModalities: ['text'] }],
      resolveModelInfo: async () => ({}),
      stream: async function* (): AsyncGenerator<any> {
        throw new Error('offline fixture')
        yield { type: 'text-delta', text: '' }
      },
    },
    inject: (names: string[], callback: Function) => {
      // An unsatisfied cordis injection never calls back. Answering a request
      // for a service this fake host does not have is what let a missing
      // service look available to the code under test.
      if (names.includes('settings')) return
      if (names.includes('sessionQuery')) callback({ sessionQuery: services.sessionQuery })
      else callback(services)
    },
    on: () => undefined,
    effect: (callback: Function) => callback(),
  }
  const originalConsoleError = console.error
  console.error = () => undefined
  try {
    apply(ctx, { ...baseConfig(), dashscopeApiKey: KEY }, { nativeGlobalIo: nativeFs })
    const req: any = Readable.from([JSON.stringify({ action: 'settings-get', args: { sessionId: 'secret-session' } })])
    req.method = 'POST'
    let body = ''
    await routeHandler(req, { writeHead: () => undefined, end: (value: string) => { body = value } })

    assert.equal(JSON.parse(body).dashscopeKeySet, true, 'the card can say a key is configured')
    assert.ok(!body.includes(KEY), 'the key itself is nowhere in the response')

    // And the negative: no key configured reads as not configured.
    let empty: any = null
    const ctx2 = { ...ctx, webServer: { register: (route: any) => { empty = route.handler } } }
    apply(ctx2 as any, { ...baseConfig(), dashscopeApiKey: '' }, { nativeGlobalIo: nativeFs })
    const req2: any = Readable.from([JSON.stringify({ action: 'settings-get', args: { sessionId: 'secret-session' } })])
    req2.method = 'POST'
    let body2 = ''
    await empty(req2, { writeHead: () => undefined, end: (value: string) => { body2 = value } })
    assert.equal(JSON.parse(body2).dashscopeKeySet, false)
  } finally {
    console.error = originalConsoleError
    rmSync(dshHome, { recursive: true, force: true })
  }
})
