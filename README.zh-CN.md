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
- 对未填写的成员**自动催填**、全员填写后**自动确定**（可选）。在催填消息上加回答按钮后，成员可**直接在 Discord 里回答出勤**（自建模式，可选）
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
- **补齐空缺** —— 列出有开团却没有任何记录的日子；ACT 没能运行的那天，可**手动记录**尝试次数与进度，计入统计。没有练习的日子可用「当天取消了」把日程设为取消
- ⚠ **不保存也不显示个人 DPS。** 阵亡记录只到「职业 + 技能」，不含玩家名

### 我的页面 (`/me`)

从页眉的人形图标打开，**只显示你自己的内容**（管理员也看不到别人的行）。

- 我的职业设置（默认值 + 按副本覆盖），用于减伤表筛选
- **剩余 BiS** 与**学习路径**进度条
- 出勤汇总入口

### 其他

- **命令面板**（Ctrl+K）—— 跨副本、标签与操作搜索
- **Discord 自动导入** —— 为副本登记攻略 / 视频频道 ID 后，每天 01:00 JST 从最近 100 条消息中提取 URL 并归档（也可按钮即时执行）
- **YouTube 播放列表导入** —— 不公开列出的视频不会出现在频道的视频列表里，把它们放进播放列表并登记后，同一时间会导入到视频标签（需要 YouTube API 密钥）
- **练习记录通知** —— 把新报告、最高进度更新、首次通关，以及周二早上的**每周总结**（上周的尝试次数、最高进度、首次突破与通关）发到 Discord。可按种类分别开关，默认全部关闭
- **学习路径** —— 给新成员的有序清单：视频 → 站位图 → 宏 → 减伤表
- **主题** —— 7 个资料片主题与各自的背景效果
- **统一的 5 级配色**（`src/lib/perf-tone.ts`）—— 好 = emerald → lime → amber → orange → rose = 差。⚠ **不靠颜色单独传达含义**（始终并列数字与符号）

---

## 技术

Next.js 16 + React 19 + Tailwind CSS v4 · Supabase（Postgres + Realtime + RLS）· shadcn/ui + Base UI · Vercel（`main` 自动部署、Cron）。

### 四层防护

1. **代理** —— Discord OAuth 门禁，不是服务器成员就进不来
2. **页面** —— 按角色限制显示
3. **Server Action** —— 每次写入都单独校验管理员
4. **RLS** —— 数据库端执行同样的判定（绕过应用也写不进去）

FFLogs 令牌以 AES-256-GCM 加密保存。

---

## 安装（摘要，20–40 分钟）

**需要手动收集的值只有 6 个**（必填 5 个 + 管理员角色 ID）。逐屏说明见[英文指南](docs/setup.en.md)。

> ⚠ fork 时**务必修改仓库名的默认值 `raid-repository`**（如 `pandora-raid`、`tuesday-night-raid`）。保留默认名会与其他队伍的 fork 无法区分。它也会成为 Vercel 项目名的默认值。

### 1. 收集 6 个值（浏览器）

