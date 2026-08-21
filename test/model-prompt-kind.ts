export type ModelPromptKind =
  | 'emotion-classifier'
  | 'choice-generator'
  | 'side-story-continuation'
  | 'side-story-writer'
  | 'dialogue'

const promptLabels: ReadonlyArray<readonly [ModelPromptKind, readonly string[]]> = [
  // The continuation prompt also identifies itself as the side-story writer.
  ['side-story-continuation', ['正在续写结尾', '正在續寫結尾']],
  ['side-story-writer', ['小剧场编剧', '小劇場編劇']],
  ['emotion-classifier', ['情绪分类器', '情緒分類器']],
  ['choice-generator', ['对话选项生成器', '對話選項生成器']],
]

export function modelPromptKind(system: unknown): ModelPromptKind {
  const text = String(system || '')
  for (const [kind, labels] of promptLabels) {
    if (labels.some((label) => text.includes(label))) return kind
  }
  return 'dialogue'
}
