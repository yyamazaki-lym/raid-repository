"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileClock, Link2, LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReleaseEntry } from "@/lib/changelog";
import { useConfirm } from "@/components/portal/confirm-dialog";

/**
 * Inline GitHub mark — `lucide-react` v1.x removed brand icons (Github
 * et al.) so we embed the simple-icons SVG path directly. Single use,
 * not worth a separate component.
 */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.111.82-.261.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.305-5.467-1.334-5.467-5.931 0-1.31.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.51 11.51 0 0 1 12 5.803c1.02.005 2.045.138 3.003.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.652.242 2.873.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .319.216.694.825.576C20.565 22.092 24 17.598 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

/**
 * TODO #66 (2026-05-02): settings-dialog.tsx 分割の一部。
 * 全員に表示される footer block — 更新履歴トグル + GitHub / Lodestone
 * 外部リンク + Sign out フォーム + dynamic import による changelog
 * archive lazy load を担当。
 *
 * archive lazy load (TODO #67 で導入したパターン): ボタン押下時に
 * `import("@/lib/changelog-archive")` で過去分 (~210 KB) を初めて fetch
 * して結合表示する。
 *
 * 2.14 (2026-09-06) 軽量化: `RELEASES` (`@/lib/changelog`) も static import
 * をやめ、「更新履歴」ボタンを初めて押した時に `import("@/lib/changelog")`
 * で取り込む。changelog.ts は graduate 運用が追い付かず ~420 KB (source)
 * に育っており、static import のままだと settings-dialog chunk に同梱
 * されて **全ページの初回ロードで毎回ダウンロード** されていた
 * (settings-dialog-lazy は mount 直後に chunk を fetch するため)。更新履歴
 * を開く操作は稀なので、開いた時に 1 回だけ取りに行く。表示内容・並び
 * 順は従来と同一 (最新 → archive の結合)。
 *
 * TODO #91 follow-up: `showSignIn` (= demo モードのゲスト閲覧時) は
 * セッションが無く Sign out が意味を成さないため、代わりに owner 向けの
 * サインイン導線 (/login) を表示する。
 */