| # | 值 | 位置 |
|---|---|---|
| 1–3 | Supabase 的 **Project URL** / **anon** / **service_role** | 在 [Supabase](https://supabase.com) 建项目 → Settings → API |
| 4 | Discord **Bot 令牌** | [Developer Portal](https://discord.com/developers/applications) → Bot → Reset Token（**打开 SERVER MEMBERS INTENT**） |
| 5 | Discord **服务器 ID** | Discord（开发者模式）→ 右键服务器 |
| 6 | **管理员角色 ID**（`DISCORD_ADMIN_ROLE_IDS`） | Discord → 服务器设置 → 身份组 → 右键 → 复制身份组 ID。**不设置的话，谁都无法编辑内容或更改设置** |

浏览器里还有三件事：

- 把 Bot 邀请进你的服务器（Developer Portal → **OAuth2 → URL Generator** → Scopes `bot`）。**Bot 不在服务器里的话，谁都无法登录**
- 在 Discord **OAuth2 → Redirects** 添加 `https://<project ref>.supabase.co/auth/v1/callback`
- 在 Supabase **Authentication → Providers → Discord** 打开并粘贴 Client ID / Secret

### 2. 配置与数据库（命令）

先 **Fork** 本仓库，再把你的 fork clone 到本地：

```bash
git clone https://github.com/<你>/<你的 fork>.git
cd <你的 fork>
npm install
npm run setup
```

它会边校验边写入 `.env.local`，自动生成只需随机的值，引导你**创建数据表**，最后运行诊断。

### 3. 部署并登记回跳地址

在 [Vercel](https://vercel.com/new) → **Add New → Project** 导入**你自己的 fork**，把 `.env.local` 的全部内容粘贴到 **Environment Variables**，然后 Deploy（包括 `CRON_SECRET`、`SECRET_ENCRYPTION_KEY`、`DISCORD_ADMIN_ROLE_IDS`；详见[英文指南](docs/setup.en.md#6-deploy-to-vercel-5-min)第 6 步）。⚠ 不要粘贴 `DEV_AUTH_BYPASS` / `PUBLIC_DEMO_MODE` 这两行。

部署确定域名后，在 **Supabase → Authentication → URL Configuration** 填写 Site URL 与 Redirect URLs（`https://<域名>/auth/callback` 和 `http://localhost:3000/auth/callback`）。**漏掉这一步，登录后就回不来。**

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

打开 http://localhost:3000（终端里显示的是 `127.0.0.1`，但登录回跳地址登记的是 `localhost`，所以请用 `localhost` 打开）。

| 命令 | 作用 |
|---|---|
| `npm run setup` | 交互式安装（`.env.local` → schema → 诊断） |
| `npm run doctor` | 诊断配置；加 `-- --url https://…` 也检查已部署的站点 |
| `npm run dev` | 开发服务器（只绑定 `127.0.0.1`，仅本机可打开：`DEV_AUTH_BYPASS` 会让你成为管理员，所以同一 Wi-Fi 下的其他设备打不开） |
| `npm run build` | 生产构建 |
| `npm run lint` | ESLint |

`scripts/check-*.mjs` 是对纯函数与约定的检查，CI 会全部运行。

---

## 文档

| 文件 | 内容 |
|---|---|
| [`docs/setup.en.md`](docs/setup.en.md) | **详细安装指南**与故障排查（英文） |
| [`docs/backlog.md`](docs/backlog.md) | 剩余任务（日文） |
| [`docs/guides/discord-setup.md`](docs/guides/discord-setup.md) | 推荐的 Discord 频道结构（日文） |
| [`docs/guides/log-runner.md`](docs/guides/log-runner.md) | 记录负责人的指南（日文） |
| [`docs/demo-site.md`](docs/demo-site.md) | 演示站的搭建方法（**通常不需要**） |
| [`docs/release-notes/`](docs/release-notes/) | 各版本详情（应用内显示的一行摘要在 `src/lib/changelog.ts`） |
| [`.env.local.example`](.env.local.example) | 全部环境变量及说明 |

---

## 品牌

徽标在 `public/brand/`。`logo-mark.svg` 的方形标志中，水晶 = 积累知识的容器，周围 8 个点 = 8 人小队：上方 2 点是坦克（蓝），下方 2 点是治疗（绿），左右 4 点是 DPS（红）。`logo-wordmark-dark.svg` / `logo-wordmark-light.svg` 是深色 / 浅色背景用的文字标志，本 README 开头会自动切换。应用里的网站图标、iOS 主屏幕图标、登录页和启动画面也使用同一标志。

`social-preview.png`（1280×640）是 GitHub 仓库卡片上显示的图片。**需在仓库的 Settings → Social preview 手动上传**（GitHub API 无法设置）。

---

## 许可证

MIT

但 `src/app/fonts/` 中的字体（Geist、JetBrains Mono、Orbitron）采用 SIL Open Font License 1.1（见各字体的 `OFL-*.txt`）。
