import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULTS, foxyHome, loadSettings, publicSettings, saveSettings, normalizeSettings } from './settings.js'
import { startBot, stopBot } from './oopz.js'
import { chat, summarizeCall } from './llm.js'
import { appendTurn, finishCall, listCalls, readCall, startCall } from './call-context.js'
import { join as joinVoice, leave as leaveVoice, play, synthesize, transcribe } from './voice.js'
import { loginWithPassword } from './login.js'

export const name = 'dsh-foxy-oopz'
export const inject = ['connection']

export const STATUS_ROUTE = '/api/dsh-foxy-oopz/status'
export const SETTINGS_ROUTE = '/api/dsh-foxy-oopz/settings'
export const START_ROUTE = '/api/dsh-foxy-oopz/start'
export const STOP_ROUTE = '/api/dsh-foxy-oopz/stop'
export const TTS_TEST_ROUTE = '/api/dsh-foxy-oopz/tts/test'
export const CALL_START_ROUTE = '/api/dsh-foxy-oopz/call/start'
export const CALL_END_ROUTE = '/api/dsh-foxy-oopz/call/end'
export const CALL_TURN_ROUTE = '/api/dsh-foxy-oopz/call/turn'
export const CALL_STT_ROUTE = '/api/dsh-foxy-oopz/call/stt'
export const VOICE_CATALOG_ROUTE = '/api/dsh-foxy-oopz/voice/catalog'
export const LOGIN_ROUTE = '/api/dsh-foxy-oopz/login/password'

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

