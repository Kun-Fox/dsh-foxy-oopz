let sdkPromise = null

async function sdk() {
  if (!sdkPromise) sdkPromise = import('oopz-sdk')
  return await sdkPromise
}

export function credentials(settings) {
  const privateKey = String(settings.privateKey || '').replace(/\\n/g, '\n').trim()
  if (!settings.deviceId || !settings.personUid || !settings.jwtToken || !privateKey) {
    throw new Error('OOPZ 凭据不完整：需要 deviceId、personUid、jwtToken、privateKey')
  }
  return {
    deviceId: settings.deviceId,
    personUid: settings.personUid,
    jwtToken: settings.jwtToken,
    privateKey,
  }
}

export async function startBot(settings, handlers = {}) {
  const { OopzBot, OopzConfig } = await sdk()
  const config = new OopzConfig(credentials(settings))
  if (config.autoSubscribeJoinedAreas !== undefined) config.autoSubscribeJoinedAreas = true
  const bot = new OopzBot(config)
  const selfUid = String(settings.personUid || '')

  bot.on('message', async (event) => {
    const message = event?.message
    if (!message) return
    const senderUid = String(message.senderUid || message.senderId || '')
    if (senderUid && senderUid === selfUid) return
    const area = String(message.areaId || event.areaId || settings.areaId || '')
    const channel = String(message.channelId || event.channelId || settings.channelId || '')
    if (settings.areaId && area && area !== settings.areaId) return
    if (settings.channelId && channel && channel !== settings.channelId) return
    const content = String(message.content || '').trim()
    if (!content) return
    const mentioned = (settings.triggerWords || []).some((word) => content.includes(word))
    if (!mentioned && !content.startsWith('/')) return
    try {
      await handlers.onMessage?.({
        content,
        area,
        channel,
        messageId: String(message.messageId || ''),
        senderUid,
        senderName: String(message.senderNickname || message.senderName || ''),
      })
    } catch (error) {
      handlers.onError?.(error)
    }
  })

  await bot.start()
  return bot
}

export async function stopBot(bot) {
  if (bot?.close) await bot.close()
}
