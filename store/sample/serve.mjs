import { execFileSync } from 'node:child_process'
import { createServer } from 'node:https'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Use a temporary self-signed certificate only for this loopback demo server.
const directory = mkdtempSync(join(tmpdir(), 'dev-sideboard-sample-'))
process.on('exit', () => rmSync(directory, { recursive: true, force: true }))
const key = join(directory, 'key.pem')
const cert = join(directory, 'cert.pem')
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    key,
    '-out',
    cert,
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
  ],
  { stdio: 'ignore' },
)

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/cover.svg', ['cover.svg', 'image/svg+xml']],
])
const server = createServer(
  { key: readFileSync(key), cert: readFileSync(cert) },
  (request, response) => {
    const file = files.get(new URL(request.url, 'https://localhost').pathname)
    if (!file) {
      response.writeHead(404)
      response.end('Not found')
      return
    }
    const body = readFileSync(new URL(file[0], import.meta.url))
    response.writeHead(200, {
      'Content-Type': file[1],
      'Content-Length': body.length,
    })
    response.end(body)
  },
)
server.listen(8443, '127.0.0.1', () => {
  console.log(
    'Open https://localhost:8443/ and accept the local certificate warning.',
  )
  console.log('Press Ctrl+C to stop.')
})
process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
