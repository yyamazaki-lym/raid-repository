import Link from "next/link";
import { GraduationCap, Shield, Sword, UserRound } from "lucide-react";
import { fetchMyDashboard } from "@/lib/server/me-page";
import { AttendanceSummaryDialog } from "@/components/portal/schedule/attendance-summary-dialog";
import { bisSlotLabel } from "@/lib/bis-slots";
import { getMessages } from "@/lib/i18n/server";
import { getLocale } from "@/lib/i18n/server";
import { MyJobPicker } from "@/components/portal/my-job-picker";
import { jobLabel } from "@/lib/jobs";

/**
 * 個人ページ `/me` (B-5、2026-09-08)。
 *
 * 調査ノート第 1 回 B-5。第 4 回 7-E の再評価どおり **新しいデータは
 * 1 つも増やさず**、W-19 (出席) / W-23 (BiS) / B-3 (学習パス) の値を
 * 自分の視点で 1 枚に集める。
 *
 * ⚠ **自分のぶんだけ。** admin でも他人の行は出さない (全員の集計は
 * 予定表の出席サマリー側にある)。詳細は `server/me-page.ts` の docstring。
 *
 * ⚠ **自分の担当軽減は出さない。** 軽減表は Sheets が正で、コンテンツを
 * またいで集めると外部 fetch がコンテンツ数ぶん走り、`/me` が Sheets の
 * 応答に引きずられる。軽減表タブの「自分のロールだけ」(UI-4) へ誘導する。
 *
 * ⚠ FFLogs 非依存なので Node runtime (他の非 FFLogs ページと揃える)。
 */
export const runtime = "nodejs";

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.mePage.title };
}

export default async function MePage() {
  const [{ profile, bis, onboarding }, m, locale] = await Promise.all([
    fetchMyDashboard(),
    getMessages(),
    getLocale(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-xl leading-tight text-foreground sm:text-2xl">
          {m.mePage.title}
        </h1>
        {/* 出席サマリーは既存の dialog をそのまま置く (可視範囲の判定を
            Server Action 1 箇所に集めておきたいので、ここで再実装しない)。 */}
        <span className="ml-auto">
          <AttendanceSummaryDialog />
        </span>
      </div>

      {/* L-9 (2026-09-09): 何のページで、ここで何ができるのかを最初に言う。
          実機報告「どのように使うのかも分かりにくい」への対応。節ごとの
          説明は各 section の見出し直下に置く (空のときは既存の空状態
          メッセージが同じ役目をするので出さない)。 */}
      <p className="px-1 text-[12px] leading-relaxed text-muted-foreground">
        {m.mePage.lead}
      </p>

      {/* ---- 自分の情報 ---- */}
      <section className="flex flex-col gap-2 rounded-md border border-border/40 bg-secondary/15 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <UserRound
            className="h-3 w-3 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
            {m.mePage.profileTitle}
          </span>
        </div>
        {profile.registered ? (
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[12px]">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{m.mePage.name}</dt>
              <dd className="text-foreground">{profile.displayName}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{m.mePage.role}</dt>
              <dd className="text-foreground">
                {profile.role
                  ? m.mePage.roleNames[profile.role]
                  : m.mePage.unset}
              </dd>
            </div>
            {/* L-8 (2026-09-08): ジョブも出す (ロールの導出元)。 */}
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{m.myJob.label}</dt>
              <dd className="text-foreground">
                {jobLabel(profile.job, locale) ?? m.myJob.unset}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{m.mePage.logName}</dt>
              <dd className="text-foreground">
                {profile.characterName ?? m.mePage.sameAsName}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-[12px] leading-snug text-muted-foreground">
            {m.mePage.notRegistered}
          </p>
        )}
        {/* L-8 (2026-09-08): ジョブは**本人が**ここで設定できる。ロールは
            ジョブから決まるので、選ばせるのはジョブだけ。 */}
        <MyJobPicker job={profile.job} registered={profile.registered} />
        <p className="text-[11px] leading-snug text-muted-foreground/85">
          {m.myJob.hint}
        </p>
      </section>

      {/* ---- 残り BiS ---- */}
      <section className="flex flex-col gap-2 rounded-md border border-border/40 bg-secondary/15 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Sword className="h-3 w-3 shrink-0 text-amber-300/80" aria-hidden />
          <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
            {m.mePage.bisTitle}
          </span>
        </div>
        {bis.length === 0 ? (
          <p className="text-[12px] leading-snug text-muted-foreground">
            {m.mePage.bisEmpty}
          </p>
        ) : (
          <>
          <p className="text-[11px] leading-snug text-muted-foreground/85">
            {m.mePage.bisLead}
          </p>
          <ul className="flex flex-col gap-1.5">
            {bis.map((b) => (
              <li key={`${b.categorySlug}:${b.label}`} className="flex flex-col gap-0.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Link
                    href={`/category/${b.categorySlug}/strategy`}
                    prefetch={false}
                    className="text-[12px] text-foreground transition-colors hover:text-[var(--neon-cyan)]"
                  >
                    {b.categoryName}
                  </Link>
                  {b.job && (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {b.job}
                    </span>
                  )}
                  <span className="font-mono text-[11px] tabular-nums text-foreground/85">
                    {b.obtained}/{b.total}
                  </span>
                </div>
                {b.remaining.length > 0 && (
                  <span className="text-[11px] leading-snug text-muted-foreground/85">
                    {m.mePage.bisRemaining(
                      b.remaining.map((s) => bisSlotLabel(s, locale)).join(" / "),
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
          </>
        )}
      </section>

      {/* ---- 学習パス ---- */}
      <section className="flex flex-col gap-2 rounded-md border border-border/40 bg-secondary/15 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <GraduationCap
            className="h-3 w-3 shrink-0 text-emerald-300/80"
            aria-hidden
          />
          <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
            {m.mePage.onboardingTitle}
          </span>
        </div>
        {onboarding.length === 0 ? (
          <p className="text-[12px] leading-snug text-muted-foreground">
            {m.mePage.onboardingEmpty}
          </p>
        ) : (
          <>
          <p className="text-[11px] leading-snug text-muted-foreground/85">
            {m.mePage.onboardingLead}
          </p>
          <ul className="flex flex-col gap-1">
            {onboarding.map((o) => (
              <li key={o.categorySlug} className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  href={`/category/${o.categorySlug}/strategy`}
                  prefetch={false}
                  className="min-w-0 flex-1 truncate text-[12px] text-foreground transition-colors hover:text-[var(--neon-cyan)]"
                >
                  {o.categoryName}
                </Link>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {o.done}/{o.total}
                </span>
                {o.next && (
                  <span className="text-[11px] text-muted-foreground/85">
                    {m.mePage.onboardingNext(m.onboardingPath.steps[o.next])}
                  </span>
                )}
              </li>
            ))}
          </ul>
          </>
        )}
      </section>

      {/* ---- 軽減表への誘導 (担当はシートが正なのでここには出さない) ---- */}
      <p className="flex items-center gap-1.5 px-1 text-[11px] leading-snug text-muted-foreground/85">
        <Shield className="h-3 w-3 shrink-0" aria-hidden />
        {m.mePage.mitigationHint}
      </p>
    </div>
  );
}
