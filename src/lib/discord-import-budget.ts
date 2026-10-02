/**
 * Discord 取り込みの時間予算と同時数 (純関数、2026-10-01 監査 C-6)。
 *
 * 取り込みは「カテゴリ横断で無制限に並列 × チャンネル内 6 並列 × 1 URL で
 * 最大 ~32 秒」の enrichment を、全部終わってから 1 回で upsert していた。
 * 新しいチャンネルを初めて取り込むと (新規 URL 60 件で) 最悪 ~320 秒に
 * なり、300 秒で関数ごと打ち切られてそのチャンネルの挿入が丸ごと失われ、
 * 翌晩も同じ量をやり直す。そこで:
 *
 * - **締切** (`DISCORD_IMPORT_BUDGET_MS`): 呼び出し元の開始から数えて
 *   この時間を過ぎたら、新しいページ取得・新しい URL の enrichment を
 *   始めない。始めなかった URL は「次回へ持ち越し」として数え、DB には
 *   入れない (次の実行で再び新規として拾われる)
 * - **1 チャンネルの新規 URL 上限** (`DISCORD_IMPORT_MAX_NEW_URLS_PER_CHANNEL`):
 *   超えた分は**古い方**を持ち越す。新しい投稿を毎回確実に拾うため
 *   (古い方から取ると、フィルタで弾かれ続ける古い URL が枠を食い続けて
 *   新しい投稿に届かなくなる)
 * - **カテゴリ横断の共有 limiter** (`DISCORD_IMPORT_ENRICH_CONCURRENCY`):
 *   enrichment の同時数を実行全体で頭打ちにする
 *
 * 締切 220 秒の根拠: 締切直前に始まった処理の最長 (Discord 1 ページ
 * 15 秒 + 429 待ち 10 秒 + 再送 15 秒 = 40 秒、または enrichment 1 件
 * ~32 秒) と、そのあとの upsert・Logs 同期の起動を足しても 300 秒の
 * maxDuration に収まる。
 *
 * `@/` を import しない純モジュール (scripts/check-discord-import-budget.mjs)。
 */

/** 呼び出し元の開始から数えた取り込みの持ち時間。 */
export const DISCORD_IMPORT_BUDGET_MS = 220_000;

/** 1 チャンネル 1 回の実行で enrichment する新規 URL の上限。 */
export const DISCORD_IMPORT_MAX_NEW_URLS_PER_CHANNEL = 50;

/** 実行全体での enrichment の同時数。 */
export const DISCORD_IMPORT_ENRICH_CONCURRENCY = 8;

/**
 * 古い順に並んだ候補から、新しい方の `max` 件を (古い順のまま) 残す。
 * 残さなかった件数を `deferred` で返す。
 */
export function takeNewest<T>(
  oldestFirst: readonly T[],
  max: number,
): { kept: T[]; deferred: number } {
  const cap = Math.max(0, Math.floor(max));
  if (oldestFirst.length <= cap) return { kept: [...oldestFirst], deferred: 0 };
  return {
    kept: oldestFirst.slice(oldestFirst.length - cap),
    deferred: oldestFirst.length - cap,
  };
}

/** 締切を過ぎているか (締切ちょうども過ぎた扱い)。 */
export function isPastDeadline(deadlineAt: number, now: number): boolean {
  return !(now < deadlineAt);
}

/** `summarizeDiscordImportRun` が読むチャンネル単位の結果 (ImportResult の一部)。 */
export type DiscordImportChannelOutcome = {
  category: string;
  kind: string;
  ok: boolean;
  reason?: string;
  skipped?: "disabled" | "deadline";
  deferred?: number;
};

/**
 * 1 回の取り込みを、自動処理の記録 (`cron_status:import-discord`) に載せる
 * 成否と理由にまとめる (2026-10-02)。次回へ回した件数 (`deferred`) と
 * 持ち時間切れ (`skipped: "deadline"`) は応答 JSON にしか出ず、runtime logs
 * は 1 時間しか残らないので、翌朝には分からなかった。
 *
 * - チャンネル単位の失敗が 1 つでもあれば `error` (理由は最初の 1 つ)
 * - 失敗が無く、次回へ回した分があれば `partial` (画面は「一部 (残りは次回)」)
 * - どちらも無ければ `ok` (理由なし)
 *
 * 次回へ回した件数は失敗の回にも理由の後ろに書き添える。理由は英語のコード
 * (画面はそのまま出す。cron-status.ts の注意どおり秘密は入れない)。
 */
export function summarizeDiscordImportRun(
  results: readonly DiscordImportChannelOutcome[],
): { outcome: "ok" | "partial" | "error"; reason: string | null } {
  const deferred = results.reduce(
    (n, r) => n + (typeof r.deferred === "number" && r.deferred > 0 ? r.deferred : 0),
    0,
  );
  const deadlineChannels = results.filter((r) => r.skipped === "deadline").length;
  const carried: string[] = [];
  if (deferred > 0) carried.push(`deferred ${deferred} new URL(s)`);
  if (deadlineChannels > 0) {
    carried.push(`${deadlineChannels} channel(s) stopped at the deadline`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    const first = failed[0]!;
    const head =
      `${failed.length} channel(s) failed: ${first.category}/${first.kind} ${first.reason ?? ""}`.trimEnd();
    return { outcome: "error", reason: [head, ...carried].join("; ") };
  }
  if (carried.length > 0) return { outcome: "partial", reason: carried.join("; ") };
  return { outcome: "ok", reason: null };
}

/**
 * 同時実行数を `concurrency` に抑える limiter。返す関数に渡した処理は、
 * 空きができた順 (渡した順) に始まる。処理の失敗はその呼び出しの
 * Promise にだけ返り、limiter は止まらない。
 */
export function createLimiter(
  concurrency: number,
): <T>(task: () => Promise<T>) => Promise<T> {
  const limit = Math.max(1, Math.floor(concurrency));
  let active = 0;
  const queue: Array<() => void> = [];
  const pump = () => {
    while (active < limit && queue.length > 0) {
      const start = queue.shift()!;
      active += 1;
      start();
    }
  };
  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            pump();
          });
      });
      pump();
    });
}
