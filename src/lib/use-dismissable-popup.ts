"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * 手書きポップアップの「閉じる」挙動を 1 箇所に集約するフック
 * (2026-08-30、Tier3-10)。
 *
 * 経緯: portal 内には Base UI の primitive を使わない手書きポップアップが
 * 3 つあり (日付メモ / スケジュールのルール / メンテナンス結果パネル)、
 * どれも 50〜60 行の同型コードをコピーして持っていた。細部が少しずつ違い、
 * そのズレが実際にバグを生んでいる:
 *
 *   - **トリガーを「外側」と誤認する**と、再クリックで閉じられない。
 *     mousedown で閉じ → 直後の click のトグルで開き直すため。実際に
 *     スケジュールの「ルール」で発生した (2026-08-30 に個別修正)。
 *   - **フォーカス復帰を無条件に行う**と、ユーザーが別の場所へ移動して
 *     いても勝手にフォーカスを奪う (メンテナンスメニューで発生していた)。
 *
 * このフックが引き受けるのは以下だけ:
 *   1. ポップアップ外の mousedown で閉じる (トリガー自身は「内側」扱い)
 *   2. Escape で閉じる
 *   3. 閉じた後、フォーカスが body に落ちていたときだけトリガーへ戻す
 *      (open が true → false に変わった瞬間だけ。mount 時には動かない)
 *
 * 位置決め (getBoundingClientRect / portal) は各コンポーネントの都合が
 * 大きく違うので統合しない。
 */
export function useDismissablePopup(opts: {
  open: boolean;
  onClose: () => void;
  /** ポップアップ本体。ここへの mousedown は「内側」。 */
  popupRef: RefObject<HTMLElement | null>;
  /**
   * トリガー要素。**必ず渡す**こと。ここを「外側」と扱うと、再クリックで
   * 閉じられない (mousedown で閉じ → click で開き直す) 不具合になる。
   */
  triggerRef?: RefObject<HTMLElement | null>;
  /**
   * トリガーが DOM 上で別の場所にある場合の追加セレクタ
   * (例: `[data-memo-dot-trigger]`)。これも「内側」として扱う。
   */
  insideSelector?: string;
  /**
   * フォーカスを戻す先。省略時は `triggerRef`。
   * `triggerRef` にラッパー要素 (span 等、フォーカス不可) を渡している
   * 場合に、実際のボタンをここで指定する。
   */
  focusRef?: RefObject<HTMLElement | null>;
  /**
   * true の間は外側クリックで閉じない (編集中の誤閉じ防止)。
   * Escape も抑止する。
   */
  locked?: boolean;
  /**
   * 閉じたときにトリガーへフォーカスを戻すか (既定 true)。
   * 戻すのは activeElement が body / null のときだけ — ユーザーが別の
   * コントロールへ移動していたら奪わない。
   */
  restoreFocus?: boolean;
}): void {
  const {
    open,
    onClose,
    popupRef,
    triggerRef,
    insideSelector,
    focusRef,
    locked = false,
    restoreFocus = true,
  } = opts;
  const focusTargetRef = focusRef ?? triggerRef;

  // 1) 外側 mousedown + Escape で閉じる。
  useEffect(() => {
    if (!open) return;
    const isInside = (t: Node) => {
      if (popupRef.current?.contains(t)) return true;
      if (triggerRef?.current?.contains(t)) return true;
      if (
        insideSelector &&
        t instanceof Element &&
        t.closest(insideSelector) !== null
      ) {
        return true;
      }
      return false;
    };
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t || locked) return;
      if (isInside(t)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !locked) onClose();
    };
    // 開いた直後の同一クリックで即閉じないよう、mousedown の購読は
    // 次のタスクまで遅らせる (Escape は遅らせる理由が無い)。
    const handle = setTimeout(() => {
      document.addEventListener("mousedown", onDocMouseDown);
    }, 0);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(handle);
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, locked, onClose, popupRef, triggerRef, insideSelector]);

  // 2) 閉じた直後のフォーカス復帰。open が true → false に落ちた遷移で、
  //    フォーカスが body に落ちている (= 閉じた要素と一緒に消えた) 場合のみ。
  //
  //    2026-09-06 実機報告「スケジュールページを更新 (再読み込み) すると
  //    ルールボタンに白い枠が出る。他を押すと消える」の原因がここ。旧実装は
  //    `open === false` なら無条件に走っていたため **初回 mount** (open=false、
  //    activeElement=body) でもトリガーへ focus() を呼び、読み込み直後で
  //    ユーザー操作が無い状態での script focus はブラウザが :focus-visible
  //    (白い枠) を付ける。直前の open を ref で覚え、true → false の遷移
  //    以外では何もしない。
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (!restoreFocus) return;
    if (open || !wasOpen) return;
    if (typeof document === "undefined") return;
    const active = document.activeElement;
    if (active === null || active === document.body) {
      focusTargetRef?.current?.focus();
    }
    // open の false 遷移だけを見たいので依存は open のみ (ref は不変)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, restoreFocus]);
}
