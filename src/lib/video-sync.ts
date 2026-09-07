/**
 * 動画オフセットの校正 (W-11、2026-09-07)。
 *
 * 練習ログの pull 行から動画の該当時刻へ飛べるのは、レポートごとに
 * 「**動画上で pull #1 の戦闘開始が何秒か**」= オフセットを 1 つ持って
 * いるため。これまでは人が動画を見ながら秒数を数えて手入力していた
 * (調査ノート第 4 回 W-11 / 出典 xivodreview-local)。
 *
 * ここでは「動画を再生して pull #1 の瞬間で押す」から**逆算**する。
 * 計算自体は 1 行だが、
 *
 *   - 基準にする pull を #1 以外にも選べる (前半だけ録っていない動画では
 *     #1 が映っていないので、映っている pull を基準にする)
 *   - 端数の丸め方を 1 箇所に固定する
 *   - YouTube プレーヤーとの postMessage を検証する
 *
 * を分けて置くために独立したモジュールにしている。
 *
 * ## なぜ YouTube だけなのか
 *
 * 動画の現在時刻を外から読めるのは、埋め込みプレーヤーが API を出して
 * いる場合だけ。Google フォトとニコニコ動画は出していないので、
 * そちらは従来どおり手入力のままにする (UI 側でその旨を出す)。
 *
 * ## なぜ IFrame Player API の script を読み込まないのか
 *
 * `https://www.youtube.com/iframe_api` は **CSP で止まる**。本 portal の
 * `script-src` は `'self' 'nonce-...'` で、外部 script を意図的に許して
 * いない (`src/lib/csp.ts` の TODO #84)。オフセット校正のために XSS 経路を
 * 広げるのは釣り合わないので、iframe への `postMessage` を直接使う
 * (`frame-src` には既に YouTube が入っている)。API script はこの
 * postMessage の薄いラッパーなので、できることは変わらない。
 *
 * 代わりに **プレーヤーから時刻が返ってこないケースを UI で見せる**
 * 必要がある (YouTube 側の仕様変更で黙って 0 秒を書き込むのが最悪)。
 * `parseYoutubePlayerTime` が null を返す限り UI はボタンを押させない。
 *
 * 検証: `node scripts/check-video-sync.mjs`
 */

/**
 * オフセットの許容範囲 (秒)。±24 時間。
 *
 * 上限を置くのは、桁を間違えた入力 (ミリ秒を貼った等) をそのまま保存して
 * 「どの pull を押しても動画の終端に飛ぶ」状態を作らないため。負の値は
 * 正常で、録画開始が pull #1 より後 (= 動画の 0 秒地点が pull #1 より
 * 後ろ) のときに起きる。
 */
export const OFFSET_LIMIT_SECONDS = 86400;

/** 基準にできる pull (UI の選択肢)。 */
export type VideoSyncAnchor = {
  fightId: number;
  /** 戦闘開始 (epoch ms)。 */
  startMs: number;
  /** その日の何本目か (1 始まり、表示用)。 */
  index: number;
};

/**
 * pull の戦闘開始が動画上の何秒に当たるか。
 *
 * `pull-row.tsx` が動画リンクを組むときと同じ式。逆算 (
 * `offsetFromVideoSeconds`) と対にして、片方だけ直して壊れるのを防ぐため
 * ここに置く。
 */
export function videoSecondsForPull(
  offsetSeconds: number,
  pullStartMs: number,
  firstPullStartMs: number,
): number {
  return offsetSeconds + (pullStartMs - firstPullStartMs) / 1000;
}

/**
 * 「いま動画は `videoSeconds` 秒で、ここが `anchor` の戦闘開始」から
 * オフセットを逆算する。
 *
 * 丸めは四捨五入。`Math.trunc` だと常に動画の手前側にずれ、pull の開始が
 * 1 秒切れて「もう始まっている」ように見える (0.5 秒の差でも開幕は詰まって
 * いるので分かる)。保存は整数秒なので、ここで整数にして返す。
 */
export function offsetFromVideoSeconds(
  videoSeconds: number,
  anchorStartMs: number,
  firstPullStartMs: number,
): number {
  const raw = videoSeconds - (anchorStartMs - firstPullStartMs) / 1000;
  return clampOffsetSeconds(Math.round(raw));
}

/** 整数秒に丸めて許容範囲に収める。非数は 0。 */
export function clampOffsetSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  const n = Math.round(seconds);
  return Math.min(OFFSET_LIMIT_SECONDS, Math.max(-OFFSET_LIMIT_SECONDS, n));
}

/** ±1 秒の微調整。範囲外には出さない。 */
export function nudgeOffset(offsetSeconds: number, delta: number): number {
  return clampOffsetSeconds(clampOffsetSeconds(offsetSeconds) + delta);
}

/**
 * いまのオフセットが「何を意味しているか」を実データで言い直すための値
 * (2026-09-07 実機報告)。
 *
 * 実機で起きた取り違え: 動画の 0:22 から始まる pull を「最初の pull」と見て
 * 22 を入れたが、その動画は最初の pull が映っておらず (録画開始が 82 秒後)、
 * 0:22 で始まっていたのは **2 本目の pull** だった。結果、全リンクが一律
 * 104 秒 (= 2 本目までの経過 103 秒 + 端数) 遅い位置を指していた。
 *
 * 数字 (「オフセット 22」) だけでは、それが正しいかを画面から判断できない。
 * 「最初の pull は動画の何秒か」「動画に最初に映る pull はどれか」を実時刻で
 * 出せば、取り違えはその場で見える。
 */
