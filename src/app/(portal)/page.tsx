import { redirect } from "next/navigation";
import { ScheduleDisabledNotice } from "@/components/portal/schedule-disabled-notice";
import { ScheduleOnboarding } from "@/components/portal/schedule-onboarding";
import { SchedulePageBody } from "@/components/portal/schedule-page-body";
import { fetchJapaneseHolidays } from "@/lib/japanese-holidays";
import { fetchNativeSchedule } from "@/lib/schedule/native-fetch";
import {
  fetchSchedule,
  pickNextDecision,
  type NextSessionResult,
} from "@/lib/schedule/next-session";
import { getScheduleSourceMode } from "@/lib/schedule/source-mode";
import { getScheduleSourceUrl } from "@/lib/schedule/source-url";
import { SCHEDULE_TOP_TEXT_OVERRIDE_KEY } from "@/lib/schedule-top-text-keys";
import {
  fetchSessionLogsByDate,
  fetchNativeSessionLogsByDate,
} from "@/lib/server/fflogs";
import {
  ensureNativeMonthlyPlaceholders,
  NATIVE_DEFAULT_END_TIME_KEY,
  NATIVE_DEFAULT_START_TIME_KEY,
} from "@/lib/server/native-schedule-placeholders";
import { fetchScheduleMemosByDateBulk } from "@/lib/server/schedule-memos-fetch";
import { buildSessionVideoLinkMap } from "@/lib/server/session-video-link";
import { fetchPortalSettings } from "@/lib/supabase/app-settings";
import { jstTodayStartMs } from "@/lib/schedule/jst-cutoff";
import { fetchCategories } from "@/lib/supabase/categories";
import { fetchRecruitmentTemplatesServer } from "@/lib/supabase/recruitment-templates";
import {
  getAuthorizedUserRoles,
  requireDiscordMember,
  userIsAdmin,
} from "@/lib/server/auth";
import { filterVisibleCategories } from "@/lib/category-visibility";
import { getMessages } from "@/lib/i18n/server";

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.nav.schedule };
}

/**
 * 2.9 (2026-06-11): Edge → Node runtime 化。経緯と判断根拠は
 * `(portal)/layout.tsx` の runtime コメントを参照 (cold start 対策。旧
 * Edge 維持の根拠だった「FFLogs scrape は Edge IP 必須」は cron の Node
 * scrape 成功実績で崩れた)。
 *
 * 描画パスの FFLogs 処理 `fetchSessionLogsByDate()` は Supabase SELECT
 * のみで外部 scrape を含まないため、runtime 変更の影響を受けない。
 */
export const runtime = "nodejs";

/**
 * 2.1 (2026-05-01) TODO #55 part2 — Suspense streaming で FCP 改善。
 * `(portal)/layout.tsx` の SiteHeader / MainTabs が data 完了直後に flush
 * されて FCP を計上するため、page 側の重い `Promise.all` を Suspense 境界
 * の向こう側に追い出す構成。h1 は SchedulePageBody 内で描画されるので
 * shell には重複させない。
 *
 * 2.9 (2026-06-11): その Suspense 境界を page 内の `<Suspense>` から
 * `(portal)/loading.tsx` (同じ遅延 fade-in "Now Loading" fallback) に移設。
 * loading.tsx は prefetch に含まれるため、タブ遷移で TOP に戻る時もサーバー
 * の RSC 応答を待たずに即 fallback が出る (旧構成は応答到着まで無反応 =
 * cold start 時の「無音 stuck」)。page 内に `<Suspense>` を残すと client
 * 遷移時に「loading.tsx fallback → page shell 到着で fallback 再マウント
 * (遅延 500ms ぶん一時消灯)」のチラつきが出るため、境界は loading.tsx の
 * 1 枚に集約する。
 */
