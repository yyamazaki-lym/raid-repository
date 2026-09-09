<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-wordmark-dark.svg">
    <img src="public/brand/logo-wordmark-light.svg" alt="Raid Repository" width="480">
  </picture>
</p>

# Raid Repository

阅读语言: [日本語](README.md) | [English](README.en.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | **简体中文** | [한국어](README.ko.md)

> 本文是精简版。逐屏的安装指引与故障排查以[英文](docs/setup.en.md)和[日文](docs/setup.md)维护。

面向《最终幻想 XIV》固定队的门户站 —— 把**日程、减伤表、装备分配、攻略链接、视频、练习记录**放在一处。

按「一个队伍 = 一次部署」设计的单租户应用，**fork 后为自己的固定队运行**。入口由 Discord 服务器成员身份把守，只有该服务器的成员才能登录。

🔗 **演示站（只读）: https://demo-raid-repository.vercel.app**
可以直接点开体验。**你不需要自己搭一个演示站。**

---

## 功能

### 日程

- **三种模式**：**自建**（在门户内完成候选日添加 → 出勤 ○ × △ → 确定开团）/ **同步**（从 character-sheets 导入）/ **关闭**
- 已确定的场次会作为**下次开团**高亮（当天显示「距开始还有 N 小时 M 分」）
- 设定**固定星期**后，候选日只在这些星期自动生成；对话框还能**按时间段 × 星期批量生成**。不在固定星期的日子会带「临时」「仅此一次」标记
- 除 ○ × △ 外，成员可自行填写**迟到的预计到达时间 / 早退时间**（在符号旁显示 `21:30〜`）
- 对未填写的成员**自动催填**、全员填写后**自动确定**（可选）
- Discord 通知模板支持 `{discord_relative}` / `{discord_time}`，按阅读者所在时区渲染
- 按日期的**备忘**（带重要度）。作者与管理员可编辑；没有记录作者的旧备忘任何成员都可清理
- **出勤汇总** —— 把回答（○ × △）与练习记录中的实际参与做近 90 天的比对并列出偏差。两种模式都可用

### 内容（分类）

- 按副本设置**状态**（未开始 / 练习中 / 已通关 / 暂停）、拖拽排序、Realtime 即时同步
- 每张卡片带**近 8 周进度迷你折线**
- **难度标签**与**进度模型**（层 / 阶段）按副本设置 —— 即使新难度名称尚未公布也能运行
- 可设置卡片背景图，并指定**显示图片的哪一部分**

### 每个副本的子标签

| 标签 | 内容 |
|---|---|
| **减伤表** | 直接嵌入现有 Google 表格。**手机上重排为只读卡片**，可筛选「我的职能」「只看我负责的」 |
| **装备分配** | 同样嵌入表格，另有**本周消耗勾选**（周二 17:00 JST 重置）与 **BiS**（XivGear 嵌入）。「想要的人」矩阵可折叠 |
| **攻略** | 链接列表（自动取标题、标签、已读）。Google 文档 / 表格显示为可辨类型的卡片 |
| **视频** | YouTube 缩略图 + 点击播放，可跳转 FFLogs / XIVAnalysis |
| **宏** | 一键复制游戏内宏，同一标签还放**场景标记预设**与**战术板分享码** |
| **练习记录** | 见下 |

### 练习记录

从 FFLogs 按每次尝试（pull）导入。

- 总次数 / 练习天数 / 最高进度 / 通关次数，以及按日进度条
- 从任一次尝试一键跳到 FFLogs / XIVAnalysis / 视频的**对应时刻**
- **团灭原因**（最先阵亡的职业 ← 致命技能）与卡在哪个机制的统计，还能看**阵亡前发生了什么**
- 绝本显示**各阶段停留时间**与首次到达，零式显示**各层首次通关**
- 一天用**一排方块**表示（一个方块 = 一次尝试，通关为 `✓`）
- 每次尝试可事后补写**失误备注**
- ⚠ **不保存也不显示个人 DPS。** 阵亡记录只到「职业 + 技能」，不含玩家名

### 我的页面 (`/me`)

从页眉的人形图标打开，**只显示你自己的内容**（管理员也看不到别人的行）。

- 我的职业设置（默认值 + 按副本覆盖），用于减伤表筛选
- **剩余 BiS** 与**学习路径**进度条
- 出勤汇总入口

### 其他

- **命令面板**（Ctrl+K）—— 跨副本、标签与操作搜索
- **Discord 自动导入** —— 为副本登记攻略 / 视频频道 ID 后，每天 01:00 JST 从最近 100 条消息中提取 URL 并归档（也可按钮即时执行）
- **学习路径** —— 给新成员的有序清单：视频 → 站位图 → 宏 → 减伤表
- **主题** —— 7 个资料片主题与各自的背景效果
- **统一的 5 级配色**（`src/lib/perf-tone.ts`）—— 好 = emerald → lime → amber → orange → rose = 差。⚠ **不靠颜色单独传达含义**（始终并列数字与符号）

---

## 技术

Next.js 16 + React 19 + Tailwind CSS v4 · Supabase（Postgres + Realtime + RLS）· shadcn/ui + Base UI · Vercel（`main` 自动部署、Cron）。

**四层防护**：① 代理层的 Discord OAuth 门禁 ② 页面级角色限制 ③ 每个 Server Action 的管理员校验 ④ 数据库 RLS。FFLogs 令牌以 AES-256-GCM 加密保存。

---

## 安装（摘要，20–40 分钟）

**需要手动收集的值只有 5 个**。逐屏说明见[英文指南](docs/setup.en.md)。

> ⚠ fork 时**务必修改仓库名**（如 `pandora-raid`）。保留默认名会与其他队伍的 fork 无法区分。

### 1. 收集 5 个值（浏览器）

| # | 值 | 位置 |
|---|---|---|
| 1–3 | Supabase 的 **Project URL** / **anon** / **service_role** | 在 [Supabase](https://supabase.com) 建项目 → Settings → API |
| 4 | Discord **Bot 令牌** | [Developer Portal](https://discord.com/developers/applications) → Bot → Reset Token（**打开 SERVER MEMBERS INTENT**） |
| 5 | Discord **服务器 ID** | Discord（开发者模式）→ 右键服务器 |

浏览器里还有两件事：

- 在 Discord **OAuth2 → Redirects** 添加 `https://<project ref>.supabase.co/auth/v1/callback`
- 在 Supabase **Authentication → Providers → Discord** 打开并粘贴 Client ID / Secret

### 2. 配置与数据库（一条命令）

```bash
npm install
npm run setup
```

它会边校验边写入 `.env.local`，自动生成只需随机的值，引导你**创建数据表**，最后运行诊断。

### 3. 部署并登记回跳地址

部署到 Vercel 后，在 **Supabase → Authentication → URL Configuration** 填写 Site URL 与 Redirect URLs（`https://<域名>/auth/callback` 和 `http://localhost:3000/auth/callback`）。**漏掉这一步，登录后就回不来。**

```bash
npm run doctor -- --url https://<你的域名>
```

### 出问题时

```bash
npm run doctor
```

它会实际调用接口，检查环境变量、Supabase 连通性、schema 是否已应用、Discord 登录是否启用、Bot 令牌与是否在服务器内、以及 **SERVER MEMBERS INTENT**，并对每个 `❌` 给出修复方法。

---

## 本地开发

```bash
npm install
npm run setup   # 首次（生成 .env.local）
npm run dev
```

## 许可证

MIT
