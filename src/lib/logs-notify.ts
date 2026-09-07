/**
 * 練習ログのイベント検出と通知設定 (W-35)。2026-09-07。
 *
 * 同期のたびに「何が起きたか」を判定して Discord に流す。portal を見に
 * 来る動機を作るのが目的 (調査ノート第 4 回 W-35)。
 *
 * ## 種類を 3 つに絞った理由
 *
 * 調査ノートは「新レポート到着 / ベスト到達更新 / 初クリア / 軽減表・
 * マクロ更新」の 4 つを挙げているが、ここで実装するのは**同期で検出できる
 * 3 つ**だけにした:
 *
 *   - 軽減表は **Google Sheets が正** (portal はデータを持たない) ので、
 *     更新を検出する手段がそもそも無い。
 *   - マクロは portal 側のデータだが、更新頻度が低い一方で保存経路すべてに
 *     フックを入れる必要があり、費用対効果が釣り合わない。
 *
 * 通知は **すべて既定 OFF**。通知過多が調査ノートのデメリット欄そのもの
 * なので、必要なものだけ管理者が ON にする形にする。
 *
 * 検証: `node scripts/check-logs-notify.mjs`
 */

/** 通知の種類。`app_settings` のキーと 1:1。 */
export const LOGS_NOTIFY_KINDS = [
  /** 新しいレポートを取り込んだ。 */
  "newReport",
  /** 到達度のベストが更新された (より深いフェーズ / より低い残 HP%)。 */
  "bestUpdate",
  /** 初討伐。 */
  "firstClear",
] as const;
export type LogsNotifyKind = (typeof LOGS_NOTIFY_KINDS)[number];

export function isLogsNotifyKind(v: unknown): v is LogsNotifyKind {
  return (
    typeof v === "string" && (LOGS_NOTIFY_KINDS as readonly string[]).includes(v)
  );
}

/**
 * `app_settings` のキー。既存の native スケジュール通知と同じ命名で並べる。
 * 値は `"true"` / `"false"` で、**未設定は false (OFF)**。
 */
export function logsNotifyKey(kind: LogsNotifyKind): string {
  return `logs_notify_${kind === "newReport" ? "new_report" : kind === "bestUpdate" ? "best_update" : "first_clear"}`;
}

/** 未設定 / 不正値は OFF に倒す (通知は「明示的に ON」だけで飛ばす)。 */
export function parseLogsNotifyEnabled(raw: string | null | undefined): boolean {
  return (raw ?? "").trim() === "true";
}

/**
 * カテゴリの到達度スナップショット。同期の前後で比較してイベントを出す。
 *
 * `bestPercentage` は **小さいほど深い** (残 HP%)。`null` は未取得。
 */
export type LogsSnapshot = {
  /** 到達した最深フェーズ (層モデルのコンテンツでは最深 encounter の層番号)。 */
  bestPhase: number | null;
  /** その最深フェーズでの最小残 HP%。 */
  bestPercentage: number | null;
  /** 討伐があるか。 */
  hasClear: boolean;
};

export type LogsEvent =
  | { kind: "newReport"; reports: number }
  | {
      kind: "bestUpdate";
      /** 更新後の到達度。 */
      phase: number | null;
      percentage: number | null;
      /** フェーズ自体が進んだか (残 HP% だけの更新と区別する)。 */
      phaseAdvanced: boolean;
    }
  | { kind: "firstClear" };

/**
 * 前後のスナップショットからイベントを出す (純関数)。
 *
 * 判定の順序は firstClear → bestUpdate → newReport で、UI / 通知文では
 * この順に並べる (初討伐が一番大きいニュース)。
 *
 * ベスト更新の判定:
 *   - フェーズが進んだ → 更新 (残 HP% は比較しない。新しいフェーズの削りは
 *     必ず 100% から始まるので、前フェーズの残 HP% と比べると必ず「後退」に
 *     見えてしまう)
 *   - フェーズが同じ → 残 HP% が下がったときだけ更新
 *   - フェーズが下がった → 更新ではない (その日の調子が悪かっただけ)
 *
 * `prev` が null (初回同期) のときは **ベスト更新を出さない** — 初めて
 * 取り込んだ全ログが「更新」として一斉に飛ぶのを避ける。
 */
export function detectLogsEvents(
  prev: LogsSnapshot | null,
  next: LogsSnapshot,
  newReports: number,
): LogsEvent[] {
  const out: LogsEvent[] = [];

  if (next.hasClear && !(prev?.hasClear ?? false)) {
    out.push({ kind: "firstClear" });
  }

  if (prev !== null) {
    const phaseAdvanced =
      next.bestPhase !== null &&
      (prev.bestPhase === null || next.bestPhase > prev.bestPhase);
    const samePhase =
      next.bestPhase !== null && next.bestPhase === prev.bestPhase;
    const pctImproved =
      samePhase &&
      next.bestPercentage !== null &&
      (prev.bestPercentage === null || next.bestPercentage < prev.bestPercentage);
    if (phaseAdvanced || pctImproved) {
      out.push({
        kind: "bestUpdate",
        phase: next.bestPhase,
        percentage: next.bestPercentage,
        phaseAdvanced,
      });
    }
  }

  if (newReports > 0) {
    out.push({ kind: "newReport", reports: newReports });
  }
  return out;
}

/**
 * 通知本文を組む (純関数)。
 *
 * `<t:unix:R>` などの Discord 記法は使わない — 練習ログのイベントは「いつ」
 * より「何が」が主題で、相対時刻を付けると読み手が時刻に目を取られる。
 * リンクは呼び出し側が組んだ URL をそのまま埋める。
 */
export function formatLogsNotifyMessage(input: {
  categoryName: string;
  events: ReadonlyArray<LogsEvent>;
  /** 練習ログへの絶対 URL (空なら省略)。 */
  url?: string | null;
}): string {
  const lines: string[] = [];
  for (const e of input.events) {
    if (e.kind === "firstClear") {
      lines.push(`🏆 **${input.categoryName}** を初討伐しました!`);
    } else if (e.kind === "bestUpdate") {
      const where = e.phase !== null ? `P${e.phase}` : null;
      const pct =
        e.percentage !== null ? `残り ${formatPercent(e.percentage)}%` : null;
      const detail = [where, pct].filter(Boolean).join(" / ");
      lines.push(
        e.phaseAdvanced
          ? `📈 **${input.categoryName}** の到達フェーズが更新されました${detail ? ` (${detail})` : ""}`
          : `📈 **${input.categoryName}** のベスト到達が更新されました${detail ? ` (${detail})` : ""}`,
      );
    } else {
      lines.push(
        `🆕 **${input.categoryName}** の練習ログに新しいレポートを ${e.reports} 件取り込みました`,
      );
    }
  }
  if (input.url) lines.push(input.url);
  return lines.join("\n");
}

/** 残 HP% の表示 (小数 2 桁まで、末尾の 0 は落とす)。 */
function formatPercent(v: number): string {
  const rounded = Math.round(v * 100) / 100;
  return String(rounded);
}
