import { createHash, createPrivateKey, createPublicKey, publicEncrypt, randomUUID, sign } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { MODULUS_DATA, SIGNING_KEY_DATA, XOR_KEY } from './oopz-login-bundle.js'

const BASE_URL = 'https://gateway.oopz.cn'
const LOGIN_PATH = '/client/v1/login/v2/login'
const CLIENT_VERSION = '0.73.817'
const APP_VERSION_NUMBER = '73817'

function restore(parts) {
  const encoded = parts.join('').split('').reverse().join('')
  const encrypted = Buffer.from(encoded, 'base64url')
  const key = Buffer.from(XOR_KEY, 'utf8')
  const compressed = Buffer.alloc(encrypted.length)
  for (let i = 0; i < encrypted.length; i += 1) compressed[i] = encrypted[i] ^ key[i % key.length]
  return inflateSync(compressed).toString('utf8')
}

let cachedSigningKey = ''
let cachedModulus = ''

function signingKey() {
  if (!cachedSigningKey) cachedSigningKey = restore(SIGNING_KEY_DATA)
  return cachedSigningKey
}

function passwordModulus() {
  if (!cachedModulus) cachedModulus = restore(MODULUS_DATA)
  return cachedModulus
}

function encryptPassword(password) {
  const publicKey = createPublicKey({
    key: { kty: 'RSA', n: passwordModulus(), e: 'AQAB' },
    format: 'jwk',
  })
  return publicEncrypt(
    { key: publicKey, padding: 4, oaepHash: 'sha256' },
    Buffer.from(String(password), 'utf8'),
  ).toString('base64')
}

function signRequest(body, oopzTime) {
  const digest = createHash('md5').update(LOGIN_PATH + body, 'utf8').digest('hex')
  const signature = sign('RSA-SHA256', Buffer.from(digest + oopzTime, 'utf8'), createPrivateKey(signingKey()))
  return signature.toString('base64')
}

export async function loginWithPassword(phone, password, options = {}) {
  const phoneText = String(phone || '').trim()
  const passwordText = String(password || '')
  if (!phoneText || !passwordText) throw new Error('请填写 OOPZ 手机号和密码')
  const deviceId = String(options.deviceId || randomUUID())
  const oopzTime = String(Date.now())
  const payload = {
    auto: true,
    code: encryptPassword(passwordText),
    loginType: 'PASSWORD',
    phone: phoneText,
    autoRegister: true,
    deviceId,
    deviceRam: 'TBD',
    deviceProcessor: '0',
    loggedIn: deviceId,
    osEdition: 'web',
    osVersion: 'web/BrowserName.chrome',
    resolution: 'TBD',
    graphics: 'TBD',
    clientVersion: CLIENT_VERSION,
  }
  const body = JSON.stringify(payload)
  const headers = {
    accept: '*/*',
    'content-type': 'application/json;charset=utf-8',
    'oopz-app-version-number': APP_VERSION_NUMBER,
    'oopz-channel': 'Web',
    'oopz-device-id': deviceId,
    'oopz-platform': 'windows',
    'oopz-request-id': randomUUID(),
    'oopz-time': oopzTime,
    'oopz-web': 'true',
    'oopz-sign': signRequest(body, oopzTime),
    origin: 'https://web.oopz.cn',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  }
  let response
  try {
    response = await fetch(BASE_URL + LOGIN_PATH, { method: 'POST', headers, body })
  } catch (error) {
    throw new Error(`OOPZ 登录请求失败：${error?.message || error}`)
  }
  let data
  try { data = await response.json() } catch { throw new Error(`OOPZ 登录返回非 JSON（HTTP ${response.status}）`) }
  if (!response.ok || !data?.status) {
    const message = data?.data?.message || data?.message || data?.msg || `HTTP ${response.status}`
    throw new Error(`OOPZ 登录失败：${message}`)
  }
  const result = data.data || {}
  if (!result.uid || !result.signature) throw new Error('OOPZ 登录成功但未返回 uid/signature')
  return {
    deviceId,
    personUid: String(result.uid),
    jwtToken: String(result.signature),
    privateKey: signingKey(),
    expiresAt: result.signatureNearExpired || '',
  }
}
