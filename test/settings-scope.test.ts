import assert from 'node:assert/strict'
import test from 'node:test'
import {
  NO_SCOPE_SNAPSHOT,
  createSettingsWriter,
  releaseSettingsScope,
  saveDashscopeKey,
  scopeAcceptsWrites,
  setSettingsScope,
  settingsScope,
  settingsScopeSnapshot,
  settingsWriter,
  subscribeSettingsScope,
} from '../src/client/settings-scope.ts'

/** A stand-in for rc.7's SettingsScopeController with the same observable shape. */
function fakeScope(snapshot: any = { status: 'ready', writable: true, revision: 1 }) {
  const listeners = new Set<() => void>()
  let current = snapshot
  return {
    getSnapshot: () => current,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    /** Publish a new snapshot the way the controller does after a Host read. */
    push(next: any) {
      current = next
      for (const listener of [...listeners]) listener()
    },
    get listenerCount() { return listeners.size },
  }
}

test.afterEach(() => setSettingsScope(null, null))

test('a card that mounted before the scope arrived sees it arrive', () => {
  // The nested connection/remote injection fires after the settings card can
  // already be on screen. A subscription taken while the global was null used
  // to observe nothing, so the field stayed disabled with a live scope bound.
  setSettingsScope(null)
  let notified = 0
  const stop = subscribeSettingsScope(() => { notified++ })
  assert.equal(settingsScopeSnapshot(), NO_SCOPE_SNAPSHOT)
  assert.equal(scopeAcceptsWrites(settingsScopeSnapshot()), false)

  setSettingsScope(fakeScope() as any)
  assert.equal(notified, 1, 'arrival is observable')
  assert.equal(scopeAcceptsWrites(settingsScopeSnapshot()), true)
  stop()
})

test('a snapshot change on the bound scope reaches the card', () => {
  const scope = fakeScope({ status: 'loading', writable: false, revision: undefined })
  setSettingsScope(scope as any)
  let notified = 0
  const stop = subscribeSettingsScope(() => { notified++ })
  assert.equal(scopeAcceptsWrites(settingsScopeSnapshot()), false, 'loading is not editable')

  scope.push({ status: 'ready', writable: true, revision: 4 })
  assert.equal(notified, 1)
  assert.equal(scopeAcceptsWrites(settingsScopeSnapshot()), true)

  // A read-only provider must close the field again.
  scope.push({ status: 'ready', writable: false, revision: 4 })
  assert.equal(notified, 2)
  assert.equal(scopeAcceptsWrites(settingsScopeSnapshot()), false)
  stop()
})

test('a disconnect closes the field instead of leaving it looking writable', () => {
  const scope = fakeScope()
  setSettingsScope(scope as any)
  const stop = subscribeSettingsScope(() => undefined)
  assert.equal(scopeAcceptsWrites(settingsScopeSnapshot()), true)

  releaseSettingsScope(scope as any)
  assert.equal(settingsScope(), null)
  assert.equal(scopeAcceptsWrites(settingsScopeSnapshot()), false)
  assert.equal(scope.listenerCount, 0, 'the disposed controller is no longer observed')
  stop()
})

test('after a reconnect the card follows the replacement, not the disposed scope', () => {
  const first = fakeScope({ status: 'ready', writable: true, revision: 1 })
  setSettingsScope(first as any)
  let notified = 0
  const stop = subscribeSettingsScope(() => { notified++ })

  const second = fakeScope({ status: 'loading', writable: false, revision: undefined })
  setSettingsScope(second as any)
  assert.equal(notified, 1, 'the replacement is observable')
  assert.equal(first.listenerCount, 0, 'the old controller is dropped')

  second.push({ status: 'ready', writable: true, revision: 9 })
  assert.equal(notified, 2, 'the replacement is what is now observed')
  assert.equal(settingsScopeSnapshot().revision, 9)

  // The old fiber's disposer must not erase the newer binding.
  releaseSettingsScope(first as any)
  assert.equal(settingsScope(), second as any)
  assert.equal(scopeAcceptsWrites(settingsScopeSnapshot()), true)
  stop()
})

/**
 * The Host's settings.mutate seam, reporting the outcome the scope hides.
 *
 * @param ok - what the Host replies.
 */
function fakeWriter(ok: boolean) {
  const calls: any[] = []
  return {
    calls,
    set: async (field: string, value: unknown) => {
      calls.push({ field, value })
      return ok
    },
  }
}

/** A settings RPC face recording every describe and mutate. */
function fakeSettingsApi(script: Array<{ ok: boolean; revision?: number; movedTo?: number }>) {
  const mutations: any[] = []
  let describes = 0
  let hostRevision = 7
  return {
    mutations,
    get describes() { return describes },
    describe: async () => {
      describes++
      return { result: { ok: true, value: { namespaces: [{ ns: 'dsh-whale-galgame', revision: hostRevision }], writable: true } } }
    },
    mutate: async (request: any) => {
      mutations.push(request)
      const outcome: any = script.shift() || { ok: true, revision: hostRevision + 1 }
      // A refusal is CAUSED by somebody else having moved the document, so the
      // fixture moves it as part of refusing.
      if (outcome.movedTo !== undefined) hostRevision = outcome.movedTo
      if (!outcome.ok) return { result: { ok: false } }
      hostRevision = outcome.revision === undefined ? hostRevision + 1 : outcome.revision
      return { result: { ok: true, value: { ns: 'dsh-whale-galgame', revision: hostRevision } } }
    },
  }
}