async function readJsonBody(request) {
  if (!request?.body) return {}
  const raw = await new Response(request.body).text()
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

function presetPath(settings) {
  return join(foxyHome(), 'foxy', 'presets', settings.memoryPresetId || 'foxy.yml')
}

function readPersona(settings) {
  try {
    const text = readFileSync(presetPath(settings), 'utf8')
    const match = text.match(/^persona:\s*\|?\s*\n([\s\S]*?)(?=\n\w|$)/m)
    return match?.[1]?.trim() || ''
  } catch {
    return ''
  }
}

export function apply(ctx, config) {
  let settings = normalizeSettings({ ...DEFAULTS, ...(config || {}), ...loadSettings() })
  let bot = null
  let call = null
  let starting = false
  let lastError = ''
  let history = []

  const log = (message) => ctx.logger?.info?.(`[foxy-oopz] ${message}`)

  function status() {
    return {
      ok: true,
      running: !!bot,
      starting,
      voiceEnabled: settings.voiceEnabled,
      channel: settings.voiceChannelId || settings.channelId,
      area: settings.voiceAreaId || settings.areaId,
      voiceOnly: settings.voiceOnly !== false,
      autoJoinVoice: settings.autoJoinVoice === true,
      listenMode: settings.listenMode,
      listenUserIds: settings.listenUserIds,
      call: call ? { id: call.id, file: call.file, startedAt: call.startedAt } : null,
      lastError,
      history: history.slice(0, 20),
      calls: listCalls(settings, 10),
    }
  }

  async function remember(text, meta = {}) {
    if (!settings.enableMemory || !text) return { ok: false, reason: 'disabled' }
    const provider = ctx.get?.('foxyMemory')
    if (!provider?.record) return { ok: false, reason: 'no-provider' }
    try {
      await provider.record({
        role: 'assistant',
        text,
        sessionId: meta.sessionId || `oopz:${Date.now()}`,
        presetId: settings.memoryPresetId || undefined,
        platform: 'oopz',
        channelType: meta.channelType || 'oopz_text',
        channelId: meta.channelId || settings.channelId || '',
        eventType: meta.eventType || 'oopz_message',
        sourceLabel: meta.sourceLabel || 'OOPZ',
        speakerKey: meta.speakerKey || `oopz:${settings.personUid}`,
        speakerLabel: meta.speakerLabel || 'Foxy',
      })
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: error.message }
    }
  }

  function acceptsSpeaker(uid) {
    const id = String(uid || '')
    if (!id) return true
    if ((settings.muteUserIds || []).includes(id)) return false
    if (settings.listenMode === 'allow') return (settings.listenUserIds || []).includes(id)
    if (settings.listenMode === 'deny') return !(settings.listenUserIds || []).includes(id)
    return true
  }
  async function handleMessage(message) {
    if (settings.voiceOnly !== false) return
    const content = String(message.content || '').trim()
    if (!content) return
    const memory = ctx.get?.('foxyMemory')
    let contextText = ''
    try {
      const context = await memory?.context?.({
        presetId: settings.memoryPresetId || undefined,
        query: content,
        limit: 6,
      })
      contextText = context?.text || ''
    } catch {}
    const persona = readPersona(settings)
    const reply = await chat(settings, [
      {
        role: 'system',
        content: [
          settings.systemPrompt || '',
          persona,
          '你正在 OOPZ 语音/文字频道中与用户交流。回复自然、简短，中文口语；不要假装听过没有提供的语音内容。',
          contextText ? `可参考的记忆：\n${contextText}` : '',
        ].filter(Boolean).join('\n\n'),
      },
      { role: 'user', content },
    ], { temperature: 0.8, maxTokens: 500 })

    if (settings.replyEnabled) {
      await bot.send(message.area, message.channel, reply, {
        referenceMessageId: message.messageId || undefined,
      })
    }
    await remember(`我在 OOPZ 回复了 ${message.senderName || '用户'}：${reply}`, {
      sessionId: `oopz:${message.area}:${message.channel}`,
      channelId: message.channel,
      eventType: 'oopz_reply',
      speakerKey: message.senderUid ? `oopz:${message.senderUid}` : `oopz:${settings.personUid}`,
      speakerLabel: message.senderName || '用户',
    })
    history.unshift({ at: Date.now(), type: 'message', channel: message.channel, text: reply.slice(0, 120) })
    history = history.slice(0, 20)
  }

  async function start() {
    if (bot || starting) return status()
    if (!settings.deviceId || !settings.personUid || !settings.jwtToken || !settings.privateKey) {
      lastError = '缺少 OOPZ 凭据：网页登录不会自动导入。请填写 Device ID、Person UID、JWT Token 和 Private Key。'
      return status()
    }
    starting = true
    lastError = ''
    try {
      bot = await startBot(settings, {
        onMessage: handleMessage,
        onError: (error) => { lastError = error?.message || String(error) },
      })
      log(`connected uid=${settings.personUid}`)
      if (settings.autoJoinVoice && !call) {
        try {
          await startCallRoute({ area: settings.voiceAreaId, channel: settings.voiceChannelId })
        } catch (error) {
          lastError = error?.message || String(error)
        }
      }
      return status()
    } catch (error) {
      lastError = error?.message || String(error)
      bot = null
      throw error
    } finally {
      starting = false
    }
  }

  async function stop() {
    if (call) await endCall().catch(() => {})
    await stopBot(bot).catch(() => {})
    bot = null
    return status()
  }

  async function passwordLogin(body = {}) {
    const credentials = await loginWithPassword(body.phone, body.password, { deviceId: settings.deviceId })
    settings = saveSettings({
      deviceId: credentials.deviceId,
      personUid: credentials.personUid,
      jwtToken: credentials.jwtToken,
      privateKey: credentials.privateKey,
    })
    if (bot) await stop()
    await start()
    return {
      ok: true,
      account: { personUid: credentials.personUid, expiresAt: credentials.expiresAt },
      status: status(),
    }
  }

  async function voiceCatalog(areaId = '') {
    if (!bot) throw new Error('OOPZ 尚未连接，请先填写凭据并连接')
    const areas = await bot.areas.getJoinedAreas()
    if (!Array.isArray(areas) || areas.length === 0) {
      return {
        areaId: '',
        areas: [],
        channels: [],
        members: [],
        message: '机器人账号尚未加入任何 OOPZ 分区。请先在 OOPZ 客户端把机器人账号拉入目标分区，再重新读取。',
      }
    }
    const selectedArea = String(areaId || settings.voiceAreaId || areas[0]?.areaId || '')
    let groups = []
    let members = []
    let warnings = []
    if (selectedArea) {
      groups = await bot.areas.getAreaChannels(selectedArea)
      try {
        const page = await bot.areas.getMembers(selectedArea, { limit: 100 })
        members = Array.isArray(page?.members) ? page.members : []
      } catch (error) {
        warnings.push(`成员列表读取失败：${error?.message || error}`)
      }
    }
    return {
      areaId: selectedArea,
      areas: areas.map((area) => ({ id: area.areaId, name: area.name, memberCount: area.memberCount })),
      channels: (groups || []).flatMap((group) => (group.channels || []).map((channel) => ({
        id: channel.channelId,
        name: channel.name,
        type: channel.type,
        group: group.name,
      }))),
      members: (members || []).map((member) => ({ uid: member.uid, name: member.nickname || member.uid })),
      warnings,
    }
  }

  async function startCallRoute(body = {}) {
    if (call) return { ok: false, error: 'call already active', call }
    const voice = await joinVoice(ctx, settings, body)
    call = { ...startCall(settings, { areaId: body.area, channelId: body.channel }), startedAt: new Date().toISOString(), voice }
    log(`voice call started ${call.id}`)
    return { ok: true, call: { id: call.id, startedAt: call.startedAt }, voice }
  }

  async function endCall() {
    if (!call) return { ok: false, error: 'no active call' }
    const current = call
    call = null
    await leaveVoice(ctx, settings).catch(() => {})
    const data = readCall(current, settings)
    let summary = ''
    try {
      summary = await summarizeCall(settings, data, readPersona(settings))
    } catch (error) {
      summary = (data.turns || []).map((turn) => `${turn.speaker}: ${turn.text}`).join('\n').slice(0, 4000)
      lastError = error.message
    }
    const finished = finishCall(current, settings, summary)
    if (summary) {
      await remember(summary, {
        sessionId: `oopz-call:${current.id}`,
        channelType: 'oopz_voice',
        channelId: current.id,
        eventType: 'oopz_call',
        sourceLabel: 'OOPZ 语音',
        speakerKey: `oopz:${settings.personUid}`,
        speakerLabel: 'Foxy',
      })
    }
    return { ok: true, callId: current.id, summary, turns: finished?.turns || 0 }
  }

  async function onCallTurn(body = {}) {
    if (!call) return { ok: false, error: 'no active call' }
    if (!acceptsSpeaker(body.speakerUid)) return { ok: false, skipped: 'speaker-filtered' }
    const text = String(body.text || '').trim()
    if (!text) return { ok: false, error: 'empty transcript' }
    appendTurn(call, {
      speaker: body.speaker,
      speakerUid: body.speakerUid,
      text,
      source: body.source || 'voice',
    })
    return { ok: true, turns: readCall(call, settings).turns.length }
  }

  ctx.effect?.(() => () => { stop().catch(() => {}) }, 'foxy-oopz lifecycle')

  ctx.inject?.(['connection'], (host) => {
    const register = host?.connection?.fetch?.register
    if (typeof register !== 'function') return
    const route = (path, methods, handler) => register({
      path,
      methods,
      requestBody: 'buffered',
      fetch: async (request) => {
        try { return await handler(request) } catch (error) {
          return json({ ok: false, error: error?.message || String(error) }, 500)
        }
      },
    })

    route(STATUS_ROUTE, ['GET'], async () => json({ ok: true, status: status(), settings: publicSettings(settings) }))
    route(SETTINGS_ROUTE, ['GET', 'POST'], async (request) => {
      if (request.method === 'POST') {
        const patch = await readJsonBody(request)
        settings = saveSettings(patch)
        if (bot) { await stop(); await start().catch(() => {}) }
      }
      return json({ ok: true, settings: publicSettings(settings), status: status() })
    })
    route(START_ROUTE, ['POST'], async () => json({ ok: true, status: await start() }))
    route(STOP_ROUTE, ['POST'], async () => json({ ok: true, status: await stop() }))
    route(TTS_TEST_ROUTE, ['POST'], async (request) => {
      const body = await readJsonBody(request)
      const audio = await synthesize(ctx, settings, body.text || '你好，我是 Foxy。')
      await play(ctx, settings, audio.file)
      return json({ ok: true, audio })
    })
    route(LOGIN_ROUTE, ['POST'], async (request) => json({ ...(await passwordLogin(await readJsonBody(request))) }))
    route(VOICE_CATALOG_ROUTE, ['GET', 'POST'], async (request) => {
      const body = request.method === 'POST' ? await readJsonBody(request) : {}
      return json({ ok: true, ...(await voiceCatalog(body.areaId)) })
    })
    route(CALL_START_ROUTE, ['POST'], async (request) => json({ ok: true, ...(await startCallRoute(await readJsonBody(request))) }))
    route(CALL_END_ROUTE, ['POST'], async () => json({ ok: true, ...(await endCall()) }))
    route(CALL_TURN_ROUTE, ['POST'], async (request) => json({ ok: true, ...(await onCallTurn(await readJsonBody(request))) }))
    route(CALL_STT_ROUTE, ['POST'], async (request) => {
      const body = await readJsonBody(request)
      if (!body.data) throw new Error('audio data is required (base64)')
      if (!acceptsSpeaker(body.speakerUid)) return json({ ok: false, skipped: 'speaker-filtered' })
      const result = await transcribe(ctx, settings, Buffer.from(body.data, 'base64'), body.mediaType || 'audio/ogg')
      if (body.append !== false && call) {
        appendTurn(call, { speaker: body.speaker || '用户', speakerUid: body.speakerUid || '', text: result.text, source: 'stt' })
      }
      return json({ ok: true, transcript: result })
    })
  })

  if (settings.enabled) start().catch((error) => { lastError = error.message })
  log(`ready enabled=${settings.enabled} area=${settings.areaId || 'unset'} channel=${settings.channelId || 'unset'}`)
}
