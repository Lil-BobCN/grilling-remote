import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMultipart } from '../lib/multipart.mjs'

const boundary = '----afktest'

function body(parts) {
  const chunks = []
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`))
    chunks.push(Buffer.from(`${part.headers}\r\n\r\n`))
    chunks.push(Buffer.isBuffer(part.data) ? part.data : Buffer.from(part.data))
    chunks.push(Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return Buffer.concat(chunks)
}

test('解析文本字段和文件字段', () => {
  const fileBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x0a, 0x0d])
  const parsed = parseMultipart(
    body([
      { headers: 'Content-Disposition: form-data; name="finished"', data: 'true' },
      {
        headers:
          'Content-Disposition: form-data; name="file"; filename="工作区.zip"\r\nContent-Type: application/zip',
        data: fileBytes,
      },
    ]),
    `multipart/form-data; boundary=${boundary}`,
  )

  assert.equal(parsed.fields.finished, 'true')
  assert.equal(parsed.files.file.filename, '工作区.zip')
  assert.equal(parsed.files.file.contentType, 'application/zip')
  assert.deepEqual(parsed.files.file.data, fileBytes)
})

test('没有 boundary 报 400', () => {
  assert.throws(
    () => parseMultipart(Buffer.from(''), 'multipart/form-data'),
    (error) => error.status === 400,
  )
})

test('内容截断报 400', () => {
  const truncated = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"\r\n\r\nabc`)
  assert.throws(
    () => parseMultipart(truncated, `multipart/form-data; boundary=${boundary}`),
    (error) => error.status === 400,
  )
})
