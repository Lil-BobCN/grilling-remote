import { HttpError } from './errors.mjs'

const MAX_PARTS = 10

export function parseMultipart(body, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '')
  if (!match) throw new HttpError(400, '上传格式不对，请重新选择文件')
  const boundary = (match[1] || match[2]).trim()
  if (!boundary) throw new HttpError(400, '上传格式不对，请重新选择文件')

  const delimiter = Buffer.from(`--${boundary}`)
  const separator = Buffer.from(`\r\n--${boundary}`)
  const fields = {}
  const files = {}

  let position = body.indexOf(delimiter)
  if (position !== 0) throw new HttpError(400, '上传格式不对，请重新选择文件')
  position += delimiter.length

  let count = 0
  while (true) {
    if (body[position] === 0x2d && body[position + 1] === 0x2d) break
    if (body[position] === 0x0d && body[position + 1] === 0x0a) position += 2

    const headerEnd = body.indexOf('\r\n\r\n', position)
    if (headerEnd < 0) throw new HttpError(400, '上传格式不对，请重新选择文件')
    const headerText = body.subarray(position, headerEnd).toString('utf8')
    const partEnd = body.indexOf(separator, headerEnd + 4)
    if (partEnd < 0) throw new HttpError(400, '上传格式不对，请重新选择文件')
    const data = body.subarray(headerEnd + 4, partEnd)

    const part = parseHeaders(headerText)
    if (!part.name) throw new HttpError(400, '上传格式不对，请重新选择文件')
    if (part.filename !== undefined) {
      files[part.name] = {
        filename: part.filename,
        contentType: part.contentType || 'application/octet-stream',
        data,
      }
    } else {
      fields[part.name] = data.toString('utf8')
    }

    count += 1
    if (count > MAX_PARTS) throw new HttpError(400, '上传内容太多，请只传工作区 zip')

    position = partEnd + separator.length
  }

  return { fields, files }
}

function parseHeaders(text) {
  const out = {}
  for (const line of text.split('\r\n')) {
    const index = line.indexOf(':')
    if (index < 0) continue
    const name = line.slice(0, index).trim().toLowerCase()
    const value = line.slice(index + 1).trim()
    if (name === 'content-disposition') {
      const nameMatch = /name="([^"]*)"/i.exec(value)
      if (nameMatch) out.name = nameMatch[1]
      const filenameMatch = /filename="([^"]*)"/i.exec(value)
      if (filenameMatch) out.filename = filenameMatch[1]
      if (/filename\*=UTF-8''/i.test(value)) {
        const extended = /filename\*=UTF-8''([^;]+)/i.exec(value)
        if (extended) {
          try {
            out.filename = decodeURIComponent(extended[1])
          } catch {
            // 保留 filename 的原文
          }
        }
      }
    }
    if (name === 'content-type') out.contentType = value
  }
  return out
}
