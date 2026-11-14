/**
 * 标题逐字入场。视觉用 span 拆开，读屏走 h1 的 aria-label。
 * segments: [{ text, bold }]
 *
 * 英文按单词包一层 nowrap，避免行内方块在单词中间断行；
 * 中文没有空格，仍按字拆开，照常换行。
 */
export default function RiseChars({ segments }) {
  let index = 0

  const renderChar = (char) => {
    const charIndex = index
    index += 1
    return (
      <span
        className={`rise-char${char === ' ' ? ' rise-space' : ''}`}
        style={{ '--char-index': charIndex }}
        key={charIndex}
      >
        {char}
      </span>
    )
  }

  const renderText = (text) => {
    if (!text.includes(' ')) return Array.from(text).map(renderChar)

    return text.split(/(\s+)/).filter(Boolean).map((token, tokenIndex) => {
      if (/^\s+$/.test(token)) {
        return token.split('').map(renderChar)
      }
      return (
        <span className="rise-word" key={`word-${tokenIndex}`}>
          {Array.from(token).map(renderChar)}
        </span>
      )
    })
  }

  return (
    <span aria-hidden="true">
      {segments.map((segment, segmentIndex) => {
        const chars = renderText(segment.text)

        return (
          <span key={segmentIndex}>
            {segment.bold ? <b>{chars}</b> : chars}
            {segmentIndex < segments.length - 1 ? (
              <br className="rise-break" />
            ) : null}
          </span>
        )
      })}
    </span>
  )
}
