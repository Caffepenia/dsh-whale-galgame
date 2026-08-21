import assert from 'node:assert/strict'
import test from 'node:test'
import { LOCALES, getLocale, resolveLocale, setLocale, t } from '../src/locales/index.ts'
import { zhTW } from '../src/locales/zh-TW.ts'
import { activityCgTheme, activitySystemInstruction } from '../src/activity-context.ts'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

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

test('the framework sentinels exercise non-identity zh-TW translation', () => {
  setLocale('zh-TW')
  const cases = [
    ['鲸鱼娘', '鯨魚娘'],
    ['那就继续聊聊吧', '那就繼續聊聊吧'],
    ['工作区主模型', '工作區主模型'],
    ['把角色来源切换为 ', '把角色來源切換為 '],
    [' 登场了。）', ' 登場了。）'],
    ['「主人，又见面啦～今天也想听你说话呢。」', '「主人，又見面啦～今天也想聽你說話喔。」'],
    ['温暖浪漫的日常氛围（旧版主题摘要已隐藏）', '溫暖浪漫的日常氛圍（舊版主題摘要已隱藏）'],
    ['找不到这场小剧场的记录', '找不到這場小劇場的紀錄'],
    ['生成被重启打断，请重新触发', '生成被重啟打斷，請重新觸發'],
  ] as const
  for (const [source, expected] of cases) {
    assert.notEqual(expected, source)
    assert.equal(t(source), expected)
  }
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

test('zh-TW translates known keys and still falls back for the rest', () => {
  setLocale('zh-TW')
  assert.equal(t('鲸鱼娘'), '鯨魚娘')
  assert.equal(t('保存失败：'), '儲存失敗：')
  assert.equal(t('这句话不在任何表里'), '这句话不在任何表里')
})

test('translating an already-translated string is a no-op, across the whole table', () => {
  // Stored dialogue is translated every time it is served, so the operation has
  // to be idempotent: no translated value may itself be a key, or that string
  // translates a second time on the next read and lands somewhere else.
  // Spot-checking a few sources cannot see a collision introduced elsewhere,
  // so this is the invariant over every entry.
  setLocale('zh-TW')
  const collisions = Object.values(zhTW).filter((value) => value in zhTW)
  assert.deepEqual(collisions, [], 'these translations are themselves source keys')
  for (const source of Object.keys(zhTW)) assert.equal(t(t(source)), t(source), `not idempotent for ${source.slice(0, 30)}`)
})

test('a save written in zh-CN translates, because the stored text is the key', () => {
  // Activity labels and hints are persisted in zh-CN and translated where they
  // enter a prompt, so an existing save needs no migration and a language
  // switch applies to history that was recorded before it.
  const stored: any = {
    fingerprint: 'activity-abc123',
    category: 'code-debug',
    label: '代码调试',
    status: 'completed',
    time: 1_700_000_000_000,
    chatHint: '主人刚才似乎又在排查棘手的代码问题；自然表示你注意到了这件事，并用符合角色性格的方式关心一句，尤其提醒不要熬得太晚。',
    cgHint: '画面用抽象的程序结构、调试光点与理顺的逻辑线呼应代码调试，不出现可读文字或真实代码',
  }
  setLocale('zh-TW')
  const instruction = activitySystemInstruction(stored)
  assert.ok(instruction.includes('程式除錯'), 'the persisted zh-CN label renders in Traditional')
  assert.ok(!instruction.includes('代码调试'), 'no Simplified label survives into the prompt')
  assert.ok(activityCgTheme(stored).includes('程式除錯'))
})

test('no zh-TW string drops an escape sequence or an ASCII token', () => {
  // A translation that loses a \n, a placeholder, or a model id corrupts a
  // prompt or a URL at runtime rather than merely reading oddly, so this is
  // checked over the whole table rather than spot-checked.
  // Control characters as they exist at RUNTIME. Matching the two-character
  // escape as written in the file would bless a key that holds a backslash and
  // an "n" instead of a newline — which is a string no call site can produce.
  const escapes = (s: string) => (s.match(/[\n\t\r]/g) || []).join()
  // Every ASCII character, in order: JSON punctuation, angle brackets, `=` and
  // single characters are all load-bearing in these prompts, and a token-based
  // match steps over them.
  const ascii = (s: string) => (s.match(/[\x20-\x7e]/g) || []).join('')
  assert.ok(Object.keys(zhTW).length > 0, 'the table is not empty')
  for (const [source, translated] of Object.entries(zhTW)) {
    assert.equal(escapes(translated), escapes(source), `escape drift: ${source.slice(0, 40)}`)
    assert.equal(ascii(translated), ascii(source), `ascii drift: ${source.slice(0, 40)}`)
  }
})

test('no zh-TW string keeps a term that reads as Mainland usage in Taiwan', () => {
  // OpenCC produces valid Traditional characters for these, but the wrong word.
  const banned: [string, string, string][] = [
    ['质量', '質量', '品質'],
    ['设置', '設置', '設定'],
    ['默认', '默認', '預設'],
    ['数据', '數據', '資料'],
    ['插件', '插件', '外掛'],
    ['屏幕', '屏幕', '螢幕'],
    ['缓存', '緩存', '快取'],
    ['台词', '臺詞', '台詞'],
    ['哦', '哦', '喔'],
  ]
  // The one entry where a Mainland form is correct: it quotes DSH's own sidebar
  // labels, and DSH has no Traditional Chinese. Translating that path sends the
  // reader looking for something the host never renders.
  const quotesHostUi = '在左侧“设置 → 插件 → 插件配置”中展开鲸鱼娘 Galgame，即可重新开启。'
  assert.ok(quotesHostUi in zhTW, 'the host-path exemption still names a real entry')

  // Scanned over every value regardless of its key: a Mainland form can be
  // typed into a translation whose source never contained the paired term.
  for (const [source, wrong, right] of banned) {
    for (const [key, value] of Object.entries(zhTW)) {
      if (key === quotesHostUi) continue
      assert.ok(!value.includes(wrong), `"${source}" rendered as "${wrong}" (want "${right}"): ${value.slice(0, 40)}`)
    }
  }
})

test('every source key appears in src/ exactly as a call site writes it', async () => {
  // A source-string table has no compiler behind it: a key that no call site
  // can produce is never found, and the string silently stays Simplified.
  // Keys are compared in their ESCAPED form, because that is the only way a
  // mistake in escaping shows up — a key holding a backslash and an "n" is
  // indistinguishable in the file from one holding a newline, yet only the
  // latter is ever passed to t().
  const asWritten = (key: string) =>
    key.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r')

  const dir = join(import.meta.dirname, '..', 'src')
  const files = (await readdir(dir, { recursive: true })).map(String).filter((f) => f.endsWith('.ts') && !f.includes('locales'))
  const sources = await Promise.all(files.map((f) => readFile(join(dir, f), 'utf8')))

  const unreachable = Object.keys(zhTW).filter((key) => !sources.some((src) => src.includes(asWritten(key))))
  assert.deepEqual(unreachable, [], 'these keys can never be looked up')
})

test('the activity prefix is looked up, not only the label inside it', async () => {
  // The prefix and the label are separate lookups on the same line, so the
  // label can translate while the sentence around it stays Simplified.
  setLocale('zh-TW')
  const instruction = activitySystemInstruction({
    fingerprint: 'activity-prefix',
    category: 'code-debug',
    label: '代码调试',
    status: 'completed',
    time: 1_700_000_000_000,
    chatHint: '主人刚才似乎又在排查棘手的代码问题；自然表示你注意到了这件事，并用符合角色性格的方式关心一句，尤其提醒不要熬得太晚。',
    cgHint: '画面用抽象的程序结构、调试光点与理顺的逻辑线呼应代码调试，不出现可读文字或真实代码',
  } as any)
  assert.ok(instruction.includes('近期任務事件'), instruction.slice(0, 60))
  assert.ok(instruction.startsWith('\n'), 'the prompt still opens with a real newline')
})
