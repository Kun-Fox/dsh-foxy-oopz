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
