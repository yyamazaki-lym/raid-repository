import { notFound } from "next/navigation";
import { findCategoryBySlug } from "@/lib/supabase/categories";
import { getCurrentUserCanEdit } from "@/lib/server/auth";
import {
  fetchCategoryFights,
  fetchFailedReportSyncs,
  fetchReportVideoLinks,
} from "@/lib/supabase/fflogs-fights";
import { resolveProgressModel } from "@/lib/content-model";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { localizeWipeAbilities } from "@/lib/server/wipe-ability-names";
import { LogsView } from "./logs-view";

/**
 * 練習ログタブ (TODO #94 / A-1 + A-2)。
 *
 * FFLogs に溜まっている pull 単位のデータを「読み物」に変える場所。
 * データ取得自体は日次 cron (`/api/cron/fflogs-sync`) で materialize 済み
 * なので、このページは DB を読むだけ (**FFLogs API は叩かない** = 速い)。
 *
 * ⚠ 例外が 1 つある: L-7 (2026-09-08) でワイプ原因の技名を表示言語に
 * 揃えるため、**保存に足りない言語の名前だけ** XIVAPI (ゲームデータの
 * 公開ダンプ) に引きに行く。上限 100 ID / 締切 2.5 秒 / プロセス内 7 日
 * キャッシュで、失敗しても元の名前で描画は続く
 * (`server/wipe-ability-names.ts`)。FFLogs は今も叩かない。
 */
export const runtime = "nodejs";

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.logs.title };
}

export default async function LogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  // UI-5 (2026-09-08): 区間の絞り込みを URL に載せる (`?floor=4b` /
  // `?phase=2`)。Next 16 では params / searchParams はどちらも Promise なので
  // await して読む。値の検証は client 側 (`logs-filter-url.ts`) — 実在する
  // 層 / フェーズの一覧が明細から決まるので、そこでしか照合できない。
  searchParams: Promise<{ floor?: string | string[]; phase?: string | string[] }>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  // `?floor=a&floor=b` のように複数回書かれたら先頭だけ見る。
  const firstParam = (v: string | string[] | undefined): string | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
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

  // W-33 ① (2026-09-07): カテゴリの明示指定を優先し、'auto' のときだけ
  // 名前から推測する。8.0 の新難易度は名称未発表なので、名前の辞書に
  // 頼りきらず人が指定できる経路を残す。
  const ultimate =
    resolveProgressModel(category.progressModel, category.name) === "phases";
  // フェーズ滞在時間の全件集計は **明細と同じ行から** 出す (2026-09-09)。
  // ⚠ 以前は `fetchCategoryPhaseTotals` を並列に呼んでいたが、あちらは同じ
  // category_id / 同じ並び / 同じページングで `fflogs_fights` をもう一度
  // フルスキャンしていた (集計が使う列は明細側の列に完全に含まれる)。
  // 実機の絶竜詩 1047 pull で 4 クエリ / 約 2,100 行の転送になっていた。
  const {
    fights,
    totalPulls,
    totalClears,
    truncated,
    phaseTotals: phaseTotalsAll,
  } = await fetchCategoryFights(category.id, {
    // フェーズ滞在区間は絶 (フェーズ管理コンテンツ) だけ表示に使う。
    includePhases: ultimate,
    includePhaseTotals: ultimate,
    ultimate,
  });
  const codes = Array.from(new Set(fights.map((f) => f.reportCode)));
  const [videoLinks, failedSyncs] = await Promise.all([
    fetchReportVideoLinks(codes),
    fetchFailedReportSyncs(category.id),
    // L-7: 同期より前に取り込んだ pull は技名がクライアント言語のままなので、
    // 足りているものは触らず、欠けている ID だけ表示言語で埋める (in place)。
    localizeWipeAbilities(
      fights.map((f) => f.wipe),
      await getLocale(),
    ),
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
      progressModel={category.progressModel}
      difficultyLabel={category.difficultyLabel}
      initialFloorParam={firstParam(sp.floor)}
      initialPhaseParam={firstParam(sp.phase)}
      phaseTotalsAll={phaseTotalsAll}
      videoLinks={videoLinks}
      failedSyncs={failedSyncs}
      canEdit={canEdit}
    />
  );
}
