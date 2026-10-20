# Roam MCP 与命令行

标准 **MCP Streamable HTTP** 接口：

```
https://nokkeydhtxewgtkxxnsh.supabase.co/functions/v1/roam-mcp
```

网站右上角 **◇ Agent** 管理当前账号的连接。创建时选择只读或读写，以及 1–90 天有效期。令牌只显示一次，可复制令牌或完整远程 MCP 配置；丢失后撤销并重新创建。最多同时保留 8 个有效连接。

## 接入 Agent

支持远程 MCP 和自定义 Authorization 请求头的客户端，可使用：

```json
{
  "mcpServers": {
    "roam": {
      "url": "https://nokkeydhtxewgtkxxnsh.supabase.co/functions/v1/roam-mcp",
      "headers": { "Authorization": "Bearer <网站生成的令牌>" }
    }
  }
}
```

不同客户端的配置位置和环境变量替换规则可能不同；以客户端设置为准。当前使用个人访问令牌，未实现 OAuth 自动发现/登录，仅支持 OAuth 的客户端无法直接连接。

也可使用 stdio 桥接（Node.js 22+，已执行 `npm ci`）：

```json
{
  "mcpServers": {
    "roam": {
      "command": "node",
      "args": ["<仓库绝对路径>/mcp/stdio.mjs"],
      "env": { "ROAM_MCP_TOKEN": "<网站生成的令牌>" }
    }
  }
}
```

stdio 请直接执行 `node mcp/stdio.mjs`，不要通过 npm 的启动日志污染 JSON-RPC 标准输出。凭据存放在自己的客户端设置/环境变量中，不要提交到 Git，也无需发到聊天里。

## Codex 接入

网站创建令牌后，可点「复制 Codex 配置」，将生成的 `[mcp_servers.roam]` 段加入个人的 `~/.codex/config.toml`。其中包含令牌，保持该文件私有，不要提交到项目。支持环境变量的运行方式也可用以下无凭据模板：

```toml
[mcp_servers.roam]
url = "https://nokkeydhtxewgtkxxnsh.supabase.co/functions/v1/roam-mcp"
bearer_token_env_var = "ROAM_MCP_TOKEN"
startup_timeout_sec = 30
tool_timeout_sec = 60
```

