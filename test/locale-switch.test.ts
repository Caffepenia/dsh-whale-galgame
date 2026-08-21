import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import * as nativeFs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { apply } from '../src/index.ts'

/**
 * Drives the plugin over its own HTTP action surface, which is where a stored
 * line is turned into something the browser renders.
 */
function makeHarness(dshHome: string, files = new Map<string, string>(), systems?: string[], requests?: any[]) {
  const root = 'E:\\workspace\\locale-switch'
  const sessions = [{
    header: { version: 0, id: 'locale-session', cwd: root, createdAt: 1_000 },
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
    agentDefaultModel: {
      currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }),
    },
    dshHomePath: (...segments: string[]) => join(dshHome, ...segments),
    sessionQuery: {
      listSessions: async () => sessions,
      listEvents: async () => [],
      filterSessions: async () => sessions,
    },
  }
  const ctx: any = {
    dshHomePath: services.dshHomePath,
    webServer: { register: (route: any) => { routeHandler = route.handler } },
    llm: {
      listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
      listModels: async () => [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', inputModalities: ['text'] }],
      resolveModelInfo: async () => ({}),
      stream: async function* (options: any): AsyncGenerator<any> {
        if (!systems) throw new Error('no model in this fixture')
        const system = String(options && options.system || '')
        systems.push(system)
        if (requests) requests.push(options)
        if (system.includes('情绪分类器')) yield { type: 'text-delta', text: 'normal' }
        else if (system.includes('对话选项生成器')) {
          yield { type: 'text-delta', text: '{"positive":"陪你休息一下","neutral":"继续聊聊吧","negative":"我想先静静"}' }
        } else yield { type: 'text-delta', text: '主人今天也辛苦了呢。' }
      },
    },
    inject: (names: string[], callback: Function) => {
      if (names.includes('sessionQuery')) callback({ sessionQuery: services.sessionQuery })
      else callback(services)
    },
    on: () => undefined,
    effect: (callback: Function) => callback(),
  }
  apply(ctx, { chatProvider: 'deepseek-official', chatModel: 'deepseek-v4-flash' }, { nativeGlobalIo: nativeFs })

  async function post(action: string, args: any = {}): Promise<any> {
    const req: any = Readable.from([JSON.stringify({ action, args: { ...args, sessionId: 'locale-session' } })])
    req.method = 'POST'
    let status = 0
    let body = ''
    await routeHandler(req, { writeHead: (n: number) => { status = n }, end: (v: string) => { body = v } })
    assert.equal(status, 200, body)
    return JSON.parse(body)
  }

  return { post, files }
}

function narratorOf(view: any): string {
  const row = (view.history || []).find((line: any) => line.who === 'narrator')
  assert.ok(row, 'the switch wrote a narrator line')
  return row.text
}

function globalSavePath(dshHome: string): string {
  return join(dshHome, 'storages', 'dsh-whale-galgame', 'global.json')
}

async function storedNarrator(dshHome: string): Promise<any> {
  const saved = JSON.parse(await nativeFs.readFile(globalSavePath(dshHome), 'utf8'))
  const state = saved.state || saved
  return (state.characters.chatgpt.chatLines || []).find((line: any) => line.who === 'narrator')
}

const SWITCH_NOTICE = '（你把角色来源切换为 小吉，小吉 登场了。）'

