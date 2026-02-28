# Interview AI Hamburger 端到端手工验收脚本

本文档用于按 `README.md` 的 Feature List 逐条验收，强调“可执行步骤 + 可观察结果”。

## 0. 验收范围（与 README 对齐）

- Live Transcript
- AI Answer Generation（Streaming）
- Standard Mode（Overlay + Screen Capture Protection）
- Undetectable Mode（桌面隐藏 + 手机实时接收）
- Configurable Settings（结构/风格/长度/敏感度）
- Cross-Platform（Windows / macOS）

## 1. 验收前准备

### 1.1 环境

- Node.js 18+
- OpenAI API Key（用于 AI 路由）
- 两台设备：
  - 桌面端（运行 Electron）
  - 手机端（Expo Go 或模拟器）

### 1.2 配置与启动

1. 启动 server
```bash
cd server
cp .env.example .env
# 填 OPENAI_API_KEY，建议也配 CORS_ORIGIN
npm install
npm run dev
```

2. 启动 desktop
```bash
cd desktop
cp .env.example .env.local
# REACT_APP_SERVER_URL 指向 server（如 http://localhost:4000）
npm install
npm start
```

3. 启动 mobile
```bash
cd mobile
cp .env.example .env
# EXPO_PUBLIC_SERVER_URL 指向 server（如 http://<局域网IP>:4000）
npm install
npm start
```

### 1.3 验收记录模板（每条都建议记录）

- 结果：`PASS / FAIL`
- 证据：截图/录屏/关键日志
- 备注：失败现象 + 复现步骤

---

## 2. Feature-by-Feature 手工验收

## 2.1 Live Transcript

### 用例 LT-01：标准模式实时转写

1. desktop 打开 `Session Settings`，保持 `Show Transcript = ON`。
2. 进入 `Start Interview (Standard)`。
3. 点击 `Start Listening`，连续说 2~3 句英文面试话术。

预期：
- Transcript 区域实时滚动更新，无明显卡死。
- 停止说话后文本不丢失。

---

### 用例 LT-02：关闭展示但保持自动识别

1. `Show Transcript = OFF`，`Auto Answer = ON`。
2. 进入 Standard Mode，点击 `Start Listening`。
3. 说一个典型问题：“Tell me about yourself.”

预期：
- 即使不显示 Transcript，仍可触发问题检测和后续 AI 回答。
- UI 不应因为隐藏 Transcript 而完全失去识别能力。

---

### 用例 LT-03：多语言轮询识别（中文 + 英文）

1. 在 Interview Setup 勾选 `Chinese (Mandarin)` 和 `English (US)`。
2. Standard Mode 点击 `Start Listening`。
3. 先说中文句子，再说英文句子。
4. 观察 transcript 区域右上角 `Listening: ... (auto-cycle)` 与分段条目。

预期：
- transcript 中可出现中英混合片段。
- 识别语言标记会在多语言间轮询切换（非固定单语言）。

---

### 用例 LT-04：Transcript 面板可拉伸 + 自动滚动到底部

1. 进入 Standard Mode，保证 `Show Transcript = ON`，开始监听。
2. 在 Transcript 面板右下角拖拽调整高度（上拉/下拉各一次）。
3. 连续说 5~8 句，让 transcript 条目超过可视区域。

预期：
- Transcript 面板高度可通过拖拽改变。
- 每次新语音片段进入时，滚动位置自动贴近最新一行（无需手动滚动）。

---

## 2.2 AI Answer Generation（Streaming）

### 用例 AI-01：自动检测问题并流式回答

1. Standard Mode 中开启 `Auto Answer`。
2. 口述问题：“What is your biggest strength?”
3. 观察答案区域输出。

预期：
- 先出现 `Detected Question`（或等价问题识别反馈）。
- 答案逐步增长（流式），非一次性整段返回。
- 结束后出现稳定完整答案，可点击 `Copy`。

---

### 用例 AI-02：手工输入问题

1. 确保 `Show Custom Input = ON`。
2. 在输入框输入问题并回车。

预期：
- 能正常触发生成，不依赖语音。
- 新问题会替换并生成新答案，不应与旧答案错位拼接。

---

### 用例 AI-02b：Answer Current Transcript 手动触发

1. 关闭 `Auto Answer`。
2. 说一段 transcript（可不带问号）。
3. 点击 `💡 Answer Current Transcript`。

预期：
- 可直接触发回答生成（不依赖 detect-question 返回 true）。

---

### 用例 AI-02c：Auto Answer 开启时仍可手动补答/重试

1. 开启 `Auto Answer`，开始监听并说一段可识别 transcript。
2. 在自动回答进行中或结束后，点击 `💡 Answer Current Transcript (Manual Retry)`。

预期：
- 按钮在 `Auto Answer = ON` 时依然可见。
- 点击后会基于当前 transcript 再发起一轮回答（用于漏检补救或重试）。

---

### 用例 AI-04：重复自动回答去重

1. 开启 `Auto Answer`，说一个问题（例如 "Tell me about your biggest strength?"）。
2. 在短时间内重复/停顿后再说同一问题，观察是否再次自动触发。

预期：
- 同一问题在短窗口内不会连续触发两次自动回答（避免重复生成）。
- 如需强制再生成，可使用 `Answer Current Transcript` 手动触发。

---

### 用例 AI-03：中断与清理

1. 生成过程中点击 `Stop Listening`。
2. 再次点击 `Start Listening`，输入/口述新问题。
3. 使用 `Clear` 按钮。

预期：
- 停止后不应继续生成旧回答。
- 新一轮回答不应混入上一轮残留内容。
- Clear 后 transcript/answer/问题提示清空。

