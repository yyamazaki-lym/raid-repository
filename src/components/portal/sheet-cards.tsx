"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { ExternalLink, Filter, RotateCcw, Table2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeHref } from "@/lib/url-safe";
import {
  buildSheetCardRows,
  findMemberColumn,
  type SheetTable,
} from "@/lib/sheet-csv";
import {
  getStoredAuthorName,
  persistAuthorName,
} from "@/lib/schedule-memos-client";

/**
 * 軽減表 / ロット表の **読み取り専用カードビュー** (TODO #94 / A-3)。
 *
 * 1 行 = 1 カード。左端列 (フェーズ / ギミック名) をカードの見出しに、
 * 残りの列を「見出し: 値」の組にして縦に積む。iframe の 80% スケールでは
 * 読めなかったスマホでも、開催直前に必要な行だけ拾える形にする。
 *
 * 「自分の担当だけ」: 表示名 (日付メモと同じ localStorage キーを共有) が
 * 見出し行のどれかと一致すればその列だけを残す。一致しなければトグルは
 * 出さない — 固定ごとにシートの作りが違うので、規約を押し付けない。
 *
 * 編集は一切しない。編集導線は従来どおり Google Sheets 本体 (下のリンク /
 * PC の iframe)。
 */
export function SheetCards({
  table,
  sheetUrl,
  title,
  variant = "generic",
  columnLabels,
  ignoreRows,
}: {
  table: SheetTable;
  sheetUrl: string;
  title: string;
  /**
   * 列番号 → 表示名の手動登録 (2026-08-30)。チェックボックス列の見出しが
   * アイコン画像で CSV に文字が無い場合、ここで付けた名前で表示する。
   */
  columnLabels?: Record<number, string>;
  /** カードにしない行 (見出しの 3 行)。 */
  ignoreRows?: ReadonlySet<number>;
  /**
   * 2026-08-30: `mitigation` は軽減表向けの簡素カード — AA 行を除外し、
   * 素ダメージ → 軽減率 → 最終ダメージを数値サマリ行で、対象 (誰に
   * 入れるか) をチップで出す (ユーザー要望)。`generic` は従来どおり。
   */
  variant?: "generic" | "mitigation";
}) {
  // 表示名は localStorage 由来 (日付メモと同じキー)。SSR では空文字を返し、
  // hydration 後に実値へ差し替わるよう useSyncExternalStore を使う
  // (effect 内 setState を避ける = react-hooks/set-state-in-effect)。
  const storedName = useSyncExternalStore(
    subscribeStoredName,
    getStoredAuthorName,
    () => "",
  );
  // 入力中の値は draft として持ち、保存すると storedName 側に反映される。
  const [draftName, setDraftName] = useState<string | null>(null);
  const name = draftName ?? storedName;
  const [onlyMine, setOnlyMine] = useState(false);
  const [editingName, setEditingName] = useState(false);

  const myColumn = useMemo(
    () => (name.trim() ? findMemberColumn(table, name) : null),
    [table, name],
  );

  // 見出し列 (0 番) は常に残す。onlyMine のときは自分の列だけ追加。
  const visibleColumns = useMemo(() => {
    const all = table.headers.map((_, i) => i);
    if (!onlyMine || myColumn === null) return all.slice(1);
    return [myColumn];
  }, [table.headers, onlyMine, myColumn]);

  const href = safeHref(sheetUrl);

  // 行 → カードデータ (ノイズセル除去・見出し昇格は buildSheetCardRows 参照)。
  const cardRows = useMemo(
    () =>
      buildSheetCardRows(table, visibleColumns, {
        mitigation: variant === "mitigation",
        columnLabels,
        ignoreRows,
      }),
    [table, visibleColumns, variant, columnLabels, ignoreRows],
  );

  // 巨大なシート (数百行) をスマホで全部カード化すると描画が重くなるため
  // 上限を切る。超えた分は Sheets 本体で見てもらう (読み取り専用ビューなので
  // 情報が失われるわけではない)。
  const MAX_CARDS = 200;
  const shown = cardRows.slice(0, MAX_CARDS);
  const hidden = cardRows.length - shown.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Table2 className="h-4 w-4 text-[var(--neon-cyan)]" aria-hidden />
          <h2 className="font-display text-base">{title}</h2>
          <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
            {table.rows.length} 行
          </span>
        </div>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-sm border border-border/50 px-2 py-1 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase transition-colors hover:text-foreground"
          >
            Sheets で編集
            <ExternalLink className="h-2.5 w-2.5 opacity-70" aria-hidden />
          </a>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {myColumn !== null && !editingName ? (
          <Button
            type="button"
            size="sm"
            variant={onlyMine ? "default" : "outline"}
            onClick={() => setOnlyMine((v) => !v)}
            className="gap-1.5 text-[11px] tracking-normal"
            aria-pressed={onlyMine}
          >
            <Filter className="h-3.5 w-3.5" aria-hidden />
            {onlyMine ? `${name} の担当のみ` : "自分の担当だけ"}
          </Button>
        ) : null}
        {editingName ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const next = name.trim();
              persistAuthorName(next);
              setDraftName(next);
              setEditingName(false);
            }}
          >
            <Input
              autoFocus
              value={name}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="シートの見出しと同じ表示名"
              className="h-8 w-52 text-[12px]"
              aria-label="表示名"
            />
            <Button type="submit" size="sm" className="text-[11px]">
              保存
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditingName(true)}
            className="gap-1.5 text-[11px] tracking-normal text-muted-foreground"
          >
            <UserRound className="h-3.5 w-3.5" aria-hidden />
            {name ? `表示名: ${name}` : "表示名を設定"}
          </Button>
        )}
        {onlyMine && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setOnlyMine(false)}
            className="gap-1.5 text-[11px] tracking-normal text-muted-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            全部表示
          </Button>
        )}
      </div>

      {name.trim() && myColumn === null && (
        <p className="rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          見出し行に「{name}」に一致する列が見つかりませんでした。シートの
          見出しと同じ表記に直すと「自分の担当だけ」が使えます。
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {shown.map(({ heading, cells, checks, stats, target }, ri) => {
          return (
            <li
              key={ri}
              className="rounded-md border border-border/40 bg-secondary/20 px-3 py-2"
            >
              <p className="font-display text-sm break-words text-foreground">
                {heading || (
                  <span className="text-muted-foreground/70">（無題）</span>
                )}
              </p>
              {/* mitigation モード: ダメージ → 軽減率 → 最終の数値サマリと
                  対象チップ。値の意味が色で拾えるように kind ごとに配色
                  (素ダメ = rose / 軽減率 = sky / 最終 = emerald)。 */}
              {((stats && stats.length > 0) || target) && (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  {stats?.map((s, i) => (
                    <span key={i} className="inline-flex items-center gap-1">
                      {i > 0 && (
                        <span
                          aria-hidden
                          className="text-[10px] text-muted-foreground/60"
                        >
                          →
                        </span>
                      )}
                      <span
                        className={
                          "inline-flex items-baseline gap-1 rounded-sm border px-1.5 py-0.5 " +
                          (s.kind === "damage"
                            ? "border-rose-400/35 bg-rose-400/8"
                            : s.kind === "rate"
                              ? "border-sky-400/35 bg-sky-400/8"
                              : "border-emerald-400/35 bg-emerald-400/8")
                        }
                        title={s.label}
                      >
                        {/* 2026-08-30: シートの実際の列名を出す (種別名だと
                            「軽減率」が 2 つ並んで区別できなかった)。 */}
                        <span className="max-w-[8rem] truncate font-mono text-[9px] tracking-[0.1em] text-muted-foreground">
                          {s.label}
                        </span>
                        <span
                          className={
                            "font-mono text-[12px] tabular-nums " +
                            (s.kind === "damage"
                              ? "text-rose-200"
                              : s.kind === "rate"
                                ? "text-sky-200"
                                : "text-emerald-200")
                          }
                        >
                          {s.value}
                        </span>
                      </span>
                    </span>
                  ))}
                  {target && (
                    <span
                      className="inline-flex items-baseline gap-1 rounded-sm border border-violet-400/35 bg-violet-400/8 px-1.5 py-0.5"
                      title="対象"
                    >
                      <span className="font-mono text-[9px] tracking-[0.1em] text-muted-foreground uppercase">
                        対象
                      </span>
                      <span className="text-[12px] break-words text-violet-200">
                        {target}
                      </span>
                    </span>
                  )}
                </div>
              )}
              {/* 2026-08-30 実機要望「誰がどの軽減・バフを入れたか簡易的に
                  確認したい」: 軽減表では「担当者: スキル」を 1 行に畳んだ
                  チップで出す (縦に伸びる定義リストだと 1 画面に 2〜3 行しか
                  入らず、攻撃ごとの分担がひと目で追えなかった)。 */}
              {variant === "mitigation" && (cells.length > 0 || (checks && checks.length > 0)) ? (
                <ul className="mt-1 flex flex-wrap gap-1">
                  {cells.map((c, i) => {
                    const role = roleOf(c.label);
                    return (
                    <li
                      key={i}
                      className={
                        "inline-flex items-baseline gap-1 rounded-sm border px-1.5 py-0.5 " +
                        (role ? ROLE_TONE[role] : "border-border/40 bg-background/40")
                      }
                      title={`${c.label || "担当"}: ${c.value}`}
                    >
                      <span className="font-mono text-[10px] tracking-[0.08em] text-[var(--neon-cyan)]/85">
                        {c.label || "—"}
                      </span>
                      <span className="text-[12px] break-words text-foreground/90">
                        {c.value}
                      </span>
                    </li>
                    );
                  })}
                  {/* 2026-08-30 実機要望「チェックが付いたアビリティを Type の
                      横に出せないか」: 担当チップと同じ行に続けて並べる。
                      別ブロックにすると 1 攻撃が縦に伸びて追いにくかった。 */}
                  {checks?.map((c, i) => (
                    <li
                      key={`chk-${i}`}
                      className="inline-flex items-baseline gap-1 rounded-sm border border-[var(--neon-violet)]/45 bg-[var(--neon-violet)]/10 px-1.5 py-0.5"
                      title={c.owner ? `${c.owner}: ${c.label}` : c.label}
                    >
                      <span aria-hidden className="text-[10px] text-[var(--neon-violet)]">
                        ✓
                      </span>
                      {c.owner && (
                        <span className="font-mono text-[9px] tracking-[0.08em] text-[var(--neon-violet)]/85">
                          {c.owner}
                        </span>
                      )}
                      <span className="text-[12px] break-words text-foreground/90">
                        {c.label}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : cells.length > 0 ? (
                // 見出し列は max-content で伸びると長い担当者名でグリッドが
                // コンテナ幅を超えるため上限を切り、値列は最小 0 で必ず縮める。
                <dl className="mt-1.5 grid grid-cols-[minmax(3.5rem,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1">
                  {cells.map((c, i) => (
                    <div key={i} className="contents">
                      <dt className="truncate font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
                        {c.label || "—"}
                      </dt>
                      {/* URL のような区切りの無い長い文字列でも折り返す
                          (`break-words` = overflow-wrap: break-word)。 */}
                      <dd className="min-w-0 text-[12px] leading-relaxed break-words whitespace-pre-wrap text-foreground/90">
                        {c.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (stats && stats.length > 0) || target ? null : (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  この行に担当の記載はありません
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {hidden > 0 && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          残り {hidden} 行は表示していません。全体は「Sheets で編集」から確認してください。
        </p>
      )}
    </div>
  );
}

/**
 * 担当名からロールを推定する (2026-08-30)。軽減表の列見出しは
 * MT/ST/H1/H2/D1..D4 のようなロール略号が定番なので、それだけを拾って
 * 色付けする。実際のジョブアイコン画像は配布できない (著作物) ため、
 * ロール色のバッジで代替する。判定できなければ null。
 */
function roleOf(label: string): "tank" | "healer" | "dps" | null {
  const t = label.trim().toUpperCase();
  if (/^(MT|ST|T[12]?)\b/.test(t)) return "tank";
  if (/^(H[12]?)\b/.test(t)) return "healer";
  if (/^(D[1-4]?|DPS)\b/.test(t)) return "dps";
  return null;
}

/** ロール色 (FF14 のロールカラーに寄せる: タンク=青 / ヒーラー=緑 / DPS=赤)。 */
const ROLE_TONE: Record<"tank" | "healer" | "dps", string> = {
  tank: "border-sky-400/40 bg-sky-400/10",
  healer: "border-emerald-400/40 bg-emerald-400/10",
  dps: "border-rose-400/40 bg-rose-400/10",
};

/**
 * localStorage の表示名変更を購読する。同一タブ内の `storage` イベントは
 * 発火しないので、保存側 (この画面) は draft state で即時反映し、ここでは
 * 他タブからの変更だけを拾えば足りる。
 */
function subscribeStoredName(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
