import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
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
export const LOGOUT_ROUTE = '/api/dsh-foxy-oopz/logout'

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
  let captureTimer = null
  let captureBusy = false
  let lastReplyAt = 0

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
  function stopCapturePolling() {
    if (captureTimer) clearInterval(captureTimer)
    captureTimer = null
    captureBusy = false
  }

  function startCapturePolling() {
    stopCapturePolling()
    captureTimer = setInterval(() => {
      void pollCaptures()
    }, 1500)
    if (captureTimer.unref) captureTimer.unref()
  }

  function shouldReply(text) {
    if (settings.replyMode === 'off') return false
    if (settings.replyMode === 'all') return true
    const value = String(text || '').toLowerCase()
    return (settings.triggerWords || []).some((word) => value.includes(String(word).toLowerCase()))
  }

  async function replyToCall(text) {
    if (!call || settings.replyEnabled === false || !shouldReply(text)) return
    if (Date.now() - lastReplyAt < settings.replyCooldownMs) return
    lastReplyAt = Date.now()
    const data = readCall(call, settings)
    const recent = (data.turns || []).slice(-24)
      .map((turn) => `${turn.speaker || '未知'}：${turn.text}`)
      .join('\n')
    const persona = readPersona(settings)
    const reply = await chat(settings, [
      {
        role: 'system',
        content: [
          settings.systemPrompt || '',
          persona,
          '你正在 OOPZ 语音频道里和朋友聊天。根据最近的对话用中文口语简短回应，一般一到三句话；不要提模型、系统提示、工具或“我听到了语音”。',
        ].filter(Boolean).join('\n\n'),
      },
      { role: 'user', content: `最近的通话记录：\n${recent}\n\n请直接回应最后说话的人。` },
    ], { temperature: 0.8, maxTokens: 350 })
    appendTurn(call, { speaker: 'Foxy', text: reply, source: 'llm' })
    const audio = await synthesize(ctx, settings, reply)
    await play(ctx, settings, audio.file)
    history.unshift({ at: Date.now(), type: 'voice-reply', text: reply.slice(0, 120) })
    history = history.slice(0, 20)
  }

  async function handleCapture(item) {
    if (!call) return
    const uid = String(item.uid || '')
    if (!acceptsSpeaker(uid)) return
    const raw = Buffer.from(String(item.data || ''), 'base64')
    if (!raw.length) return
    const result = await transcribe(ctx, settings, raw, item.mime || 'audio/webm')
    const text = String(result?.text || '').trim()
    if (!text) return
    appendTurn(call, {
      speaker: `OOPZ ${uid}`,
      speakerUid: uid,
      text,
      source: 'stt',
    })
    log(`语音转写 ${uid}: ${text.slice(0, 80)}`)
    await replyToCall(text)
  }

  async function pollCaptures() {
    if (!call || captureBusy) return
    const base = String(settings.sidecarUrl || '').replace(/\/+$/, '')
    if (!base) return
    captureBusy = true
    try {
      const after = Number(call.captureSeq || 0)
      const response = await fetch(`${base}/voice/captures?after=${after}`)
      if (!response.ok) throw new Error(`capture HTTP ${response.status}`)
      const payload = await response.json()
      const items = Array.isArray(payload.captures) ? payload.captures : []
      if (!items.length) return
      const ids = []
      for (const item of items) {
        if (!call) break
        call.captureSeq = Math.max(Number(call.captureSeq || 0), Number(item.id) || 0)
        ids.push(item.id)
        try {
          await handleCapture(item)
        } catch (error) {
          lastError = `语音处理失败：${error?.message || error}`
          log(lastError)
        }
      }
      if (ids.length) {
        await fetch(`${base}/voice/captures/ack`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids }),
        }).catch(() => {})
      }
    } catch (error) {
      lastError = `读取语音片段失败：${error?.message || error}`
    } finally {
      captureBusy = false
    }
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

  async function waitForWs(bot, timeoutMs = 12000) {
    const started = Date.now()
    while (bot?.ws && !bot.ws.isConnected && Date.now() - started < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    return !!bot?.ws?.isConnected
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
      const wsReady = await waitForWs(bot)
      if (!wsReady) log('WebSocket 尚未就绪，语音进房可能被服务端忽略')
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
    if (sidecarChild && !sidecarChild.killed) sidecarChild.kill()
    sidecarChild = null
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

  async function logout() {
    await stop().catch(() => {})
    settings = saveSettings({
      enabled: false,
      deviceId: '',
      personUid: '',
      voiceAreaId: '',
      voiceChannelId: '',
      clearSecrets: true,
    })
    return status()
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
    const memberList = (members || []).slice(0, 100)
    let profiles = {}
    if (memberList.length) {
      try {
        profiles = await bot.members.getUserInfos(memberList.map((member) => member.uid))
      } catch (error) {
        warnings.push(`成员昵称解析失败：${error?.message || error}`)
      }
    }
    const resolvedMembers = memberList.map((member) => {
      const profile = profiles?.[member.uid] || {}
      const name = member.nickname || member.nickName || member.name
        || profile.nickname || profile.name || ''
      return { uid: member.uid, name: name || member.uid }
    })
    return {
      areaId: selectedArea,
      areas: areas.map((area) => ({ id: area.areaId, name: area.name, memberCount: area.memberCount })),
      channels: (groups || []).flatMap((group) => (group.channels || []).map((channel) => ({
        id: channel.channelId,
        name: channel.name,
        type: channel.type,
        group: group.name,
      }))),
      members: resolvedMembers,
      warnings,
    }
  }

  function voiceContext() {
    return { foxyOopz: { bot } }
  }

  let sidecarChild = null

  async function sidecarHealthy(base) {
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) })
      return response.ok
    } catch {
      return false
    }
  }

  async function ensureSidecar() {
    if (settings.autoStartSidecar === false) return false
    const base = String(settings.sidecarUrl || '').replace(/\/+$/, '')
    if (!base) return false
    let url
    try { url = new URL(base) } catch { return false }
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) return false
    if (await sidecarHealthy(base)) return true
    if (sidecarChild && !sidecarChild.killed) return false
    const script = fileURLToPath(new URL('../sidecar/server.mjs', import.meta.url))
    if (!existsSync(script)) {
      log(`语音侧车脚本不存在：${script}`)
      return false
    }
    try {
      sidecarChild = spawn(process.execPath, [script], {
        cwd: dirname(script),
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: url.port || '7899' },
        stdio: 'ignore',
        windowsHide: true,
      })
      sidecarChild.on('exit', (code) => {
        sidecarChild = null
        if (code) ctx.logger?.warn?.(`[foxy-oopz] 语音侧车退出：${code}`)
      })
      for (let i = 0; i < 50; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        if (await sidecarHealthy(base)) {
          log('语音侧车已启动')
          return true
        }
        if (!sidecarChild) break
      }
      log('语音侧车启动超时')
    } catch (error) {
      log(`语音侧车启动失败：${error?.message || error}`)
    }
    return false
  }

  async function startCallRoute(body = {}) {
    if (call) return { ok: false, error: 'call already active', call }
    await ensureSidecar()
    const voice = await joinVoice(voiceContext(), settings, body)
    call = {
      ...startCall(settings, {
        areaId: body.area || settings.voiceAreaId,
        channelId: body.channel || settings.voiceChannelId,
      }),
      startedAt: new Date().toISOString(),
      areaId: body.area || settings.voiceAreaId || '',
      channelId: body.channel || settings.voiceChannelId || '',
      voice,
      captureSeq: 0,
    }
    if (voice.audio) startCapturePolling()
    log(`voice call started ${call.id}`)
    return { ok: true, call: { id: call.id, startedAt: call.startedAt }, voice }
  }

  async function endCall() {
    stopCapturePolling()
    const current = call
    call = null
    const left = await leaveVoice(voiceContext(), settings).catch((error) => ({
      ok: false,
      error: error?.message || String(error),
    }))
    if (!current) return { ok: true, alreadyLeft: true, left }
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
    return { ok: true, callId: current.id, summary, turns: finished?.turns || 0, left }
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
      if (!call) throw new Error('请先开始语音通话，再测试 TTS')
      await ensureSidecar()
      const joinCurrent = async () => {
        const voice = await joinVoice(voiceContext(), settings, {
          area: call.areaId || settings.voiceAreaId,
          channel: call.channelId || settings.voiceChannelId,
        })
        call.voice = voice
        if (voice.audio !== true) {
          throw new Error(voice.warning || voice.note || '语音侧车没有加入频道')
        }
      }
      if (call.voice?.audio !== true) await joinCurrent()
      const audio = await synthesize(ctx, settings, body.text || '你好，我是 Foxy。')
      let played
      try {
        played = await play(ctx, settings, audio.file)
      } catch (firstError) {
        // 侧车可能被手动重启过；重新进房后再试一次，避免“有通话但页面已掉线”。
        await joinCurrent().catch(() => {})
        try {
          played = await play(ctx, settings, audio.file)
        } catch {
          throw firstError
        }
      }
      return json({ ok: true, audio, played })
    })
    route(LOGIN_ROUTE, ['POST'], async (request) => json({ ...(await passwordLogin(await readJsonBody(request))) }))
    route(LOGOUT_ROUTE, ['POST'], async () => json({ ok: true, status: await logout() }))
    route(VOICE_CATALOG_ROUTE, ['GET', 'POST'], async (request) => {
      const body = request.method === 'POST' ? await readJsonBody(request) : {}
      return json({ ok: true, ...(await voiceCatalog(body.areaId)) })
    })
    route(CALL_START_ROUTE, ['POST'], async (request) => {
      const result = await startCallRoute(await readJsonBody(request))
      return json({ ok: true, ...result, status: status() })
    })
    route(CALL_END_ROUTE, ['POST'], async () => json({ ok: true, ...(await endCall()), status: status() }))
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
