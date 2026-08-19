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
function makeHarness(dshHome: string, files = new Map<string, string>()) {
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
      stream: async function* (): AsyncGenerator<any> {
        throw new Error('no model in this fixture')
        // Keep this an async generator without yielding at runtime.
        yield { type: 'text-delta', text: '' }
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
