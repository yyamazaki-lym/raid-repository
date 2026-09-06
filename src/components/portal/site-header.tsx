import Link from "next/link";
import Image from "next/image";
import { ThemeSwitcher } from "./theme-switcher";
import { LocaleSwitcher } from "./locale-switcher";
// 1.9 (2026-04-28) TODO #11: SettingsDialog (~1601 行 + MaintenanceMenu
// ~880 行) は開いた時だけ必要なので、`next/dynamic` 経由で別 chunk 化
// した lazy ラッパー (`settings-dialog-lazy.tsx`) を使う。初期ページ
// ロードの client bundle から外して reload を軽くする。
import { SettingsDialog } from "./settings-dialog-lazy";
import { DeployColorBadge } from "./deploy-color-badge";
import { OnlinePresenceIndicator } from "./online-presence-indicator";
import { LATEST_RELEASE_META } from "@/lib/changelog-meta";
import { getMessages } from "@/lib/i18n/server";
import {
  getCurrentUserCanEdit,
  getCurrentUserPresenceKey,
  getCurrentUserIsDemoGuest,
} from "@/lib/server/auth";

/**
 * App version for the header badge.
 *
 * Single source of truth: `@/lib/changelog-meta` (`LATEST_RELEASE_META`).
 *   `changelog.ts` の `RELEASES[0]` も同オブジェクトを spread して組み立てる
 *   ため、ヘッダーと更新履歴の最新エントリーはズレない。以前は `RELEASES[0]`
 *   を直接参照していたが、その import で ~306 KB の changelog 本文が全
 *   ポータルページのサーバーバンドルに混入し cold start を重くしていた
 *   ため分離 (2026-07-22)。`package.json#version` fallback は meta が必ず
 *   存在するため廃止 (経緯コメントは changelog-meta.ts に移設)。
 *
 * Versioning convention (from v1.9, 2026-04-28):
 *   `MAJOR.MINOR (YYYY-MM-DD)` — patch dropped.
 *     MINOR — notable feature additions / reworks (1.9 → 1.10)
 *     MAJOR — breaking / sweeping changes (1.x → 2.0)
 *     date  — pulled from the latest changelog entry; multiple days of
 *             small fixes share the same MAJOR.MINOR and only the date
 *             updates.
 *   Pre-scheme history used MAJOR.MINOR.PATCH; see `src/lib/changelog.ts`.
 *
 * Stage tag is deliberately kept inline since it changes rarely:
 *     ALPHA — internal, rough — bumped to BETA once it's daily-driver usable
 *     BETA  — operational, but still actively bug-fixing (current)
 *     RC    — release candidate, only show-stoppers being fixed
 *     (none) — stable
 */
const APP_VERSION = LATEST_RELEASE_META.version;
const APP_DATE = LATEST_RELEASE_META.date;
const APP_STAGE = "BETA";

/**
 * デプロイ判別用カラーサイクル。
 *
 * Vercel deploy が反映されたかを目視で確認できるように、ヘッダーの
 * バージョン + STAGE 表示を 7 種の色のいずれかで描画する。同じビルドの
 * 間は色が固定、別のビルドにデプロイが切り替わると別の色になる。
 *
 * Seed の優先順:
 *   1. `VERCEL_GIT_COMMIT_SHA` — Vercel ビルド時に commit SHA を埋め込む。
 *      コミットが変われば必ず別シードになるので push のたびに色が変わる。
 *   2. `JSON.stringify(LATEST_RELEASE_META)` — ローカル dev / Vercel 以外。
 *      changelog メタ分離 (2026-07-22) 以降は version / date が変わった時
 *      だけ色が変わる (本文 parts の編集では変わらない)。Vercel 上では
 *      常に SHA が存在するので、この劣化はローカル dev 表示のみに影響。
 *
 * 7 色は dark / light 双方で識別可能な飽和度の Tailwind 標準色から選定。
 * テーマの neon トークンは theme 切替で意味が変わるので使わない。
 *
 * 1.9 (2026-04-29): 日付跨ぎでサイクル先頭の cyan にリセット。
 * `RELEASES[0].date` (= 当日エントリー) と JST 現在日付が一致する間のみ
 * ハッシュ色を使い、翌日になったら `DEPLOY_COLORS[0]` (cyan) に戻す。
 * 「今日の deploy がある = ユニーク色」「無い = 静かな状態 = cyan」。
 */
