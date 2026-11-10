# dsh-foxy-oopz sidecar

把 Agora Web SDK 放进 Playwright/Edge，让 OOPZ 机器人真正加入语音频道并播放 TTS。

## 启动

```powershell
cd sidecar
npm install
$env:EDGE_PATH="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"  # 可选
node server.mjs
```

默认 `http://127.0.0.1:7899`。环境变量：

- `PORT`：监听端口，默认 `7899`
- `EDGE_PATH`：Edge/Chromium 可执行文件，默认系统 Edge
- `AGORA_APP_ID`：OOPZ 默认 App ID，默认 `358eebceadb94c2a9fd91ecd7b341602`

## 工作方式

1. 插件先调 OOPZ `/area/v2/channel/enter`，拿 `supplierSign`、`roomId` 和数字 `pid`；
2. 侧车用 `agoraJoin(appId, supplierSign, roomId, pid)` 加入 Agora；
3. 侧车向 Agora signaling 发 `data_stream`：`{uid: OOPZ uid, cid: Agora uid, m, hm}`；
4. `/voice/play` 收到本地音频文件，解码后作为 `BufferSourceAudioTrack` 发布；
5. `RemoteAudioTrack.setAudioFrameCallback()` 按远端用户收 PCM，6 秒一段，只有检测到人声才上传到 `/voice/capture`。

## 限制

- 远端捕获按 Agora uid 分用户切段，不做说话人分离/降噪；音乐、噪声可能被 VAD 当成语音。
- 只在通话期间捕获，最多保留 40 段、单段 8 MB；插件消费后会 ack 删除。
- 私人频道需要机器人账号有权限；否则 `enter_channel` 返回 `ERR.003.00001`。
- `supplierSign` 有时效，插件进频道后应尽快播放，不要缓存太久。