---

## 2.3 Standard Mode（Overlay + Screen Capture Protection）

### 用例 SM-01：窗口浮层属性

1. 打开 desktop 应用并切换到任意模式。
2. 拖动窗口并打开其他应用窗口（浏览器/IDE）。

预期：
- Interview AI Hamburger 窗口保持前置（Always On Top 打开时）。

---

### 用例 SM-02：屏幕共享保护开关

1. 进入 `More Settings`：
   - `Hide from Screen Sharing = ON`
2. 使用系统截图或会议软件共享（Zoom/Teams/Meet）尝试捕获窗口。
3. 再切换 `Hide from Screen Sharing = OFF` 重试。

预期：
- ON 时：窗口尽量不可被捕获（依赖平台能力，Windows/macOS表现可不同）。
- OFF 时：窗口恢复可见/可捕获。

---

### 用例 SM-03：Conversation History 面板收缩/隐藏

1. 在 Standard Mode 连续触发 2~3 轮问答，确保出现 `Conversation History`。
2. 点击 `Collapse`，再点击 `Expand`。
3. 点击 `Hide`，随后点击 `Show` 恢复。
4. 隐藏状态下执行 `Export`。

预期：
- History 可在展开/收缩/隐藏之间切换，不影响主流程操作空间。
- 即使 History 被隐藏，导出内容仍包含完整 Q&A 记录。

---

## 2.4 Undetectable Mode（手机联动）

### 用例 UM-01：会话建立与手机接入

1. desktop 进入 `Undetectable Mode`，记录 session code（如 `IRON-1234`）。
2. mobile 打开 `Connect to Session`，输入 server URL + session code 连接。

预期：
- mobile 显示已连接状态（joined）。
- desktop 状态显示 `Phone Connected`。

---

### 用例 UM-02：转写与答案实时同步到手机

1. desktop 点击 `Start Listening`。
2. 说一个问题触发回答。
3. 观察 mobile 的 transcript 与 answer。

预期：
- transcript 能在手机侧更新。
- answer 按 chunk 实时追加，完成后停止闪烁/生成态。

---

### 用例 UM-03：新一轮回答替换旧回答

1. 在 UM 模式连续触发两轮不同问题。
2. 观察 mobile 答案面板。

预期：
- 第二轮开始时应以新回答为主，不应把上一轮整段继续拼接。

---

### 用例 UM-04：断连处理

1. desktop 退出 UM 页面或直接关闭 desktop。
2. 观察 mobile。

预期：
- mobile 出现 host disconnected/错误态提示。
- 不应崩溃，不应卡在假连接状态。

---

## 2.5 Configurable Settings

### 用例 CFG-01：行为结构/风格/长度

1. 进入 `More Settings`：
   - Behavioral Structure 切换 STAR/CAR/PAR/SOAR
   - Response Style 切换 conversational/structured/concise/detailed
   - Answer Length 切换 short/medium/long
2. 每次切换后，用同一问题触发一次回答。

预期：
- 回答形态随配置变化（简短/详细、结构化程度不同）。
- 设置刷新页面后仍保留（zustand persist）。

---

### 用例 CFG-02：检测敏感度

1. 敏感度设为 `Low`，说非问题陈述句。
2. 改为 `High`，说同样陈述句/隐式提问。

预期：
- Low 下不易触发，高敏感度下更容易触发。

---

### 用例 CFG-03：显示与高级设置

1. 调整 `Font Size`，观察答案区域字号变化。
2. 调整 `Window Opacity`，观察窗口透明度变化。
3. 切换 `Always On Top`，观察前置行为变化。
4. 切换 `Hide App Icon`，观察任务栏/Dock 表现。

预期：
- `Font Size` 可即时生效并持久化。
- 若运行在 Electron：其余开关/滑条应生效并持久化。
- 若运行在纯 web 预览（localhost）：Electron 专属项应显示为禁用，并有明确提示，不应出现“可点击但无效果”的假象。

---

### 用例 CFG-04：导出内容完整性（Transcript + Q/A）

1. 在 Standard Mode 进行至少 1 轮语音转写和 1 轮回答。
2. 点击 `Export`。
3. 打开导出的 `.txt` 文件。

预期：
- 包含 `=== Full Transcript ===` 段落（完整转写）。
- 包含 `=== Q&A ===` 段落（问答记录）。
- 若有分段 transcript，应含说话人和语言标记。

---

## 2.6 Cross-Platform（Windows / macOS）

### 用例 CP-01：基础流程一致性

分别在 Windows 和 macOS 跑一次最小闭环：

1. Setup -> Session Settings -> Standard Mode
2. 语音提问 -> 自动回答
3. 切 Undetectable -> mobile 接入 -> 手机收流

预期：
- 核心功能流程一致可用。
- 平台差异仅限系统级能力（如 content protection 细节）。

---

## 3. 回归通过标准（建议）

- 阻断级（P0）：
  - 无法生成答案
  - 手机无法接入会话
  - 断连后状态错误导致不可恢复
- 重要级（P1）：
  - 配置不生效/不持久化
  - 流式内容串流错位（新旧回答混合）
- 一般级（P2）：
  - 文案/样式轻微问题，不影响主链路

推荐验收门槛：
- P0 = 0
- P1 <= 1（且有明确 workaround）

---

## 4. 建议执行顺序（节省时间）

1. LT-01 -> AI-01 -> AI-03（先验证本地主链路）
2. UM-01 -> UM-02 -> UM-04（再验证双端联动）
3. CFG-01/02/03（最后做参数矩阵）
4. CP-01（跨平台抽检）
