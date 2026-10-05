"use client";

import { useCallback, useRef } from "react";
import {
  fitMemberColumns,
  MEMBER_NAME_PREFERRED_PX,
} from "@/lib/schedule/fit-member-columns";

/** メンバー列の最低幅を渡す CSS 変数 (`UserHeaderCell` の th が読む)。 */
export const MEMBER_COL_MIN_VAR = "--member-col-min";
/** 見出しの名前を省略する上限を渡す CSS 変数 (名前の要素が読む)。 */
export const MEMBER_NAME_MAX_VAR = "--member-name-max";

/**
 * スケジュールの詳細表を、入れ物の幅に収まるように自動で詰める (2026-10-05)。
 * 返した callback ref を `overflow-x-auto` の入れ物に付ける (過去の表のように
 * 後から現れる入れ物にも効くよう、付いた時点で監視を始める)。
 *
 * 入れ物か表の大きさが変わるたびに (幅の変更・メンバーの増減・行の展開・
 * フォントの読み込み)、表を一時的に `max-content` にして各列の中身の幅と
 * 見出しの名前の幅を測り、`fitMemberColumns` で決めた値を CSS 変数に入れる。
 * 測る間の書き換えは同じタスクの中で戻すので、画面には出ない。
 *
 * メンバー列の th には `data-member-col`、見出しの名前の要素には
 * `data-member-name` を付けておく (それ以外の列は「中身の幅のまま」として合計する)。
 */
export function useFitMemberColumns<T extends HTMLElement>() {
  const cleanupRef = useRef<(() => void) | null>(null);
  return useCallback((wrap: T | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const table = wrap.querySelector("table");
      const head = table?.tHead?.rows[0];
      // 非表示 (スマホ幅で display:none の表) は測らない。
      if (!table || !head || wrap.clientWidth === 0) return;
      const prevWidth = table.style.width;
      const prevMinWidth = table.style.minWidth;
      wrap.style.setProperty(MEMBER_COL_MIN_VAR, "0px");
      wrap.style.setProperty(MEMBER_NAME_MAX_VAR, `${MEMBER_NAME_PREFERRED_PX}px`);
      table.style.width = "max-content";
      table.style.minWidth = "0";
      const cells = [...head.cells];
      const widths = cells.map((c) => c.getBoundingClientRect().width);
      const names = cells.map(
        (c) => c.querySelector("[data-member-name]")?.getBoundingClientRect().width ?? 0,
      );
      table.style.width = prevWidth;
      table.style.minWidth = prevMinWidth;
      let fixed = 0;
      const columns: Array<{ content: number; name: number }> = [];
      cells.forEach((c, i) => {
        if (c.hasAttribute("data-member-col")) {
          columns.push({ content: Math.ceil(widths[i]!), name: Math.ceil(names[i]!) });
        } else {
          fixed += widths[i]!;
        }
      });
      const fit = fitMemberColumns({
        // 小数の幅の丸めで 1px はみ出さないよう 1px 余らせる。
        available: wrap.clientWidth - 1,
        fixed: Math.ceil(fixed),
        columns,
      });
      wrap.style.setProperty(MEMBER_COL_MIN_VAR, `${fit.minWidth}px`);
      wrap.style.setProperty(MEMBER_NAME_MAX_VAR, `${fit.nameMax}px`);
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(measure);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(wrap);
    const table = wrap.querySelector("table");
    if (table) ro.observe(table);
    // 付いた時点で 1 回その場で測る (描画前に正しい幅にする。裏のタブでは
    // requestAnimationFrame が止まるので、それを待たない)。
    measure();
    // 2026-10-05: フォントの読み込みが終わったらもう一度測る。付いた時点は
    // フォントの読み込み前のことがあり (本番で実測: 読み込み前の幅で 80px の
    // まま収まると判定し、読み込み後に 2px はみ出していた)、裏のタブでは
    // 大きさの変化を受けた requestAnimationFrame も止まっている。
    let disposed = false;
    void document.fonts?.ready.then(() => {
      if (!disposed) measure();
    });
    cleanupRef.current = () => {
      disposed = true;
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
}
