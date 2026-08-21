export interface DialogueLine {
  readonly who?: string
  readonly text?: string
  readonly emotion?: string
}

// Whale-girl emotion sprites: filename = emotion (local asset keys).
export const EMOTION_ART: Readonly<Record<string, string>> = {
  cheerful: 'whale-cheerful',
  shy: 'whale-shy',
  serious: 'whale-serious',
  confused: 'whale-confused',
  angry: 'whale-angry',
  frightened: 'whale-frightened',
  exasperated: 'whale-exasperated',
  starry: 'whale-starry',
}

// Prefer the host's LLM classification, then apply the first matching keyword branch.
export function emotionOf(lines: readonly DialogueLine[]): string {
  const line = lastLine(lines, 'user')
  if (!line) return 'normal'
  if (line.emotion && EMOTION_ART[line.emotion]) return line.emotion
  const last = line.text || ''
  if (!last) return 'normal'
  if (/生气|讨厌|哼|烦|滚|过分|笨蛋|气死|可恶|生氣|討厭|煩|滾|過分|氣死|可惡/.test(last)) return 'angry'
  if (/害怕|吓|恐怖|鬼|啊啊|惊|别吓我|嚇|驚|別嚇我/.test(last)) return 'frightened'
  if (/无奈|累死|唉|好吧|算了|服了|无语|头疼|無奈|無語|頭疼/.test(last)) return 'exasperated'
  if (/星星|好美|浪漫|月亮|梦想|憧憬|心动|闪闪|漂亮|夢想|心動|閃閃/.test(last)) return 'starry'
  if (/害羞|呜|脸红|别这样|不好意思|才不|嗚|臉紅|別這樣/.test(last)) return 'shy'
  if (/？|\?|什么|不懂|困惑|为啥|咦|不明白|没听懂|什麼|為啥|沒聽懂/.test(last)) return 'confused'
  if (/认真|工作|学习|讨论|问题|严肃|报告|项目|方案|認真|學習|討論|問題|嚴肅|報告|項目/.test(last)) return 'serious'
  if (/开心|高兴|哈哈|太好了|棒|喜欢|爱|♪|≧▽≦|耶|抱抱|亲亲|開心|高興|喜歡|愛|親親/.test(last)) return 'cheerful'
  return 'normal'
}

export function moodOf(lines: readonly DialogueLine[]): string {
  const line = lastLine(lines, 'heroine')
  const last = line && line.text
  if (!last) return 'normal'
  if (/生气|讨厌|哼|笨蛋|不理|走开|过分|烦|生氣|討厭|走開|過分|煩/.test(last)) return 'angry'
  if (/喜欢|♪|开心|太棒|幸福|≧▽≦|哈哈|啦～|喜歡|開心/.test(last)) return 'happy'
  if (/害羞|才不|呜|脸红|别这样|……|嗚|臉紅|別這樣/.test(last)) return 'shy'
  return 'normal'
}

function lastLine(lines: readonly DialogueLine[], who: string): DialogueLine | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].who === who) return lines[i]
  }
  return undefined
}
