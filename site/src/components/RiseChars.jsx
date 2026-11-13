/**
 * 标题逐字入场。视觉用 span 拆开，读屏走 h1 的 aria-label。
 * segments: [{ text, bold }]
 */
export default function RiseChars({ segments }) {
  let index = 0

  return (
    <span aria-hidden="true">
      {segments.map((segment, segmentIndex) => {
        const chars = Array.from(segment.text).map((char) => {
          const charIndex = index
          index += 1
          return (
            <span className="rise-char" style={{ '--char-index': charIndex }} key={charIndex}>
              {char}
            </span>
          )
        })

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
