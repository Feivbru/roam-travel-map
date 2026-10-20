# Roam 漫游 · 在线旅行地图

以地图为主体的多日旅行计划。邮箱注册、登录、找回密码由 Supabase Auth 提供；每个账户的计划和路线坐标分别保存在 PostgreSQL 的 `roam_states`、`roam_routes` 中；地图服务与浏览器 Key 单独保存在 `roam_map_settings` 中。

## 本地开发

```sh
npm ci
cp .env.example .env
# 填写项目 URL 和 publishable key / anon key，不能填 secret / service_role key
npm run build
npm run dev
```

开发时 `config.mjs` 需填写同一组公开项目配置，或先运行构建后预览 `dist/`。`.env`、用户草稿、迁移数据不进入 Git。

## 数据库

按顺序执行 `supabase/migrations/001_roam.sql` 、`002_route_cleanup.sql` 和 `003_map_settings.sql`。前者开启 RLS，并仅向登录用户开放自己的记录；写入只能调用校验了 `auth.uid()` 的函数，前端不传入可冒用的用户 ID。行程保存使用 revision 比较，防止不同设备静默覆盖。路线缓存只包含经纬度，29天到期，定时清理留出30天上限以内的余量。

## GitHub Pages

仓库 Settings → Pages，Source 选 GitHub Actions。仓库变量 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY` 使用公开的 Supabase 项目配置。推送 main 后，Actions 测试、构建并部署 dist。

在 Supabase Authentication → URL Configuration 中，将 Site URL 设置为发布后的完整网址，并加入同一地址与 `http://127.0.0.1:8190/` 作为允许回跳地址。邮箱确认保持开启；试用默认邮件服务有收件人与发送额度限制，正式开放多人注册前配置 SMTP。

Google Maps 使用用户在「地图设置」填写的浏览器 Key，按账号保存并在登录时恢复。已有登录会话中的 Key 会自动迁移，可通过「移除账号 Key」清空。设置与行程独立，不进入 JSON/KML/ICS 导出和公开源码。RLS 限制用户只能读取自己的设置；数据库管理员仍有查看权限，这不是端到端加密。浏览器 Maps Key 会出现在前端请求中，须在 Google Cloud 设置网站来源与 API 限制及配额。

## 迁移已有行程

登录自己的账号后，用「导入」选择原本地版导出的 JSON。新账户从空白开始，网站及公开代码中不包含原旅行行程。可选的云端迁移 JSON 也支持附带仍在有效期内的路线坐标，导入时同步到当前账号。JSON、KML、ICS 导出继续可用；原始 Google 评论、照片与参考页面不入库。

## 验证

```sh
npm test
npm run build
```

测试覆盖跨设备保存冲突、读取失败不覆盖、按账户查询、路线只保存允许字段。数据库测试用临时 PostgreSQL 验证 RLS、匿名访问拒绝和用户数据隔离。

## Agent / MCP

右上角「◇ Agent」可创建、撤销只读或读写连接令牌。支持远程 MCP Streamable HTTP、stdio 桥接与终端命令行，修改默认先预览；同一套 revision 检查避免覆盖并发修改。接口独立部署为 Supabase Edge Function，不访问 Google Key。完整接入、操作类型和部署说明见 [MCP.md](MCP.md)。
