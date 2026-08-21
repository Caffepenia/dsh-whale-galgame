import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import * as nativeFs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { setFlagsFromString } from 'node:v8'
import { apply } from '../src/index.ts'

async function forceGarbageCollection(): Promise<void> {
  const bun = (globalThis as any).Bun
  const collect = bun && typeof bun.gc === 'function'
    ? () => bun.gc(true)
    : (() => {
        setFlagsFromString('--expose_gc')
        const exposed = runInNewContext('gc') as () => void
        return () => exposed()
      })()
  for (let attempt = 0; attempt < 8; attempt++) {
    collect()
    await new Promise((resolve) => setImmediate(resolve))
  }
}

/**
 * A provider that refuses `temperature` the way the Codex bridge does: the
 * request reaches the model and comes back as a finish chunk carrying an error,
 * rather than throwing out of the stream.
 */
function makeHarness(
  dshHome: string,
  refusal: string | ((turn: number, options: any) => string | undefined) = 'Codex error: Unsupported parameter: temperature',
  retryRefusal?: string | ((turn: number) => string | { message: string; kind: 'error' | 'aborted' } | undefined),
) {
  const root = 'E:\\workspace\\temperature'
  const files = new Map<string, string>()
  const sessions = [{
    header: { version: 0, id: 'temperature-session', cwd: root, createdAt: 1_000 },
    live: true,
    persisted: true,
    events: [],
  }]
  const calls: { temperature: unknown; system: string; turn: number; model: string }[] = []
  const scopeRefs: WeakRef<AbortSignal>[] = []
  let chatTurn = 0
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
        calls.push({
          temperature: options.temperature,
          system: String(options.system || ''),
          turn: chatTurn,
          model: String(options.model || ''),
        })
        scopeRefs.push(new WeakRef(options.signal))
        const retryFailureValue = options.temperature === undefined
          ? (typeof retryRefusal === 'function' ? retryRefusal(chatTurn) : retryRefusal)
          : undefined
        const retryFailure = typeof retryFailureValue === 'string'
          ? { message: retryFailureValue, kind: 'error' as const }
          : retryFailureValue
        const originalRefusal = options.temperature !== undefined
          ? (typeof refusal === 'function' ? refusal(chatTurn, options) : refusal)
          : undefined
        if (originalRefusal !== undefined || retryFailure !== undefined) {
          yield {
            type: 'finish',
            reason: {
              kind: originalRefusal !== undefined ? 'error' : retryFailure!.kind,
              failure: { message: originalRefusal ?? retryFailure!.message },
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
    if (action === 'chat') chatTurn += 1
    const req: any = Readable.from([JSON.stringify({ action, args: { ...args, sessionId: 'temperature-session' } })])
    req.method = 'POST'
    let status = 0
    let body = ''
    await routeHandler(req, { writeHead: (n: number) => { status = n }, end: (v: string) => { body = v } })
    assert.equal(status, 200, body)
    return JSON.parse(body)
  }

  return { post, calls, scopeRefs }
}

async function selectHarnessModel(harness: ReturnType<typeof makeHarness>, model: string): Promise<void> {
  const result = await harness.post('settings-set', {
    chatSelection: { provider: 'codex', model },
  })
  assert.equal(result.ok, true, JSON.stringify(result.errors || []))
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

test('settled failed retries do not retain their request signals', async () => {
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-temperature-signal-retention-'))
  const originalConsoleError = console.error
  console.error = () => undefined
  try {
    const harness = makeHarness(
      dshHome,
      'Parameter temperature is not supported for this model',
      'Unsupported parameter: top_p',
    )
    let response = await harness.post('view')
    for (let model = 0; model < 5; model++) {
      await selectHarnessModel(harness, `retention-probe-${model}`)
      response = await harness.post('chat', {
        choiceId: response.choices[0].id,
        text: response.choices[0].text,
      })
      assert.equal(response.fallbackUsed, true, 'the retry must fail so confidence resets')
    }

    const settledScopes = harness.scopeRefs.slice()
    assert.ok(settledScopes.length > 0, 'the provider observed request signals')
    await forceGarbageCollection()
    const retained = settledScopes.filter((reference) => reference.deref() !== undefined).length
    assert.equal(retained, 0, 'completed reset records must not pin any request AbortSignal')
  } finally {
    console.error = originalConsoleError
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('partial temperature confidence evicts old model keys', async () => {
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-temperature-partial-bound-'))
  try {
    const harness = makeHarness(dshHome, 'Parameter temperature is not supported for this model')
    let response = await harness.post('view')
    const chat = async () => {
      response = await harness.post('chat', {
        choiceId: response.choices[0].id,
        text: response.choices[0].text,
      })
    }

    for (let model = 0; model < 33; model++) {
      await selectHarnessModel(harness, `partial-bound-${model}`)
      await chat()
    }

    await selectHarnessModel(harness, 'partial-bound-0')
    await chat()
    const beforeSecondRevisit = harness.calls.length
    await chat()
    assert.ok(
      harness.calls.slice(beforeSecondRevisit).some((call) => call.temperature !== undefined),
      'the oldest partial record was evicted instead of combining evidence across an unbounded model history',
    )
  } finally {
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('admitted temperature cache entries evict old model keys', async () => {
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-temperature-admitted-bound-'))
  try {
    const harness = makeHarness(dshHome, 'Parameter temperature is not supported for this model')
    let response = await harness.post('view')
    const chat = async () => {
      response = await harness.post('chat', {
        choiceId: response.choices[0].id,
        text: response.choices[0].text,
      })
    }

    for (let model = 0; model < 33; model++) {
      await selectHarnessModel(harness, `admitted-bound-${model}`)
      await chat()
      await chat()
    }

    await selectHarnessModel(harness, 'admitted-bound-0')
    const beforeRevisit = harness.calls.length
    await chat()
    assert.ok(
      harness.calls.slice(beforeRevisit).some((call) => call.temperature !== undefined),
      'the oldest admitted record was evicted instead of growing the session memo without bound',
    )
  } finally {
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('two successful non-canonical confirmations admit the model to the cache', async () => {
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-temperature-confidence-'))
  try {
    const harness = makeHarness(dshHome, 'Parameter temperature is not supported for this model')
    const entry = await harness.post('view')
    const first = await harness.post('chat', {
      choiceId: entry.choices[0].id,
      text: entry.choices[0].text,
    })

    const beforeSecondTurn = harness.calls.length
    const second = await harness.post('chat', {
      choiceId: first.choices[0].id,
      text: first.choices[0].text,
    })
    assert.ok(
      harness.calls.slice(beforeSecondTurn).some((call) => call.temperature !== undefined),
      'one request-scoped confirmation is not enough to omit temperature',
    )

    const beforeThirdTurn = harness.calls.length
    await harness.post('chat', {
      choiceId: second.choices[0].id,
      text: second.choices[0].text,
    })
    const thirdCalls = harness.calls.slice(beforeThirdTurn)
    assert.ok(thirdCalls.length > 0, 'the third turn really called the model')
    assert.ok(
      thirdCalls.every((call) => call.temperature === undefined),
      'two independent confirmations admit the provider/model to the cache',
    )
  } finally {
    rmSync(dshHome, { recursive: true, force: true })
  }
})

for (const interrupted of ['failed', 'aborted'] as const) {
  test(`${interrupted === 'aborted' ? 'an' : 'a'} ${interrupted} retry resets non-canonical cache confidence`, async () => {
    const dshHome = mkdtempSync(join(tmpdir(), `dsh-whale-temperature-${interrupted}-confidence-`))
    const originalConsoleError = console.error
    console.error = () => undefined
    try {
      const harness = makeHarness(
        dshHome,
        'Parameter temperature is not supported for this model',
        (turn) => turn === 2
          ? interrupted === 'aborted'
            ? { message: 'provider aborted the retry', kind: 'aborted' }
            : 'Unsupported parameter: top_p'
          : undefined,
      )
      let response = await harness.post('view')
      const chat = async () => {
        response = await harness.post('chat', {
          choiceId: response.choices[0].id,
          text: response.choices[0].text,
        })
        return response
      }

      await chat()
      const interruptedTurn = await chat()
      assert.equal(interruptedTurn.fallbackUsed, true, `the ${interrupted} retry really interrupted confirmation`)
      await chat()

      const beforeFourthTurn = harness.calls.length
      await chat()
      const fourthCalls = harness.calls.slice(beforeFourthTurn)
      assert.ok(
        fourthCalls.some((call) => call.temperature !== undefined),
        `confidence before the ${interrupted} retry was discarded rather than combined with later evidence`,
      )

      const beforeFifthTurn = harness.calls.length
      await chat()
      const fifthCalls = harness.calls.slice(beforeFifthTurn)
      assert.ok(fifthCalls.length > 0, 'the fifth turn really called the model')
      assert.ok(
        fifthCalls.every((call) => call.temperature === undefined),
        'two confirmations after the interruption eventually admit the model',
      )
    } finally {
      console.error = originalConsoleError
      rmSync(dshHome, { recursive: true, force: true })
    }
  })
}

test('a real maxTokens refusal retries broadly but falls back without caching', async () => {
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-temperature-max-tokens-'))
  const originalConsoleError = console.error
  console.error = () => undefined
  try {
    const refusal = 'Unsupported parameter: maxTokens; request included temperature=0.9'
    const harness = makeHarness(dshHome, refusal, 'Unsupported parameter: maxTokens')
    const entry = await harness.post('view')
    const mainCalls = (from: number) => harness.calls.slice(from).filter((call) => {
      return !call.system.includes('情绪分类器') && !call.system.includes('对话选项生成器')
    })

    const beforeFirstTurn = harness.calls.length
    const first = await harness.post('chat', {
      choiceId: entry.choices[0].id,
      text: entry.choices[0].text,
    })
    assert.equal(first.fallbackUsed, true, 'removing temperature cannot fix the real maxTokens refusal')
    assert.deepEqual(
      mainCalls(beforeFirstTurn).map((call) => call.temperature),
      [0.9, undefined],
      'the broad policy makes exactly one temperature-free retry before falling back',
    )

    const beforeSecondTurn = harness.calls.length
    const second = await harness.post('chat', {
      choiceId: first.choices[0].id,
      text: first.choices[0].text,
    })
    assert.equal(second.fallbackUsed, true)
    assert.deepEqual(
      mainCalls(beforeSecondTurn).map((call) => call.temperature),
      [0.9, undefined],
      'the failed retry did not cache temperature as unsupported',
    )
  } finally {
    console.error = originalConsoleError
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('a successful request with temperature resets behavioral confidence', async () => {
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-temperature-supported-reset-'))
  try {
    const refusal = 'Parameter temperature is not supported for this model'
    const harness = makeHarness(dshHome, (turn) => turn === 2 ? undefined : refusal)
    let response = await harness.post('view')
    const chat = async () => {
      response = await harness.post('chat', {
        choiceId: response.choices[0].id,
        text: response.choices[0].text,
      })
    }

    await chat()
    await chat()
    await chat()

    const beforeFourthTurn = harness.calls.length
    await chat()
    assert.ok(
      harness.calls.slice(beforeFourthTurn).some((call) => call.temperature !== undefined),
      'a successful temperature request broke the earlier confirmation sequence',
    )

    const beforeFifthTurn = harness.calls.length
    await chat()
    const fifthCalls = harness.calls.slice(beforeFifthTurn)
    assert.ok(fifthCalls.length > 0, 'the fifth turn really called the model')
    assert.ok(
      fifthCalls.every((call) => call.temperature === undefined),
      'two fresh confirmations after the successful request eventually admit the model',
    )
  } finally {
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('a successful temperature call overrides concurrent refusal evidence in the same scope', async () => {
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-whale-temperature-mixed-scope-'))
  try {
    const refusal = 'Parameter temperature is not supported for this model'
    const harness = makeHarness(dshHome, (turn, options) => {
      const system = String(options.system || '')
      return turn === 2 && system.includes('情绪分类器') ? undefined : refusal
    })
    let response = await harness.post('view')
    const chat = async () => {
      response = await harness.post('chat', {
        choiceId: response.choices[0].id,
        text: response.choices[0].text,
      })
    }

    await chat()
    const beforeMixedTurn = harness.calls.length
    await chat()
    const mixedCalls = harness.calls.slice(beforeMixedTurn)
    assert.ok(
      mixedCalls.some((call) => call.system.includes('情绪分类器') && call.temperature !== undefined),
      'one temperature-bearing call succeeded in the mixed action',
    )
    assert.ok(
      mixedCalls.some((call) => !call.system.includes('情绪分类器') && call.temperature === undefined),
      'another call in the same action refused temperature and retried successfully',
    )

    await chat()
    const beforeFourthTurn = harness.calls.length
    await chat()
    assert.ok(
      harness.calls.slice(beforeFourthTurn).some((call) => call.temperature !== undefined),
      'same-scope contradictory evidence resets confidence instead of admitting the model',
    )

    const beforeFifthTurn = harness.calls.length
    await chat()
    const fifthCalls = harness.calls.slice(beforeFifthTurn)
    assert.ok(fifthCalls.length > 0, 'the fifth turn really called the model')
    assert.ok(
      fifthCalls.every((call) => call.temperature === undefined),
      'two later clean refusal scopes can still admit the model',
    )
  } finally {
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
