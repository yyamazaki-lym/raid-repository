"use client";

import dynamic from "next/dynamic";
import { useState, useSyncExternalStore } from "react";
import { Settings } from "lucide-react";

/**
 * 1.9 (2026-04-28) — TODO #11 (パフォーマンス最適化):
 *
 * `SettingsDialog` 本体は ~1601 行 + `MaintenanceMenu` (~880 行) を含み
 * 巨大だが、ヘッダー右上のボタン経由で「開いた時だけ」必要な UI。
 * これまで `site-header.tsx` から static import していたため初回ページ
 * ロードの client bundle に常時混入してリロードが遅くなっていた。
 *
 * `next/dynamic({ ssr: false })` で別 chunk に分離し、コンポーネントが
 * mount されるタイミング (= ヘッダーが描画される直後) でも別ファイルと
 * して fetch されるようにする。初期 paint が完了するまで blocking
 * しないので体感の重さが軽減する。
 *
 * 2.14 (2026-09-06) 軽量化: 「mount 直後に fetch」から「操作した時に
 * fetch」へ変更。旧構成は初期 paint こそ塞がないものの、設定ダイアログ
 * を開かない大多数の訪問でも毎回 chunk (設定 12 セクション + Server
 * Action 参照群) をダウンロード・parse していた。
 *
 *   - 初期描画: 本体と同じ見た目の placeholder ボタンだけを出す
 *     (SSR にも含まれるので、旧構成の「ボタンが一瞬遅れて現れる」も解消)
 *   - hover / focus / touch: `import()` で chunk を先読み (クリック時の
 *     待ち時間を隠す)
 *   - click: 本体を mount し `defaultOpen` で即座に開く
 *   - OAuth 復帰 (`?fflogs_oauth_connected` / `?fflogs_oauth_error`):
 *     本体の useEffect が toast + 自動オープンを担うため、その query が
 *     ある時だけ従来どおり mount 直後に読み込む
 *
 * trade-off: 初回クリックから開くまでに chunk fetch 分 (通常 hover 先読み
 * で吸収、ネットワーク次第で数十〜数百 ms) の遅延が出る可能性あり。
 */
const LazySettingsDialog = dynamic(
  () =>
    import("./settings-dialog").then((m) => ({
      default: m.SettingsDialog,
    })),
  {
    ssr: false,
    // chunk 到着までの間も同じ見た目のボタンを出し続けてレイアウトを
    // 動かさない。押下は activated 側で既に受けているので no-op で良い。
    loading: () => <TriggerPlaceholder busy />,
  },
);

function preloadSettingsDialog() {
  // 同一 specifier なので `dynamic()` 側と同じ chunk が解決される。
  // 失敗はクリック時の dynamic() 経路で再試行されるためここでは握る。
  void import("./settings-dialog").catch(() => {});
}

/**
 * 本体 `<DialogTrigger>` と同一の className / aria-label を持つ見た目だけ
 * のボタン。本体側を変更する時はこちらも揃える (settings-dialog.tsx の
 * `<DialogTrigger className=...>` 参照)。
 */
function TriggerPlaceholder({
  busy = false,
  onActivate,
}: {
  busy?: boolean;
  onActivate?: () => void;
}) {
  return (
    <button
      type="button"
      className="flex h-8 w-8 items-center justify-center rounded-md border border-border/40 bg-background/30 text-muted-foreground transition-colors hover:border-[var(--neon-cyan)]/40 hover:text-foreground"
      aria-label="設定"
      aria-haspopup="dialog"
      aria-expanded={false}
      aria-busy={busy || undefined}
      onPointerEnter={onActivate ? preloadSettingsDialog : undefined}
      onFocus={onActivate ? preloadSettingsDialog : undefined}
      onTouchStart={onActivate ? preloadSettingsDialog : undefined}
      onClick={onActivate}
    >
      <Settings className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

/**
 * OAuth 復帰 query の有無。ページ寿命の間で 1 回だけ評価して固定する
 * (module スコープに latch)。本体の useEffect が `history.replaceState`
 * で query を剥がした後に再評価されて false に戻ると、開いているダイアログ
 * ごと unmount してしまうため。OAuth 復帰は Route Handler の redirect
 * (= フルページロード) でしか起きないので、module 初期化と同じ寿命で良い。
 */
let oauthReturnSnapshot: boolean | null = null;
function getOauthReturnSnapshot(): boolean {
  if (oauthReturnSnapshot === null) {
    const params = new URLSearchParams(window.location.search);
    oauthReturnSnapshot =
      params.has("fflogs_oauth_connected") ||
      params.has("fflogs_oauth_error");
  }
  return oauthReturnSnapshot;
}
const getServerSnapshot = () => false;
const subscribeNoop = () => () => {};

export function SettingsDialog({
  canEdit,
  showSignIn = false,
}: {
  canEdit: boolean;
  showSignIn?: boolean;
}) {
  // null = 未活性 (placeholder のみ)。open は mount 直後に開くかどうか。
  const [clicked, setClicked] = useState<{ open: boolean } | null>(null);
  // OAuth 復帰時は本体側の useEffect (toast + setOpen(true) + query 除去)
  // に処理を委ねるため、閉じた状態で即 mount する。SSR / hydration 中は
  // false (placeholder) で描画し、hydration 後に client 値で再描画される。
  const oauthReturn = useSyncExternalStore(
    subscribeNoop,
    getOauthReturnSnapshot,
    getServerSnapshot,
  );
  const activated = clicked ?? (oauthReturn ? { open: false } : null);

  if (activated === null) {
    return (
      <TriggerPlaceholder onActivate={() => setClicked({ open: true })} />
    );
  }

  return (
    <LazySettingsDialog
      canEdit={canEdit}
      showSignIn={showSignIn}
      defaultOpen={activated.open}
    />
  );
}