export function ChangelogFooter({
  showSignIn = false,
}: {
  showSignIn?: boolean;
}) {
  const pathname = usePathname();
  const confirm = useConfirm();
  const [showChangelog, setShowChangelog] = useState(false);
  // 最新分 (`RELEASES`)。初回表示時に dynamic import で取り込む。
  const [releases, setReleases] = useState<ReleaseEntry[] | null>(null);
  const [loadingReleases, setLoadingReleases] = useState(false);
  const [releasesError, setReleasesError] = useState<string | null>(null);
  const [archiveReleases, setArchiveReleases] = useState<ReleaseEntry[] | null>(
    null,
  );
  const [loadingArchive, setLoadingArchive] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2 border-t border-border/30 pt-3">
      {/* 更新履歴ボタン + GitHub リポジトリへのリンクを横並び。
          GitHub アイコンを単独配置すると意図が伝わりにくいので、
          ラベル "Source" を併記してアウトラインボタンと統一感を出す。 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const next = !showChangelog;
            setShowChangelog(next);
            // 初めて開く時だけ本文 chunk を取りに行く。失敗時は再度
            // ボタンを押せば retry される (loading 中の二重発火は抑止)。
            if (next && releases === null && !loadingReleases) {
              setLoadingReleases(true);
              setReleasesError(null);
              import("@/lib/changelog")
                .then((mod) => {
                  setReleases(mod.RELEASES);
                })
                .catch((err: unknown) => {
                  console.warn("[changelog] load failed:", err);
                  setReleasesError("読み込みに失敗しました");
                })
                .finally(() => {
                  setLoadingReleases(false);
                });
            }
          }}
          className="h-8 gap-1.5 rounded-md px-3 text-[10px] tracking-normal"
          title="更新履歴を表示 / 非表示"
          aria-expanded={showChangelog}
          aria-busy={loadingReleases}
        >
          <FileClock className="h-3 w-3" aria-hidden />
          {showChangelog ? "更新履歴を隠す" : "更新履歴"}
        </Button>
        <a
          href="https://github.com/yyamazaki-lym/raid-repository"
          target="_blank"
          rel="noopener noreferrer"
          title="GitHub リポジトリを新しいタブで開く"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-3 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:bg-secondary/40 hover:text-foreground"
        >
          <GithubMark className="h-3 w-3" />
          Source
        </a>
        {/* TODO #18 (1.9 (2026-04-28)): FF14 Lodestone への
            外部リンク。出欠 / 装備チェック / Mog ステーション等の
            公式入口として頻繁にアクセスするので、設定ダイアログ
            フッターに常駐させる。 */}
        <a
          href="https://jp.finalfantasyxiv.com/lodestone/"
          target="_blank"
          rel="noopener noreferrer"
          title="FF14 Lodestone (公式) を新しいタブで開く"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-3 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:bg-secondary/40 hover:text-foreground"
        >
          <Link2 className="h-3 w-3" aria-hidden />
          Lodestone
        </a>
        {/* 2.1 (2026-04-29): サインアウトボタンは頻度が低いため
            SiteHeader から本ダイアログ内に移設。誤クリック防止
            のため confirm を経由してから /auth/sign-out POST。
            2.7 (TODO #91 follow-up): demo ゲスト時はセッションが無いので
            Sign out の代わりにサインイン導線 (/login) を表示。next= で
            現在ページに戻す。ログインしても guild member 以外はゲスト
            fallback のままなので一般訪問者の read-only 体験は変わらない。 */}
        {showSignIn ? (
          <Link
            href={`/login?next=${encodeURIComponent(pathname)}`}
            title="Discord アカウントでログイン"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--neon-cyan)]/30 bg-[var(--neon-cyan)]/5 px-3 font-mono text-[10px] tracking-[0.18em] text-[var(--neon-cyan)]/85 uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:bg-[var(--neon-cyan)]/10 hover:text-[var(--neon-cyan)]"
          >
            <LogIn className="h-3 w-3" aria-hidden />
            Sign in
          </Link>
        ) : (
          <form
            action="/auth/sign-out"
            method="post"
            className="inline-flex"
            onSubmit={(e) => {
              // async confirm のため一旦既定動作を止め、承諾時のみ native
              // submit する (form.submit() は onSubmit を再発火しない)。
              e.preventDefault();
              const form = e.currentTarget;
              void (async () => {
                const ok = await confirm({
                  title: "サインアウトしますか？",
                  confirmText: "サインアウト",
                  destructive: true,
                });
                if (ok) form.submit();
              })();
            }}
          >
            <button
              type="submit"
              title="サインアウト"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-rose-400/30 bg-rose-400/5 px-3 font-mono text-[10px] tracking-[0.18em] text-rose-300 uppercase transition-colors hover:border-rose-400/60 hover:bg-rose-400/10 hover:text-rose-200"
            >
              <LogOut className="h-3 w-3" aria-hidden />
              Sign out
            </button>
          </form>
        )}
      </div>
      {showChangelog && (
        <div className="flex flex-col gap-3 rounded-sm border border-border/40 bg-secondary/20 px-3 py-2.5 text-[11px] leading-relaxed">
          <p className="text-[10px] tracking-normal text-muted-foreground">
            更新履歴 — Release Notes
          </p>
          {(() => {
            if (releases === null) {
              return (
                <p
                  className={
                    releasesError
                      ? "text-[10px] text-rose-400/80"
                      : "text-muted-foreground"
                  }
                  role="status"
                >
                  {releasesError ?? "読み込み中…"}
                </p>
              );
            }
            const displayReleases = archiveReleases
              ? [...releases, ...archiveReleases]
              : releases;
            return displayReleases.length === 0 ? (
              <p className="text-muted-foreground">記録なし</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {displayReleases.map((r, idx) => (
                  <li
                    key={`${r.version}|${r.date}`}
                    className="border-l-2 border-[var(--neon-cyan)]/40 pl-2.5"
                  >
                    {/* 各リリースは <details> で折りたたみ。最新の
                        1 件のみ default open、他は閉じた状態で開始。
                        ▶/▼ 表示は親の [open] 状態を参照して回転 */}
                    <details open={idx === 0} className="group/release">
                      <summary className="flex cursor-pointer list-none items-baseline gap-2 select-none outline-none [&::-webkit-details-marker]:hidden">
                        <span
                          aria-hidden
                          className="inline-block w-2 text-[10px] text-muted-foreground transition-transform duration-150 group-open/release:rotate-90"
                        >
                          ▶
                        </span>
                        <span className="font-mono text-[12px] font-bold text-[var(--neon-cyan)]">
                          v{r.version}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {r.date}
                        </span>
                        {r.parts && (
                          <span className="font-mono text-[9px] tracking-[0.18em] text-muted-foreground/70 uppercase">
                            {r.parts.length} parts
                          </span>
                        )}
                      </summary>

                      {/* 2.1 (2026-05-02 part3) TODO #55 完了に併設:
                          各 part の <details> 折りたたみ + body を撤去
                          し、title 1 行のみのフラットなリストに変更。
                          詳細は GitHub commits / changelog.ts 参照。 */}
                      <div className="mt-1.5 ml-3 flex flex-col gap-1">
                        {r.parts ? (
                          <ul className="flex flex-col gap-0.5 text-[11px] text-foreground/85">
                            {r.parts.slice(0, 5).map((p, i) => (
                              <li key={i} className="leading-snug">
                                ・{p.title}
                              </li>
                            ))}
                            {r.parts.length > 5 && (
                              <li className="font-mono text-[9px] tracking-[0.18em] text-muted-foreground/70 uppercase">
                                … +{r.parts.length - 5} more
                              </li>
                            )}
                          </ul>
                        ) : (
                          <ul className="flex flex-col gap-0.5 text-[11px] text-foreground/85">
                            {(r.notes ?? []).map((n, i) => (
                              <li key={i} className="leading-snug">
                                ・{n}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            );
          })()}
          {/* TODO #67 (2026-05-02): archive (~210 KB) は dynamic
              import で lazy load。最初の表示は最新リリース 1 件
              のみで初期 bundle を抑える */}
          {archiveReleases === null && releases !== null ? (
            <button
              type="button"
              onClick={() => {
                if (loadingArchive) return;
                setLoadingArchive(true);
                setArchiveError(null);
                import("@/lib/changelog-archive")
                  .then((mod) => {
                    setArchiveReleases(mod.RELEASES_ARCHIVE);
                  })
                  .catch((err: unknown) => {
                    console.warn("[changelog-archive] load failed:", err);
                    setArchiveError("読み込みに失敗しました");
                  })
                  .finally(() => {
                    setLoadingArchive(false);
                  });
              }}
              disabled={loadingArchive}
              className="self-start cursor-pointer rounded-sm border border-[var(--neon-cyan)]/30 bg-secondary/30 px-2.5 py-1 text-[10px] tracking-normal text-[var(--neon-cyan)]/85 transition-colors hover:border-[var(--neon-cyan)]/60 hover:bg-secondary/50 hover:text-[var(--neon-cyan)] disabled:cursor-wait disabled:opacity-60"
              aria-busy={loadingArchive}
            >
              {loadingArchive ? "読み込み中…" : "↓ 過去の更新履歴を見る"}
            </button>
          ) : null}
          {archiveError && (
            <p className="text-[10px] text-rose-400/80" role="status">
              {archiveError}
            </p>
          )}
          <a
            href="https://github.com/yyamazaki-lym/raid-repository/commits/main"
            target="_blank"
            rel="noopener noreferrer"
            className="self-start text-[10px] tracking-normal text-[var(--neon-cyan)]/85 transition-colors hover:text-[var(--neon-cyan)]"
            title="これ以前の commit log は GitHub で確認"
          >
            ↗ commit log を GitHub で見る
          </a>
        </div>
      )}
    </div>
  );
}
