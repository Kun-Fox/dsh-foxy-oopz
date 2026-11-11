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

## OOPZ 登录

设置页支持两种方式：

1. **手机号 + 密码登录**：调用 OOPZ 网页登录接口，成功后自动写入
   `deviceId / personUid / jwtToken / privateKey`。手机号和密码只用于本次请求，不保存。
2. **手动填写凭据**：在 [web.oopz.cn](https://web.oopz.cn) 登录机器人账号后获取。

扫码/短信验证码目前仍需要用户在 OOPZ 网页完成，插件不会绕过风控。

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

分段参数（0.1.16 起）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `vadSilenceMs` | `900` | 说完后静音多久算一整句，300–5000 |
| `vadMinSpeechMs` | `300` | 少于此语音时长视为噪声，150–3000 |
| `vadMaxUtteranceMs` | `15000` | 单句最长时长，超过强制切段，3000–60000 |
| `vadThreshold` | `0.008` | 能量阈值 RMS，0.001–0.1；环境吵可调高 |

每次切段后，转写会立即追加到运行状态里的「实时转写」；只有 `replyMode` 命中时才进入 LLM + TTS。`triggerWords` 留空时 `trigger` 等同于每条都回。

## 语音链路

### TTS

四种适配器：

- `windows-sapi`：Windows 本机 SAPI（PowerShell + `System.Speech`），无需额外依赖；默认优先使用，失败时自动回退到它。
- `dsh-speech`：调用 `ctx.get('dshSpeech').synthesize()`，需要安装 `@lamplitisles/dsh-speech` 并配置 DashScope key。
- `edge-tts`：调用本机 `edge-tts` 命令，输出 MP3。
- `gpt-sovits`：POST `${gptSovitsUrl}/tts`，请求 `{ text, text_lang: 'zh', model }`，返回音频二进制。

> 0.1.11 修复了所有 TTS 适配器共用的 `tempFile()` 路径错误：此前它误调用了语音加入函数 `join()`，拿到 Promise 而不是路径，导致 TTS 实际一直失败。

### 退出与登录

设置页顶栏提供：

- **断开 OOPZ**：停止 bot，但保留凭据。
- **退出登录**：停止 bot 并清除 Token、私钥、Area/Channel 等连接信息。
- **退出语音频道并整合记忆**：离开 Agora 频道，结束当前通话并写入 Foxy 记忆；没有通话时也会清理残留的侧车连接。
- **测试 TTS**：必须先开始语音通话；会确保侧车已加入当前频道后再播放。

### STT

- `dsh-speech`：调用 `dshSpeech.transcribe()`，使用 Qwen ASR；未安装或调用失败时默认回退本地 SenseVoice。
- `sensevoice`：直接使用本地 SenseVoice，不依赖 DashScope。
- `none`：关闭。

本地 SenseVoice 依赖 Python `sherpa-onnx`、`ffmpeg` 和模型文件；默认目录：

```text
~/.dsh/speech-to-text/sensevoice/models/sensevoice-onnx
```

可用 `sttModelDir`、`sttPython`、`ffmpegPath` 覆盖。首次使用前可自测：

```powershell
python stt/sensevoice.py --wav test.wav
```

### 语音回复闭环

通话开始后，插件每 1.5 秒从侧车拉取远端语音片段：

1. ffmpeg 转 16k 单声道 WAV；
2. DSH Speech 或本地 SenseVoice 转写；
3. 按 `replyMode` 判断是否回复：`off` 不回复、`trigger` 仅命中 `triggerWords`、`all` 每条都回；
4. 用 Foxy persona + `llmApiKey` 生成 1–3 句回复；
5. TTS 合成并通过侧车播放到 Agora 频道。

`replyCooldownMs` 默认 6000ms，防止连续语音触发刷屏或 TTS 自激。`llmApiKey` 为空时只记录转写，不会生成回复。

### OOPZ 语音侧车

0.1.9 起，未配置侧车时会调用 OOPZ 的 `/area/v2/channel/enter`，让机器人账号以“在线”状态进入频道；私人频道会返回“暂无访问该频道的权限”。这只能拿到 Agora 凭据，不能收发音轨。

0.1.15 起，读取分区/频道后如果还没选频道，界面会自动选第一个 VOICE 频道；后端在只给了 area、channel 为空时也会自动选第一个 VOICE 频道，避免“能读分区但开始通话按钮是灰的”。

0.1.10 起仓库自带一个 Playwright + Agora Web SDK 侧车 `sidecar/`，它会：
- 用 `supplierSign`、`roomId`、数字 `pid` 加入 Agora 频道；
- 向 Agora signaling 发送 `data_stream`，让 OOPZ 识别 `oopzUid ↔ agoraUid`；
- 把 TTS 音频作为 `BufferSourceAudioTrack` 发布，机器人能真正“说话”；
- 从 0.1.12 起用 `RemoteAudioTrack.setAudioFrameCallback()` 直接收远端 PCM；0.1.16 起改为按用户能量 VAD 切句：累计语音达到最短时长、说完静音达到 `vadSilenceMs` 才上传整句，超过 `vadMaxUtteranceMs` 强制切段。不再固定 6 秒切断一句话。

侧车启动（插件安装后，根依赖已包含 Playwright/Agora）：

```powershell
node node_modules/dsh-foxy-oopz/sidecar/server.mjs
```

源码仓库里也可以：

```powershell
cd sidecar
npm install
node server.mjs
```

默认监听 `http://127.0.0.1:7899`，与插件默认 `sidecarUrl` 一致。接口：

```text
POST {sidecarUrl}/voice/join     { area, channel, appId, token, roomId, uid, oopzUid }
POST {sidecarUrl}/voice/leave
POST {sidecarUrl}/voice/play     { file }
POST {sidecarUrl}/voice/capture  { uid, mime, data(base64), startedAt, endedAt }
GET  {sidecarUrl}/voice/captures?after=<id>
POST {sidecarUrl}/voice/captures/ack { ids }
GET  {sidecarUrl}/health
```

远端捕获按 Agora 用户分别切段；只有检测到人声、达到最短时长的整句才上传，最多保留 40 段、单段 8 MB。私人频道还需要给机器人账号频道权限。

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
