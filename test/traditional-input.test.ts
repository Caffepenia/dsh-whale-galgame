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

test('classifies Traditional input: research', () => {
  assert.equal(classify('幫我找資料，查一下相關文獻的出處'), 'research')
})

/**
 * Simplified input this change must not move.
 *
 * The expected value of every row is what the classifier answered BEFORE any
 * Traditional term was added, `null` included. A Traditional twin cannot appear
 * in Simplified text, so it cannot reach these; a term that reads the same in
 * both scripts can, and that is the whole risk this table exists to catch.
 *
 * The rows carrying 文件, 修正, 需求, 素材, 草稿, 原文, 期限, 排程 and 影像 are
 * the ones that actually regressed while this branch was being written: each of
 * those words is ordinary Simplified vocabulary as well as Taiwanese usage, so
 * adding it plain stole sentences from other categories. 文件夹 is the sharpest
 * of them — a folder, classified as document writing.
 */
const UNCHANGED: [string, string | null][] = [
  ['帮我调试一下，这个程序一直崩溃', 'code-debug'],
  ['帮我重构这个组件，顺便把接口写完', 'code-development'],
  ['帮我把这份材料总结成要点', 'document-summary'],
  ['帮我做这季的数据分析，顺便画个图表', 'data-analysis'],
  ['帮我校对这段翻译的措辞', 'translation'],
  ['帮我重构文件读取逻辑', 'code-development'],
  ['帮我实现这个文件', 'code-development'],
  ['帮我计划这个文件', 'planning'],
  ['帮我看看这个文件', null],
  ['这个文件我读不懂', null],
  ['帮我整理一下文件夹', null],
  ['帮我修正这个界面的排版', 'visual-design'],
  ['帮我修正一下这个函数的返回值', 'code-development'],
  ['把这个需求拆成几个任务', null],
  ['这批素材要重新压缩', null],
  ['先写个草稿给我看看', null],
  ['对照原文校对一下译文', 'translation'],
  ['这个项目的期限是下周五', null],
  ['帮我排程一下明天的会议', null],
  ['这张影像的分辨率太低', null],
  ['今天天气真好，晚上吃什么', null],
  ['我有点累了，想休息一下', null],
]

for (const [text, expected] of UNCHANGED) {
  test(`Simplified input is untouched: ${text}`, () => {
    assert.equal(classify(text) ?? null, expected)
  })
}

/**
 * Category order decides ties, so a new alternative can lose a sentence to an
 * earlier definition without matching anything it should not. Both of these
 * did exactly that before the terms behind them were narrowed.
 */
test('a new term does not steal a sentence from an earlier category', () => {
  assert.equal(classify('幫我修正這個介面的排版'), 'visual-design')
  assert.equal(classify('幫我寫一份系統設計文件的初稿'), 'document-writing')
  assert.equal(classify('這個程式一直丟例外，幫我追一下堆疊'), 'code-debug')
})
