import Link from "next/link";
import { GraduationCap, Shield, Sword, UserRound } from "lucide-react";
import { fetchMyDashboard } from "@/lib/server/me-page";
import { AttendanceSummaryDialog } from "@/components/portal/schedule/attendance-summary-dialog";
import { bisSlotLabel } from "@/lib/bis-slots";
import { getMessages } from "@/lib/i18n/server";
import { getLocale } from "@/lib/i18n/server";
import { MyJobScopes } from "@/components/portal/my-job-scopes";
import { jobLabel } from "@/lib/jobs";
import { Card } from "@/components/ui/card";

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
  const [{ profile, bis, onboarding, categories }, m, locale] = await Promise.all([
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
      <SectionCard
        icon={<UserRound className="h-3 w-3 shrink-0" aria-hidden />}
        accent="bg-[var(--neon-cyan)]/70"
        label={m.mePage.profileTitle}
        right={
          profile.registered ? (
            <span className="truncate font-display text-[12px] text-foreground/90">
              {profile.displayName}
            </span>
          ) : null
        }
      >
        {profile.registered ? (
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[12px]">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{m.mePage.name}</dt>
              <dd className="text-foreground">{profile.displayName}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{m.mePage.role}</dt>
              <dd className="text-foreground">
                {profile.roles.length > 0
                  ? profile.roles.map((r) => m.mePage.roleNames[r]).join(" / ")
                  : m.mePage.unset}
              </dd>
            </div>
            {/* L-8 (2026-09-08): ジョブも出す (ロールの導出元)。
                L-10 (2026-09-09): 既定が複数になり得るので並べる。 */}
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{m.myJob.label}</dt>
              <dd className="text-foreground">
                {profile.jobs.defaults.length > 0
                  ? profile.jobs.defaults
                      .map((j) => jobLabel(j, locale) ?? j)
                      .join(" / ")
                  : m.myJob.unset}
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
            ジョブから決まるので、選ばせるのはジョブだけ。
            L-10 (2026-09-09): 既定の複数指定と、コンテンツごとの上書きを
            まとめて出すのはこのページだけ (軽減表タブ側は今開いている
            コンテンツ 1 つしか出さない)。 */}
        <MyJobScopes
          defaults={profile.jobs.defaults}
          byCategory={profile.jobs.byCategory}
          categories={categories}
          registered={profile.registered}
        />
        <p className="text-[11px] leading-snug text-muted-foreground/85">
          {m.myJob.hint}
        </p>
      </SectionCard>

      {/* ---- 残り BiS ---- */}
      <SectionCard
        icon={<Sword className="h-3 w-3 shrink-0 text-amber-300/80" aria-hidden />}
        accent="bg-amber-300/70"
        label={m.mePage.bisTitle}
        right={
          bis.length > 0 ? (
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/80">
              {bis.reduce((n, b) => n + b.obtained, 0)}/
              {bis.reduce((n, b) => n + b.total, 0)}
            </span>
          ) : null
        }
      >
        {bis.length === 0 ? (
          <p className="text-[12px] leading-snug text-muted-foreground">
            {m.mePage.bisEmpty}
          </p>
        ) : (
          <>
          <p className="text-[11px] leading-snug text-muted-foreground/85">
            {m.mePage.bisLead}
          </p>
          <ul className="flex flex-col gap-2">
            {bis.map((b) => (
              <li
                key={`${b.categorySlug}:${b.label}`}
                className="flex flex-col gap-1 rounded-md border border-border/40 bg-secondary/15 px-2.5 py-2 transition-colors hover:border-amber-300/40"
              >
                <div className="flex items-baseline gap-2">
                  <Link
                    href={`/category/${b.categorySlug}/strategy`}
                    prefetch={false}
                    className="min-w-0 flex-1 truncate text-[12px] text-foreground transition-colors hover:text-[var(--neon-cyan)]"
                  >
                    {b.categoryName}
                  </Link>
                  {b.job && (
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {b.job}
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-foreground/85">
                    {b.obtained}/{b.total}
                  </span>
                </div>
                <MeterBar
                  done={b.obtained}
                  total={b.total}
                  tone="bg-amber-300/80"
                />
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
      </SectionCard>

      {/* ---- 学習パス ---- */}
      <SectionCard
        icon={
          <GraduationCap
            className="h-3 w-3 shrink-0 text-emerald-300/80"
            aria-hidden
          />
        }
        accent="bg-emerald-300/70"
        label={m.mePage.onboardingTitle}
        right={
          onboarding.length > 0 ? (
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/80">
              {onboarding.reduce((n, o) => n + o.done, 0)}/
              {onboarding.reduce((n, o) => n + o.total, 0)}
            </span>
          ) : null
        }
      >
        {onboarding.length === 0 ? (
          <p className="text-[12px] leading-snug text-muted-foreground">
            {m.mePage.onboardingEmpty}
          </p>
        ) : (
          <>
          <p className="text-[11px] leading-snug text-muted-foreground/85">
            {m.mePage.onboardingLead}
          </p>
          <ul className="flex flex-col gap-2">
            {onboarding.map((o) => (
              <li
                key={o.categorySlug}
                className="flex flex-col gap-1 rounded-md border border-border/40 bg-secondary/15 px-2.5 py-2 transition-colors hover:border-emerald-300/40"
              >
                <div className="flex items-baseline gap-2">
                  <Link
                    href={`/category/${o.categorySlug}/strategy`}
                    prefetch={false}
                    className="min-w-0 flex-1 truncate text-[12px] text-foreground transition-colors hover:text-[var(--neon-cyan)]"
                  >
                    {o.categoryName}
                  </Link>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {o.done}/{o.total}
                  </span>
                </div>
                <MeterBar
                  done={o.done}
                  total={o.total}
                  tone="bg-emerald-300/80"
                />
                {o.next && (
                  <span className="text-[11px] leading-snug text-muted-foreground/85">
                    {m.mePage.onboardingNext(m.onboardingPath.steps[o.next])}
                  </span>
                )}
              </li>
            ))}
          </ul>
          </>
        )}
      </SectionCard>

      {/* ---- 軽減表への誘導 (担当はシートが正なのでここには出さない) ---- */}
      <p className="flex items-center gap-1.5 px-1 text-[11px] leading-snug text-muted-foreground/85">
        <Shield className="h-3 w-3 shrink-0" aria-hidden />
        {m.mePage.mitigationHint}
      </p>
    </div>
  );
}

/**
 * 節の器 (L-22、2026-09-09 実機報告「マイページはもう少しスタイリッシュな
 * 感じに出来るか」)。
 *
 * ⚠ **新しい見た目を発明しない。** 予定表の「PAST」カードや攻略の
 * セクションと**同じ形**にする (`glass` + 上辺の帯 + モノスペースの見出し
 * + 左の色ドット)。ここだけ独自の意匠にすると、ページを移った時に別の
 * アプリに見える。
 */
function SectionCard({
  icon,
  accent,
  label,
  right,
  children,
}: {
  icon: React.ReactNode;
  /** 見出し左のドットの色 (節ごとに変える)。 */
  accent: string;
  label: string;
  /** 見出し右の要約 (合計など)。無ければ null。 */
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="glass neon-edge overflow-hidden p-0">
      <header className="flex items-center justify-between gap-2 border-b border-border/40 bg-secondary/20 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 font-mono text-[11px] tracking-[0.22em] text-muted-foreground uppercase">
          <span
            className={"inline-flex h-1.5 w-1.5 shrink-0 rounded-full " + accent}
            aria-hidden
          />
          {icon}
          <span className="truncate">{label}</span>
        </div>
        {right}
      </header>
      <div className="flex flex-col gap-2 px-3 py-2.5">{children}</div>
    </Card>
  );
}

/**
 * 進捗のバー。数字 (`8/11`) だけだと「あとどれくらいか」が一目で入って
 * こないので、同じ値を長さでも出す。
 *
 * ⚠ **色だけで意味を持たせない** (`memo-severity.ts` と同じ方針)。数字は
 * 必ず隣に出ているので、ここは `aria-hidden` の装飾に徹する。
 * ⚠ total が 0 のときは 0% (割り算しない)。
 */
function MeterBar({
  done,
  total,
  tone,
}: {
  done: number;
  total: number;
  tone: string;
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <span
      className="flex h-1 w-full overflow-hidden rounded-full bg-secondary/50"
      aria-hidden
    >
      <span
        className={"h-full rounded-full " + tone}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}