export type OffsetExplain = {
  /**
   * このレポートの最初の pull が動画の何秒地点か。
   * **負なら動画に映っていない** (録画開始がその pull より後)。
   */
  firstPullVideoSeconds: number;
  /** 最初の pull の戦闘開始 (epoch ms)。表示で実時刻に直す。 */
  firstPullStartMs: number;
  /** 動画に映っている最初の pull。全部より前に録画が終わっていれば null。 */
  firstVisible: {
    fightId: number;
    index: number;
    startMs: number;
    videoSeconds: number;
  } | null;
};

/**
 * オフセットの意味を実データに当てはめる (純関数)。
 *
 * `anchors` はそのレポートの pull を時刻の昇順で。`firstPullStartMs` は
 * オフセットの基準 (= そのレポートの最初の pull の戦闘開始)。
 */
export function explainOffset(
  offsetSeconds: number,
  anchors: ReadonlyArray<VideoSyncAnchor>,
  firstPullStartMs: number | null,
): OffsetExplain | null {
  if (firstPullStartMs === null || anchors.length === 0) return null;
  const at = (a: VideoSyncAnchor) =>
    videoSecondsForPull(offsetSeconds, a.startMs, firstPullStartMs);
  // 0 秒以降に映る最初の pull。負の pull は録画開始より前なので映っていない。
  const visible = anchors.find((a) => at(a) >= 0) ?? null;
  return {
    firstPullVideoSeconds: offsetSeconds,
    firstPullStartMs,
    firstVisible: visible
      ? {
          fightId: visible.fightId,
          index: visible.index,
          startMs: visible.startMs,
          videoSeconds: at(visible),
        }
      : null,
  };
}

/* ────────────────────────── YouTube プレーヤー ────────────────────────── */

/**
 * 埋め込みプレーヤーの origin。`postMessage` の `targetOrigin` と、
 * 受信側の origin 検証に使う。
 *
 * `youtube-nocookie.com` は privacy-enhanced mode のホストで、既存の動画
 * タブの埋め込み (`youtube.ts`) がこちらを使っている。校正用の埋め込みも
 * 同じホストに揃えるので、受信は 2 つとも許す。
 */
export const YOUTUBE_PLAYER_ORIGINS = [
  "https://www.youtube-nocookie.com",
  "https://www.youtube.com",
] as const;

/**
 * `message` イベントの origin が埋め込みプレーヤーのものか。
 *
 * **完全一致で見る**。`endsWith("youtube.com")` のような判定は
 * `https://evil-youtube.com` を通してしまう。
 */
export function isYoutubePlayerOrigin(origin: string): boolean {
  return (YOUTUBE_PLAYER_ORIGINS as readonly string[]).includes(origin);
}

/**
 * 校正用の埋め込み URL。
 *
 * - `enablejsapi=1` … postMessage を受け付けさせる (これが無いと無反応)
 * - `origin` … 親ページの origin。YouTube 側が postMessage の宛先検証に使う
 * - `rel=0` / `playsinline=1` … 関連動画を出さない / iOS で全画面化しない
 * - `autoplay` は付けない … 校正は「探して止める」操作なので、開いた瞬間に
 *   音が出ると邪魔になる
 *
 * 開始位置 (`start`) は秒で渡せる。いまのオフセットから計算した推定位置を
 * 入れておくと、開いた時点で目的の場面の近くから探せる。
 */
export function youtubeSyncEmbedUrl(
  videoId: string,
  origin: string,
  startSeconds?: number,
): string {
  const params = new URLSearchParams({
    enablejsapi: "1",
    rel: "0",
    playsinline: "1",
    origin,
  });
  const start = Math.max(0, Math.floor(startSeconds ?? 0));
  if (start > 0) params.set("start", String(start));
  return `${YOUTUBE_PLAYER_ORIGINS[0]}/embed/${videoId}?${params.toString()}`;
}

/** プレーヤーに「状態を送ってくれ」と伝える handshake。 */
export function youtubeListeningMessage(): string {
  return JSON.stringify({ event: "listening", id: 1, channel: "widget" });
}

/** プレーヤーへのコマンド (`seekTo` / `pauseVideo` など)。 */
export function youtubeCommandMessage(
  func: string,
  args: ReadonlyArray<number | boolean | string> = [],
): string {
  return JSON.stringify({
    event: "command",
    func,
    args,
    id: 1,
    channel: "widget",
  });
}

/**
 * プレーヤーからの `message` の `data` から現在時刻 (秒) を取り出す。
 *
 * handshake 後、YouTube は再生中および状態変化時に
 * `{"event":"infoDelivery","info":{"currentTime":12.34,...}}` を
 * (JSON 文字列またはオブジェクトで) 送ってくる。
 *
 * 取り出せないものはすべて null。**null と 0 を混ぜないこと**が肝で、
 * 「時刻が取れていない」を 0 秒と扱うとオフセットに 0 を書き込んでしまう。
 */
export function parseYoutubePlayerTime(data: unknown): number | null {
  let payload: unknown = data;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  if (typeof payload !== "object" || payload === null) return null;
  const rec = payload as Record<string, unknown>;
  if (rec.event !== "infoDelivery") return null;
  const info = rec.info;
  if (typeof info !== "object" || info === null) return null;
  const t = (info as Record<string, unknown>).currentTime;
  if (typeof t !== "number" || !Number.isFinite(t) || t < 0) return null;
  return t;
}
