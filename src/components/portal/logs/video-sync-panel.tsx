/**
 * 練習ログ: 動画を見ながらオフセットを合わせるパネル (W-11、2026-09-07)。
 *
 * これまでオフセットは「動画上で pull #1 の戦闘が始まる秒数」を人が数えて
 * 手入力していた。ここでは動画を埋め込み、基準にする pull を選んで
 * 「いまの位置を基準にする」を押すと逆算する。計算とメッセージの検証は
 * `@/lib/video-sync` (純関数 + `scripts/check-video-sync.mjs`)。
 *
 * ## プレーヤーとの通信
 *
 * IFrame Player API の script は **CSP で止まる**ので読み込まない
 * (`src/lib/csp.ts` の `script-src 'self' 'nonce-...'`)。代わりに
 * `enablejsapi=1` の埋め込みへ `postMessage` を直接送る。
 *
 *   1. iframe の load 後に handshake (`{event:"listening"}`) を送る
 *   2. プレーヤーが `infoDelivery` で `currentTime` を返してくる
 *   3. 返ってこない間はボタンを無効にする
 *
 * 3 が肝。読み取れないときに 0 秒として保存すると「押したのに全部の
 * pull が動画の先頭に飛ぶ」状態になり、しかも原因が分からない。
 * `currentTime` が一度も来ていなければ押させず、理由を出す。
 *
 * handshake は 1 回では取りこぼすことがある (プレーヤーの準備前に届くと
 * 無視される) ので、最初の応答が来るまで一定間隔で送り直す。
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Crosshair, Minus, Plus, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatClock } from "@/lib/fflogs-url";
import { useMessages } from "@/lib/i18n/client";
import { parseYouTubeId } from "@/lib/youtube";
import {
  isYoutubePlayerOrigin,
  offsetFromVideoSeconds,
  parseYoutubePlayerTime,
  videoSecondsForPull,
  youtubeCommandMessage,
  youtubeListeningMessage,
  youtubeSyncEmbedUrl,
  type VideoSyncAnchor,
} from "@/lib/video-sync";

/** postMessage の送信先 (埋め込みの host)。`"*"` は使わない。 */
const PLAYER_TARGET_ORIGIN = "https://www.youtube-nocookie.com";

/** handshake を送り直す間隔と回数 (最初の応答が来たら止める)。 */
const HANDSHAKE_INTERVAL_MS = 700;
const HANDSHAKE_TRIES = 12;

