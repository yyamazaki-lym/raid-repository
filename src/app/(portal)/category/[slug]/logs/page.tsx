import { notFound } from "next/navigation";
import { findCategoryBySlug } from "@/lib/supabase/categories";
import { getCurrentUserCanEdit } from "@/lib/server/auth";
import {
  fetchCategoryFights,
  fetchFailedReportSyncs,
  fetchReportVideoLinks,
  fetchCategoryPhaseTotals,
} from "@/lib/supabase/fflogs-fights";
import { isUltimateContent } from "@/lib/content-groups";
import { getMessages } from "@/lib/i18n/server";
import { LogsView } from "./logs-view";

/**
 * 練習ログタブ (TODO #94 / A-1 + A-2)。
 *
 * FFLogs に溜まっている pull 単位のデータを「読み物」に変える場所。
 * データ取得自体は日次 cron (`/api/cron/fflogs-sync`) で materialize 済み
 * なので、このページは DB を読むだけ (FFLogs API は叩かない = 速い)。
 */
export const runtime = "nodejs";

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.logs.title };
}

export default async function LogsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [category, canEdit, m] = await Promise.all([
    findCategoryBySlug(slug),
    getCurrentUserCanEdit(),
    getMessages(),
  ]);

  if (!category) {
    return (
      <p className="text-muted-foreground p-6 text-center text-sm">
        {m.logs.notFound}
      </p>
    );
  }

  // 監査 P3-m: enabled=false のタブはナビから除外されるが直 URL では描画される。
  if (category.tabConfig?.["logs"]?.enabled === false) notFound();

  const ultimate = isUltimateContent(category.name);
  // フェーズ滞在時間の全件集計 (2026-09-07) は明細と独立なので並列に取る。
  const [{ fights, totalPulls, totalClears, truncated }, phaseTotalsAll] =
    await Promise.all([
      fetchCategoryFights(category.id, {
        // フェーズ滞在区間は絶 (フェーズ管理コンテンツ) だけ表示に使う。
        includePhases: ultimate,
        ultimate,
      }),
      ultimate ? fetchCategoryPhaseTotals(category.id) : Promise.resolve(null),
    ]);
  const codes = Array.from(new Set(fights.map((f) => f.reportCode)));
  const [videoLinks, failedSyncs] = await Promise.all([
    fetchReportVideoLinks(codes),
    fetchFailedReportSyncs(category.id),
  ]);

  return (
    <LogsView
      categoryId={category.id}
      minDifficulty={category.fflogsMinDifficulty}
      categoryName={category.name}
      fights={fights}
      totalPulls={totalPulls}
      totalClears={totalClears}
      truncated={truncated}
      phaseTotalsAll={phaseTotalsAll}
      videoLinks={videoLinks}
      failedSyncs={failedSyncs}
      canEdit={canEdit}
    />
  );
}
