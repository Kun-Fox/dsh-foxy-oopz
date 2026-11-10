# dsh-foxy-oopz

Foxy 的 OOPZ 适配器框架，运行于 DeepSeek Harness。

目标是把 OOPZ 语音频道接入 Foxy：

- 语音频道 → 按用户转写 → Foxy → TTS 播放；
- 一次语音通话产生一份临时上下文，结束后整合成长期记忆；
- 记忆写入 `foxyMemory`，平台标记为 `oopz`。

> 当前版本是语音框架/早期实现。文字消息默认关闭，只保留语音；语音链路依赖 OOPZ 网页语音侧车和 DSH Speech。没有真实 OOPZ 账号时只能做模块级测试。

## 依赖

- `dsh-foxy`：Foxy persona。
- `dsh-foxy-memory`：可选，写入/读取 Foxy 记忆。
- `@lamplitisles/dsh-speech`：可选，DSH 官方生态的语音插件，提供 `ctx.get('dshSpeech')` 的 TTS/ASR 服务。
- `oopz-sdk`：OOPZ 的 Node SDK，负责文字连接和事件。
- 语音播放/收音：`sidecarUrl` 指向的 OOPZ 语音侧车；Node SDK 自带的 `voice` 目前只是占位实现。

## 安装

```powershell
dsh plugin --profile desktop add file:D:\Documents\deepseek-harness\default-workspace\dsh-foxy-oopz
```

也可以发布后安装：

```powershell
dsh plugin --profile desktop add dsh-foxy-oopz
```

安装后完整重启 DSH。左侧栏会出现 **Foxy OOPZ**，设置页也有同名入口。

## OOPZ 凭据

在 [web.oopz.cn](https://web.oopz.cn) 登录机器人账号，从浏览器获取：

- `deviceId`
- `personUid`
- `jwtToken`
- `privateKey`（PKCS8 PEM）

私钥和 JWT 只保存在本机 `~/.dsh/foxy-oopz/settings.json`，设置页不会回传。凭据格式参考 [Oopzbot-SDK](https://github.com/tangqingfeng7/Oopzbot-SDK)。

## 配置

设置页分四块：

1. **OOPZ 连接**：凭据、网页登录、连接/断开；文字消息已关闭。
2. **语音与适配器**：语音 Area/Channel、监听模式、允许/拒绝/静音用户、STT/TTS、GPT-SoVITS、语音侧车、自动进房。
3. **模型与记忆**：OpenAI 兼容 Base URL、模型、API Key、Foxy Memory preset、附加系统提示词。
4. **运行状态**：连接状态、最近消息、通话记录。

监听模式：`all` 所有人；`allow` 仅允许名单；`deny` 名单外；`muteUserIds` 优先级最高。

## 语音链路

### TTS

三种适配器：

- `dsh-speech`：调用 `ctx.get('dshSpeech').synthesize()`，需要安装 `@lamplitisles/dsh-speech` 并配置 DashScope key。
- `edge-tts`：调用本机 `edge-tts` 命令，输出 MP3。
- `gpt-sovits`：POST `${gptSovitsUrl}/tts`，请求 `{ text, text_lang: 'zh', model }`，返回音频二进制。

### STT

- `dsh-speech`：调用 `dshSpeech.transcribe()`，使用 Qwen ASR。
- `none`：关闭。

### OOPZ 语音侧车

由于 OOPZ Node SDK 的 `voice` 只提供占位播放接口，真实语音需要侧车：

```text
POST {sidecarUrl}/voice/join   { area, channel }
POST {sidecarUrl}/voice/leave
POST {sidecarUrl}/voice/play   { file }
```

建议侧车用 Playwright 打开 `web.oopz.cn`，登录机器人账号，进入语音频道，并负责：

- 把远端音频按 VAD 切片，调用本插件 `/api/dsh-foxy-oopz/call/stt` 或本地 ASR；
- 把转写结果通过 `/api/dsh-foxy-oopz/call/turn` 追加到通话上下文；
- 接收 `/voice/play` 播放 TTS 文件。

侧车不包含在本仓库中；这是语音收发的边界。

## 通话上下文

每次通话创建：

```text
~/.dsh/foxy-oopz/calls/<call-id>.jsonl
```

每轮追加 `speaker / speakerUid / text / at`；通话结束时：

1. 读取完整 JSONL；
2. 用 Foxy persona + 模型生成一段长期记忆摘要；
3. 写 `eventType: 'oopz_call'` 的长期记忆；
4. 在 `calls/index.json` 记录通话摘要。

这样通话中的逐轮细节不直接写长期记忆，只保留整合后的摘要。

## HTTP API

- `GET /api/dsh-foxy-oopz/status`
- `GET|POST /api/dsh-foxy-oopz/settings`
- `POST /api/dsh-foxy-oopz/start|stop`
- `POST /api/dsh-foxy-oopz/tts/test` `{ text }`
- `POST /api/dsh-foxy-oopz/call/start` `{ area?, channel? }`
- `POST /api/dsh-foxy-oopz/call/end`
- `POST /api/dsh-foxy-oopz/call/turn` `{ speaker, speakerUid, text }`
- `POST /api/dsh-foxy-oopz/call/stt` `{ data(base64), mediaType, speaker? }`

## 限制

- OOPZ 是第三方平台，接口可能变动；本插件不保证账号安全或长期可用。
- 语音收发需要侧车，且需要真实登录与频道权限。
- 模型需要支持 OpenAI 兼容 `/chat/completions`。
- 默认关闭自动回复；测试时先用自己的小号频道。
