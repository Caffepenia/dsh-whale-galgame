/**
 * The browser half's handle on the plugin's settings namespace.
 *
 * This is separate from the card, and from React, for one reason: the card's
 * two hardest questions have nothing to do with rendering, and a source-shape
 * assertion over a React component cannot answer either of them.
 *
 *   1. WHEN may the key field be edited? The scope arrives after the card
 *      mounts, can go read-only, can disappear on a disconnect, and can be
 *      REPLACED by a new controller on reconnect. A component that subscribed
 *      to whichever controller existed at mount observes none of that and its
 *      gate goes permanently stale.
 *   2. Did a write actually land? `SettingsScope.set()` catches transport
 *      failures and refused mutations and then resolves, and on a memory-mode
 *      scope it is a resolved no-op — so the promise settling proves nothing.
 *
 * Both live here as plain functions over a fake-able controller, so
 * test/settings-scope.test.ts can drive arrival, detachment, replacement and a
 * rejected write directly.
 *
 * @module dsh-whale-galgame/client/settings-scope
 */

/** The snapshot fields this plugin reads; see SettingsScopeSnapshot in dsh-client-runtime. */
export interface WhaleScopeSnapshot {
  status: 'loading' | 'ready' | 'unavailable' | string
  writable: boolean
  /** Namespace revision fencing the next write; bumped by an accepted write. */
  revision?: number | undefined
}

/**
 * The subset of `SettingsScope` this plugin uses.
 *
 * Only what the published contract guarantees: `getSnapshot` and `subscribe`.
 * The concrete rc.7 controller also has `load()`, but it is not part of the
 * interface `bind()` is typed to return, so depending on it would mean a
 * conforming replacement silently stops refreshing and every retry keeps
 * fencing on a stale revision. The writer below carries its own instead.
 */
export interface WhaleSettingsScope {
  getSnapshot(): WhaleScopeSnapshot
  subscribe(listener: () => void): () => void
}

/** One settings mutation whose Host outcome the caller can actually read. */
export interface WhaleSettingsWriter {
  /**
   * @param field - scalar field inside this plugin's namespace.
   * @param value - the value to store.
   * @returns whether the Host ACCEPTED the mutation.
   */
  set(field: string, value: unknown): Promise<boolean>
}

/** Neither ready nor writable: what the card sees before any scope exists. */
export const NO_SCOPE_SNAPSHOT: WhaleScopeSnapshot = {
  status: 'unavailable',
  writable: false,
  revision: undefined,
}

let current: WhaleSettingsScope | null = null
let currentWriter: WhaleSettingsWriter | null = null
const listeners = new Set<() => void>()

/** @returns the bound scope, or null on a host that cannot serve the namespace. */
export function settingsScope(): WhaleSettingsScope | null {
  return current
}

/** @returns the writer bound alongside the current scope, or null. */
export function settingsWriter(): WhaleSettingsWriter | null {
  return currentWriter
}

/**
 * Install or clear the bound scope, notifying every subscriber.
 *
 * @param next - the controller to publish, or null to clear.
 * @param writer - the mutation seam bound with it, or null.
 */
export function setSettingsScope(next: WhaleSettingsScope | null, writer: WhaleSettingsWriter | null = null): void {
  if (current === next && currentWriter === writer) return
  current = next
  currentWriter = writer
  for (const listener of [...listeners]) listener()
}

/**
 * Clear only the controller a given fiber installed.
 *
 * A disposer running after a reconnect has already published a replacement
 * must not erase it — the card would then hold a disabled field with a live
 * scope sitting right there.
 *
 * @param owned - the controller that fiber bound.
 */
export function releaseSettingsScope(owned: WhaleSettingsScope | null): void {
  if (current === owned) setSettingsScope(null, null)
}

/**
 * Subscribe to everything that can change the answer to "may I edit this now":
 * the current controller's own snapshot, AND the controller being replaced or
 * removed underneath us.
 *
 * @param listener - invoked after either kind of change.
 * @returns the disposer removing this subscription.
 */
