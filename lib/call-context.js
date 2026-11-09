import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export function callsDir(settings) {
  if (settings.callContextDir) return settings.callContextDir
  return join(process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh'), 'foxy-oopz', 'calls')
}

export function startCall(settings, meta = {}) {
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
  const dir = callsDir(settings)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${id}.jsonl`)
  const header = {
    kind: 'call-start',
    callId: id,
    startedAt: new Date().toISOString(),
    areaId: meta.areaId || settings.voiceAreaId || '',
    channelId: meta.channelId || settings.voiceChannelId || '',
    participants: meta.participants || [],
  }
  appendFileSync(file, `${JSON.stringify(header)}\n`, 'utf8')
  return { id, file }
}

export function appendTurn(call, turn = {}) {
  if (!call?.file) return
  const entry = {
    kind: 'turn',
    at: new Date().toISOString(),
    speaker: String(turn.speaker || ''),
    speakerUid: String(turn.speakerUid || ''),
    text: String(turn.text || '').slice(0, 8000),
    source: String(turn.source || 'voice'),
    final: turn.final !== false,
  }
  if (!entry.text.trim()) return
  appendFileSync(call.file, `${JSON.stringify(entry)}\n`, 'utf8')
}

export function readCall(callOrId, settings) {
  const file = typeof callOrId === 'string'
    ? join(callsDir(settings), `${callOrId}.jsonl`)
    : callOrId?.file
  if (!file || !existsSync(file)) return { header: null, turns: [] }
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
  const entries = lines.map((line) => {
    try { return JSON.parse(line) } catch { return null }
  }).filter(Boolean)
  return {
    header: entries.find((entry) => entry.kind === 'call-start') || null,
    turns: entries.filter((entry) => entry.kind === 'turn'),
  }
}

export function finishCall(call, settings, summary = '') {
  if (!call?.file) return null
  const data = readCall(call, settings)
  const end = {
    kind: 'call-end',
    callId: data.header?.callId || call.id,
    endedAt: new Date().toISOString(),
    turns: data.turns.length,
    summary: String(summary || ''),
  }
  appendFileSync(call.file, `${JSON.stringify(end)}\n`, 'utf8')
  const indexPath = join(callsDir(settings), 'index.json')
  let index = {}
  try { index = JSON.parse(readFileSync(indexPath, 'utf8')) } catch {}
  index[call.id] = {
    callId: call.id,
    startedAt: data.header?.startedAt || '',
    endedAt: end.endedAt,
    turns: data.turns.length,
    summary: end.summary,
  }
  writeFileSync(indexPath, JSON.stringify(index, null, 2))
  return { ...end, header: data.header, turns: data.turns.length, entries: data.turns }
}

export function listCalls(settings, limit = 20) {
  const dir = callsDir(settings)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .reverse()
    .slice(0, limit)
    .map((name) => {
      const id = name.replace(/\.jsonl$/, '')
      const data = readCall(id, settings)
      const end = (() => {
        try {
          const lines = readFileSync(join(dir, name), 'utf8').split(/\r?\n/).filter(Boolean)
          return lines.map((line) => JSON.parse(line)).reverse().find((entry) => entry.kind === 'call-end')
        } catch { return null }
      })()
      return { callId: id, startedAt: data.header?.startedAt || '', turns: data.turns.length, summary: end?.summary || '' }
    })
}
