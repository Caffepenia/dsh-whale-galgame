import assert from 'node:assert/strict'
import test from 'node:test'
import { emotionOf, moodOf, type DialogueLine } from '../src/client/dialogue-classifiers.ts'

function userSays(text: string): { who: 'user'; text: string }[] {
  return [{ who: 'user', text }]
}

function heroineSays(text: string): { who: 'heroine'; text: string }[] {
  return [{ who: 'heroine', text }]
}

const EMOTION_CASES: readonly [input: string, expected: string][] = [
  ['你太过分了', 'angry'],
  ['你太過分了', 'angry'],
  ['别吓我', 'frightened'],
  ['別嚇我', 'frightened'],
  ['真是无语', 'exasperated'],
  ['真是無語', 'exasperated'],
  ['我的梦想在闪闪发光', 'starry'],
  ['我的夢想在閃閃發光', 'starry'],
  ['别这样，我脸红了', 'shy'],
  ['別這樣，我臉紅了', 'shy'],
  ['这是什么', 'confused'],
  ['這是什麼', 'confused'],
  ['认真讨论项目报告', 'serious'],
  ['認真討論項目報告', 'serious'],
  ['我喜欢你，真开心', 'cheerful'],
  ['我喜歡你，真開心', 'cheerful'],
]

test('emotion oracle classifies representative Simplified and Traditional input', () => {
  for (const [input, expected] of EMOTION_CASES) {
    assert.equal(emotionOf(userSays(input)), expected, input)
  }
})

const MOOD_CASES: readonly [input: string, expected: string][] = [
  ['你太过分了', 'angry'],
  ['你太過分了', 'angry'],
  ['我喜欢你，真开心', 'happy'],
  ['我喜歡你，真開心', 'happy'],
  ['别这样，我脸红了', 'shy'],
  ['別這樣，我臉紅了', 'shy'],
]

test('mood oracle classifies representative Simplified and Traditional input', () => {
  for (const [input, expected] of MOOD_CASES) {
    assert.equal(moodOf(heroineSays(input)), expected, input)
  }
})

const EMOTION_SHADOWING_CASES: readonly [input: string, expected: string][] = [
  ['别吓我，你太过分了', 'angry'],
  ['別嚇我，你太過分了', 'angry'],
  ['这个问题我没听懂', 'confused'],
  ['這個問題我沒聽懂', 'confused'],
  ['我喜欢认真学习', 'serious'],
  ['我喜歡認真學習', 'serious'],
]

test('emotion oracle fixes first-match precedence for overlapping vocabulary', () => {
  for (const [input, expected] of EMOTION_SHADOWING_CASES) {
    assert.equal(emotionOf(userSays(input)), expected, input)
  }
})

const EMOTION_BOUNDARY_CASES: readonly {
  name: string
  lines: readonly DialogueLine[]
  expected: string
}[] = [
  { name: 'no user line', lines: heroineSays('你太过分了'), expected: 'normal' },
  {
    name: 'valid host emotion overrides a conflicting keyword',
    lines: [{ who: 'user', text: '你太过分了', emotion: 'starry' }],
    expected: 'starry',
  },
  { name: 'empty text', lines: userSays(''), expected: 'normal' },
  { name: 'non-matching text', lines: userSays('今天风很轻'), expected: 'normal' },
]

test('emotion oracle pins host precedence and normal boundaries', () => {
  for (const { name, lines, expected } of EMOTION_BOUNDARY_CASES) {
    assert.equal(emotionOf(lines), expected, name)
  }
})

const MOOD_SHADOWING_CASES: readonly [input: string, expected: string][] = [
  ['我喜欢你，但你太过分了', 'angry'],
  ['我喜歡你，但你太過分了', 'angry'],
  ['我喜欢你就脸红', 'happy'],
  ['我喜歡你就臉紅', 'happy'],
]

test('mood oracle fixes first-match precedence for overlapping vocabulary', () => {
  for (const [input, expected] of MOOD_SHADOWING_CASES) {
    assert.equal(moodOf(heroineSays(input)), expected, input)
  }
})

const MOOD_BOUNDARY_CASES: readonly {
  name: string
  lines: readonly DialogueLine[]
  expected: string
}[] = [
  { name: 'no heroine line', lines: userSays('你太过分了'), expected: 'normal' },
  { name: 'empty text', lines: heroineSays(''), expected: 'normal' },
  { name: 'non-matching text', lines: heroineSays('今天风很轻'), expected: 'normal' },
]

test('mood oracle pins normal boundaries', () => {
  for (const { name, lines, expected } of MOOD_BOUNDARY_CASES) {
    assert.equal(moodOf(lines), expected, name)
  }
})
