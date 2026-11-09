function endpoint(baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '')
  if (!base) throw new Error('LLM Base URL is empty')
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
}

export async function chat(settings, messages, { temperature = 0.7, maxTokens = 900 } = {}) {
  if (!settings.llmApiKey) throw new Error('Foxy OOPZ 还没有填写 LLM API Key')
  const response = await fetch(endpoint(settings.llmBaseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.llmApiKey}`,
    },
    body: JSON.stringify({
      model: settings.llmModel || 'deepseek-chat',
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`LLM HTTP ${response.status}: ${text.slice(0, 300)}`)
  const json = text ? JSON.parse(text) : {}
  const content = json?.choices?.[0]?.message?.content
  if (!content) throw new Error('LLM returned empty content')
  return String(content).trim()
}

export async function summarizeCall(settings, call, persona = '') {
  const turns = (call.turns || []).map((turn) => `${turn.speaker || '未知'}: ${turn.text}`).join('\n')
  const system = [
    persona,
    '你正在整理一段 OOPZ 语音通话的上下文。请用第一人称写一段简洁的长期记忆，保留参与者、主要话题、结论和待办；不要逐句复述，不要编造。',
  ].filter(Boolean).join('\n\n')
  return await chat(settings, [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `时间段：${call.header?.startedAt || ''} 至 ${new Date().toISOString()}\n参与者：${(call.header?.participants || []).join('、') || '未知'}\n\n对话：\n${turns.slice(0, 24000)}`,
    },
  ], { temperature: 0.4, maxTokens: 700 })
}