test('the writer seeds its fence from the Host before the first write', async () => {
  const api = fakeSettingsApi([{ ok: true, revision: 8 }])
  const writer = createSettingsWriter(api, 'dsh-whale-galgame')!
  assert.ok(writer, 'an api offering both RPCs yields a writer')

  assert.equal(await writer.set('dashscopeApiKey', 'sk-a'), true)
  assert.equal(api.describes, 1, 'the first write reads the current revision')
  assert.equal(api.mutations[0].expectedRevision, 7)
})

test('an accepted write takes its next fence from the accepted view, not another read', async () => {
  const api = fakeSettingsApi([{ ok: true, revision: 8 }, { ok: true, revision: 9 }])
  const writer = createSettingsWriter(api, 'dsh-whale-galgame')!

  await writer.set('dashscopeApiKey', 'sk-a')
  await writer.set('dashscopeApiKey', 'sk-b')
  assert.equal(api.mutations[1].expectedRevision, 8, 'the second write fences on what the Host returned')
  assert.equal(api.describes, 1, 'and it did not need to read again')
})

test('a refused write re-reads, so a retry does not repeat the rejected expectation', async () => {
  // The two-editor case: somebody else moved the namespace to 9, this write
  // fenced on 7 and was refused. Retrying with 7 again would be refused for
  // exactly the same reason.
  const api = fakeSettingsApi([{ ok: false, movedTo: 9 }, { ok: true, revision: 10 }])
  const writer = createSettingsWriter(api, 'dsh-whale-galgame')!

  assert.equal(await writer.set('dashscopeApiKey', 'sk-a'), false)
  assert.equal(await writer.set('dashscopeApiKey', 'sk-a'), true)
  assert.equal(api.mutations[1].expectedRevision, 9, 'the retry fences on the value it re-read')
})

test('an api without the RPCs yields no writer at all', () => {
  assert.equal(createSettingsWriter(null, 'dsh-whale-galgame'), null)
  assert.equal(createSettingsWriter({ mutate: () => undefined }, 'dsh-whale-galgame'), null)
})

test('a refused write is reported as refused', async () => {
  const scope = fakeScope({ status: 'ready', writable: true, revision: 7 })
  const writer = fakeWriter(false)
  setSettingsScope(scope as any, writer)

  assert.equal(await saveDashscopeKey(scope as any, writer, 'sk-new'), false)
  assert.deepEqual(writer.calls, [{ field: 'dashscopeApiKey', value: 'sk-new' }])
})

test('a conflicting write is refused even though the revision moved and a key is still set', async () => {
  // The case a revision comparison cannot see. Another tab moves this
  // namespace from 7 to 8; this card fences on 7 and is refused BECAUSE of
  // that move; the controller's recovery read then publishes revision 8, and
  // the plugin still reports a key because the PREVIOUS one is untouched.
  // Every observable signal afterwards is identical to a successful write.
  const scope = fakeScope({ status: 'ready', writable: true, revision: 7 })
  const writer = {
    calls: [] as any[],
    set: async (field: string, value: unknown) => {
      writer.calls.push({ field, value })
      scope.push({ status: 'ready', writable: true, revision: 8 })
      return false
    },
  }
  setSettingsScope(scope as any, writer)

  assert.equal(await saveDashscopeKey(scope as any, writer, 'sk-rotated'), false, 'the Host outcome is what decides')
  assert.equal(settingsScopeSnapshot().revision, 8, 'and the revision did move, which is exactly the trap')
})

test('an accepted write reports accepted', async () => {
  const scope = fakeScope({ status: 'ready', writable: true, revision: 7 })
  const writer = fakeWriter(true)
  setSettingsScope(scope as any, writer)

  assert.equal(await saveDashscopeKey(scope as any, writer, 'sk-new'), true)
})

test('a scope that went read-only between the click and the call writes nothing', async () => {
  // keyEditable came from the last render. The provider can go read-only, or
  // the scope be replaced by one that is, before the promise chain runs.
  const scope = fakeScope({ status: 'ready', writable: false, revision: 7 })
  const writer = fakeWriter(true)
  setSettingsScope(scope as any, writer)

  assert.equal(await saveDashscopeKey(scope as any, writer, 'sk-new'), false)
  assert.deepEqual(writer.calls, [], 'the secret never reached the wire')
})

test('the writer is published and released with the scope it belongs to', () => {
  const scope = fakeScope()
  const writer = fakeWriter(true)
  setSettingsScope(scope as any, writer)
  assert.equal(settingsWriter(), writer as any)

  releaseSettingsScope(scope as any)
  assert.equal(settingsWriter(), null, 'a disposed transport cannot be reused')
})
