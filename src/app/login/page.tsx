import Image from "next/image";
import {
  Activity,
  BookOpen,
  Dice5,
  Film,
  ShieldHalf,
  CalendarCheck2,
} from "lucide-react";
import { LoginButton } from "./login-button";
import { LocaleSwitcher } from "@/components/portal/locale-switcher";
import { LATEST_RELEASE_META } from "@/lib/changelog-meta";
import { getMessages } from "@/lib/i18n/server";
import type { Messages } from "@/lib/i18n/messages";

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.login.title };
}

// Discord OAuth はセッション cookie を扱うので edge / SSG で固めると
// 不整合になる。動的レンダリングを明示する。
export const dynamic = "force-dynamic";

/**
 * ログイン画面 (2026-09-06 再設計)。
 *
 * ロゴ (public/brand/logo-mark.svg) を中心に置いた 1 枚のガラスカード。
 * 背景の雰囲気 (bg-orbs / bg-grid / bg-scanlines とテーマ) は root layout が
 * 持っているので、ここではロゴの後光と、中に何があるかの 6 チップだけを足す。
 * 文字は 11px 以上、色はテーマ変数経由 (7 テーマ全部でそのまま成立する)。
 * 後光のアニメは prefers-reduced-motion で止める。
 */
const FEATURES = [
  { key: "schedule", Icon: CalendarCheck2 },
  { key: "mitigation", Icon: ShieldHalf },
  { key: "loot", Icon: Dice5 },
  { key: "guide", Icon: BookOpen },
  { key: "video", Icon: Film },
  { key: "logs", Icon: Activity },
] as const satisfies ReadonlyArray<{
  key: keyof Messages["login"]["features"];
  Icon: unknown;
}>;

export default async function LoginPage({
  searchParams,
}: {
  // 2026-08-05 監査 L-7: `detail` (Supabase の内部エラー文字列) の受け渡しを
  // 廃止。診断はサーバーログ側に寄せた。クエリ由来の任意文字列をエラー
  // ボックスに描画する口でもあったため、パラメータごと落としている
  // (React のエスケープで XSS にはならないが、攻撃者が任意の「案内文」を
  // 出せる状態だった)。表示する文言は `describeError` の既知集合のみ。
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const m = await getMessages();
  const errorMessage = describeError(error, m);

  return (
    <main className="relative flex min-h-screen w-full flex-col items-center justify-center px-4 py-12">
      {/* ロゴの後光。カードの背後で 8 秒周期にゆっくり呼吸する。 */}
      <div
        aria-hidden
        // 中央寄せは inset-0 + m-auto (transform を使わない)。keyframes 側は
        // scale だけを動かすので、reduced-motion で止めても位置がずれない。
        className="login-glow pointer-events-none absolute inset-0 -z-10 m-auto h-[34rem] w-[34rem] rounded-full motion-reduce:animate-none"
      />

      <section
        aria-labelledby="login-title"
        className="glass-popup relative flex w-full max-w-[26rem] flex-col items-center gap-7 rounded-2xl px-7 py-10 sm:px-9"
      >
        {/* 上端の細いハイライト線 — ガラスの縁の光。 */}
        <span
          aria-hidden
          className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-[var(--neon-cyan)]/70 to-transparent"
        />

        <Image
          src="/brand/logo-mark.svg"
          alt=""
          width={104}
          height={104}
          priority
          unoptimized
          className="h-[104px] w-[104px] drop-shadow-[0_0_24px_var(--neon-cyan)]"
        />

        <div className="flex flex-col items-center gap-2 text-center">
          <p className="font-mono text-[11px] tracking-[0.34em] text-[var(--neon-cyan)]">
            {m.login.kicker}
          </p>
          <h1
            id="login-title"
            className="font-display text-[1.55rem] leading-tight tracking-[0.2em] text-foreground sm:text-[1.75rem]"
          >
            {m.common.appName}
          </h1>
          {/* 改行位置は固定 (1 行目を短く、2 行目に「〜を、固定の 8 人で 1 か所に。」を
              まとめる)。各行を inline-block にして、行の途中で折れないようにする。 */}
          <p className="max-w-[20rem] text-[13px] leading-relaxed text-muted-foreground">
            <span className="inline-block">{m.login.taglineLine1}</span>
            <span className="inline-block">{m.login.taglineLine2}</span>
          </p>
        </div>

        <LoginButton next={next ?? "/"} />

        <p className="text-center text-[11px] leading-relaxed text-muted-foreground/85">
          {m.login.memberOnlyLine1}
          <br />
          {m.login.memberOnlyLine2}
        </p>

        {errorMessage && (
          <div
            role="alert"
            className="w-full rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-center text-[12px] text-destructive"
          >
            {errorMessage}
          </div>
        )}

        <ul
          aria-label={m.login.featuresAria}
          className="flex flex-wrap justify-center gap-1.5 border-t border-border/40 pt-5"
        >
          {FEATURES.map(({ key, Icon }) => (
            <li
              key={key}
              className="inline-flex items-center gap-1 rounded-sm border border-border/50 bg-background/30 px-2 py-1 text-[11px] text-muted-foreground"
            >
              <Icon className="h-3 w-3 text-[var(--neon-cyan)]/80" aria-hidden />
              {m.login.features[key]}
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-6 flex flex-col items-center gap-3">
        {/* 2026-09-06: 表示言語。未ログインでも切り替えられるようここに置く。 */}
        <LocaleSwitcher variant="segmented" />
        <p className="font-mono text-[10px] tracking-[0.22em] text-muted-foreground/60 uppercase">
          v{LATEST_RELEASE_META.version} · {LATEST_RELEASE_META.date}
        </p>
      </div>
    </main>
  );
}

function describeError(code: string | undefined, m: Messages): string | null {
  switch (code) {
    case undefined:
    case "":
      return null;
    case "missing_code":
      return m.login.errorMissingCode;
    case "exchange_failed":
      return m.login.errorExchangeFailed;
    default:
      return m.login.errorGeneric(code);
  }
}
