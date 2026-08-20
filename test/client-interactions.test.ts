import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')

function section(start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  assert.notEqual(from, -1, 'missing client section: ' + start)
  assert.notEqual(to, -1, 'missing client section boundary: ' + end)
  return source.slice(from, to)
}

test('picker catalogue reads never reuse the mutation lock', () => {
  const loader = section('function loadPickerData()', 'function openPicker(')
  const option = section('function pickerOption(', 'function characterPicker(')

  assert.match(loader, /setPickerCatalogLoading\(true\)/)
  assert.match(loader, /callApi\('settings-get'\)/)
  assert.match(loader, /callModelOptions\(\)/)
  assert.doesNotMatch(loader, /setPickerLoading\(/)
  assert.match(option, /disabled:\s*pickerLoading/)
})

test('profile fields remain editable until a profile write begins', () => {
  const load = section('function loadCharacterProfile(', 'function updateProfileField(')
  const field = section('function profileField(', 'function profileEditor(')
  const save = section('function saveCharacterProfile()', 'function resetCharacterProfile(')

  assert.match(source, /const PROFILE_KEYS = \['displayName', 'address', 'greeting', 'persona', 'tone', 'visual'\] as const/)
  assert.match(load, /\.finally\(\(\)\s*=>\s*\{[\s\S]*setProfileLoading\(false\)/)
  assert.match(field, /disabled:\s*profileLoading\s*\|\|\s*profileSaving/)
  assert.match(field, /onChange:[\s\S]*updateProfileField/)
  assert.match(save, /!profileLoaded\s*\|\|\s*profileSaving/)
  assert.doesNotMatch(save, /pickerLoading/)
  assert.match(save, /setProfileSaving\(true\)/)
  assert.match(save, /\.finally\(\(\)\s*=>\s*setProfileSaving\(false\)\)/)
})

test('available reply choices are not hidden by the latest line author', () => {
  const dialogue = section('function dialogue()', 'function cgModal(')
  assert.match(dialogue, /const showChoices = Array\.isArray\(s\.choices\) && s\.choices\.length > 0/)
  assert.doesNotMatch(dialogue, /last\.who === 'heroine' && s\.choices/)
})

test('the card confirms a key write through the store, not by re-deriving it', () => {
  // The behaviour lives in src/client/settings-scope.ts and is covered by
  // test/settings-scope.test.ts with fake controllers. What can only be
  // checked here is that the card actually routes through it: a copy of the
  // logic inlined in the component would pass those tests and still ship the
  // bug, because nothing would exercise the copy.
  const saveKey = section('function saveKey()', 'function save(patch: any)')

  assert.match(saveKey, /if \(!scope \|\| !writer \|\| !keyEditable \|\| keySaving \|\| !value\) return/)
  assert.match(saveKey, /saveDashscopeKey\(scope, writer, value\)/, 'the write goes through the shared seam')
  assert.match(saveKey, /if \(!accepted\) throw new Error/, 'the Host outcome decides')
  assert.doesNotMatch(saveKey, /revision/, 'no revision heuristic is re-derived here')
  assert.ok(
    saveKey.indexOf('if (!accepted)') < saveKey.indexOf("setKeyDraft('')"),
    'the draft is kept until the write is confirmed',
  )
  assert.ok(
    saveKey.indexOf('if (!accepted)') < saveKey.indexOf('密钥已保存'),
    'success is reported only after the confirmation',
  )
})

test('the key field follows the live scope rather than a snapshot taken at mount', () => {
  // The scope arrives after the card can already be mounted, and can be
  // replaced on reconnect. Subscribing to whichever controller existed at
  // mount observes neither, and the gate goes permanently stale.
  const card = section('function PluginSettingsCard()', 'function save(patch: any)')
  const row = section("React.createElement('strong', null, 'DashScope 密钥')", "className: 'whg-settings-message'")

  assert.match(card, /useSyncExternalStore\(\s*subscribeSettingsScope,\s*settingsScopeSnapshot,/)
  assert.match(card, /const keyEditable = scopeAcceptsWrites\(keyScopeSnapshot\)/)
  assert.match(row, /disabled: !keyEditable \|\| keySaving,/, 'the input is gated')
  assert.match(row, /disabled: !keyEditable \|\| keySaving \|\| !keyDraft\.trim\(\),/, 'the button is gated')
})

test('the binding publishes and releases through the store', () => {
  // Assigning a module-level variable notifies nobody, and a late disposer
  // that clears unconditionally erases the controller a reconnect installed.
  const binding = section("scopeCtx.inject(['connection', 'remote']", 'ctx.effect(() => () => {')
  assert.match(binding, /setSettingsScope\(bound, writer\)/)
  assert.match(binding, /isLoopback === true/, 'a remote browser gets no direct writer')
  assert.match(binding, /releaseSettingsScope\(bound\)/, 'only what this fiber bound is released')
  assert.doesNotMatch(binding, /whaleSettingsScope\s*=/, 'no direct assignment to a mutable global')
})

test('both halves take the settings namespace from one module', () => {
  // The Settings -> Plugins tab renders the intersection of served namespaces
  // and registered cards, so a drift between the two halves does not error —
  // the card just stops appearing.
  assert.match(source, /import \{ WHALE_SETTINGS_NS \} from '\.\.\/settings-namespace\.ts'/)
  assert.doesNotMatch(source, /const WHALE_SETTINGS_NS =/, 'the browser half does not redeclare it')
})
