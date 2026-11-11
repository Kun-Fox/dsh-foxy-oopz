import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join as joinPath } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

function tempFile(ext) {
  const dir = joinPath(tmpdir(), 'foxy-oopz')
  mkdirSync(dir, { recursive: true })
  return joinPath(dir, `${randomUUID()}.${ext}`)
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

async function runOutput(command, args, timeoutMs = 60000) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${command} timed out`))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 500)}`))
    })
  })
}

function ffmpegPath(settings = {}) {
  const candidates = [
    settings.ffmpegPath,
    process.env.FFMPEG_PATH,
    'ffmpeg',
    'F:\\kunfox\\ffmpeg-8.1.2-essentials_build\\bin\\ffmpeg.exe',
  ].filter(Boolean)
  return candidates.find((item) => item === 'ffmpeg' || existsSync(item)) || 'ffmpeg'
}

function pythonPath(settings = {}) {
  return String(settings.sttPython || process.env.PYTHON || 'python')
}

async function localSenseVoice(settings, data, mediaType) {
  const ext = String(mediaType || '').includes('wav') ? 'wav'
    : String(mediaType || '').includes('ogg') ? 'ogg'
      : 'webm'
  const input = tempFile(ext)
  const wav = tempFile('wav')
  writeFileSync(input, Buffer.from(data))
  try {
    await run(ffmpegPath(settings), [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', input, '-ar', '16000', '-ac', '1', '-f', 'wav', wav,
    ], 120000)
    const script = fileURLToPath(new URL('../stt/sensevoice.py', import.meta.url))
    const modelDir = String(settings.sttModelDir || '').trim()
    const args = [script, '--wav', wav]
    if (modelDir) {
      args.push('--model', joinPath(modelDir, 'model.int8.onnx'))
      args.push('--tokens', joinPath(modelDir, 'tokens.txt'))
    }
    const stdout = await runOutput(pythonPath(settings), args, 180000)
    const lines = String(stdout).trim().split(/\r?\n/).filter(Boolean)
    const parsed = JSON.parse(lines[lines.length - 1] || '{}')
    return {
      text: String(parsed.text || '').trim(),
      provider: 'sensevoice-local',
    }
  } finally {
    for (const file of [input, wav]) {
      try { unlinkSync(file) } catch {}
    }
  }
}

async function dshSpeech(ctx) {
  const service = ctx?.get?.('dshSpeech') || ctx?.dshSpeech
  return service?.synthesize && service?.transcribe ? service : null
}

async function windowsSapi(text, voice = '') {
  if (process.platform !== 'win32') throw new Error('Windows SAPI TTS is only available on Windows')
  const textFile = tempFile('txt')
  const scriptFile = tempFile('ps1')
  const file = tempFile('wav')
  writeFileSync(textFile, text, 'utf8')
  writeFileSync(scriptFile, [
    'param([string]$TextFile, [string]$OutFile, [string]$Voice)',
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    'if ($Voice) { try { $s.SelectVoice($Voice) } catch {} }',
    '$s.SetOutputToWaveFile($OutFile)',
    '$s.Speak([IO.File]::ReadAllText($TextFile))',
    '$s.Dispose()',
  ].join('\n'), 'utf8')
  await run('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', scriptFile, textFile, file, String(voice || ''),
  ], 120000)
  return { file, mediaType: 'audio/wav', provider: 'windows-sapi' }
}

export async function synthesize(ctx, settings, text, sessionId = 'foxy-oopz') {
  const value = String(text || '').trim()
  if (!value) throw new Error('TTS text is empty')
  if (settings.ttsProvider === 'none') throw new Error('TTS is disabled')
  if (settings.ttsProvider === 'dsh-speech') {
    const speech = await dshSpeech(ctx)
    if (!speech) return await windowsSapi(value, settings.ttsVoice)
    const audio = await speech.synthesize({ sessionId, text: value })
    const file = tempFile(audio.mediaType === 'audio/wav' ? 'wav' : 'mp3')
    writeFileSync(file, Buffer.from(audio.data))
    return { file, mediaType: audio.mediaType || 'audio/mpeg', provider: 'dsh-speech' }
  }
  if (settings.ttsProvider === 'windows-sapi') {
    return await windowsSapi(value, settings.ttsVoice)
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
  const speech = settings.sttProvider === 'sensevoice' ? null : await dshSpeech(ctx)
  if (speech) {
    try {
      return await speech.transcribe({
        sessionId: 'foxy-oopz',
        mediaType,
        data: Buffer.from(data),
        language: 'zh',
      })
    } catch (error) {
      if (settings.sttProvider === 'dsh-speech' && settings.sttFallback === false) throw error
    }
  }
  if (settings.sttProvider === 'dsh-speech' && !speech) {
    // Local SenseVoice fallback is intentional: dsh-speech is an optional plugin.
  }
  return await localSenseVoice(settings, data, mediaType)
}

export async function play(ctx, settings, file) {
  const base = String(settings.sidecarUrl || '').replace(/\/+$/, '')
  if (!base) throw new Error('未配置 OOPZ 语音侧车，无法播放 TTS')
  let response
  try {
    response = await fetch(`${base}/voice/play`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file }),
    })
  } catch (error) {
    throw new Error(`语音侧车不可达（${base}）：${error?.message || error}`)
  }
  if (!response.ok) throw new Error(`语音侧车播放失败：HTTP ${response.status}`)
  const result = await response.json()
  if (result?.ok === false) throw new Error(result.error || '语音侧车拒绝播放')
  return result
}

export async function join(ctx, settings, options = {}) {
  const bot = ctx?.foxyOopz?.bot
  if (!bot) throw new Error('OOPZ 尚未连接，无法加入语音频道')
  const area = String(options.area || settings.voiceAreaId || '').trim()
  let channel = String(options.channel || settings.voiceChannelId || '').trim()
  if (!channel && area && typeof bot?.areas?.getAreaChannels === 'function') {
    try {
      const channels = await bot.areas.getAreaChannels(area)
      const first = (channels || []).find((item) =>
        String(item?.type).toUpperCase().includes('VOICE') || item?.type === 1)
      channel = String(first?.id || '').trim()
      if (channel) console.warn(`[dsh-foxy-oopz] 未指定频道，自动选择 ${channel}`)
    } catch {}
  }
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
        vad: {
          silenceMs: settings.vadSilenceMs,
          minSpeechMs: settings.vadMinSpeechMs,
          maxUtteranceMs: settings.vadMaxUtteranceMs,
          threshold: settings.vadThreshold,
        },
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