export function subscribeSettingsScope(listener: () => void): () => void {
  let inner: (() => void) | null = current ? current.subscribe(listener) : null
  const onIdentityChange = (): void => {
    if (inner) inner()
    inner = current ? current.subscribe(listener) : null
    listener()
  }
  listeners.add(onIdentityChange)
  return () => {
    listeners.delete(onIdentityChange)
    if (inner) inner()
    inner = null
  }
}

/**
 * @returns the current snapshot. Stable by reference between changes, which is
 * what useSyncExternalStore requires.
 */
export function settingsScopeSnapshot(): WhaleScopeSnapshot {
  return current ? current.getSnapshot() : NO_SCOPE_SNAPSHOT
}

/** @returns the snapshot on a server render, where no scope is ever bound. */
export function noSettingsScopeSnapshot(): WhaleScopeSnapshot {
  return NO_SCOPE_SNAPSHOT
}

/**
 * @param snapshot - the scope snapshot the card is observing.
 * @returns whether a write may be attempted at all.
 */
export function scopeAcceptsWrites(snapshot: WhaleScopeSnapshot): boolean {
  return snapshot.status === 'ready' && snapshot.writable === true
}

/**
 * Save the DashScope key and report whether the Host actually took it.
 *
 * This deliberately does NOT go through `SettingsScope.set()`. That method
 * catches a refused mutation, performs a recovery read, and resolves — the
 * outcome never reaches the caller. Nothing observable afterwards can stand in
 * for it either:
 *
 *   - the value cannot be read back, because the field is `role('secret')`;
 *   - "does the plugin have a key now" answers yes for the key that was
 *     already there, so every refused ROTATION would look like a success;
 *   - the namespace revision cannot attribute a change. A conflicting write
 *     from another tab moves it, our fenced write is refused BECAUSE of that
 *     move, and the controller's recovery read then publishes the new
 *     revision. A revision that advanced is therefore consistent with both
 *     outcomes.
 *
 * So the write goes to the same `settings.mutate` RPC the controller uses, one
 * layer below the scope, and reads `result.ok`. The scope stays in charge of
 * WHETHER a write is allowed, and is re-read here rather than trusted from the
 * last render: it can go read-only, or be replaced, between the click and this
 * call.
 *
 * @param scope - the bound scope, consulted for permission.
 * @param writer - the mutation seam bound with it.
 * @param value - the key the user typed.
 * @returns whether the Host accepted the write.
 */
export async function saveDashscopeKey(
  scope: WhaleSettingsScope,
  writer: WhaleSettingsWriter,
  value: string,
): Promise<boolean> {
  if (!scopeAcceptsWrites(scope.getSnapshot())) return false
  return await writer.set('dashscopeApiKey', value)
}

/**
 * Build the writer over the Host's settings RPC, owning its own revision fence.
 *
 * The fence is this adapter's business because it writes outside the
 * controller's queue: it seeds from a `describe`, takes the accepted view's
 * revision on success, and re-reads after a refusal so a retry does not repeat
 * the expectation that was just rejected.
 *
 * @param settingsApi - `connection.api.settings`, the same seam the controller uses.
 * @param namespace - this plugin's settings namespace.
 * @returns the writer, or null if the api does not offer the RPC.
 */
export function createSettingsWriter(settingsApi: any, namespace: string): WhaleSettingsWriter | null {
  if (!settingsApi || typeof settingsApi.mutate !== 'function' || typeof settingsApi.describe !== 'function') {
    return null
  }
  let revision: number | undefined

  const sync = async (): Promise<void> => {
    const response = await settingsApi.describe({})
    const payload = response && response.result && response.result.ok ? response.result.value : null
    const views = payload && Array.isArray(payload.namespaces) ? payload.namespaces : []
    const view = views.find((candidate: any) => candidate && candidate.ns === namespace)
    revision = view ? view.revision : undefined
  }

  return {
    set: async (field: string, value: unknown): Promise<boolean> => {
      if (revision === undefined) await sync().catch(() => undefined)
      const response = await settingsApi.mutate({
        ns: namespace,
        ops: [{ op: 'set', path: [field], value }],
        ...(revision === undefined ? {} : { expectedRevision: revision }),
      })
      const accepted = !!(response && response.result && response.result.ok)
      if (accepted) revision = response.result.value ? response.result.value.revision : undefined
      else await sync().catch(() => { revision = undefined })
      return accepted
    },
  }
}
