# 当前部署

网站：https://feivbru.github.io/roam-travel-map/

代码：https://github.com/Feivbru/roam-travel-map

数据库：Supabase 项目 Roam，新加坡地区。项目控制台：https://supabase.com/dashboard/project/nokkeydhtxewgtkxxnsh

GitHub Pages 提供网页，Supabase Auth 提供邮箱账户，PostgreSQL 保存每个账户自己的计划和路线。公开仓库只有程序、数据库规则和公开项目配置；私人行程及数据库管理凭据不在其中。

## 以后怎样更新

在此目录修改源代码，运行 `npm test` 和 `npm run build`，提交并推送到 main。GitHub Actions 会自动测试、构建并发布，无需重新上传网页。

数据库结构调整写成新的 SQL 迁移文件；不要改写已应用的迁移历史。可通过已授权的 Supabase CLI 用 `supabase db query --linked --project-ref nokkeydhtxewgtkxxnsh --file 文件路径` 执行，不需要在聊天中提供数据库密码。

## 第一次使用

注册、验证邮箱并登录。导入本地版导出的 JSON；本机另备有带路线坐标的云端迁移文件，不能放进公开仓库。地图设置中的 Google 浏览器 Key 仍由使用者自行填写，并为线上网站添加来源限制：`https://feivbru.github.io/roam-travel-map/*`。

当前使用 Supabase 默认邮件发送服务，适合先用组织成员邮箱试用。向其他人开放邮箱注册前，请在 Supabase 配置自己的 SMTP 服务并检查发信额度。
