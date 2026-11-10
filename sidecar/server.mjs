import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const PORT = Number(process.env.PORT || 7899)
const HOST = '127.0.0.1'
const DEFAULT_AGORA_APP_ID = process.env.AGORA_APP_ID || '358eebceadb94c2a9fd91ecd7b341602'
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
}

let browser = null
let page = null
let joining = null
let identityTimer = null
let current = null
const captures = []
let captureSeq = 0
const MAX_CAPTURES = 40
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024

async function ensurePage() {
  if (page && !page.isClosed()) return page
  if (joining) return await joining
  joining = (async () => {
    if (!browser || !browser.isConnected()) {
      browser = await chromium.launch({
        executablePath: EDGE,
        headless: true,
        args: [
          '--autoplay-policy=no-user-gesture-required',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--no-first-run',
        ],
      })
    }
    page = await browser.newPage()
    page.on('console', (msg) => {
      const text = msg.text()
      if (text) console.log(`[page:${msg.type()}] ${text.slice(0, 500)}`)
    })
    page.on('pageerror', (error) => console.error('[pageerror]', error?.message || error))
    await page.goto(`http://${HOST}:${PORT}/agora_player.html`, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForFunction(() => typeof window.agoraJoin === 'function', null, { timeout: 15000 })
    return page
  })().finally(() => { joining = null })
  return await joining
}

function send(res, status, body) {
  const data = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': data.length,
    'cache-control': 'no-store',
  })
  res.end(data)
}

