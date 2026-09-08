/**
 * コマンドパレット (UI-8、2026-09-08) が使う「画面をまたぐ合図」。
 *
 * 第 2 回 UI 監査の残課題 3 は **「管理操作が設定ダイアログの奥にある」**。
 * パレットから設定の節を直接開けるようにするには、ヘッダーの中にある
 * `SettingsDialog` の開閉を外から触る必要がある。
 *
 * ## なぜ context ではなく DOM イベントか
 *
 * `SettingsDialog` はヘッダー配下、パレットは layout 直下に居る。共通の
 * 親に context を通すと、**両方が同じ provider の再描画に巻き込まれる**
 * (設定を開くたびにパレットの候補一覧が作り直される)。合図は 1 方向で
 * 状態を共有しないので、`window` の CustomEvent で足りる。
 *
 * SSR で `window` に触らないよう、送受信の両方を関数の中に閉じている。
 */

const OPEN_SETTINGS = "portal:open-settings";

export type OpenSettingsDetail = {
  /**
   * 開いた直後にスクロールして開く節の id
   * (`CollapsibleSection` の `id` と同じ値)。省略時は先頭のまま。
   */
  section?: string;
};

/** 設定ダイアログを開く (任意で節を指定)。 */
export function requestOpenSettings(detail: OpenSettingsDetail = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS, { detail }));
}

/**
 * 設定ダイアログ側の受け口。戻り値は解除関数 (useEffect の cleanup に返す)。
 */
export function onOpenSettings(
  handler: (detail: OpenSettingsDetail) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<OpenSettingsDetail>).detail ?? {};
    handler(detail);
  };
  window.addEventListener(OPEN_SETTINGS, listener);
  return () => window.removeEventListener(OPEN_SETTINGS, listener);
}
