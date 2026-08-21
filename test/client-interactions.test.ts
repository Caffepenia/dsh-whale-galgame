import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
const classifierSource = readFileSync(new URL('../src/client/dialogue-classifiers.ts', import.meta.url), 'utf8')

function section(start: string, end: string, body = source): string {
  const from = body.indexOf(start)
  const to = body.indexOf(end, from + start.length)
  assert.notEqual(from, -1, 'missing client section: ' + start)
  assert.notEqual(to, -1, 'missing client section boundary: ' + end)
  return body.slice(from, to)
}

function classifierAlternatives(body: string, result: string): string[] {
  const match = body.match(new RegExp("if \\(/([^\\n/]+)/\\.test\\(last\\)\\) return '" + result + "'"))
  assert.ok(match, 'missing ' + result + ' fallback classifier')
  return match[1].split('|')
}

function assertTwinPairs(alternatives: string[], pairs: [string, string][]): void {
  for (const [simplified, traditional] of pairs) {
    assert.ok(alternatives.includes(simplified), 'missing Simplified control: ' + simplified)
    assert.ok(alternatives.includes(traditional), 'missing Traditional twin: ' + traditional)
  }
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

test('user emotion fallback literals include their Traditional twins', () => {
  const emotion = section('export function emotionOf(', 'export function moodOf(', classifierSource)
  assertTwinPairs(classifierAlternatives(emotion, 'angry'), [
    ['生气', '生氣'], ['讨厌', '討厭'], ['烦', '煩'], ['滚', '滾'],
    ['过分', '過分'], ['气死', '氣死'], ['可恶', '可惡'],
  ])
  assertTwinPairs(classifierAlternatives(emotion, 'frightened'), [
    ['吓', '嚇'], ['惊', '驚'], ['别吓我', '別嚇我'],
  ])
  assertTwinPairs(classifierAlternatives(emotion, 'exasperated'), [
    ['无奈', '無奈'], ['无语', '無語'], ['头疼', '頭疼'],
  ])
  assertTwinPairs(classifierAlternatives(emotion, 'starry'), [
    ['梦想', '夢想'], ['心动', '心動'], ['闪闪', '閃閃'],
  ])
  assertTwinPairs(classifierAlternatives(emotion, 'shy'), [
    ['呜', '嗚'], ['脸红', '臉紅'], ['别这样', '別這樣'],
  ])
  assertTwinPairs(classifierAlternatives(emotion, 'confused'), [
    ['什么', '什麼'], ['为啥', '為啥'], ['没听懂', '沒聽懂'],
  ])
  assertTwinPairs(classifierAlternatives(emotion, 'serious'), [
    ['认真', '認真'], ['学习', '學習'], ['讨论', '討論'], ['问题', '問題'],
    ['严肃', '嚴肅'], ['报告', '報告'], ['项目', '項目'],
  ])
  assertTwinPairs(classifierAlternatives(emotion, 'cheerful'), [
    ['开心', '開心'], ['高兴', '高興'], ['喜欢', '喜歡'], ['爱', '愛'], ['亲亲', '親親'],
  ])
})

test('model mood fallback literals include their Traditional twins', () => {
  const mood = section('export function moodOf(', 'function lastLine(', classifierSource)
  assertTwinPairs(classifierAlternatives(mood, 'angry'), [
    ['生气', '生氣'], ['讨厌', '討厭'], ['走开', '走開'], ['过分', '過分'], ['烦', '煩'],
  ])
  assertTwinPairs(classifierAlternatives(mood, 'happy'), [
    ['喜欢', '喜歡'], ['开心', '開心'],
  ])
  assertTwinPairs(classifierAlternatives(mood, 'shy'), [
    ['呜', '嗚'], ['脸红', '臉紅'], ['别这样', '別這樣'],
  ])
})