async function readBody(req, limit = 64 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`)
  if (url.pathname === '/agora.js') {
    const file = join(ROOT, 'node_modules', 'agora-rtc-sdk-ng', 'AgoraRTC_N-production.js')
    const data = await readFile(file)
    res.writeHead(200, { 'content-type': MIME['.js'], 'content-length': data.length, 'cache-control': 'no-store' })
    res.end(data)
    return true
  }
  if (url.pathname === '/' || url.pathname === '/agora_player.html') {
    const data = await readFile(join(ROOT, 'agora_player.html'))
    res.writeHead(200, { 'content-type': MIME['.html'], 'content-length': data.length, 'cache-control': 'no-store' })
    res.end(data)
    return true
  }
  return false
}

async function handleJoin(body) {
  const appId = String(body.appId || '').trim()
  const token = String(body.token || '').trim()
  const roomId = String(body.roomId || '').trim()
  const uid = String(body.uid || '').trim()
  const oopzUid = String(body.oopzUid || '').trim()
  if (!roomId) throw new Error('roomId is required')
  if (!uid) throw new Error('uid is required')
  if (!token) throw new Error('token/supplierSign is required')

  const p = await ensurePage()
  const result = await p.evaluate(async ({ appId, token, roomId, uid, oopzUid }) => {
    const joined = await window.agoraJoin(appId || '358eebceadb94c2a9fd91ecd7b341602', token, roomId, uid)
    if (!joined?.ok) return joined
    const identity = await window.agoraSetVoiceIdentity(oopzUid, joined.uid)
    return { ...joined, identity, state: window.agoraGetStatus() }
  }, { appId, token, roomId, uid, oopzUid })

  if (!result?.ok) throw new Error(result?.error || 'Agora join failed')
  current = { appId, roomId, uid, agoraUid: result.uid, oopzUid, joinedAt: Date.now() }
  if (identityTimer) clearInterval(identityTimer)
  identityTimer = setInterval(async () => {
    if (!page || page.isClosed() || !current) return
    try { await page.evaluate(() => window.agoraSetVoiceIdentity()) } catch {}
  }, 10000)
  return { ok: true, audio: true, mode: 'agora', agoraUid: result.uid, identity: result.identity, state: result.state }
}

async function handlePlay(body) {
  const file = String(body.file || '').trim()
  if (!file) throw new Error('file is required')
  const info = await stat(file)
  if (!info.isFile()) throw new Error('file not found')
  const data = await readFile(file)
  if (data.length > 32 * 1024 * 1024) throw new Error('audio file too large')
  const mime = MIME[extname(file).toLowerCase()] || 'audio/mpeg'
  const p = await ensurePage()
  const result = await p.evaluate(async ({ base64, mime }) => {
    return await window.agoraPlayLocal(base64, mime)
  }, { base64: data.toString('base64'), mime })
  if (!result?.ok) throw new Error(result?.error || 'Agora play failed')
  return { ok: true, ...result }
}

async function handleLeave() {
  if (identityTimer) clearInterval(identityTimer)
  identityTimer = null
  if (page && !page.isClosed()) {
    try { await page.evaluate(() => window.agoraLeave()) } catch {}
  }
  current = null
  captures.length = 0
  return { ok: true }
}

async function handleStop() {
  if (page && !page.isClosed()) {
    try { await page.evaluate(() => window.agoraStopAudio()) } catch {}
  }
  return { ok: true }
}

function handleCapture(body) {
  const uid = String(body.uid || '').trim()
  if (!uid) throw new Error('uid is required')
  const mime = String(body.mime || 'audio/wav').trim()
  const data = String(body.data || '')
  if (!data) throw new Error('data is required')
  const buffer = Buffer.from(data, 'base64')
  if (!buffer.length) throw new Error('empty capture')
  if (buffer.length > MAX_CAPTURE_BYTES) throw new Error('capture too large')
  const capture = {
    id: ++captureSeq,
    uid,
    mime,
    startedAt: Number(body.startedAt) || Date.now(),
    endedAt: Number(body.endedAt) || Date.now(),
    durationMs: Number(body.durationMs) || 0,
    data: buffer.toString('base64'),
  }
  captures.push(capture)
  while (captures.length > MAX_CAPTURES) captures.shift()
  return { ok: true, id: capture.id, queued: captures.length }
}

function handleCaptures(after = 0) {
  const id = Math.max(0, Number(after) || 0)
  return {
    ok: true,
    captures: captures.filter((item) => item.id > id),
    latest: captures.length ? captures[captures.length - 1].id : id,
  }
}

function handleCaptureAck(body) {
  const ids = new Set((Array.isArray(body.ids) ? body.ids : []).map((id) => Number(id)))
  if (ids.size) {
    for (let i = captures.length - 1; i >= 0; i--) {
      if (ids.has(captures[i].id)) captures.splice(i, 1)
    }
  }
  return { ok: true, queued: captures.length }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`)
    if (req.method === 'GET' && (url.pathname === '/health')) {
      send(res, 200, {
        ok: true,
        service: 'dsh-foxy-oopz-sidecar',
        joined: !!current,
        page: !!page && !page.isClosed(),
        browser: !!browser && browser.isConnected(),
        agoraAppId: current?.appId || DEFAULT_AGORA_APP_ID,
        roomId: current?.roomId || '',
        agoraUid: current?.agoraUid || null,
        oopzUid: current?.oopzUid || '',
        captures: captures.length,
        latestCapture: captures.length ? captures[captures.length - 1].id : 0,
      })
      return
    }
    if (req.method === 'GET' && url.pathname === '/voice/captures') {
      return send(res, 200, handleCaptures(url.searchParams.get('after')))
    }
    if (req.method === 'GET' && await serveStatic(req, res)) return
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST required' })

    const body = await readBody(req)
    let result
    if (url.pathname === '/voice/join') result = await handleJoin(body)
    else if (url.pathname === '/voice/play') result = await handlePlay(body)
    else if (url.pathname === '/voice/leave') result = await handleLeave()
    else if (url.pathname === '/voice/stop') result = await handleStop()
    else if (url.pathname === '/voice/capture') result = handleCapture(body)
    else if (url.pathname === '/voice/captures/ack') result = handleCaptureAck(body)
    else return send(res, 404, { ok: false, error: 'not found' })
    send(res, 200, result)
  } catch (error) {
    console.error(`[${req.method} ${req.url}]`, error?.stack || error)
    send(res, 500, { ok: false, error: error?.message || String(error) })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`dsh-foxy-oopz sidecar listening on http://${HOST}:${PORT}`)
  console.log(`edge=${EDGE}`)
  console.log(`defaultAgoraAppId=${DEFAULT_AGORA_APP_ID}`)
})

async function shutdown() {
  try { if (page && !page.isClosed()) await page.close() } catch {}
  try { if (browser && browser.isConnected()) await browser.close() } catch {}
  server.close(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
