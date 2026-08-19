import assert from 'node:assert/strict'
import test from 'node:test'
import { collectHarnessActivities } from '../src/activity-context.ts'

const root = 'E:\\workspace\\demo'
const now = 2_000_000_000_000

function classify(text: string): string | undefined {
  const sessions = [{
    id: 'traditional-input',
    header: { id: 'traditional-input', cwd: root, createdAt: now - 10_000 },
    events: [
      { type: 'turn/start', seq: 0, time: now - 10_000, data: { turn: 1 } },
      {
        type: 'user/message',
        seq: 1,
        time: now - 9_000,
        data: { id: 'user-message-1', role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } },
      },
      { type: 'turn/end', seq: 2, time: now - 7_000, data: { turn: 1, reason: { kind: 'completed' } } },
    ],
  }]
  return collectHarnessActivities(sessions, root, now)[0]?.category
}

/**
 * The keyword lists were Simplified-only, so a user writing Traditional Chinese
 * got no classification at all and the whole task-awareness feature went quiet.
 * This is independent of any locale setting: the text being matched is whatever
 * the user typed, which a Taiwanese user may write in either script.
 */
const CASES: [string, string][] = [
  ['幫我除錯一下，這個程式一直當掉', 'code-debug'],
  ['幫我重構這個元件，順便把介面串接寫完', 'code-development'],
  ['幫我把這份逐字稿統整成重點整理', 'document-summary'],
  ['幫我潤稿這份提案的段落結構', 'document-writing'],
  ['幫我續寫這篇小說的劇情，人設不要跑掉', 'literary-creation'],
  ['幫我做這季的資料分析，順便畫個圖表', 'data-analysis'],
  ['明天要上台，幫我把簡報的投影片再調整一下', 'presentation'],
  ['幫我調整這個介面的配色跟排版', 'visual-design'],
  ['幫我校對這段翻譯的措辭', 'translation'],
  ['幫我規劃這個專案的時程跟優先順序', 'planning'],
]

for (const [text, expected] of CASES) {
  test(`classifies Traditional input: ${expected}`, () => {
    assert.equal(classify(text), expected, `"${text}" should classify as ${expected}`)
  })
}

test('Simplified input still classifies exactly as before', () => {
  // The change is strictly additive, so nothing that used to be recognised may
  // move to a different category.
  assert.equal(classify('帮我调试一下，这个程序一直崩溃'), 'code-debug')
  assert.equal(classify('帮我重构这个组件，顺便把接口写完'), 'code-development')
  assert.equal(classify('帮我把这份材料总结成要点'), 'document-summary')
  assert.equal(classify('帮我做这季的数据分析，顺便画个图表'), 'data-analysis')
  assert.equal(classify('帮我校对这段翻译的措辞'), 'translation')
})