const DEPLOY_COLORS = [
  "text-cyan-400",
  "text-amber-300",
  "text-emerald-400",
  "text-rose-400",
  "text-violet-400",
  "text-orange-300",
  "text-fuchsia-400",
];

function deployColorIndex(): number {
  const seed =
    process.env.VERCEL_GIT_COMMIT_SHA ?? JSON.stringify(LATEST_RELEASE_META);
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h % DEPLOY_COLORS.length;
}

const HASH_COLOR = DEPLOY_COLORS[deployColorIndex()]!;
const DEFAULT_COLOR = DEPLOY_COLORS[0]!;

/**
 * SSR 用の初期色計算 (server component なので request 時に評価される)。
 * client 側の `DeployColorBadge` 内 useEffect でも同じロジックを再評価
 * するため hydration mismatch しない (両者とも JST 日付ベース)。
 *
 * Note: Next.js 16 では `"use client"` ファイルからの非コンポーネント
 * export は server component から呼べないため、ここに同じ関数を duplicate
 * している (5 行程度なのでコピーが妥当)。
 */
function pickInitialColor(): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return today === APP_DATE ? HASH_COLOR : DEFAULT_COLOR;
}

export async function SiteHeader() {
  // ADMIN ロールでなければ設定ダイアログ内の書き込み系 UI は非表示
  // (TODO #21 follow-up)。Server Action 側でも assertAdminResult で
  // 二重に守るが、UI が露出していると non-admin が触って失敗 toast を
  // 食らうので、見せないのが本来の意図。
  const canEdit = await getCurrentUserCanEdit();
  // TODO #91 follow-up: demo モードのゲスト (実セッションなし) のときだけ
  // 設定ダイアログ footer に「サインイン」導線を出す。requireDiscordMember
  // は cache() 済みなので canEdit と合わせても auth 解決は 1 回。
  const isDemoGuest = await getCurrentUserIsDemoGuest();
  // F-4: ヘッダーの ONLINE 表示を presence ベースのオンライン人数にするため、
  // presence key を取得 (requireDiscordMember は cache 済)。生の Discord ID では
  // なく不可逆ハッシュ — presence チャンネルは anon でも join でき presenceState()
  // でキーが列挙されるため、生 ID を client に渡さない (auth.ts の docstring 参照)。
  const presenceKey = await getCurrentUserPresenceKey();
  const m = await getMessages();
  return (
    <header className="glass-bar sticky top-0 z-30">
      <div className="mx-auto flex h-[var(--header-h)] max-w-5xl items-center gap-3 px-4 sm:px-6">
        <Link
          href="/"
          className="group flex items-center gap-2.5"
          aria-label={m.header.homeAria}
        >
          {/* 2026-09-06: ロゴマーク (public/brand/logo-mark.svg)。マーク自体が
              角丸のタイルなので枠は付けず、後光だけ残す。 */}
          <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-md shadow-[0_0_18px_-4px_var(--neon-cyan)] transition-shadow group-hover:shadow-[0_0_22px_-2px_var(--neon-cyan)]">
            <Image
              src="/brand/logo-mark.svg"
              alt=""
              width={32}
              height={32}
              priority
              unoptimized
              className="h-8 w-8"
            />
          </span>
          <div className="flex flex-col gap-0.5 leading-none">
            <span className="font-display text-[13px] font-semibold tracking-[0.2em] text-foreground sm:text-sm">
              {m.common.appName}
            </span>
            <DeployColorBadge
              hashColor={HASH_COLOR}
              defaultColor={DEFAULT_COLOR}
              releaseDate={APP_DATE}
              initialColor={pickInitialColor()}
            >
              <span>
                v{APP_VERSION}
                {` (${APP_DATE})`}
              </span>
              <span aria-hidden className="opacity-50">·</span>
              <span className="tracking-[0.22em]">{APP_STAGE}</span>
            </DeployColorBadge>
          </div>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          {/* 2026-09-07: 表示言語 (国旗)。設定ダイアログから移動。 */}
          <LocaleSwitcher />
          <ThemeSwitcher />
          {/* サインアウトは設定ダイアログ内に移設 (2.1 2026-04-29)。 */}
          <SettingsDialog canEdit={canEdit} showSignIn={isDemoGuest} />
          <OnlinePresenceIndicator selfKey={presenceKey} isDemoGuest={isDemoGuest} />
        </div>
      </div>
    </header>
  );
}
