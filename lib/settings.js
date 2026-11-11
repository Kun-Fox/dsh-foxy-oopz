import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export function foxyHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function settingsPath() {
  return join(foxyHome(), 'foxy-oopz', 'settings.json')
}

export const DEFAULTS = {
  enabled: false,
  deviceId: '',
  personUid: '',
  jwtToken: '',
  privateKey: '',
  areaId: '',
  channelId: '',
  voiceAreaId: '',
  voiceChannelId: '',
  triggerWords: ['Foxy', 'foxy'],
  replyEnabled: true,
  voiceEnabled: false,
  voiceOnly: true,
  autoJoinVoice: false,
  listenMode: 'all',
  listenUserIds: [],
  muteUserIds: [],
  sttProvider: 'dsh-speech',
  sttFallback: true,
  sttPython: 'python',
  sttModelDir: '',
  ffmpegPath: '',
  replyMode: 'trigger',
  replyCooldownMs: 6000,
  vadSilenceMs: 900,
  vadMinSpeechMs: 300,
  vadMaxUtteranceMs: 15000,
  vadThreshold: 0.008,
  ttsProvider: 'dsh-speech',
  ttsVoice: 'Maia',
  gptSovitsUrl: 'http://127.0.0.1:9880',
  gptSovitsModel: 'default',
  edgeTtsCommand: 'edge-tts',
  sidecarUrl: 'http://127.0.0.1:7899',
  agoraAppId: '',
  autoStartSidecar: true,
  callContextDir: '',
  maxCallMinutes: 60,
  llmBaseUrl: 'https://api.deepseek.com',
  llmModel: 'deepseek-chat',
  llmApiKey: '',
  enableMemory: true,
  memoryPresetId: '',
  debug: false,
  systemPrompt: '',
}

const BOOLEAN_KEYS = new Set(['enabled', 'replyEnabled', 'voiceEnabled', 'voiceOnly', 'autoJoinVoice', 'autoStartSidecar', 'enableMemory', 'debug', 'sttFallback'])
const NUMBER_KEYS = new Set(['maxCallMinutes', 'vadSilenceMs', 'vadMinSpeechMs', 'vadMaxUtteranceMs', 'vadThreshold'])
const SECRET_KEYS = new Set(['jwtToken', 'privateKey', 'llmApiKey'])

export function normalizeSettings(input = {}) {
  const next = { ...DEFAULTS, ...(input || {}) }
  for (const key of BOOLEAN_KEYS) next[key] = next[key] === true
  next.maxCallMinutes = Math.max(1, Math.min(240, Number(next.maxCallMinutes) || 60))
  next.triggerWords = Array.isArray(next.triggerWords)
    ? next.triggerWords.map((v) => String(v).trim()).filter(Boolean).slice(0, 20)
    : String(next.triggerWords || '').split(',').map((v) => v.trim()).filter(Boolean).slice(0, 20)
  next.listenMode = ['all', 'allow', 'deny'].includes(next.listenMode) ? next.listenMode : 'all'
  for (const key of ['listenUserIds', 'muteUserIds']) {
    next[key] = Array.isArray(next[key])
      ? next[key].map((v) => String(v).trim()).filter(Boolean).slice(0, 100)
      : String(next[key] || '').split(/[,\\s]+/).map((v) => v.trim()).filter(Boolean).slice(0, 100)
  }
  next.sttProvider = ['dsh-speech', 'sensevoice', 'none'].includes(next.sttProvider) ? next.sttProvider : 'dsh-speech'
  next.replyMode = ['off', 'trigger', 'all'].includes(next.replyMode) ? next.replyMode : 'trigger'
  next.replyCooldownMs = Math.max(1000, Math.min(120000, Number(next.replyCooldownMs) || 6000))
  next.vadSilenceMs = Math.max(300, Math.min(5000, Number(next.vadSilenceMs) || 900))
  next.vadMinSpeechMs = Math.max(150, Math.min(3000, Number(next.vadMinSpeechMs) || 300))
  next.vadMaxUtteranceMs = Math.max(3000, Math.min(60000, Number(next.vadMaxUtteranceMs) || 15000))
  next.vadThreshold = Math.max(0.001, Math.min(0.1, Number(next.vadThreshold) || 0.008))
  next.ttsProvider = ['dsh-speech', 'windows-sapi', 'edge-tts', 'gpt-sovits', 'none'].includes(next.ttsProvider)
    ? next.ttsProvider
    : 'dsh-speech'
  next.llmBaseUrl = String(next.llmBaseUrl || DEFAULTS.llmBaseUrl).trim().replace(/\/+$/, '')
  next.llmModel = String(next.llmModel || DEFAULTS.llmModel).trim()
  next.sidecarUrl = String(next.sidecarUrl || DEFAULTS.sidecarUrl).trim().replace(/\/+$/, '')
  return next
}

export function loadSettings() {
  try {
    return normalizeSettings(JSON.parse(readFileSync(settingsPath(), 'utf8')))
  } catch {
    return normalizeSettings()
  }
}

export function saveSettings(patch = {}) {
  const current = loadSettings()
  const next = { ...current }
  for (const [key, value] of Object.entries(patch || {})) {
    if (!(key in DEFAULTS)) continue
    if (SECRET_KEYS.has(key) && !value) continue
    next[key] = value
  }
  if (patch?.clearSecrets === true) {
    next.jwtToken = ''
    next.privateKey = ''
    next.llmApiKey = ''
  }
  const normalized = normalizeSettings(next)
  mkdirSync(dirname(settingsPath()), { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(normalized, null, 2))
  return normalized
}

export function publicSettings(settings = loadSettings()) {
  const out = { ...settings }
  for (const key of SECRET_KEYS) out[key] = ''
  out.jwtTokenSet = !!settings.jwtToken
  out.privateKeySet = !!settings.privateKey
  out.llmApiKeySet = !!settings.llmApiKey
  return out
}
