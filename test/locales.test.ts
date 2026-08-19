import assert from 'node:assert/strict'
import test from 'node:test'
import { LOCALES, getLocale, resolveLocale, setLocale, t } from '../src/locales/index.ts'
import { activityCgTheme, activitySystemInstruction } from '../src/activity-context.ts'

test.afterEach(() => setLocale('zh-CN'))

test('zh-CN is the key space, so translation is the identity and behaviour is unchanged', () => {
  setLocale('zh-CN')
  assert.equal(t('保存失败：'), '保存失败：')
  assert.equal(t('鲸鱼娘'), '鲸鱼娘')
  assert.equal(t('这句话不在任何表里'), '这句话不在任何表里')
})

test('an unknown locale falls back to zh-CN instead of throwing', () => {
  setLocale('klingon')
  assert.equal(getLocale(), 'zh-CN')
  assert.equal(t('鲸鱼娘'), '鲸鱼娘')
})

test('a locale with no table yet leaves every string at its zh-CN source', () => {
  // A language file that does not exist, or exists but is empty, must degrade
  // one string at a time rather than break the interface.
  setLocale('ja')
  assert.equal(t('鲸鱼娘'), '鲸鱼娘')
  assert.equal(t('保存失败：'), '保存失败：')
})

test('auto follows the host locale, and zh-TW is reachable only by explicit choice', () => {
  // DSH exposes exactly two locales and collapses regional subtags, so no host
  // value can ever select Traditional Chinese.
  assert.equal(resolveLocale('auto', 'zh'), 'zh-CN')
  assert.equal(resolveLocale('auto', 'en'), 'en')
  assert.equal(resolveLocale('auto', undefined), 'zh-CN')
  assert.equal(resolveLocale('zh-TW', 'zh'), 'zh-TW')
  assert.equal(resolveLocale('nonsense', 'zh'), 'zh-CN')
})

test('activity text is translated where it is used, not where it is stored', () => {
  // Labels and hints are persisted, so they stay in zh-CN in the save file and
  // pass through t() only on their way into a prompt. With no table loaded the
  // output must be byte-identical to the pre-i18n behaviour.
  const stored: any = {
    fingerprint: 'activity-abc123',
    category: 'code-debug',
    label: '代码调试',
    status: 'completed',
    time: 1_700_000_000_000,
    chatHint: '主人刚才似乎又在排查棘手的代码问题。',
    cgHint: '画面用抽象的程序结构呼应代码调试',
  }
  setLocale('zh-CN')
  assert.ok(activitySystemInstruction(stored).includes('代码调试'))
  assert.ok(activitySystemInstruction(stored).includes('主人刚才似乎又在排查棘手的代码问题。'))
  assert.ok(activityCgTheme(stored).includes('画面用抽象的程序结构呼应代码调试'))
})

test('every locale the plugin offers is a declared id', () => {
  assert.ok(LOCALES.includes('zh-CN'))
  assert.ok(LOCALES.includes('zh-TW'))
  for (const id of LOCALES) assert.equal(resolveLocale(id, undefined), id)
})
