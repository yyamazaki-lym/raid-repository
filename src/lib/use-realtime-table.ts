"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/**
 * Supabase Realtime 購読フックの共通土台 (総合レビュー C-4)。
 *
 * 旧来は `categories-client` / `category-links-client` (links + albums) /
 * `category-macros-client` / `recruitment-templates-client` /
 * `schedule-memos-client` の 6 フックが、それぞれ
 *   createClient → channel(`name-${useId()}`) → .on(postgres_changes, ...) →
 *   .subscribe() → cleanup(removeChannel) + cancelled フラグ
 * という同じスケルトンをコピペしていた。さらに更新方式が「全件 refetch」と
 * 「payload incremental」で混在していた。これを 2 層に集約する:
 *
 *   - {@link useRealtimeChannel}: channel ライフサイクルのみ (全 6 本が共有)。
 *   - {@link useRealtimeTable}: フラットリスト state + initial 追従 + refetch/
 *     incremental 両モード (id をキーに持つ 5 本が使用)。schedule-memos の
 *     rawDate グループ Map だけは形が異なるため `useRealtimeChannel` を直接使う。
 */

/** `payload.new` / `payload.old` を緩く扱う共通 payload 型。各 consumer が
 * 具体 Row 型へ cast する (旧実装と同じ運用)。 */
export type RealtimeChangePayload = RealtimePostgresChangesPayload<
  Record<string, unknown>
>;

/**
 * `public` スキーマの 1 テーブルを Realtime 購読し、変更ごとに `onChange`
 * を呼ぶだけの薄いフック。state は持たない (呼び出し側の責務)。
 *
 * `onChange` / `onSubscribeError` は ref 経由で最新版を参照するため、
 * 毎レンダーで新しい関数を渡しても channel は貼り直されない。channel の
 * 貼り直しは `channelPrefix` / `table` / `filter` が変わった時のみ。
 */
export function useRealtimeChannel(opts: {
  /** channel 名の接頭辞。`useId()` を付与して同一ページの複数インスタンスを分離。 */
  channelPrefix: string;
  table: string;
  /** postgres-side フィルタ (例 `category_id=eq.<uuid>`)。単一条件のみ。 */
  filter?: string;
  onChange: (payload: RealtimeChangePayload) => void;
  onSubscribeError?: (status: string, err: Error) => void;
}): void {
  const id = useId();
  // 最新の onChange / onSubscribeError を async コールバックから参照するための
  // ref。render 中の書き換えは React の警告対象なので effect で更新する。
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const { channelPrefix, table, filter } = opts;

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`${channelPrefix}-${id}`)
      .on(
        "postgres_changes",
        // filter が無い時は key 自体を省く (旧実装と同じ)。
        { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
        (payload) => {
          optsRef.current.onChange(payload as RealtimeChangePayload);
        },
      )
      .subscribe((status, err) => {
        // CHANNEL_ERROR のときだけ第 2 引数 Error が渡され、TIMED_OUT / CLOSED は
        // status のみ (err=undefined) で配送される (@supabase/realtime-js)。
        // `if (err)` だと最頻の一時切断 (TIMED_OUT) を取りこぼし
        // refetchOnSubscribeError フォールバックが効かないため、status 文字列で
        // 判定する (use-online-presence と同じ意味論)。
        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          optsRef.current.onSubscribeError?.(status, err ?? new Error(status));
        }
      });

    return () => {
      try {
        void supabase.removeChannel(channel);
      } catch (e) {
        console.warn(`[realtime:${table}] removeChannel error:`, e);
      }
    };
  }, [id, channelPrefix, table, filter]);
}

