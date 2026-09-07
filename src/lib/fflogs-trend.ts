/**
 * 進行トレンド (W-4)。2026-09-07。
 *
 * 「日ごとのバー」を時系列化して、累積 pull に対する到達度の伸びを 1 枚で
 * 見せる。元データは `progressTimeline()` が既に返している `ProgressPoint[]`
 * なので、新しい取得も新しいテーブルも要らない。
 *
 * ## グラフライブラリを入れない
 *
 * 調査ノート第 4 回 W-4 のデメリット欄は「グラフ描画ライブラリの追加
 * (bundle)」だった。ここで必要なのは折れ線 1 本 + 点なので、**インライン
 * SVG の path 文字列を純関数で組む**方針にした (`sparklinePath`)。
 * recharts / chart.js を入れると 50〜200 KB の client bundle が全ページに
 * 乗るので、この規模では釣り合わない。
 *
 * ## 「ペース」の扱い
 *
 * 「このペースならクリアまで何 pull か」は要望としては分かるが、外挿は
 * 極めて当たらない — 到達度は線形に伸びず、最後のフェーズで止まるのが
 * 普通だから。そこで
 *   - **直近のセッションだけ**を見る (古い伸びを混ぜない)
 *   - **伸びている場合だけ**返す (停滞・後退で「あと ∞ pull」を出さない)
 *   - セッション数が足りないときは返さない
 * の 3 条件を満たしたときだけ数字を出し、UI 側で「目安」と明示する。
 *
 * 検証: `node scripts/check-fflogs-trend.mjs`
 */

/** `ProgressPoint` のうちトレンドに必要な部分。 */
export type TrendInput = {
  date: string;
  pulls: number;
  /** 0-100 の到達度 (層 / フェーズを含めて正規化済み)。 */
  progress: number;
  hasClear: boolean;
};

export type TrendPoint = {
  date: string;
  /** その日までの累積 pull 数。 */
  cumulativePulls: number;
  /** その日の到達度 (0-100)。 */
  progress: number;
  /** その日までの最高到達度 (0-100)。単調非減少。 */
  bestProgress: number;
  hasClear: boolean;
};

export type ClearPace = {
  /** 母数にしたセッション数。 */
  sessions: number;
  /** 1 セッションあたりの平均 pull 数。 */
  pullsPerSession: number;
  /** 1 セッションあたりの到達度の伸び (ポイント)。 */
  progressPerSession: number;
  /** 100% まであと何セッションか (切り上げ)。 */
  sessionsToClear: number;
  /** 100% まであと何 pull か (切り上げ)。 */
  pullsToClear: number;
};

/** ペースを出すのに必要な最小セッション数。 */
export const PACE_MIN_SESSIONS = 3;
/** ペースの母数にする直近セッション数。 */
export const PACE_WINDOW_SESSIONS = 5;

/**
 * 時系列トレンド。入力は日付順不問 (内部で古い順に並べ直す)。
 *
 * `bestProgress` を別に持つのは、折れ線を 2 本描くため — 「その日の到達度」
 * は上下するが、「そこまでの最高到達」は下がらない。後者だけだと調子の
 * 悪い日が見えず、前者だけだと伸びの傾向が読みにくい。
 */
export function trendSeries(days: ReadonlyArray<TrendInput>): TrendPoint[] {
  const asc = [...days].sort((a, b) => a.date.localeCompare(b.date));
  let cumulative = 0;
  let best = 0;
  const out: TrendPoint[] = [];
  for (const d of asc) {
    cumulative += Math.max(0, d.pulls);
    const progress = clamp(d.progress);
    if (progress > best) best = progress;
    out.push({
      date: d.date,
      cumulativePulls: cumulative,
      progress,
      bestProgress: best,
      hasClear: d.hasClear,
    });
  }
  return out;
}

/**
 * クリアまでのペースの目安。以下のいずれかなら **null** (出さない):
 *   - 既にクリアしている
 *   - セッションが `PACE_MIN_SESSIONS` 未満
 *   - 直近ウィンドウで到達度が伸びていない (停滞 / 後退)
 *
 * 「伸びていないときに出さない」のが肝。外挿は伸び率が正のときしか
 * 意味を持たず、0 で割ると「あと ∞」になる。
 */
export function clearPace(points: ReadonlyArray<TrendPoint>): ClearPace | null {
  if (points.length < PACE_MIN_SESSIONS) return null;
  if (points.some((p) => p.hasClear)) return null;

  const window = points.slice(-PACE_WINDOW_SESSIONS);
  if (window.length < PACE_MIN_SESSIONS) return null;

  const first = window[0]!;
  const last = window[window.length - 1]!;
  // 伸びは「最高到達」で見る。その日の到達度で見ると、最後のセッションが
  // 調子の悪い日だと伸びが負になってしまう。
  const gain = last.bestProgress - first.bestProgress;
  // ウィンドウ内の「区間数」= セッション数 − 1 (最初の点は基準)。
  const spans = window.length - 1;
  const progressPerSession = gain / spans;
  if (progressPerSession <= 0) return null;

  const pullsInWindow = last.cumulativePulls - first.cumulativePulls;
  const pullsPerSession = pullsInWindow / spans;
  const remaining = Math.max(0, 100 - last.bestProgress);
  const sessionsToClear = Math.ceil(remaining / progressPerSession);
  return {
    sessions: window.length,
    pullsPerSession: Math.round(pullsPerSession * 10) / 10,
    progressPerSession: Math.round(progressPerSession * 10) / 10,
    sessionsToClear,
    pullsToClear: Math.ceil(sessionsToClear * pullsPerSession),
  };
}

/**
 * スパークライン / 折れ線の SVG `points` 属性を組む (純関数)。
 *
 * 値は 0-100 を想定し、`height` に対して**上下反転**して描く
 * (SVG は y が下向きなので、値が大きいほど上に来るようにする)。
 * 値が 1 つのときは水平線になるよう左右 2 点を返す — 1 点だけの polyline は
 * 何も描画されず「データが無い」ように見えてしまう。
 *
 * 座標は小数 2 桁に丸める (SSR とクライアントで文字列が一致し、
 * hydration mismatch にならないようにするため)。
 */
export function sparklinePath(
  values: ReadonlyArray<number>,
  width: number,
  height: number,
): string {
  if (values.length === 0 || width <= 0 || height <= 0) return "";
  const y = (v: number) => round2(height - (clamp(v) / 100) * height);
  if (values.length === 1) {
    const only = y(values[0]!);
    return `0,${only} ${round2(width)},${only}`;
  }
  const step = width / (values.length - 1);
  return values.map((v, i) => `${round2(i * step)},${y(v)}`).join(" ");
}

function clamp(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