test('a narrator notice is stored as its sources, so a later locale can reach it', async () => {
  // Narrator lines join translatable fragments to runtime values, so the joined
  // result is not a table key and t() cannot reach it after the fact. Storing
  // the segments is what lets a language chosen later re-render a line that was
  // written before it. With no table loaded the rendering must be unchanged.
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-locale-'))
  const originalConsoleError = console.error
  console.error = () => undefined
  try {
    const harness = makeHarness(dshHome)
    await harness.post('view')

    const switched = await harness.post('settings-set', { characterMode: 'manual', characterId: 'chatgpt' })
    assert.equal(switched.ok, true)
    assert.equal(narratorOf(switched.view), SWITCH_NOTICE)

    const stored = await storedNarrator(dshHome)
    assert.ok(Array.isArray(stored.seg), 'the line is stored as segments, not as one rendered string')
    assert.ok(stored.seg.includes(' 登场了。）'), 'segments stay zh-CN: ' + JSON.stringify(stored.seg))
    assert.deepEqual(
      stored.seg.filter((part: any) => typeof part !== 'string'),
      [{ id: 'chatgpt', ref: 'address' }, { id: 'chatgpt', ref: 'displayName' }],
      'character text is a reference, so it follows the profile rather than freezing',
    )

    // A locale with no table must degrade to the source, not to blanks.
    const japanese = await harness.post('settings-set', { language: 'ja' })
    assert.equal(japanese.ok, true)
    assert.equal(narratorOf(japanese.view), SWITCH_NOTICE)
  } finally {
    console.error = originalConsoleError
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('the greeting and the fallback choices are saved at their zh-CN sources', async () => {
  // A value written while one language is active must not carry that language
  // into the save, or a later switch cannot reach it. Both of these are served
  // through the same read-side translation the rest of the history uses.
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-locale-src-'))
  const originalConsoleError = console.error
  console.error = () => undefined
  try {
    const harness = makeHarness(dshHome)
    await harness.post('view')
    await harness.post('settings-set', { characterMode: 'manual', characterId: 'chatgpt' })

    const saved = JSON.parse(await nativeFs.readFile(globalSavePath(dshHome), 'utf8'))
    const character = (saved.state || saved).characters.chatgpt
    const greeting = character.chatLines.find((line: any) => line.who === 'heroine')
    assert.equal(greeting.text, '「嗨，我把频道都理顺啦。现在只想听听你心里那一条线。」')
    assert.deepEqual(
      character.choices.map((choice: any) => choice.text).sort(),
      ['先让我安静一下', '想再靠近你一点', '那就继续聊聊吧'],
    )
  } finally {
    console.error = originalConsoleError
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('a saved fallback choice keeps provenance after restart', async () => {
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-choice-restart-'))
  const originalConsoleError = console.error
  console.error = () => undefined
  try {
    const files = new Map<string, string>()
    const harness = makeHarness(dshHome, files)
    await harness.post('view')
    const switched = await harness.post('settings-set', { language: 'zh-TW' })
    assert.ok(switched.view.choices.some((choice: any) => choice.text === '那就繼續聊聊吧'))

    const restarted = makeHarness(dshHome, files)
    const restored = await restarted.post('view')
    assert.ok(
      restored.choices.some((choice: any) => choice.text === '那就繼續聊聊吧'),
      JSON.stringify(restored.choices.map((choice: any) => choice.text)),
    )
  } finally {
    console.error = originalConsoleError
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('a picked choice is saved as the plugin\'s own text, a typed line verbatim', async () => {
  // The browser sends back the text it displayed, which has already been
  // translated. Saving that would freeze the line; the stored choice is the
  // same sentence at its source, and the view translates it on the way out.
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-locale-choice-'))
  const originalConsoleError = console.error
  console.error = () => undefined
  try {
    const harness = makeHarness(dshHome)
    const entry = await harness.post('view')
    const picked = entry.choices[0]

    const answered = await harness.post('chat', { choiceId: picked.id, text: 'WHATEVER THE BROWSER SENT' })
    const asChoice = answered.history.filter((line: any) => line.who === 'user').at(-1)
    assert.equal(asChoice.text, picked.text, 'the stored choice wins over the posted text')
    assert.equal(asChoice.choiceId, picked.id)

    const typed = await harness.post('chat', { text: '我自己打的一句話' })
    assert.equal(
      typed.history.filter((line: any) => line.who === 'user').at(-1).text,
      '我自己打的一句話',
      'a typed line is the user\'s own words and is kept as sent',
    )
  } finally {
    console.error = originalConsoleError
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('a picked fallback choice keeps provenance in history and later model context', async () => {
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-choice-provenance-'))
  const originalConsoleError = console.error
  console.error = () => undefined
  const systems: string[] = []
  const requests: any[] = []
  try {
    const harness = makeHarness(dshHome, new Map<string, string>(), systems, requests)
    const initial = await harness.post('view')
    const sourceChoice = initial.choices.find((choice: any) => choice.text === '那就继续聊聊吧')
    assert.ok(sourceChoice)

    const switched = await harness.post('settings-set', { language: 'zh-TW' })
    const displayed = switched.view.choices.find((choice: any) => choice.id === sourceChoice.id)
    assert.equal(displayed.text, '那就繼續聊聊吧')

    const answered = await harness.post('chat', { choiceId: sourceChoice.id, text: displayed.text })
    const picked = answered.history.filter((line: any) => line.who === 'user').at(-1)
    assert.equal(picked.text, '那就繼續聊聊吧')

    await harness.post('chat', { text: '這是下一句' })
    const dialogueRequests = requests.filter((request) => {
      const system = String(request && request.system || '')
      return !system.includes('情绪分类器') && !system.includes('对话选项生成器')
    })
    assert.equal(dialogueRequests.length, 2)
    const laterContext = dialogueRequests[1].messages
      .flatMap((message: any) => message.content || [])
      .map((part: any) => part.text)
    assert.ok(laterContext.includes('那就繼續聊聊吧'), JSON.stringify(laterContext))
    assert.ok(!laterContext.includes('那就继续聊聊吧'), JSON.stringify(laterContext))
  } finally {
    console.error = originalConsoleError
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('every prompt that writes dialogue states which script to write it in', async () => {
  // The character prompt used to imply this through its persona tone and the
  // other generators said nothing at all, so a conversation held in one script
  // could come back with reply buttons in the other. The rule travels through
  // the locale table, so this asserts the seam rather than the wording.
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-script-rule-'))
  const originalConsoleError = console.error
  console.error = () => undefined
  const systems: string[] = []
  try {
    const harness = makeHarness(dshHome, new Map<string, string>(), systems)
    const entry = await harness.post('view')
    const answered = await harness.post('chat', { choiceId: entry.choices[0].id, text: entry.choices[0].text })
    assert.notEqual(answered.fallbackUsed, true, 'the fixture model answered')

    const writesDialogue = systems.filter((system) => !system.includes('情绪分类器'))
    assert.ok(writesDialogue.length >= 2, 'both the character and the choice generator ran')
    for (const system of writesDialogue) {
      assert.ok(
        system.includes('输出必须使用简体中文。'),
        'prompt does not say which script to answer in: ' + system.slice(0, 60),
      )
    }
  } finally {
    console.error = originalConsoleError
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('a renamed character updates the notice that announced it', async () => {
  // The same property that makes a notice translatable: it names the character
  // rather than copying the name it had when the line was written.
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-locale-rename-'))
  const originalConsoleError = console.error
  console.error = () => undefined
  try {
    const harness = makeHarness(dshHome)
    await harness.post('view')
    await harness.post('settings-set', { characterMode: 'manual', characterId: 'chatgpt' })

    const renamed = await harness.post('profile-set', {
      characterId: 'chatgpt',
      overrides: { displayName: '吉吉' },
    })
    assert.equal(renamed.ok, true, JSON.stringify(renamed))
    const view = await harness.post('view')
    assert.ok(narratorOf(view).includes('吉吉'), narratorOf(view))
  } finally {
    console.error = originalConsoleError
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('a line saved before segments existed keeps its text instead of breaking', async () => {
  // Existing saves hold flat narrator text. It cannot be retranslated, but it
  // must still render, so the reader falls back to the stored wording.
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-locale-old-'))
  const originalConsoleError = console.error
  console.error = () => undefined
  try {
    const harness = makeHarness(dshHome)
    await harness.post('view')
    await harness.post('settings-set', { characterMode: 'manual', characterId: 'chatgpt' })

    // Rewrite the global save the way a build without segments stored it.
    const global = globalSavePath(dshHome)
    const saved = JSON.parse(await nativeFs.readFile(global, 'utf8'))
    const state = saved.state || saved
    const lines = state.characters.chatgpt.chatLines
    lines[lines.findIndex((line: any) => line.who === 'narrator')] = { who: 'narrator', text: SWITCH_NOTICE }
    await nativeFs.writeFile(global, JSON.stringify(saved), 'utf8')

    const restarted = makeHarness(dshHome)
    assert.equal(narratorOf(await restarted.post('view')), SWITCH_NOTICE)
  } finally {
    console.error = originalConsoleError
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('the view carries the language, because not every surface reads settings', () => {
  // The browser translates its own copy against a module-level locale. Only
  // some surfaces fetch settings, so a cold open of the game or the pet used to
  // render client copy in the default while server copy was already switched.
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-lang-view-'))
  const originalConsoleError = console.error
  console.error = () => undefined
  return (async () => {
    try {
      const harness = makeHarness(dshHome)
      assert.equal((await harness.post('view')).language, 'auto')
      await harness.post('settings-set', { language: 'zh-TW' })
      assert.equal((await harness.post('view')).language, 'zh-TW')
    } finally {
      console.error = originalConsoleError
      rmSync(dshHome, { recursive: true, force: true })
    }
  })()
})

test('a typed line that happens to be a source string is left alone', async () => {
  // Source-string-as-key means a person can type a sentence the plugin also
  // ships. Their own words must come back as they wrote them, while the choice
  // beside them, which the plugin wrote, follows the language.
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-typed-'))
  const originalConsoleError = console.error
  console.error = () => undefined
  try {
    const harness = makeHarness(dshHome)
    const entry = await harness.post('view')
    const picked = entry.choices.find((choice: any) => choice.text === '那就继续聊聊吧')
    assert.ok(picked, 'the fallback choice is the sentinel this test needs')

    await harness.post('settings-set', { language: 'zh-TW' })
    await harness.post('chat', { text: '那就继续聊聊吧' })

    const view = await harness.post('view')
    const typed = view.history.filter((line: any) => line.who === 'user').at(-1)
    assert.equal(typed.text, '那就继续聊聊吧', 'a person\'s own words are not a translation key')
    assert.ok(
      view.choices.every((choice: any) => choice.text !== '那就继续聊聊吧'),
      'plugin-written choices still follow the language: ' + JSON.stringify(view.choices.map((c: any) => c.text)),
    )
  } finally {
    console.error = originalConsoleError
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('a profile edit or reset writes the greeting at its source, not translated', async () => {
  // Both paths replace the opening line with the built-in greeting. Writing the
  // translated form freezes it: the save would then hold Traditional and could
  // never render back.
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-profile-src-'))
  const originalConsoleError = console.error
  console.error = () => undefined
  const storedGreeting = async () => {
    const saved = JSON.parse(await nativeFs.readFile(globalSavePath(dshHome), 'utf8'))
    const rows = (saved.state || saved).characters.deepseek.chatLines
    return rows.find((row: any) => row.who === 'heroine')
  }
  try {
    const harness = makeHarness(dshHome)
    await harness.post('view')
    await harness.post('settings-set', { language: 'zh-TW', characterMode: 'manual', characterId: 'deepseek' })
    assert.equal(
      (await harness.post('view')).history.find((line: any) => line.who === 'heroine').text,
      '「主人，又見面啦～今天也想聽你說話喔。」',
      'the served greeting follows the language',
    )

    // Edit a field that is not the greeting: the greeting row is rewritten too.
    const edited = await harness.post('profile-set', {
      characterId: 'deepseek',
      overrides: { tone: '再溫柔一點' },
    })
    assert.equal(edited.ok, true, JSON.stringify(edited))
    assert.deepEqual((await storedGreeting()).seg, [{ id: 'deepseek', ref: 'greeting' }])

    const reset = await harness.post('profile-reset', { characterId: 'deepseek' })
    assert.equal(reset.ok, true, JSON.stringify(reset))
    assert.deepEqual((await storedGreeting()).seg, [{ id: 'deepseek', ref: 'greeting' }])

    // And it still renders back once the language changes.
    const back = await harness.post('settings-set', { language: 'zh-CN' })
    assert.equal(
      back.view.history.find((line: any) => line.who === 'heroine').text,
      '「主人，又见面啦～今天也想听你说话呢。」',
    )
  } finally {
    console.error = originalConsoleError
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('a segment naming a character this build does not have falls back to its text', async () => {
  // Resolving an unknown id through the roster default would put another
  // character's name into the notice that announced this one.
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-seg-bad-'))
  const originalConsoleError = console.error
  console.error = () => undefined
  try {
    const harness = makeHarness(dshHome)
    await harness.post('view')
    await harness.post('settings-set', { characterMode: 'manual', characterId: 'chatgpt' })

    const global = globalSavePath(dshHome)
    const saved = JSON.parse(await nativeFs.readFile(global, 'utf8'))
    const rows = (saved.state || saved).characters.chatgpt.chatLines
    const index = rows.findIndex((row: any) => row.who === 'narrator')
    rows[index] = {
      who: 'narrator',
      seg: ['（', { id: 'a-character-from-the-future', ref: 'displayName' }, ' 登场了。）'],
      text: '（有人登场了。）',
    }
    await nativeFs.writeFile(global, JSON.stringify(saved), 'utf8')

    const restarted = makeHarness(dshHome)
    assert.equal(narratorOf(await restarted.post('view')), '（有人登场了。）')
  } finally {
    console.error = originalConsoleError
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('a built-in CG error follows locale changes without rewriting provider errors', async () => {
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-cg-error-locale-'))
  const originalConsoleError = console.error
  console.error = () => undefined
  try {
    const files = new Map<string, string>()
    const harness = makeHarness(dshHome, files)
    await harness.post('view')
    await harness.post('settings-set', { language: 'zh-TW' })

    const global = globalSavePath(dshHome)
    const saved = JSON.parse(await nativeFs.readFile(global, 'utf8'))
    const state = saved.state || saved
    state.characters.deepseek.cgs.push({
      id: 'cg-interrupted',
      status: 'generating',
      dataUrl: null,
      prompt: null,
      charId: 'deepseek',
      level: 1,
      at: 1,
      seen: false,
      savedAsBg: false,
      error: null,
    })
    state.characters.deepseek.cgs.push({
      id: 'cg-provider-error',
      status: 'failed',
      dataUrl: null,
      prompt: null,
      charId: 'deepseek',
      level: 1,
      at: 2,
      seen: false,
      savedAsBg: false,
      // Exact collision with a plugin source: provider text is still verbatim.
      error: '找不到这场小剧场的记录',
    })
    state.cg = { cgId: 'cg-interrupted' }
    await nativeFs.writeFile(global, JSON.stringify(saved), 'utf8')

    const restarted = makeHarness(dshHome, files)
    const interrupted = await restarted.post('view')
    assert.equal(interrupted.cg.error, '生成被重啟打斷，請重新觸發')

    const simplified = await restarted.post('settings-set', { language: 'zh-CN' })
    assert.equal(simplified.view.cg.error, '生成被重启打断，请重新触发')

    // Make the provider collision current and prove response-edge translation
    // is gated by provenance rather than by source-string equality.
    const afterRestart = JSON.parse(await nativeFs.readFile(global, 'utf8'))
    const afterRestartState = afterRestart.state || afterRestart
    afterRestartState.cg = { cgId: 'cg-provider-error' }
    await nativeFs.writeFile(global, JSON.stringify(afterRestart), 'utf8')
    const providerRestart = makeHarness(dshHome, files)
    const traditional = await providerRestart.post('settings-set', { language: 'zh-TW' })
    assert.equal(traditional.view.cg.error, '找不到这场小剧场的记录')
  } finally {
    console.error = originalConsoleError
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('an unsafe legacy CG prompt keeps its locale-independent replacement', async () => {
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-cg-prompt-source-'))
  const originalConsoleError = console.error
  console.error = () => undefined
  try {
    const files = new Map<string, string>()
    const harness = makeHarness(dshHome, files)
    await harness.post('view')
    await harness.post('settings-set', { language: 'zh-TW' })

    const global = globalSavePath(dshHome)
    const saved = JSON.parse(await nativeFs.readFile(global, 'utf8'))
    const state = saved.state || saved
    state.characters.deepseek.cgs.push({
      id: 'cg-unsafe-legacy',
      status: 'ready',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      prompt: '旧版提示，画面元素呼应对方最近的经历与工作：unsafe theme',
      charId: 'deepseek',
      level: 1,
      at: 1,
      seen: true,
      savedAsBg: false,
      error: null,
    })
    await nativeFs.writeFile(global, JSON.stringify(saved), 'utf8')

    const restarted = makeHarness(dshHome, files)
    const gallery = await restarted.post('cg-gallery')
    const item = gallery.items.find((cg: any) => cg.id === 'cg-unsafe-legacy')
    assert.equal(item.prompt, '旧版提示，温暖浪漫的日常氛围（旧版主题摘要已隐藏）')
  } finally {
    console.error = originalConsoleError
    rmSync(dshHome, { recursive: true, force: true })
  }
})
