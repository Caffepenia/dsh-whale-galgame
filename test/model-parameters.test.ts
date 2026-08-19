import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import * as nativeFs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { apply } from '../src/index.ts'

/**
 * A provider that refuses `temperature` the way the Codex bridge does: the
 * request reaches the model and comes back as a finish chunk carrying an error,
 * rather than throwing out of the stream.
 */
function makeHarness(dshHome: string) {
  const root = 'E:\\workspace\\temperature'
  const files = new Map<string, string>()
  const sessions = [{
    header: { version: 0, id: 'temperature-session', cwd: root, createdAt: 1_000 },
    live: true,
    persisted: true,
    events: [],
  }]
  const calls: { temperature: unknown }[] = []
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
      currentSelection: () => ({ provider: 'codex', model: 'gpt-5.6-sol' }),
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
      listProviders: () => [{ id: 'codex', name: 'Codex' }],
      listModels: async () => [{ id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', inputModalities: ['text'] }],
      resolveModelInfo: async () => ({}),
      stream: async function* (options: any): AsyncGenerator<any> {
        calls.push({ temperature: options.temperature })
        if (options.temperature !== undefined) {
          yield {
            type: 'finish',
            reason: { kind: 'error', failure: { message: 'Codex error: Unsupported parameter: temperature' } },
          }
          return
        }
        const system = String(options.system || '')
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
  apply(ctx, { chatProvider: 'codex', chatModel: 'gpt-5.6-sol' }, { nativeGlobalIo: nativeFs })

  async function post(action: string, args: any = {}): Promise<any> {
    const req: any = Readable.from([JSON.stringify({ action, args: { ...args, sessionId: 'temperature-session' } })])
    req.method = 'POST'
    let status = 0
    let body = ''
    await routeHandler(req, { writeHead: (n: number) => { status = n }, end: (v: string) => { body = v } })
    assert.equal(status, 200, body)
    return JSON.parse(body)
  }

  return { post, calls }
}

test('a model that refuses temperature still answers, and stops being asked twice', async () => {
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-temperature-'))
  const originalConsoleError = console.error
  // The first refusal is logged by design; the retry is what this test watches.
  console.error = () => undefined
  try {
    const harness = makeHarness(dshHome)
    const entry = await harness.post('view')

    const first = await harness.post('chat', {
      choiceId: entry.choices[0].id,
      text: entry.choices[0].text,
    })
    assert.notEqual(first.fallbackUsed, true, 'the retry answers instead of falling back to a canned line')
    assert.equal(first.history.at(-1).text, '主人今天也辛苦了呢。')
    assert.ok(
      harness.calls.some((call) => call.temperature === undefined),
      'the refused call was retried without temperature',
    )

    const before = harness.calls.length
    const second = await harness.post('chat', {
      choiceId: first.choices[0].id,
      text: first.choices[0].text,
    })
    assert.notEqual(second.fallbackUsed, true)
    const afterFirstTurn = harness.calls.slice(before)
    assert.ok(afterFirstTurn.length > 0, 'the second turn really called the model')
    for (const call of afterFirstTurn) {
      assert.equal(call.temperature, undefined, 'the refusal is remembered, so no call pays a second round trip')
    }
  } finally {
    console.error = originalConsoleError
    rmSync(dshHome, { recursive: true, force: true })
  }
})