export default async function SchedulePage() {
  // TODO #2 phase 1 (2026-05-07): スケジュールソースモードで分岐。
  // - sync     → 既存の character-sheets fetch + parse path
  // - native   → 自前テーブル fetch (phase 1 では空 skeleton)
  // - disabled → 機能停止 notice のみ
  const mode = await getScheduleSourceMode();

  if (mode === "disabled") {
    // TODO #79: スケジュール機能 OFF の portal ではコンテンツページを実質の
    // ホームにする。非 admin は `/category` に server redirect、admin だけは
    // 従来通り disabled notice を見せ、SiteHeader の設定 dialog 経由で
    // sync/native に戻せる導線を残す。
    const userRoles = await getAuthorizedUserRoles();
    if (!userIsAdmin(userRoles)) {
      redirect("/category");
    }
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-xl text-foreground sm:text-2xl">
          Schedule
        </h1>
        <ScheduleDisabledNotice />
      </div>
    );
  }

  if (mode === "sync") {
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

    // 2.9 (2026-06-11): buildSessionVideoLinkMap は fetchSchedule の結果に
    // しか依存しないので、Promise.all 完了後の直列 await (= 最遅 fetch を
    // 待ってからさらに Supabase SELECT) ではなく fetchSchedule にチェーン
    // して他の fetch と並走させる。
    const schedulePromise = fetchSchedule();
    const [
      result,
      holidays,
      recruitmentTemplates,
      categoriesResult,
      userRoles,
      sessionLogsByDate,
      appSettings,
      initialMemosByDate,
      sessionVideoLinks,
    ] = await Promise.all([
      schedulePromise,
      fetchJapaneseHolidays(),
      fetchRecruitmentTemplatesServer(),
      fetchCategories(),
      getAuthorizedUserRoles(),
      fetchSessionLogsByDate(),
      // A-2 (2026-07-12): mode / url / top_text は fetchPortalSettings() の
      // 一括 SELECT を共有 — このリクエストでは getScheduleSourceMode 解決時に
      // 取得済みなので実質キャッシュヒット。
      fetchPortalSettings(),
      fetchScheduleMemosByDateBulk(),
      schedulePromise.then((r) =>
        r.ok ? buildSessionVideoLinkMap(r.data.sessions) : {},
      ),
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
    const nextResult: NextSessionResult = result.ok
      ? { ok: true, session: pickNextDecision(result.data.sessions) }
      : { ok: false, reason: result.reason };

    return (
      <SchedulePageBody
        result={result}
        nextResult={nextResult}
        scheduleUrl={url}
        mode="sync"
        holidays={holidays}
        recruitmentTemplates={recruitmentTemplates}
        recruitmentCategories={recruitmentCategoryOptions}
        sessionVideoLinks={sessionVideoLinks}
        sessionLogsByDate={sessionLogsByDate}
        hasUltimateClear={hasUltimateClear}
        topTextOverride={topTextOverride}
        initialMemosByDate={initialMemosByDate}
        // 2.9 (2026-08-24): sync mode でも admin 判定を渡す。過去詳細表の
        // 「実施しなかった日を消す」ゴミ箱アイコンの表示判定に使う
        // (schedule-list の他の isAdmin 用途はすべて mode === "native"
        // ガード付きなので sync の挙動は変わらない)。
        isAdmin={userIsAdmin(userRoles)}
      />
    );
  }

  // mode === "native": phase 2-A 以降の native_schedule_* 取得 + 認証情報配線。
  // TODO #77 (2.1, 2026-05-12): UI を sync 同等のフラット表に統一したので、
  // sync 経路と同じく memos / topTextOverride も fetch して同等の体験にする。
  //
  // TODO #73 (2.5, 2026-06-10): FFLogs 連携 native 拡張。
  // `fetchNativeSessionLogsByDate()` で native 用 Logs map を取得し、sync と
  // 同じ shape (`rawDate → SessionLogEntry[]`) で SchedulePageBody に渡す。
  //
  // TODO #81 (2.1, 2026-05-12 part5): native では「Discord 通知のたびに候補日を
  // 都度追加」する運用が現実的に存在するため、当月分が 0 件のままだと「予定なし」
  // 表示になり日付一覧がそもそも視認できない。
  // 2026-07-12 監査 A-3: placeholder 敷設 (service role write) は日次 cron
  // (/api/cron/snapshot-schedule の native 分岐) へ移設し、GET 描画の通常経路を
  // 読み取り専用化 (SELECT 1 本 + 条件付き INSERT を毎リクエスト行っていた)。
  // ここでは「JST 今日以降の行が 1 件も無い」ときだけ従来どおり
  // ensureNativeMonthlyPlaceholders → 再 read で自己修復する (cron 未設定の
  // fork / 月初に cron が落ちた場合のフォールバック)。TODO #81 の
  // 「INSERT → read は順次必須 (並列だと初回 read が空配列になる race)」は
  // このフォールバック内の await 順で維持される。
  // 2.9 follow-up (2026-06-12) の「placeholder INSERT は requireDiscordMember()
  // の解決後にのみ走らせる」順序保証も Promise.all の待ち合わせで維持。
  const appSettingsPromise = fetchPortalSettings();
  const memberPromise = requireDiscordMember();
  const nativeResultPromise = Promise.all([
    appSettingsPromise,
    memberPromise,
  ]).then(async ([settings]) => {
    // 2.1 (2026-05-12): native_schedule_sessions.start_time / end_time が NULL の
    // row は default に追従させたいので、placeholder 敷設と read の両方に同じ
    // default を渡して COALESCE する。
    const defaults = {
      startTime: settings[NATIVE_DEFAULT_START_TIME_KEY],
      endTime: settings[NATIVE_DEFAULT_END_TIME_KEY],
    };
    let result = await fetchNativeSchedule(defaults);
    const hasUpcoming =
      result.ok &&
      result.data.sessions.some((s) => s.date.getTime() >= jstTodayStartMs());
    if (result.ok && !hasUpcoming) {
      // 稀経路 (未セットアップ / cron 欠落月) のみ書き込み → 再 read。
      // 全日 CANCELLED の月もここに入るが、ensure 側の既存日付 dedup が
      // CANCELLED 行も見るため重複投入はされず、追加 SELECT 1 本で済む。
      await ensureNativeMonthlyPlaceholders(defaults);
      result = await fetchNativeSchedule(defaults);
    }
    return result;
  });
  const [
    appSettings,
    holidays,
    recruitmentTemplates,
    categoriesResult,
    userRoles,
    member,
    initialMemosByDate,
    nativeSessionLogsByDate,
    nativeResult,
    sessionVideoLinks,
  ] = await Promise.all([
    appSettingsPromise,
    fetchJapaneseHolidays(),
    fetchRecruitmentTemplatesServer(),
    fetchCategories(),
    getAuthorizedUserRoles(),
    memberPromise,
    fetchScheduleMemosByDateBulk(),
    fetchNativeSessionLogsByDate(),
    nativeResultPromise,
    nativeResultPromise.then((r) =>
      r.ok ? buildSessionVideoLinkMap(r.data.sessions) : {},
    ),
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
  const nextResult: NextSessionResult = nativeResult.ok
    ? { ok: true, session: pickNextDecision(nativeResult.data.sessions) }
    : { ok: false, reason: nativeResult.reason };
  const isAdmin = userIsAdmin(userRoles);

  return (
    <SchedulePageBody
      result={nativeResult}
      nextResult={nextResult}
      scheduleUrl={null}
      mode="native"
      holidays={holidays}
      recruitmentTemplates={recruitmentTemplates}
      recruitmentCategories={recruitmentCategoryOptions}
      sessionVideoLinks={sessionVideoLinks}
      sessionLogsByDate={nativeSessionLogsByDate}
      hasUltimateClear={hasUltimateClear}
      topTextOverride={topTextOverride}
      initialMemosByDate={initialMemosByDate}
      currentDiscordId={member.discordId}
      isAdmin={isAdmin}
      nativeDefaultStartTime={appSettings[NATIVE_DEFAULT_START_TIME_KEY]}
      nativeDefaultEndTime={appSettings[NATIVE_DEFAULT_END_TIME_KEY]}
    />
  );
}
