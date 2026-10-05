/**
 * 自動処理 (cron) の最終実行と成否 (2026-10-01 監査 F-2、純関数)。
 *
 * これまで永続化されていたのは「レポート単位」の成否だけで、ジョブ単位の
 * 「いつ走ったか / 通ったか」を持つ場所が無かった。失敗は `console.warn`
 * 止まりで、Hobby の runtime logs は 1 時間しか残らないので、Discord の
 * token 失効・FFLogs の cookie 失効・pg_cron の宛先違い (監査 F-5) は全部
 * 「静かに止まる」。
 *
 * ジョブごとに `app_settings` の 1 キー (`cron_status:<job>`) へ最後の実行を
 * JSON で持ち、設定ダイアログの「自動処理」節に出す。失敗に変わった最初の
 * 1 回だけ Discord に知らせる (既定 OFF、`cron_alert_enabled`)。
 *
 * ⚠ `app_settings` の SELECT は authenticated (公開デモは anon も) に開いて
 * いる。理由 (`reason`) には秘密を入れないこと — route が返している英語の
 * コードや失敗理由の要約だけを入れる (上限 `CRON_REASON_MAX` 文字)。
 *
 * `@/` を import しない純モジュール (scripts/check-cron-status.mjs)。
 */

export const CRON_JOBS = [
  "import-discord",
  "fflogs-sync",
  "snapshot-schedule",
  "attendance-reminder",
  "notify-native-schedule",
] as const;
export type CronJob = (typeof CRON_JOBS)[number];

/**
 * - `ok`: 最後まで通った
 * - `partial`: 通ったが時間切れなどで一部を次回へ回した
 * - `skipped`: 設定で止まっている / 時刻前などで何もしなかった (失敗ではない)
 * - `error`: 失敗した
 */
export type CronOutcome = "ok" | "partial" | "skipped" | "error";

export const CRON_STATUS_KEY_PREFIX = "cron_status:";
/** 失敗に変わったとき Discord に知らせるか (既定 OFF)。 */
export const CRON_ALERT_ENABLED_KEY = "cron_alert_enabled";
export const CRON_REASON_MAX = 300;

/**
 * 「止まっているかもしれない」と見なすまでの間隔。日次は 1 日 + 余裕 2 時間、
 * 毎時は 2 時間 + 余裕 10 分。pg_cron の宛先違いのように**呼ばれなくなる**
 * 故障は成否では分からないので、最終実行の古さで出す。
 */
export const CRON_STALE_AFTER_MS: Record<CronJob, number> = {
  "import-discord": 26 * 60 * 60 * 1000,
  "fflogs-sync": 26 * 60 * 60 * 1000,
  "snapshot-schedule": 26 * 60 * 60 * 1000,
  "attendance-reminder": 2 * 60 * 60 * 1000 + 10 * 60 * 1000,
  "notify-native-schedule": 2 * 60 * 60 * 1000 + 10 * 60 * 1000,
};

export type CronStatus = {
  /** 最後に走った時刻 (ISO)。 */
  at: string;
  outcome: CronOutcome;
  reason: string | null;
  /** 最後に失敗以外で終わった時刻。 */
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastErrorReason: string | null;
  /** 連続した失敗の回数 (失敗以外で 0 に戻る)。 */
  consecutiveErrors: number;
};

export function cronStatusKey(job: CronJob): string {
  return CRON_STATUS_KEY_PREFIX + job;
}

export function isCronJob(v: unknown): v is CronJob {
  return typeof v === "string" && (CRON_JOBS as readonly string[]).includes(v);
}

const OUTCOMES: readonly CronOutcome[] = ["ok", "partial", "skipped", "error"];

function clampReason(reason: string | null | undefined): string | null {
  if (reason == null) return null;
  const trimmed = String(reason).replace(/\s+/g, " ").trim();
  if (trimmed === "") return null;
  return trimmed.length > CRON_REASON_MAX
    ? trimmed.slice(0, CRON_REASON_MAX - 1) + "…"
    : trimmed;
}

const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;

/** 保存値を読む。形が壊れていれば null (= 未実行扱い)。 */
export function parseCronStatus(raw: string | null | undefined): CronStatus | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.at !== "string" || !OUTCOMES.includes(o.outcome as CronOutcome)) {
    return null;
  }
  const n = Number(o.consecutiveErrors);
  return {
    at: o.at,
    outcome: o.outcome as CronOutcome,
    reason: strOrNull(o.reason),
    lastOkAt: strOrNull(o.lastOkAt),
    lastErrorAt: strOrNull(o.lastErrorAt),
    lastErrorReason: strOrNull(o.lastErrorReason),
    consecutiveErrors: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0,
  };
}

/** 1 回の実行結果から次の保存値を作る。 */
export function nextCronStatus(
  prev: CronStatus | null,
  run: { outcome: CronOutcome; reason?: string | null },
  nowIso: string,
): CronStatus {
  const reason = clampReason(run.reason);
  if (run.outcome === "error") {
    return {
      at: nowIso,
      outcome: "error",
      reason,
      lastOkAt: prev?.lastOkAt ?? null,
      lastErrorAt: nowIso,
      lastErrorReason: reason,
      consecutiveErrors: (prev?.consecutiveErrors ?? 0) + 1,
    };
  }
  return {
    at: nowIso,
    outcome: run.outcome,
    reason,
    lastOkAt: nowIso,
    lastErrorAt: prev?.lastErrorAt ?? null,
    lastErrorReason: prev?.lastErrorReason ?? null,
    consecutiveErrors: 0,
  };
}

/** 失敗に**変わった**最初の 1 回だけ知らせる (毎時の失敗で埋めない)。 */
export function shouldAlertCron(next: CronStatus): boolean {
  return next.outcome === "error" && next.consecutiveErrors === 1;
}

/**
 * 設定で止めているので何もせず終わった (2026-10-05)。既定 ON の FFLogs 同期だけを
 * 見る — OFF だと FFLogs の紐づけ・pull の取り込み・解析・通知・週のまとめが
 * すべて止まるのに、以前は「何もせず終了」を正常として扱い、気づけなかった
 * (本番で実際に止まっていた)。出欠の催促のような既定 OFF の処理は警告しない。
 */
export function isCronDisabledBySetting(job: CronJob, status: CronStatus | null): boolean {
  return job === "fflogs-sync" && status?.outcome === "skipped" && status.reason === "disabled";
}

/** 最終実行が古すぎる (= 呼ばれていないかもしれない)。未実行は判定しない。 */
export function isCronStale(
  job: CronJob,
  status: CronStatus | null,
  nowMs: number,
): boolean {
  if (!status) return false;
  const at = Date.parse(status.at);
  if (!Number.isFinite(at)) return false;
  return nowMs - at > CRON_STALE_AFTER_MS[job];
}
