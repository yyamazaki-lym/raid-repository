import { Suspense } from "react";
import { ScheduleOnboarding } from "@/components/portal/schedule-onboarding";
import { SchedulePageBody } from "@/components/portal/schedule-page-body";
import { fetchJapaneseHolidays } from "@/lib/japanese-holidays";
import {
  fetchSchedule,
  pickNextDecision,
  type NextSessionResult,
} from "@/lib/schedule/next-session";
import { getScheduleSourceUrl } from "@/lib/schedule/source-url";
import { SCHEDULE_TOP_TEXT_OVERRIDE_KEY } from "@/lib/schedule-top-text-keys";
import { fetchSessionLogsByDate } from "@/lib/server/fflogs";
import { fetchScheduleMemosByDateBulk } from "@/lib/server/schedule-memos-fetch";
import { buildSessionVideoLinkMap } from "@/lib/server/session-video-link";
import { fetchAppSettings } from "@/lib/supabase/app-settings";
import { fetchCategories } from "@/lib/supabase/categories";
import { fetchRecruitmentTemplatesServer } from "@/lib/supabase/recruitment-templates";
import { getAuthorizedUserRoles } from "@/lib/server/auth";
import { filterVisibleCategories } from "@/lib/category-visibility";

export const metadata = {
  title: "スケジュール",
};

/**
 * 1.9 (2026-04-28) TODO #11: Edge Runtime 化でコールドスタートを短縮。
 *
 * Vercel Free tier では Node.js Function に 500ms〜1.5s のコールド
 * スタートペナルティがあるが、Edge Function は ~50ms。リロード時の
 * 「引っ掛かり」体感の主要因なのでまず Edge を試す。
 *
 * 互換性チェック済み:
 *   - `@supabase/ssr` server client: Edge 公式対応
 *   - `next/headers` cookies(): Edge 対応
 *   - 外部 fetch (character-sheets / fflogs / 祝日 API): Edge 対応
 *   - `Buffer.from(...).toString("base64")` を `btoa()` に置換済み
 *     (`fflogs-oauth.ts` の OAuth Basic 認証ヘッダー)
 *
 * 別ルート (/api/auth/fflogs/callback など) は Node Runtime 維持。
 * runtime config は per-route なので独立に運用できる。
 */
export const runtime = "edge";

/**
 * 2.1 (2026-05-01) TODO #55 part2 — Suspense streaming で FCP 改善。
 *
 * 旧 (1.9 (2026-04-28) 初期): 主データロードを `<Suspense fallback={skeleton}>`
 * でラップしていたが、「skeleton → 実コンテンツ swap」体感が悪く synchronous
 * に戻していた経緯あり (詳細は git log)。
 *
 * 今回は `fallback={null}` で復活: skeleton を出さず空白のまま実コンテンツを
 * 流すので過去経緯の swap 違和感は発生しない。`(portal)/layout.tsx` の
 * SiteHeader / MainTabs が data 完了直後に flush されて FCP を計上するため、
 * page 側の重い `Promise.all` を Suspense 境界の向こう側に追い出すだけで
 * 効果が出る。h1 は SchedulePageBody 内で既に描画されているので shell には
 * 重複させない。
 */
export default function SchedulePage() {
  return (
    <Suspense fallback={null}>
      <ScheduleContent />
    </Suspense>
  );
}

async function ScheduleContent() {
  const url = await getScheduleSourceUrl();

  // No URL yet — render an onboarding card that lets the user register
  // one inline (same shape as the settings dialog body, but not behind
  // a gear).
  if (!url) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-xl text-foreground sm:text-2xl">
          Schedule
        </h1>
        <ScheduleOnboarding />
      </div>
    );
  }

  const [
    result,
    holidays,
    recruitmentTemplates,
    categoriesResult,
    userRoles,
    sessionLogsByDate,
    appSettings,
    initialMemosByDate,
  ] = await Promise.all([
    fetchSchedule(),
    fetchJapaneseHolidays(),
    fetchRecruitmentTemplatesServer(),
    fetchCategories(),
    getAuthorizedUserRoles(),
    fetchSessionLogsByDate(),
    fetchAppSettings([SCHEDULE_TOP_TEXT_OVERRIDE_KEY]),
    fetchScheduleMemosByDateBulk(),
  ]);
  const topTextOverride = appSettings[SCHEDULE_TOP_TEXT_OVERRIDE_KEY] ?? null;
  const visibleCategories = categoriesResult.ok
    ? filterVisibleCategories(categoriesResult.categories, userRoles)
    : [];
  const recruitmentCategoryOptions = visibleCategories.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
  }));
  const hasUltimateClear = visibleCategories.some(
    (c) => c.name.startsWith("絶") && c.status === "クリア済",
  );
  const sessionVideoLinks = result.ok
    ? await buildSessionVideoLinkMap(result.data.sessions)
    : {};
  const nextResult: NextSessionResult = result.ok
    ? { ok: true, session: pickNextDecision(result.data.sessions) }
    : { ok: false, reason: result.reason };

  return (
    <SchedulePageBody
      result={result}
      nextResult={nextResult}
      scheduleUrl={url}
      holidays={holidays}
      recruitmentTemplates={recruitmentTemplates}
      recruitmentCategories={recruitmentCategoryOptions}
      sessionVideoLinks={sessionVideoLinks}
      sessionLogsByDate={sessionLogsByDate}
      hasUltimateClear={hasUltimateClear}
      topTextOverride={topTextOverride}
      initialMemosByDate={initialMemosByDate}
    />
  );
}
