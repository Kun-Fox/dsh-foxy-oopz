window.__ModuleLoader__.load({
  id: 'dsh-foxy-oopz',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/api/dsh-foxy-oopz'
    const PANEL_ID = 'dsh-foxy-oopz'

    async function request(path, options = {}) {
      const response = await fetch(API + path, {
        headers: { 'content-type': 'application/json', ...(options.headers || {}) },
        ...options,
      })
      let body = {}
      try { body = await response.json() } catch {}
      if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`)
      return body
    }

    const css = `
      .fo-page { padding: 28px 32px 44px; max-width: 900px; color: var(--dsw-alias-label-primary, #1f2328); height: 100%; overflow: auto; box-sizing: border-box; overflow-anchor: none; }
      .fo-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
      .fo-eyebrow { margin: 0 0 6px; color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; }
      .fo-head h1 { margin: 0; font-size: 22px; line-height: 1.25; }
      .fo-head p { margin: 6px 0 0; color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 12px; }
      .fo-badge { flex: none; border: 1px solid var(--dsw-alias-bg-layer-3, #e5e7eb); border-radius: 999px; padding: 4px 10px; color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 11px; }
      .fo-card { margin-bottom: 14px; padding: 18px 20px; border: 1px solid var(--dsw-alias-bg-layer-3, #e5e7eb); border-radius: 12px; background: var(--dsw-alias-bg-layer-1, #fff); }
      .fo-card h2 { margin: 0; font-size: 15px; }
      .fo-card > p { margin: 5px 0 14px; color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 12px; line-height: 1.6; }
      .fo-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 18px; }
      .fo-field { min-width: 0; }
      .fo-field label { display: block; color: var(--dsw-alias-label-secondary, #4b5563); font-size: 12px; font-weight: 600; }
      .fo-field small { display: block; margin-top: 3px; color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 11px; line-height: 1.45; }
      .fo-field input, .fo-field select { width: 100%; box-sizing: border-box; margin-top: 5px; padding: 7px 9px; border: 1px solid var(--dsw-alias-bg-layer-3, #e5e7eb); border-radius: 7px; background: var(--dsw-alias-bg-layer-2, #f7f7f8); color: inherit; font: inherit; font-size: 12px; }
      .fo-field textarea { width: 100%; box-sizing: border-box; margin-top: 5px; padding: 8px 9px; min-height: 100px; resize: vertical; border: 1px solid var(--dsw-alias-bg-layer-3, #e5e7eb); border-radius: 7px; background: var(--dsw-alias-bg-layer-2, #f7f7f8); color: inherit; font: inherit; font-size: 12px; }
      .fo-toggle { display: flex; position: relative; align-items: flex-start; gap: 10px; margin-top: 10px; cursor: pointer; }
      .fo-toggle button { position: relative; flex: none; width: 32px; height: 18px; margin-top: 1px; border: 0; border-radius: 999px; background: var(--dsw-alias-bg-layer-3, #d1d5db); padding: 0; cursor: pointer; }
      .fo-toggle button::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform .15s ease; }
      .fo-toggle[data-on="true"] button { background: #2f7d4a; }
      .fo-toggle[data-on="true"] button::after { transform: translateX(14px); }
      .fo-toggle strong { display: block; font-size: 12px; }
      .fo-toggle small { display: block; margin-top: 2px; color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 11px; }
      .fo-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
      .fo-btn { border: 1px solid var(--dsw-alias-bg-layer-3, #e5e7eb); border-radius: 7px; padding: 7px 12px; background: transparent; color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
      .fo-btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
      .fo-btn.danger { color: #a33; border-color: rgba(180,40,40,.35); }
      .fo-btn:disabled { opacity: .55; cursor: default; }
      .fo-alert { margin: 10px 0 0; padding: 8px 10px; border-radius: 7px; font-size: 12px; }
      .fo-error { color: #a33; background: rgba(180,40,40,.08); }
      .fo-ok { color: #2f7d4a; background: rgba(40,130,70,.08); }
      .fo-muted { margin: 8px 0; color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 12px; }
      .fo-log { margin-top: 10px; border-top: 1px solid var(--dsw-alias-bg-layer-3, #e5e7eb); }
      .fo-row { padding: 9px 0; border-bottom: 1px solid var(--dsw-alias-bg-layer-3, #e5e7eb); font-size: 12px; }
      .fo-row small { color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 11px; }
      @media (max-width: 720px) { .fo-page { padding: 20px 16px 32px; } .fo-grid { grid-template-columns: 1fr; } }
    `

    function Icon({ size = 18 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M4 6h16v10H9l-5 4V6Z' }),
        h('path', { d: 'M8 10h8M8 13h5' }),
        h('circle', { cx: 18, cy: 5, r: 2 }),
      )
    }

    function Toggle({ checked, onChange, label, hint, disabled }) {
      return h('div', { className: 'fo-toggle', 'data-on': checked ? 'true' : 'false', onClick: () => !disabled && onChange(!checked) },
        h('button', { type: 'button', role: 'switch', 'aria-checked': checked, disabled }),
        h('span', null, h('strong', null, label), hint ? h('small', null, hint) : null),
      )
    }

    function Field({ label, hint, children }) {
      return h('div', { className: 'fo-field' }, h('label', null, label), hint ? h('small', null, hint) : null, children)
    }

    function Section({ title, description, children }) {
      return h('section', { className: 'fo-card' }, h('h2', null, title), description ? h('p', null, description) : null, children)
    }

    function Panel() {
      const [settings, setSettings] = React.useState(null)
      const [status, setStatus] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')

      const refresh = React.useCallback(async () => {
        try {
          const data = await request('/status')
          setSettings(data.settings)
          setStatus(data.status)
          setError('')
        } catch (err) { setError(err.message) }
      }, [])

      React.useEffect(() => {
        const style = document.createElement('style')
        style.dataset.foxyOopz = 'true'
        style.textContent = css
        document.head.appendChild(style)
        refresh()
        const timer = setInterval(refresh, 4000)
        return () => { clearInterval(timer); style.remove() }
      }, [refresh])

      const setField = (key, value) => setSettings((prev) => ({ ...prev, [key]: value }))
      async function save() {
        setBusy('save'); setError(''); setNotice('')
        try {
          const data = await request('/settings', { method: 'POST', body: JSON.stringify(settings) })
          setSettings(data.settings); setStatus(data.status); setNotice('设置已保存')
        } catch (err) { setError(err.message) } finally { setBusy('') }
      }
      async function action(name, path, body) {
        setBusy(name); setError(''); setNotice('')
        try {
          const data = await request(path, { method: 'POST', body: JSON.stringify(body || {}) })
          setStatus(data.status || status)
          setNotice(name === 'start' ? '已连接 OOPZ' : name === 'stop' ? '已断开 OOPZ' : name === 'tts' ? 'TTS 已播放' : '操作完成')
        } catch (err) { setError(err.message) } finally { setBusy('') }
      }

      if (!settings) return h('div', { className: 'fo-page' }, error ? h('p', { className: 'fo-alert fo-error' }, error) : '加载中…')

      return h('div', { className: 'fo-page' },
        h('header', { className: 'fo-head' },
          h('div', null,
            h('p', { className: 'fo-eyebrow' }, 'FOXY EXTENSION'),
            h('h1', null, 'OOPZ 语音'),
            h('p', null, 'Foxy 接入 OOPZ 语音频道，使用 DSH Speech / Edge TTS / GPT-SoVITS，并把通话上下文整合进记忆。'),
          ),
          h('span', { className: 'fo-badge' }, status?.running ? '已连接' : '未连接'),
        ),
        error ? h('p', { className: 'fo-alert fo-error' }, error) : null,
        notice ? h('p', { className: 'fo-alert fo-ok' }, notice) : null,

        h(Section, { title: 'OOPZ 连接', description: '凭据从 OOPZ 网页端获取；私钥只保存在本机，不回传前端。' },
          h('div', { className: 'fo-grid' },
            h(Field, { label: 'Device ID', hint: 'OOPZ_DEVICE_ID' }, h('input', { value: settings.deviceId || '', onChange: (e) => setField('deviceId', e.target.value) })),
            h(Field, { label: 'Person UID', hint: '机器人账号 UID' }, h('input', { value: settings.personUid || '', onChange: (e) => setField('personUid', e.target.value) })),
            h(Field, { label: 'JWT Token', hint: settings.jwtTokenSet ? '已保存；留空表示不修改' : 'OOPZ_JWT_TOKEN' }, h('input', { type: 'password', value: settings.jwtToken || '', placeholder: settings.jwtTokenSet ? '已保存，留空不修改' : '', onChange: (e) => setField('jwtToken', e.target.value) })),
            h(Field, { label: 'Private Key', hint: settings.privateKeySet ? '已保存；留空表示不修改' : 'PKCS8 PEM，换行可用 \\n' }, h('textarea', { rows: 4, value: settings.privateKey || '', placeholder: settings.privateKeySet ? '已保存，留空不修改' : '-----BEGIN PRIVATE KEY-----\\n...', onChange: (e) => setField('privateKey', e.target.value) })),
            h(Field, { label: '文字消息', hint: '当前版本只保留语音，文字消息不回复' }, h('p', { className: 'fo-muted' }, '已关闭')),
          ),
          h(Toggle, { checked: settings.enabled, onChange: (v) => setField('enabled', v), label: '启用 OOPZ 适配器', hint: '保存后自动连接；关闭不会删除凭据。' }),
          h('div', { className: 'fo-actions' },
            h('button', { className: 'fo-btn primary', disabled: !!busy, onClick: save }, busy === 'save' ? '保存中…' : '保存设置'),
            h('button', { className: 'fo-btn', disabled: !!busy, onClick: () => window.open('https://web.oopz.cn/#/login', '_blank') }, '网页登录'),
            h('button', { className: 'fo-btn', disabled: !!busy, onClick: () => action('start', '/start') }, '连接'),
            h('button', { className: 'fo-btn danger', disabled: !!busy, onClick: () => action('stop', '/stop') }, '断开'),
          ),
        ),

        h(Section, { title: '语音与适配器', description: '语音通话建议使用 OOPZ 侧车；文字消息不需要语音。' },
          h('div', { className: 'fo-grid' },
            h(Field, { label: '语音 Area ID' }, h('input', { value: settings.voiceAreaId || '', onChange: (e) => setField('voiceAreaId', e.target.value) })),
            h(Field, { label: '语音 Channel ID' }, h('input', { value: settings.voiceChannelId || '', onChange: (e) => setField('voiceChannelId', e.target.value) })),
            h(Field, { label: '监听模式' },
              h('select', { value: settings.listenMode || 'all', onChange: (e) => setField('listenMode', e.target.value) },
                h('option', { value: 'all' }, '所有人'),
                h('option', { value: 'allow' }, '仅名单内'),
                h('option', { value: 'deny' }, '名单外'),
              )),
            h(Field, { label: '允许/拒绝用户 ID', hint: '逗号或空格分隔；按 OOPZ personUid' }, h('input', { value: (settings.listenUserIds || []).join(', '), onChange: (e) => setField('listenUserIds', e.target.value.split(/[,\s]+/).filter(Boolean)) })),
            h(Field, { label: '静音用户 ID', hint: '优先级最高' }, h('input', { value: (settings.muteUserIds || []).join(', '), onChange: (e) => setField('muteUserIds', e.target.value.split(/[,\s]+/).filter(Boolean)) })),
            h(Field, { label: 'STT 适配器' },
              h('select', { value: settings.sttProvider || 'dsh-speech', onChange: (e) => setField('sttProvider', e.target.value) },
                h('option', { value: 'dsh-speech' }, 'DSH Speech（Qwen ASR）'),
                h('option', { value: 'none' }, '关闭'),
              )),
            h(Field, { label: 'TTS 适配器' },
              h('select', { value: settings.ttsProvider || 'dsh-speech', onChange: (e) => setField('ttsProvider', e.target.value) },
                h('option', { value: 'dsh-speech' }, 'DSH Speech'),
                h('option', { value: 'edge-tts' }, 'Edge TTS'),
                h('option', { value: 'gpt-sovits' }, 'GPT-SoVITS'),
                h('option', { value: 'none' }, '关闭'),
              )),
            h(Field, { label: 'TTS Voice ID', hint: 'DSH Speech 的 Voice ID' }, h('input', { value: settings.ttsVoice || '', onChange: (e) => setField('ttsVoice', e.target.value) })),
            h(Field, { label: 'GPT-SoVITS URL' }, h('input', { value: settings.gptSovitsUrl || '', onChange: (e) => setField('gptSovitsUrl', e.target.value) })),
            h(Field, { label: 'OOPZ 语音侧车 URL', hint: 'Playwright/语音后端；留空则用 SDK voice' }, h('input', { value: settings.sidecarUrl || '', onChange: (e) => setField('sidecarUrl', e.target.value) })),
          ),
          h(Toggle, { checked: settings.voiceEnabled, onChange: (v) => setField('voiceEnabled', v), label: '启用语音回复', hint: '语音回复走 TTS + 侧车播放；文字消息已停用。' }),
          h(Toggle, { checked: settings.autoJoinVoice, onChange: (v) => setField('autoJoinVoice', v), label: '连接后自动进入语音频道', hint: '使用上方语音 Area/Channel。' }),
          h('div', { className: 'fo-actions' },
            h('button', { className: 'fo-btn', disabled: !!busy, onClick: () => action('tts', '/tts/test', { text: '你好，我是 Foxy。' }) }, '测试 TTS'),
            h('button', { className: 'fo-btn', disabled: !!busy, onClick: () => action('call', '/call/start') }, '开始语音通话'),
            h('button', { className: 'fo-btn danger', disabled: !!busy, onClick: () => action('end', '/call/end') }, '结束并整合记忆'),
          ),
          status?.call ? h('p', { className: 'fo-muted' }, `通话中：${status.call.id}（${status.call.startedAt}）`) : h('p', { className: 'fo-muted' }, '当前没有进行中的通话。'),
        ),

        h(Section, { title: '模型与记忆', description: 'Foxy 使用 OpenAI 兼容模型；OOPZ 记忆写入 foxyMemory，平台标记为 oopz。' },
          h('div', { className: 'fo-grid' },
            h(Field, { label: 'Base URL' }, h('input', { value: settings.llmBaseUrl || '', onChange: (e) => setField('llmBaseUrl', e.target.value) })),
            h(Field, { label: '模型名' }, h('input', { value: settings.llmModel || '', onChange: (e) => setField('llmModel', e.target.value) })),
            h(Field, { label: 'API Key', hint: settings.llmApiKeySet ? '已保存；留空表示不修改' : '只保存在本机' }, h('input', { type: 'password', value: settings.llmApiKey || '', placeholder: settings.llmApiKeySet ? '已保存，留空不修改' : 'sk-...', onChange: (e) => setField('llmApiKey', e.target.value) })),
            h(Field, { label: '记忆 Preset ID' }, h('input', { value: settings.memoryPresetId || '', placeholder: 'preset（Character）', onChange: (e) => setField('memoryPresetId', e.target.value) })),
          ),
          h(Field, { label: '系统提示词（附加）', hint: '追加在 persona 后；不会替代 Foxy 预设。' },
            h('textarea', { rows: 5, value: settings.systemPrompt || '', onChange: (e) => setField('systemPrompt', e.target.value) })),
          h(Toggle, { checked: settings.enableMemory, onChange: (v) => setField('enableMemory', v), label: '写入 Foxy 记忆', hint: '文字回复与通话摘要写入记忆；关闭只影响新写入。' }),
        ),

        h(Section, { title: '运行状态', description: 'OOPZ 连接、最近消息与通话记录。' },
          h('div', { className: 'fo-grid' },
            h(Field, { label: '连接' }, h('p', { className: 'fo-muted' }, status?.running ? '已连接' : '未连接')),
            h(Field, { label: '最近错误' }, h('p', { className: 'fo-muted' }, status?.lastError || '无')),
          ),
          h('div', { className: 'fo-log' },
            (status?.history || []).length
              ? status.history.map((row, index) => h('div', { className: 'fo-row', key: index }, h('small', null, new Date(row.at).toLocaleString()), h('div', null, row.text)))
              : h('p', { className: 'fo-muted' }, '暂无消息记录。'),
          ),
          (status?.calls || []).length
            ? h('div', { className: 'fo-log' }, status.calls.map((row) => h('div', { className: 'fo-row', key: row.callId },
                h('small', null, `${row.startedAt} · ${row.turns} 轮`),
                h('div', null, row.summary || '未生成摘要'),
              )))
            : null,
        ),
      )
    }

    return {
      name: 'dsh-foxy-oopz',
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register(
          { name: 'settings.section', id: PANEL_ID, order: 33, label: 'Foxy OOPZ' },
          () => h(Panel),
        ))
        ctx.slots.inject('main', () => ctx.slots.register(
          { name: 'main', key: PANEL_ID, inject: () => ({ workbench: true }) },
          () => h(Panel),
        ))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL_ID, order: 15, label: () => 'Foxy OOPZ' },
          Icon,
        ))
      },
    }
  },
})
