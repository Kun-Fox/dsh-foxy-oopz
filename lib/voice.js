import { mkdirSync, writeFileSync } from 'node:fs'
import { join as joinPath } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

function tempFile(ext) {
  const dir = joinPath(tmpdir(), 'foxy-oopz')
  mkdirSync(dir, { recursive: true })
  return join(dir, `${randomUUID()}.${ext}`)
}

async function run(command, args, timeoutMs = 60000) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${command} timed out`))
    }, timeoutMs)
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 500)}`))
    })
  })
}

async function dshSpeech(ctx) {
  const service = ctx?.get?.('dshSpeech') || ctx?.dshSpeech
  return service?.synthesize && service?.transcribe ? service : null
}

export async function synthesize(ctx, settings, text, sessionId = 'foxy-oopz') {
  const value = String(text || '').trim()
  if (!value) throw new Error('TTS text is empty')
  if (settings.ttsProvider === 'none') throw new Error('TTS is disabled')
  if (settings.ttsProvider === 'dsh-speech') {
    const speech = await dshSpeech(ctx)
    if (!speech) throw new Error('DSH Speech is not installed; enable @lamplitisles/dsh-speech or choose edge-tts/gpt-sovits')
    const audio = await speech.synthesize({ sessionId, text: value })
    const file = tempFile(audio.mediaType === 'audio/wav' ? 'wav' : 'mp3')
    writeFileSync(file, Buffer.from(audio.data))
    return { file, mediaType: audio.mediaType || 'audio/mpeg', provider: 'dsh-speech' }
  }
  if (settings.ttsProvider === 'edge-tts') {
    const file = tempFile('mp3')
    await run(settings.edgeTtsCommand || 'edge-tts', [
      '--voice', settings.ttsVoice || 'zh-CN-XiaoxiaoNeural',
      '--text', value,
      '--write-media', file,
    ], 120000)
    return { file, mediaType: 'audio/mpeg', provider: 'edge-tts' }
  }
  if (settings.ttsProvider === 'gpt-sovits') {
    const base = String(settings.gptSovitsUrl || '').replace(/\/+$/, '')
    if (!base) throw new Error('GPT-SoVITS URL is empty')
    const response = await fetch(`${base}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: value, text_lang: 'zh', model: settings.gptSovitsModel || 'default' }),
    })
    if (!response.ok) throw new Error(`GPT-SoVITS HTTP ${response.status}`)
    const type = response.headers.get('content-type') || 'audio/wav'
    const file = tempFile(type.includes('mpeg') ? 'mp3' : 'wav')
    writeFileSync(file, Buffer.from(await response.arrayBuffer()))
    return { file, mediaType: type, provider: 'gpt-sovits' }
  }
  throw new Error(`Unsupported TTS provider: ${settings.ttsProvider}`)
}

export async function transcribe(ctx, settings, data, mediaType = 'audio/ogg') {
  if (settings.sttProvider === 'none') throw new Error('STT is disabled')
  const speech = await dshSpeech(ctx)
  if (!speech) throw new Error('DSH Speech is not installed; install @lamplitisles/dsh-speech')
  return await speech.transcribe({
    sessionId: 'foxy-oopz',
    mediaType,
    data: Buffer.from(data),
    language: 'zh',
  })
}

export async function play(ctx, settings, file) {
  const base = String(settings.sidecarUrl || '').replace(/\/+$/, '')
  if (base) {
    try {
      const response = await fetch(`${base}/voice/play`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file }),
      })
      if (response.ok) return await response.json()
    } catch {}
  }
  const bot = ctx?.foxyOopz?.bot
  if (bot?.voice?.playFile) return await bot.voice.playFile(file, 'audio/mpeg')
  throw new Error('No audio playback adapter: start the OOPZ voice sidecar or use the OOPZ SDK voice backend')
}

export async function join(ctx, settings, options = {}) {
  const base = String(settings.sidecarUrl || '').replace(/\/+$/, '')
  if (base) {
    const response = await fetch(`${base}/voice/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        area: options.area || settings.voiceAreaId,
        channel: options.channel || settings.voiceChannelId,
      }),
    })
    if (!response.ok) throw new Error(`Voice sidecar join failed: HTTP ${response.status}`)
    return await response.json()
  }
  const bot = ctx?.foxyOopz?.bot
  if (!bot?.voice?.join) throw new Error('No voice backend; configure OOPZ sidecar')
  return await bot.voice.join({
    area: options.area || settings.voiceAreaId,
    channel: options.channel || settings.voiceChannelId,
  })
}

export async function leave(ctx, settings) {
  const base = String(settings.sidecarUrl || '').replace(/\/+$/, '')
  if (base) {
    try {
      const response = await fetch(`${base}/voice/leave`, { method: 'POST' })
      if (response.ok) return await response.json()
    } catch {}
  }
  const bot = ctx?.foxyOopz?.bot
  if (bot?.voice?.leave) return await bot.voice.leave()
}
