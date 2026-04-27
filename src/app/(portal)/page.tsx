import { ScheduleOnboarding } from "@/components/portal/schedule-onboarding";
import { SchedulePageBody } from "@/components/portal/schedule-page-body";
import { fetchJapaneseHolidays } from "@/lib/japanese-holidays";
import {
  fetchSchedule,
  pickNextDecision,
  type NextSessionResult,
} from "@/lib/schedule/next-session";
import { getScheduleSourceUrl } from "@/lib/schedule/source-url";
import { fetchSessionLogsByDate } from "@/lib/server/fflogs";
import { buildSessionVideoLinkMap } from "@/lib/server/session-video-link";
import { fetchCategories } from "@/lib/supabase/categories";
import { fetchRecruitmentTemplatesServer } from "@/lib/supabase/recruitment-templates";

export const metadata = {
  title: "スケジュール",
};

export default async function SchedulePage() {
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
    sessionLogsByDate,
  ] = await Promise.all([
    fetchSchedule(),
    fetchJapaneseHolidays(),
    fetchRecruitmentTemplatesServer(),
    fetchCategories(),
    fetchSessionLogsByDate(),
  ]);
  // Slim category list passed to the recruitment dialog's category
  // picker. Only id+name are needed there.
  const recruitmentCategoryOptions = categoriesResult.ok
    ? categoriesResult.categories.map((c) => ({ id: c.id, name: c.name }))
    : [];
  // Build the date-→-video map from the actual session list so the
  // 36h window matching can pick the right video for each session
  // (vs. the older naive "same JST day" approach which missed videos
  // uploaded the morning after a late-night session).
  const sessionVideoLinks = result.ok
    ? await buildSessionVideoLinkMap(result.data.sessions)
    : {};
  const nextResult: NextSessionResult = result.ok
    ? { ok: true, session: pickNextDecision(result.data.sessions) }
    : { ok: false, reason: result.reason };

  // Past-visibility state lives client-side now so we can offer a
  // hover-peek + click-to-pin UX. The header buttons + the list are
  // wrapped together in a Client Component that owns that state.
  // Holidays travel as a plain object (date → name) so the date-column
  // tooltip can show e.g. "建国記念の日" instead of just "祝日".
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
    />
  );
}