变量必须由启动 Codex 的进程继承，仅在另一个终端 export 不会改变已运行桌面应用的环境。客户端重新加载连接后再使用，当前聊天不会因网站上线自动获得权限。`url`、`bearer_token_env_var` 与 `http_headers` 配置方式见 [OpenAI 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。

## 终端使用

先将令牌放进 `ROAM_MCP_TOKEN` 环境变量。在交互式 bash/zsh 中可隐藏输入：

```sh
read -s ROAM_MCP_TOKEN
export ROAM_MCP_TOKEN
node mcp/cli.mjs trips
node mcp/cli.mjs trip TRIP_ID
node mcp/cli.mjs day TRIP_ID DAY_ID
node mcp/cli.mjs tools
node mcp/cli.mjs history
```

读写修改有两个步骤。先创建 `change.json`（以下 ID 和版本号应替换为读取到的真实值）：

```json
{
  "expected_revision": 12,
  "summary": "将会场返程调整为 M2 加步行",
  "operations": [{
    "type": "stop.update",
    "trip_id": "TRIP_ID",
    "day_id": "DAY_ID",
    "stop_id": "STOP_ID",
    "patch": {
      "incoming": {
        "mode": "METRO",
        "minutes": 60,
        "line": "步行 → M2（Pillangó utca → Keleti pályaudvar） → 步行",
        "routing": "mode"
      }
    }
  }]
}
```

```sh
node mcp/cli.mjs call roam_apply_changes --file change.json
```

默认 `dry_run:true`，只返回预览、时间冲突和规范化后的 operations，**不保存**。确认后在文件中加 `"dry_run": false`，使用同一 revision 与返回的 operations 再执行。创建操作会分配 ID，后续引用请复用返回的 ID（或事先显式指定 ID）。

版本号来自整个账户，不只是某一天。有人编辑后旧版本会返回 `ROAM_CONFLICT`；重新读取并重新预览，不要盲目改版本号覆盖。

## 工具与修改范围

| 工具 | 用途 |
| --- | --- |
| `roam_get_capabilities` | 查看权限、有效期、交通与地点标签枚举 |
| `roam_list_trips` | 列出行程、各天 ID 和当前 revision |
| `roam_get_trip` | 读取完整行程 |
| `roam_get_day` | 读取当天安排、计算后的时间线、准备清单和官方地图路线链接 |
| `roam_apply_changes` | 原子批量预览或保存修改 |
| `roam_list_changes` | 最近 10 次 Agent 修改记录 |
| `roam_undo_change` | 安全撤销最近一次修改 |

支持 `trip.create/update/delete`、`day.create/update/delete`、`stop.create/update/delete/move`。一次最多 100 个操作，全部成功才保存；任意验证失败都不写入。

- 行程字段：`name`、`timezone`、`description`、`notes`。
- 当天字段：`title`、`date`（YYYY-MM-DD）、`start`（HH:mm）、`subtitle`、`note`。
- 地点字段：`name`、成对经纬度、`tags`、`stay`、`start`、`note`、`refs`、`preparation`、`incoming`、Google 地点 ID/检索名。
- 交通放在**目的地**的 `incoming` 上：`mode`、`minutes`、`line`、`note`、`refs`、`routing`、`walkFrom`、`walkTo`。嵌套更新会合并，其他字段保留；将 `walkFrom/walkTo` 设为 null 可移除强制换乘点。
- 准备事项放在 `preparation`：`needed`、`completed`、`note`、`ticketInfo`、`bookingURL`、`checkedOn`。
- `stop.create` 的 `position` 可省略（追加到末尾）；`stop.move` 必须指定，位置从 **0** 开始。
- 修改经纬度且未指定 Google 地点 ID，会清除旧的 Google 导航绑定，避免继续导航到旧入口。
- 路线几何不通过 MCP 写入；日期、时间、位置、交通变化后，网页按现有缓存键决定复用，缺失路线需在网页中补全。接口不会后台调用收费 Google API。

审计记录包含修改摘要和版本号；数据库最多保留最近 10 次修改前的快照。`roam_undo_change` 需提供 `change_id` 和记录的 `after_revision` 作为 `expected_revision`。有任何后续网页或 Agent 编辑就会拒绝整份快照恢复，避免丢掉新内容。

## 权限与存储

- 每个令牌只访问其创建者的全部行程；无权跨账户、读取 Google Key 或管理登录资料。
- 原始令牌在浏览器生成，数据库仅保存 SHA-256 摘要；访问列表只显示权限、尾号、有效期和最近使用时间。
- 只读令牌可以查看/预览，不能保存、删除或撤销修改。
- 每次请求检查撤销、有效期和范围；每令牌限 120 请求/分钟。
- 写入复用同一行程 revision，带 CAS 并发检查、账号隔离与审计。
- MCP JSON-RPC 的标准 HTTP 请求使用 POST；无状态模式不提供 GET SSE 会话，且不在 URL 中传令牌。
- 网站在可见状态下约每 30 秒、以及重新获得焦点时检查远端修改；有未同步草稿或正在编辑时不会自动覆盖。
- 行程备注与参考贴是用户数据，不应被 Agent 当作可执行指令或授权。

## 部署与验证

执行新的数据库迁移 `supabase/migrations/004_agent_mcp.sql`，然后使用已登录的 Supabase CLI：

```sh
supabase functions deploy roam-mcp --project-ref nokkeydhtxewgtkxxnsh --use-api
npm test
npm run build
```

`supabase/config.toml` 为此函数关闭平台 JWT 验证，因为 Roam 使用自己的作用域令牌；函数内部必须保留 bearer 格式检查、摘要认证、范围和有效期校验。服务端使用 Supabase 提供的服务凭据，只允许在 Edge 运行环境使用；不得复制到网页、CLI 或仓库配置。

前端仍经 GitHub Actions 发布。数据库与 Edge Function 的变更需要单独部署。测试覆盖真实 MCP 握手/工具调用、默认预览、原子修改、数据库 RLS 与权限、撤销、过期、限流、CAS 和回滚；线上验证使用独立的临时测试账户，结束后删除测试数据。