export function VideoSyncPanel({
  videoUrl,
  anchors,
  firstPullStartMs,
  offsetSeconds,
  onPick,
}: {
  videoUrl: string;
  /** このレポートの pull (基準の選択肢)。時刻の昇順。 */
  anchors: VideoSyncAnchor[];
  /** オフセットの基準時刻 (このレポートの最初の pull の戦闘開始)。 */
  firstPullStartMs: number | null;
  offsetSeconds: number;
  onPick: (offsetSeconds: number) => void;
}) {
  const m = useMessages();
  const [open, setOpen] = useState(false);
  const [anchorFightId, setAnchorFightId] = useState<number | null>(null);
  /** プレーヤーから受け取った最新の再生位置。null = まだ一度も来ていない。 */
  const [playerSeconds, setPlayerSeconds] = useState<number | null>(null);
  /** handshake を送り切っても応答が無かった (仕様変更 / 埋め込み拒否)。 */
  const [giveUp, setGiveUp] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // 「応答が来たか」は ref で持つ。state にすると再生中 (毎秒数回の
  // infoDelivery) のたびに handshake の effect が張り替わる。
  const gotTimeRef = useRef(false);

  const trimmedUrl = videoUrl.trim();
  const videoId = parseYouTubeId(trimmedUrl);
  const anchor =
    anchors.find((a) => a.fightId === anchorFightId) ?? anchors[0] ?? null;

  // 読み取り状態をリセットする条件は **プレーヤーが作り直されるとき**。
  // 動画の差し替えだけでなく、**折りたたみでも iframe は破棄される**
  // (`{open && ...}` の中にある) ので、開き直すと 0 秒から始まる新しい
  // プレーヤーに対して前のインスタンスで読んだ秒数が残ってしまう。
  // 残ったままだと「動画の現在位置 25:00」と出たまま押せてしまい、
  // 見ている位置と違うオフセットを書き込む (2026-09-07 マージ前レビュー)。
  //
  // effect で setState するとカスケードレンダーになるので、React 公式の
  // 「レンダー中に前回値と比べて調整する」形にする (day-row.tsx の
  // jumpNonce と同じ)。キーは「プレーヤーの同一性」= open と videoId の対。
  const playerKey = open ? videoId : null;
  const [syncedFor, setSyncedFor] = useState(playerKey);
  if (syncedFor !== playerKey) {
    setSyncedFor(playerKey);
    setPlayerSeconds(null);
    setGiveUp(false);
  }

  // 埋め込みの `origin` パラメータ用。このパネルはダイアログを開いたときに
  // しかマウントされない (SSR では描画されない) ので、body で参照して
  // 問題ない。念のため空文字のときは iframe を描かない。
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  /** プレーヤーからの再生位置を受け取る。 */
  useEffect(() => {
    if (!open || !videoId) return;
    const onMessage = (e: MessageEvent) => {
      // origin は完全一致で検証する (別サイトの iframe や拡張からの
      // メッセージで再生位置を書き換えられないようにするため)。
      if (!isYoutubePlayerOrigin(e.origin)) return;
      const t = parseYoutubePlayerTime(e.data);
      if (t === null) return;
      gotTimeRef.current = true;
      setPlayerSeconds(t);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [open, videoId]);

  /** handshake。応答が来るか、回数を使い切るまで送り直す。 */
  useEffect(() => {
    if (!open || !videoId) return;
    // 動画を差し替えたら「読めた」実績もリセットする。
    gotTimeRef.current = false;
    let tries = 0;
    const send = () => {
      frameRef.current?.contentWindow?.postMessage(
        youtubeListeningMessage(),
        // 送信先は埋め込みの host (nocookie) 固定。"*" は使わない。
        PLAYER_TARGET_ORIGIN,
      );
    };
    send();
    const timer = window.setInterval(() => {
      if (gotTimeRef.current) {
        window.clearInterval(timer);
        return;
      }
      tries += 1;
      if (tries > HANDSHAKE_TRIES) {
        window.clearInterval(timer);
        // 一度も応答が無ければ「読めない」と出す (0 秒として保存させない)。
        setGiveUp(true);
        return;
      }
      send();
    }, HANDSHAKE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [open, videoId]);

  const estimate =
    anchor && firstPullStartMs !== null
      ? videoSecondsForPull(offsetSeconds, anchor.startMs, firstPullStartMs)
      : null;
  // iframe の src に live な推定位置を入れると、オフセットを 1 秒動かす
  // たびに src が変わって再読込 (再生位置も失う) になる。開いた時点の値で
  // 固定し、以降は「推定位置へ移動」(seekTo) で動かす。
  const [initialStart] = useState(() =>
    estimate === null ? 0 : Math.max(0, Math.floor(estimate)),
  );

  // URL 未入力のときはパネル自体を出さない (「YouTube のときだけ使えます」
  // だけが出ると、まだ何も入れていない人に無関係な注意を読ませることになる)。
  if (trimmedUrl === "") return null;
  if (!videoId) {
    return (
      <p className="text-[11px] leading-relaxed text-muted-foreground/80">
        {m.logsOffset.syncYoutubeOnly}
      </p>
    );
  }

  const pick = () => {
    if (playerSeconds === null || anchor === null || firstPullStartMs === null) return;
    onPick(offsetFromVideoSeconds(playerSeconds, anchor.startMs, firstPullStartMs));
  };

  const seekToEstimate = () => {
    if (estimate === null) return;
    frameRef.current?.contentWindow?.postMessage(
      youtubeCommandMessage("seekTo", [Math.max(0, Math.floor(estimate)), true]),
      PLAYER_TARGET_ORIGIN,
    );
  };

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-border/40 bg-secondary/20 p-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-left text-[12px] font-medium text-foreground/90 transition-colors hover:text-foreground"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
          aria-hidden
        />
        {m.logsOffset.syncTitle}
      </button>
      {open && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {m.logsOffset.syncHint}
          </p>
          {anchors.length === 0 || firstPullStartMs === null ? (
            <p className="text-[11px] text-amber-200/90">{m.logsOffset.syncNoAnchor}</p>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor="offset-anchor" className="text-[11px]">
                  {m.logsOffset.syncAnchorLabel}
                </Label>
                <select
                  id="offset-anchor"
                  value={anchor?.fightId ?? ""}
                  onChange={(e) => setAnchorFightId(Number(e.target.value))}
                  className="h-8 rounded-sm border border-border/60 bg-background/60 px-2 text-[12px]"
                >
                  {/* 番号は出さない。ここの連番はレポート内の順序で、
                      pull 行の「#N」は日単位の順序なので、同じ日に複数
                      レポートがあると食い違う (2026-09-07 マージ前レビュー)。
                      時刻だけなら pull 行と確実に対応する。 */}
                  {anchors.map((a) => (
                    <option key={a.fightId} value={a.fightId}>
                      {m.logsOffset.syncAnchorOption(clockOf(a.startMs))}
                    </option>
                  ))}
                </select>
              </div>
              {origin !== "" && (
                <div className="relative aspect-video w-full overflow-hidden rounded-sm bg-black">
                  <iframe
                    ref={frameRef}
                    // 開いた時点で推定位置から始める (目的の場面を探す手間を
                    // 減らす)。src が変わると再読込になるので、推定位置は
                    // マウント時の値だけを使い、以降は「推定位置へ移動」で動かす。
                    src={youtubeSyncEmbedUrl(videoId, origin, initialStart)}
                    title={m.logsOffset.syncTitle}
                    allow="autoplay; encrypted-media; picture-in-picture"
                    referrerPolicy="strict-origin-when-cross-origin"
                    className="absolute inset-0 h-full w-full"
                  />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {playerSeconds === null
                    ? giveUp
                      ? m.logsOffset.syncUnavailable
                      : m.logsOffset.syncWaiting
                    : m.logsOffset.syncCurrent(formatClock(playerSeconds))}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={seekToEstimate}
                    disabled={estimate === null}
                    className="text-[11px]"
                  >
                    <SkipForward className="h-3 w-3" aria-hidden />
                    {m.logsOffset.syncSeek}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={pick}
                    disabled={playerSeconds === null}
                    className="text-[11px]"
                  >
                    <Crosshair className="h-3 w-3" aria-hidden />
                    {m.logsOffset.syncPick}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** ±1 秒の微調整ボタン (オフセット入力の右に置く)。 */
export function OffsetNudge({
  onNudge,
}: {
  onNudge: (delta: number) => void;
}) {
  const m = useMessages();
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={m.logsOffset.syncNudgeMinus}
        title={m.logsOffset.syncNudgeMinus}
        onClick={() => onNudge(-1)}
      >
        <Minus className="h-3 w-3" aria-hidden />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={m.logsOffset.syncNudgePlus}
        title={m.logsOffset.syncNudgePlus}
        onClick={() => onNudge(1)}
      >
        <Plus className="h-3 w-3" aria-hidden />
      </Button>
    </div>
  );
}

/** 基準 pull の時刻表記。日付のグルーピングと同じ JST 固定。 */
function clockOf(ms: number): string {
  return new Date(ms).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  });
}
