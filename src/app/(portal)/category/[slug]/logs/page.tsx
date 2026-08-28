import { notFound } from "next/navigation";
import { findCategoryBySlug } from "@/lib/supabase/categories";
import { getCurrentUserCanEdit } from "@/lib/server/auth";
import {
  fetchCategoryFights,
  fetchFailedReportSyncs,
  fetchReportVideoLinks,
} from "@/lib/supabase/fflogs-fights";
import { LogsView } from "./logs-view";

/**
 * 練習ログタブ (TODO #94 / A-1 + A-2)。
 *
 * FFLogs に溜まっている pull 単位のデータを「読み物」に変える場所。
 * データ取得自体は日次 cron (`/api/cron/fflogs-sync`) で materialize 済み
 * なので、このページは DB を読むだけ (FFLogs API は叩かない = 速い)。
 */
export const runtime = "nodejs";

export const metadata = {
  title: "練習ログ",
};

export default async function LogsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [category, canEdit] = await Promise.all([
    findCategoryBySlug(slug),
    getCurrentUserCanEdit(),
  ]);

  if (!category) {
    return (
      <p className="text-muted-foreground p-6 text-center text-sm">
        コンテンツが見つかりませんでした。
      </p>
    );
  }

  // 監査 P3-m: enabled=false のタブはナビから除外されるが直 URL では描画される。
  if (category.tabConfig?.["logs"]?.enabled === false) notFound();

  const fights = await fetchCategoryFights(category.id);
  const codes = Array.from(new Set(fights.map((f) => f.reportCode)));
  const [videoLinks, failedSyncs] = await Promise.all([
    fetchReportVideoLinks(codes),
    fetchFailedReportSyncs(category.id),
  ]);

  return (
    <LogsView
      categoryName={category.name}
      fights={fights}
      videoLinks={videoLinks}
      failedSyncs={failedSyncs}
      canEdit={canEdit}
    />
  );
}
