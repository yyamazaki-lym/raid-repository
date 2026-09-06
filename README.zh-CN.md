<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-wordmark-dark.svg">
    <img src="public/brand/logo-wordmark-light.svg" alt="Raid Repository" width="480">
  </picture>
</p>

# Raid Repository

语言：[日本語](README.md) | [English](README.en.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | **简体中文** | [한국어](README.ko.md)

> 本页为功能与部署的简要说明。完整的分步教程（环境变量、故障排查）以[英文](README.en.md)和[日文](README.md)维护。

面向《最终幻想 XIV》固定队（开荒队）的门户站点：日程、减伤表、装备分配、攻略链接、视频与练习记录集中在一处。

以「一个队伍 = 一个部署」为前提设计：fork 到自己的账号、为自己的固定队单独运行的单租户应用。

## 在线演示

公开的只读演示站：🔗 **https://demo-raid-repository.vercel.app**

## 功能

### 日程
- 三种来源模式：**同步**（从 character-sheets 导入）、**自建**（在门户内添加候选日期、填写出勤 ○ × △、确认开团，支持 FFLogs 关联与 Discord 通知）、**关闭**
- 已确认的场次高亮为**下次开团**（当天显示「距开始 N 小时 M 分」倒计时）
- 自建模式下，成员可额外填写**迟到到达时间 / 早退时间**（HH:MM），显示在符号旁（`21:30〜`），Discord 确认通知中也会出现在名字旁
- Discord 通知模板支持 `{discord_relative}` / `{discord_time}`（按阅读者时区渲染为「3 小时后」等）
- 对未填写出勤的成员自动 @提醒；可选「全员填写后自动确认」
- 悬停 / 点按成员名查看其留言；每场次提供 Google 日历链接

### 内容（分类）
- 每个副本一个**状态**（未开始 / 练习中 / 已通关 / 暂停），拖拽排序，编辑对话框，通过 Supabase Realtime 实时同步

### 每个内容的子标签
- **减伤表 / 装备分配**：以 iframe 嵌入现有 Google 表格；**手机端提供只读卡片视图**（以 CSV 读取表格、按阶段重组为卡片、可只看「自己的列」）。分配标签附带**每周消化检查**（周二 17:00 JST 重置）与 **BiS 链接**（XivGear 嵌入）
- **攻略**：链接列表，自动抓取标题；**视频**：YouTube 缩略图点击播放（懒加载），可附 FFLogs / XIVAnalysis 链接
- **宏**：游戏内宏一键复制；同页保存**场地标点预设**（markercode）与**战术板分享码**
- **练习记录**：从 FFLogs 导入逐次拉取数据——总次数、练习天数、最深进度、通关次数；每日进度条；每次拉取一键跳转 FFLogs / XIVAnalysis / 视频对应时刻；每次拉取显示**灭团原因**（最先倒下的职业 ← 致命技能、10 秒内死亡人数），并统计最常导致灭团的机制；绝境战显示**各阶段停留时间**。不存储、不显示个人 DPS；死亡记录不含玩家名（仅职业 + 技能）

### Discord 自动导入
- 每个内容可设置「攻略频道 ID」「视频频道 ID」；Vercel Cron 每天 01:00 JST 拉取各频道最近 100 条消息，提取 URL、去重后放入对应标签。也可按钮手动立即导入

### 主题与颜色
- 七个版本主题（2.0 至 Evercold），各有专属背景效果
- **五级颜色语义**（`src/lib/perf-tone.ts`）：好 = emerald → lime → amber → orange → rose = 差，统一用于剩余 HP%、死亡数、进度条、出勤符号与每周检查。数字与符号始终并列显示，不单靠颜色传达含义

## 技术

Next.js 16 + React 19 + Tailwind CSS v4 · Supabase（Postgres + Realtime、RLS）· shadcn/ui + Base UI · Vercel（`main` 自动部署、Cron Jobs）。四层防护：代理层的 Discord OAuth 门禁、按页面的角色限制、每个 Server Action 的管理员校验、数据库 RLS。FFLogs 令牌以 AES-256-GCM 加密保存。

## 部署（简版，30–60 分钟）

需要 GitHub、Supabase（免费）、Vercel（Hobby）与 Discord Developer Portal 账号。

1. **Fork** 本仓库——务必修改仓库名（如 `pandora-raid`）
2. **创建 Supabase 项目**，在 SQL Editor 中执行 `supabase/schema.sql`，记录 Project URL / anon key / service_role key
3. **创建 Discord Application + Bot**：Client ID / Client Secret、Bot Token（开启 SERVER MEMBERS INTENT 与 MESSAGE CONTENT INTENT）、服务器 ID（Guild ID）
4. **连接 Discord ↔ Supabase**：在 Discord 添加 redirect `https://<项目>.supabase.co/auth/v1/callback`，在 Supabase 启用 Discord provider 并填入 Client ID / Secret
5. **部署到 Vercel**，设置环境变量 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`DISCORD_BOT_TOKEN`、`DISCORD_GUILD_ID`（可选：`DISCORD_ADMIN_ROLE_IDS`、`CRON_SECRET`、`FFLOGS_API_KEY`、FFLogs OAuth、`SECRET_ENCRYPTION_KEY`、`YOUTUBE_API_KEY`）
6. **邀请 Bot** 加入服务器（scope `bot`，权限 View Channels、Read Message History）
7. **Supabase URL Configuration**：Site URL = Vercel 域名，Redirect URLs 加入 `https://<域名>/auth/callback` 与 `http://localhost:3000/auth/callback`
8. **初始设置**：选择日程来源、添加内容、填写表格 URL
9. *（可选）* 填写 Discord 导入的频道 ID，并为 Bot 逐频道授予读取权限
10. *（可选）* 设置 GitHub Secret `SUPABASE_DB_URL`（Session pooler），由 GitHub Actions 自动应用 `schema.sql`

各步骤详情、故障排查与架构更新：[英文指南](README.en.md#setup-for-your-raid-group)。

## 本地开发

```bash
npm install
cp .env.local.example .env.local  # 填入 Supabase 密钥
npm run dev
```

## 许可证

MIT
