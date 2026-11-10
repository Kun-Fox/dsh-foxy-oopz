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
  const bot = ctx?.foxyOopz?.bot
  if (!bot) throw new Error('OOPZ 尚未连接，无法加入语音频道')
  const area = String(options.area || settings.voiceAreaId || '').trim()
  const channel = String(options.channel || settings.voiceChannelId || '').trim()
  if (!area || !channel) throw new Error('请先选择语音分区和频道')

  // Node SDK 的 Voice.join 是空实现；REST enter_channel 负责拿真实 Agora 凭据。
  const transport = bot?.rest?.transport
  if (!transport?.post) throw new Error('OOPZ SDK 缺少 REST transport，无法进入语音频道')
  let pid = ''
  try {
    const profile = await transport.get(`/client/v1/person/v2/selfDetail?uid=${encodeURIComponent(settings.personUid || '')}`)
    const data = profile?.data || profile
    pid = String(data?.pid || data?.personId || '')
  } catch {}
  const raw = await transport.post('/area/v2/channel/enter', {
    type: 'VOICE',
    area,
    channel,
    fromChannel: '',
    fromArea: '',
    password: '',
    sign: 1,
    pid,
  }, { timeoutMs: 15000 })
  const data = raw?.data || raw
  if (!data?.rtcToken && !data?.supplierSign && !data?.roomId) throw new Error('OOPZ 返回了空的语音频道凭据')
  const presence = {
    ...data,
    rtcToken: data.rtcToken || data.supplierSign || '',
    area,
    channel,
    pid,
    audio: false,
    mode: 'presence',
    sidecar: false,
  }

  const base = String(settings.sidecarUrl || '').replace(/\/+$/, '')
  if (!base) {
    return {
      ...presence,
      warning: '',
      note: '已进入频道在线状态；未配置语音侧车，不能收发音轨。',
    }
  }

  try {
    const response = await fetch(`${base}/voice/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        area,
        channel,
        appId: settings.agoraAppId || data.appId || '',
        token: data.supplierSign || data.rtcToken || '',
        roomId: data.roomId || '',
        uid: pid,
        oopzUid: settings.personUid || '',
      }),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const sidecar = await response.json()
    if (sidecar?.ok === false) throw new Error(sidecar.error || '侧车拒绝加入')
    return {
      ...presence,
      ...sidecar,
      audio: true,
      mode: 'agora',
      sidecar: true,
      warning: '',
      note: '已通过 Agora 侧车进入语音频道。',
    }
  } catch (error) {
    const warning = `语音侧车不可达或拒绝加入（${base}）：${error?.message || error}。已改为仅在线状态；未建立音频。`
    console.warn(`[dsh-foxy-oopz] ${warning}`)
    return {
      ...presence,
      warning,
      note: `${warning} 真实收发音轨仍需要启动语音侧车。`,
    }
  }
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
