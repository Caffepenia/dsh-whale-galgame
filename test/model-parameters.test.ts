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
function makeHarness(
  dshHome: string,
  refusal = 'Codex error: Unsupported parameter: temperature',
  retryRefusal?: string,
) {
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
        if (options.temperature !== undefined || retryRefusal !== undefined) {
          yield {
            type: 'finish',
            reason: {
              kind: 'error',
              failure: { message: options.temperature !== undefined ? refusal : retryRefusal },
            },
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
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('a failed retry does not cache the canonical temperature refusal', async () => {
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-temperature-failed-retry-'))
  const originalConsoleError = console.error
  console.error = () => undefined
  try {
    const harness = makeHarness(
      dshHome,
      'Codex error: Unsupported parameter: temperature',
      'Codex error: Unsupported parameter: top_p',
    )
    const entry = await harness.post('view')
    const first = await harness.post('chat', {
      choiceId: entry.choices[0].id,
      text: entry.choices[0].text,
    })
    assert.equal(first.fallbackUsed, true, 'the retry really failed')

    const beforeSecondTurn = harness.calls.length
    await harness.post('chat', {
      choiceId: first.choices[0].id,
      text: first.choices[0].text,
    })
    const secondCalls = harness.calls.slice(beforeSecondTurn)
    assert.ok(secondCalls.length > 0, 'the second turn really called the model')
    assert.notEqual(
      secondCalls[0].temperature,
      undefined,
      'the failed retry is not evidence that later calls should omit temperature',
    )
  } finally {
    console.error = originalConsoleError
    rmSync(dshHome, { recursive: true, force: true })
  }
})

interface WordingProbe {
  refusal: string
  retry: boolean
  cache: boolean
}

/**
 * Retry and cache are deliberately independent decisions. Retrying a broad
 * English parameter complaint costs one request when its grammar is ambiguous;
 * caching a false conclusion would silently alter every later request.
 */
const WORDINGS: WordingProbe[] = [
  { refusal: 'Codex error: Unsupported parameter: temperature', retry: true, cache: true },
  { refusal: "Unsupported value: 'temperature' does not support 0.9 with this model", retry: true, cache: false },
  { refusal: 'Parameter temperature is not supported for this model', retry: true, cache: false },
  { refusal: 'The model does not support temperature.', retry: true, cache: false },
  { refusal: 'The following parameters are not supported: temperature.', retry: true, cache: false },
  { refusal: 'The following parameters are not supported: top_p, presence_penalty, and temperature.', retry: true, cache: false },
  { refusal: 'Unsupported parameters: [temperature, top_p].', retry: true, cache: false },
  { refusal: "Parameter `temperature` isn't supported for this model.", retry: true, cache: false },
  { refusal: 'Unsupported parameter: maxTokens; request included temperature=0.9', retry: true, cache: false },
  { refusal: 'Unsupported parameter: top_p', retry: false, cache: false },
  { refusal: 'Parameter temperature is accepted, but top_p is not supported for this model', retry: true, cache: false },
  { refusal: 'This model does not support top_p when temperature is set', retry: true, cache: false },
  { refusal: 'Unsupported parameters: standard_mode, candor, or temperature.', retry: true, cache: false },
  { refusal: 'Unsupported parameters: standard and temperature.', retry: true, cache: false },
  { refusal: 'Unsupported parameters: top_p, and, temperature.', retry: true, cache: false },
  { refusal: 'Unsupported parameters: top_p, or, temperature.', retry: true, cache: false },
  { refusal: 'Unsupported parameter: top_p, and temperature was accepted.', retry: true, cache: false },
  { refusal: 'Unsupported parameter: top_p, or temperature can be used instead.', retry: true, cache: false },
  { refusal: 'top_p is not supported. temperature is not supported.', retry: true, cache: false },
  { refusal: 'top_p is not supported. temperature is supported.', retry: true, cache: false },
  { refusal: 'temperature is supported. top_p is not supported.', retry: true, cache: false },
  { refusal: 'top_p is not supported, while temperature remains supported.', retry: true, cache: false },
  { refusal: 'temperature is not supported, while top_p is also not supported.', retry: true, cache: false },
  { refusal: 'All parameters except temperature are supported.', retry: false, cache: false },
  { refusal: 'Only temperature is supported.', retry: false, cache: false },
  { refusal: 'All parameters except temperature are unsupported.', retry: true, cache: false },
  { refusal: 'Everything but temperature is not supported.', retry: true, cache: false },
  { refusal: 'It is false that temperature is not supported.', retry: true, cache: false },
  { refusal: 'Only temperature is not supported.', retry: true, cache: false },
  { refusal: 'Unsupported parameter: top_p. Request echo: "Unsupported parameter: temperature".', retry: true, cache: false },
  { refusal: 'Request body: {"note":"Unsupported parameter: temperature"}; actual unsupported parameter: top_p.', retry: true, cache: false },
  { refusal: 'This model does not support top_p. Request body: {"temperature":0.9}.', retry: true, cache: false },
  { refusal: 'Unsupported parameter: temperature_scale.', retry: false, cache: false },
  { refusal: 'Unsupported parameter: default_temperature.', retry: false, cache: false },
  { refusal: 'Unsupported parameter: temperature-scale.', retry: false, cache: false },
  { refusal: 'Unsupported parameter: top_p. The request included temperature=0.9.', retry: true, cache: false },
  { refusal: 'Temperature was accepted. This model does not support top_p.', retry: true, cache: false },
  { refusal: 'This model does not support top_p.\nParameter temperature was accepted.', retry: true, cache: false },
  { refusal: '{"error":{"message":"Unsupported parameter: temperature","param":"temperature"}}', retry: true, cache: false },
  { refusal: '{"error":{"message":"Unsupported parameter: top_p","param":"temperature"}}', retry: true, cache: false },
  { refusal: '{"error":{"unsupported_parameters":["temperature","top_p"]}}', retry: true, cache: false },
  { refusal: '{"error":{"message":"Unsupported parameters: [temperature, top_p]"}}', retry: true, cache: false },
  { refusal: 'Error: {"unsupportedParameters":["temperature","top_p"]}', retry: true, cache: false },
  { refusal: 'The temperature parameter is not supported for this model.', retry: true, cache: false },
  { refusal: "This model doesn't support temperature.", retry: true, cache: false },
  { refusal: 'temperature is not a supported parameter for this model.', retry: true, cache: false },
  { refusal: 'temperature is currently not supported for this model.', retry: true, cache: false },
  { refusal: 'temperature is not currently supported for this model.', retry: true, cache: false },
  { refusal: 'Unsupported parameters in this request: temperature.', retry: true, cache: false },
  { refusal: 'Unsupported parameters: (temperature, top_p).', retry: true, cache: false },
  { refusal: 'Unsupported parameters: {temperature, top_p}.', retry: true, cache: false },
  { refusal: 'Unknown parameter: temperature.', retry: true, cache: false },
  { refusal: "Parameter 'temperature' is not allowed for this model.", retry: true, cache: false },
  { refusal: 'The model cannot accept the temperature parameter.', retry: true, cache: false },
  { refusal: '此模型不支持参数 temperature。', retry: false, cache: false },
  { refusal: "Le paramètre temperature n'est pas pris en charge.", retry: false, cache: false },
]

for (const probe of WORDINGS) {
  test(`retry=${probe.retry}, cache=${probe.cache}: ${probe.refusal}`, async () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-wording-'))
    const originalConsoleError = console.error
    // A non-retryable refusal reaches the plugin's own error logging.
    console.error = () => undefined
    try {
      const harness = makeHarness(dshHome, probe.refusal)
      const entry = await harness.post('view')
      const beforeFirstTurn = harness.calls.length
      const answered = await harness.post('chat', {
        choiceId: entry.choices[0].id,
        text: entry.choices[0].text,
      })
      const firstCalls = harness.calls.slice(beforeFirstTurn)
      const firstRetried = firstCalls.some((call) => call.temperature !== undefined)
        && firstCalls.some((call) => call.temperature === undefined)
      assert.equal(firstRetried, probe.retry, 'first-turn calls expose whether the refusal triggered a retry')
      assert.equal(
        answered.fallbackUsed === true,
        !probe.retry,
        'only a successful retry avoids the canned fallback in this provider harness',
      )

      const beforeSecondTurn = harness.calls.length
      const second = await harness.post('chat', {
        choiceId: answered.choices[0].id,
        text: answered.choices[0].text,
      })
      const secondCalls = harness.calls.slice(beforeSecondTurn)
      assert.ok(secondCalls.length > 0, 'the second turn really called the model')
      const cacheUsed = secondCalls.every((call) => call.temperature === undefined)
      assert.equal(cacheUsed, probe.cache, 'second-turn calls expose whether the first refusal poisoned or populated the cache')
      const secondRetried = secondCalls.some((call) => call.temperature !== undefined)
        && secondCalls.some((call) => call.temperature === undefined)
      assert.equal(secondRetried, probe.retry && !probe.cache, 'an uncached retry decision is made again on the next turn')
      assert.equal(second.fallbackUsed === true, !probe.retry)
    } finally {
      console.error = originalConsoleError
      rmSync(dshHome, { recursive: true, force: true })
    }
  })
}
