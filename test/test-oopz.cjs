const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'foxy-oopz-'))
  process.env.DSH_HOME = home
  const settingsModule = await import('../lib/settings.js')
  const callContext = await import('../lib/call-context.js')

  const defaults = settingsModule.loadSettings()
  assert.equal(defaults.enabled, false)
  assert.equal(defaults.ttsProvider, 'dsh-speech')
  assert.deepEqual(defaults.triggerWords, ['Foxy', 'foxy'])

  settingsModule.saveSettings({
    enabled: true,
    personUid: '10001',
    jwtToken: 'secret',
    privateKey: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
    llmApiKey: 'sk-test',
    maxCallMinutes: 999,
    ttsProvider: 'edge-tts',
  })
  const saved = settingsModule.loadSettings()
  assert.equal(saved.enabled, true)
  assert.equal(saved.maxCallMinutes, 240)
  assert.equal(saved.ttsProvider, 'edge-tts')
  const publicView = settingsModule.publicSettings(saved)
  assert.equal(publicView.jwtToken, '')
  assert.equal(publicView.jwtTokenSet, true)
  assert.equal(publicView.llmApiKeySet, true)

  const call = callContext.startCall(saved, { participants: ['10001'] })
  callContext.appendTurn(call, { speaker: '用户', speakerUid: '10002', text: '你好' })
  callContext.appendTurn(call, { speaker: 'Foxy', text: '在的' })
  const data = callContext.readCall(call, saved)
  assert.equal(data.turns.length, 2)
  const finished = callContext.finishCall(call, saved, '我们聊了打招呼。')
  assert.equal(finished.turns, 2)
  assert.ok(fs.existsSync(path.join(callContext.callsDir(saved), 'index.json')))

  const login = await import('../lib/login.js')
  let loginRequest
  const originalFetch = global.fetch
  global.fetch = async (url, options) => {
    loginRequest = { url, options }
    return new Response(JSON.stringify({ status: true, data: { uid: '10001', signature: 'jwt-test', signatureNearExpired: 0 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  const credentials = await login.loginWithPassword('13800000000', 'password', { deviceId: 'device-test' })
  global.fetch = originalFetch
  assert.equal(credentials.personUid, '10001')
  assert.equal(credentials.jwtToken, 'jwt-test')
  assert.ok(credentials.privateKey.includes('BEGIN PRIVATE KEY'))
  const loginBody = JSON.parse(loginRequest.options.body)
  assert.equal(loginBody.loginType, 'PASSWORD')
  assert.ok(loginBody.code.length > 100)
  assert.ok(loginRequest.options.headers['oopz-sign'])

  const voice = await import('../lib/voice.js')
  let enterRequest
  const voiceCtx = {
    foxyOopz: {
      bot: {
        rest: {
          transport: {
            get: async () => ({ data: { pid: '213779640' } }),
            post: async (url, body) => {
              enterRequest = { url, body }
              return { status: true, data: { rtcToken: 'rtc-test', roomId: 'room-test' } }
            },
          },
        },
      },
    },
  }
  const joined = await voice.join(voiceCtx, { voiceAreaId: 'area-1', voiceChannelId: 'channel-1' })
  assert.equal(enterRequest.url, '/area/v2/channel/enter')
  assert.equal(enterRequest.body.type, 'VOICE')
  assert.equal(enterRequest.body.area, 'area-1')
  assert.equal(enterRequest.body.pid, '213779640')
  assert.equal(joined.audio, false)
  assert.equal(joined.mode, 'presence')
  const onlineFetch = global.fetch
  let sidecarRequest
  global.fetch = async (url, options) => {
    sidecarRequest = { url, body: JSON.parse(options.body) }
    return { ok: true, json: async () => ({ ok: true, agoraUid: 213779640 }) }
  }
  try {
    const viaSidecar = await voice.join(voiceCtx, {
      voiceAreaId: 'area-1',
      voiceChannelId: 'channel-1',
      sidecarUrl: 'http://127.0.0.1:7899',
      personUid: 'oopz-user',
    })
    assert.equal(sidecarRequest.body.roomId, 'room-test')
    assert.equal(sidecarRequest.body.token, 'rtc-test')
    assert.equal(sidecarRequest.body.uid, '213779640')
    assert.equal(sidecarRequest.body.oopzUid, 'oopz-user')
    assert.equal(viaSidecar.audio, true)
    assert.equal(viaSidecar.mode, 'agora')
  } finally {
    global.fetch = onlineFetch
  }
  global.fetch = async () => { throw new Error('offline') }
  try {
    const fallback = await voice.join(voiceCtx, {
      voiceAreaId: 'area-1',
      voiceChannelId: 'channel-1',
      sidecarUrl: 'http://127.0.0.1:7899',
    })
    assert.equal(fallback.audio, false)
    assert.equal(fallback.mode, 'presence')
    assert.match(fallback.warning, /侧车不可达/)
  } finally {
    global.fetch = onlineFetch
  }
  await assert.rejects(() => voice.join(voiceCtx, {}), /请先选择语音分区和频道/)

  const fetchBeforePlayTest = global.fetch
  global.fetch = async () => ({
    ok: true,
    headers: new Headers({ 'content-type': 'audio/wav' }),
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  })
  try {
    const tts = await voice.synthesize({}, { ttsProvider: 'gpt-sovits', gptSovitsUrl: 'http://127.0.0.1:9880' }, '测试', 'test')
    assert.equal(typeof tts.file, 'string')
    assert.ok(fs.existsSync(tts.file))
    assert.equal(tts.provider, 'gpt-sovits')
  } finally {
    global.fetch = fetchBeforePlayTest
  }

  global.fetch = async () => ({ ok: true, json: async () => ({ ok: false, error: 'not joined' }) })
  try {
    await assert.rejects(
      () => voice.play({}, { sidecarUrl: 'http://127.0.0.1:7899' }, 'test.wav'),
      /not joined/,
    )
  } finally {
    global.fetch = fetchBeforePlayTest
  }

  let clientPlugin
  global.window = {
    __ModuleLoader__: {
      load({ factory }) {
        clientPlugin = factory((id) =>
          id === 'react' ? { createElement: () => ({}) } : {},
        )
      },
    },
  }
  require('../lib/client.js')
  assert.equal(clientPlugin.name, 'dsh-foxy-oopz')
  assert.deepEqual(clientPlugin.inject, ['slots'])
  assert.equal(typeof clientPlugin.apply, 'function')
  delete global.window

  console.log('foxy-oopz tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
