# PR Review Comment (copilot/build-interview-helper-app -> main)

总体上这个 PR 的架构清晰，前后端边界明确，基础测试可通过；但我建议 **Request changes**，先修下面两个问题再合并。

## 1) SSE 解析在分片边界下不可靠（Blocker）
- 现状：前端直接 `chunk.split('\n')` 并逐行解析 `data:`。
- 风险：当网络分片把一行 `data: ...` 拆成两段时，会出现丢字/拼接错误；另外如果服务端返回多行 data 事件，也会解析不完整。
- 建议：为 SSE 维护一个 buffer，按 `\n\n` 事件边界切分，再对每个事件逐行拼接 `data:` 内容。

## 2) AI 流式错误透传内部信息（Major）
- 现状：后端在 SSE 错误分支将 `err.message` 直接写给客户端。
- 风险：可能泄露上游 SDK/配置细节，不利于生产环境安全与可观测性治理。
- 建议：客户端只接收通用错误码/文案；详细错误写服务端日志并带 trace id。

## 可选优化（Non-blocking）
- 会话上下文当前仅追加 `user` 消息，建议同时保存上一轮 assistant 输出，提升连续追问场景的答案一致性。
- Jest 目前依赖 `--forceExit`，后续可用 `--detectOpenHandles` 排查未释放句柄，减少“强制退出”测试味道。

## 结论
- 当前评审意见：**Request changes**（修复 1、2 后可再次 review 并倾向批准）。