/**
 * `id` をキーに持つフラットリストを Realtime 購読するフック。
 *
 * - `incremental` 未指定 = **全件 refetch モード**: 変更が来るたび `load()` で
 *   全件取り直して state を差し替える。
 * - `incremental` 指定 = **payload incremental モード**: INSERT/UPDATE/DELETE を
 *   `payload` から直接適用 (INSERT/UPDATE は `map` + `sort`、DELETE は id 除去)。
 *   subscribe 失敗時や初期空時の保険に `load()` を使う。
 *
 * server-prefetch された `initial` の参照が差し替わったら state を追従させる
 * (`router.refresh()` 後など)。
 */
export function useRealtimeTable<Row, T extends { id: string }>(opts: {
  channelPrefix: string;
  table: string;
  filter?: string;
  initial: T[];
  /** 全件再取得 (refetch モードの本体 / incremental モードの保険)。 */
  load: () => Promise<T[]>;
  /** 指定すると incremental モードになる。 */
  incremental?: {
    map: (row: Row) => T;
    /** insert/update 後に新しい sort 済み配列を返す。 */
    sort: (list: T[]) => T[];
    /** 行フィルタ (例: kind 一致)。false の行は無視。 */
    accept?: (row: Row) => boolean;
  };
  /** 初期リストが空なら mount 時に 1 度だけ refetch する。 */
  refetchIfEmpty?: boolean;
  /** subscribe 失敗時に refetch でフォールバックする。 */
  refetchOnSubscribeError?: boolean;
}): T[] {
  const { initial } = opts;
  const [items, setItems] = useState<T[]>(initial);
  // load / incremental / フラグの最新版を async コールバックから参照する ref。
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  // initial の参照変化に追従。
  const initialRef = useRef(initial);
  useEffect(() => {
    if (initial !== initialRef.current) {
      initialRef.current = initial;
      setItems(initial);
    }
  }, [initial]);

  // unmount 後の setState を防ぐ cancelled ガード。
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const refetch = useCallback(async () => {
    try {
      const next = await optsRef.current.load();
      if (cancelledRef.current) return;
      setItems(next);
    } catch (e) {
      console.warn(`[realtime:${optsRef.current.table}] refetch failed:`, e);
    }
  }, []);

  const onChange = useCallback(
    (payload: RealtimeChangePayload) => {
      if (cancelledRef.current) return;
      const inc = optsRef.current.incremental;
      if (!inc) {
        void refetch();
        return;
      }
      const { map, sort, accept } = inc;
      if (payload.eventType === "INSERT") {
        const row = payload.new as Row | null;
        if (!row || (accept && !accept(row))) return;
        const next = map(row);
        setItems((prev) =>
          prev.some((x) => x.id === next.id) ? prev : sort([...prev, next]),
        );
      } else if (payload.eventType === "UPDATE") {
        const row = payload.new as Row | null;
        if (!row || (accept && !accept(row))) return;
        const updated = map(row);
        setItems((prev) =>
          prev.some((x) => x.id === updated.id)
            ? sort(prev.map((x) => (x.id === updated.id ? updated : x)))
            : sort([...prev, updated]),
        );
      } else if (payload.eventType === "DELETE") {
        const oldRow = payload.old as { id?: string } | null;
        const removedId = oldRow?.id;
        if (!removedId) return;
        setItems((prev) => prev.filter((x) => x.id !== removedId));
      }
    },
    [refetch],
  );

  useRealtimeChannel({
    channelPrefix: opts.channelPrefix,
    table: opts.table,
    filter: opts.filter,
    onChange,
    onSubscribeError: (status, err) => {
      console.warn(`[realtime:${opts.table}] subscribe error:`, status, err);
      if (optsRef.current.refetchOnSubscribeError) void refetch();
    },
  });

  // 初期空なら mount 時 1 度だけ実 fetch (server prefetch が無かった経路の保険)。
  const didEmptyCheck = useRef(false);
  useEffect(() => {
    if (didEmptyCheck.current) return;
    didEmptyCheck.current = true;
    if (optsRef.current.refetchIfEmpty && optsRef.current.initial.length === 0) {
      void refetch();
    }
  }, [refetch]);

  return items;
}
