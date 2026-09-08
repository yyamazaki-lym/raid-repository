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
import { useLocale, useMessages } from "@/lib/i18n/client";
import {
  isSameRoleColumn,
  roleOfName,
  type MemberRole,
  type RoleByName,
} from "@/lib/member-roles";
import { jobFromColumnLabel, roleOfJob } from "@/lib/jobs";
import { MyJobPicker } from "./my-job-picker";

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
 * ## ロール別 (UI-4、2026-09-08)
 *
 * 絞り方を 3 段にした: **全部 / 自分のロール / 自分だけ**。ノートの UI-4 は
 * 「テキストモード All / Role Only / Image Only」だが、Image Only は
 * 攻略データの構造化入力が前提で今は作れない。**ロールで絞る**ところまでを
 * 先に入れる (ノート自身が「まず軽減カードの『自分の担当だけ』を拡張」と
 * 書いている)。
 *
 * ロールは `native_schedule_members.role` を表示名で引く (`memberRoles`)。
 * ⚠ **自分のロールが分からないときはロール絞りを出さない** — 押しても
 * 全部が残るだけのボタンは、壊れているように見える。
 *
 * ## ジョブで列に当てる (L-8、2026-09-08)
 *
 * 実機報告「ロール設定が分かりにくい / 軽減表のどの列が自分か分からない」
 * への対応。実物の軽減表は **見出しがアイコン画像**で、担当は
 * `アドル (赤魔道士)` のように**ジョブ名**で書かれている。表示名を
 * 見出し行に突き合わせる従来の判定では 1 列も当たらず、「一致する列が
 * 見つかりません」しか出せていなかった。
 *
 * そこで `columnJobs` (列番号 → ジョブ、ページ側で列ラベルから解決) と
 * `myJob` (本人が選んだジョブ) を受け取り、**ジョブで列に当てる**。
 * 表示名による従来の判定は**残す** — 見出しにメンバー名を書く固定を
 * 壊さないため。両方あればジョブを優先する (シートの構造から読めた方が
 * 確度が高い)。
 *
 * ジョブの設定 UI (`MyJobPicker`) も**この画面に置く**。設定ダイアログの
 * メンバー一覧の奥にしか無かったのが「分かりにくい」の実体で、しかも
 * そこは admin しか触れなかった。
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
  memberRoles,
  columnJobs,
  myJob = null,
  myRegistered = false,
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
  /**
   * UI-4 (2026-09-08): 表示名 → ロールの対応。空なら「自分のロールだけ」の
   * トグルを出さない。
   */
  memberRoles?: RoleByName;
  /**
   * L-8 (2026-09-08): 列番号 → ジョブのキー。軽減表の列ラベル
   * (`アドル (赤魔道士)`) から解決したもの。ジョブが読めなかった列は
   * 入っていない。
   */
  columnJobs?: Record<number, string>;
  /** L-8: 本人のジョブ (`native_schedule_members.job`)。未設定は null。 */
  myJob?: string | null;
  /** L-8: メンバー一覧に本人の行があるか (無いとジョブを保存できない)。 */
  myRegistered?: boolean;
}) {
  const m = useMessages();
  const locale = useLocale();
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
  // UI-4 (2026-09-08): 絞り方は 3 段 (全部 / 自分のロール / 自分だけ)。
  const [filterMode, setFilterMode] = useState<"all" | "role" | "mine">("all");
  const [editingName, setEditingName] = useState(false);

  const myColumn = useMemo(
    () => (name.trim() ? findMemberColumn(table, name) : null),
    [table, name],
  );

  // L-8: ジョブの設定はこの画面から変えられるので、保存後の値を持つ。
  const [jobDraft, setJobDraft] = useState<string | null>(null);
  const job = jobDraft ?? myJob;

  // L-8: 自分のジョブに当たる列 (シートのジョブ名の行から解決済み)。
  const myJobColumns = useMemo(() => {
    if (!job || !columnJobs) return [] as number[];
    return Object.entries(columnJobs)
      .filter(([, v]) => v === job)
      .map(([k]) => Number(k))
      .sort((a, b) => a - b);
  }, [columnJobs, job]);

  /** 「自分の担当だけ」に絞れるか (ジョブ優先、無ければ表示名)。 */
  const hasMine = myJobColumns.length > 0 || myColumn !== null;

  // 自分のロール。**ジョブから導出したものを優先**し、無ければ表示名で
  // メンバー一覧を引く (ジョブを入れる前の固定を壊さない)。
  const myRole: MemberRole | null = useMemo(
    () => roleOfJob(job) ?? (memberRoles ? roleOfName(memberRoles, name) : null),
    [job, memberRoles, name],
  );

  /** 列のロール (ジョブから解決できた列だけ)。 */
  const roleOfColumn = useMemo(() => {
    const out = new Map<number, MemberRole>();
    for (const [k, v] of Object.entries(columnJobs ?? {})) {
      const r = roleOfJob(v);
      if (r) out.set(Number(k), r);
    }
    return out;
  }, [columnJobs]);

  // 見出し列 (0 番) は常に残す。
  //   mine … 自分の列だけ
  //   role … 自分と同じロールの列だけ
  //   all  … 全部
  const visibleColumns = useMemo(() => {
    const all = table.headers.map((_, i) => i);
    if (filterMode === "mine") {
      if (myJobColumns.length > 0) return myJobColumns;
      if (myColumn !== null) return [myColumn];
    }
    if (filterMode === "role" && myRole !== null) {
      // ジョブで解決できた列が 1 つでもあれば**そちらで絞る**
      // (シートの構造から読めているので確度が高い)。
      if (roleOfColumn.size > 0) {
        return all.slice(1).filter((i) => roleOfColumn.get(i) === myRole);
      }
      if (memberRoles) {
        return all
          .slice(1)
          .filter((i) =>
            isSameRoleColumn({
              roleByName: memberRoles,
              myName: name,
              columnName: table.headers[i] ?? null,
            }),
          );
      }
    }
    return all.slice(1);
  }, [
    table.headers,
    filterMode,
    myColumn,
    myJobColumns,
    memberRoles,
    myRole,
    roleOfColumn,
    name,
  ]);

  const href = safeHref(sheetUrl);

  // 行 → カードデータ (ノイズセル除去・見出し昇格は buildSheetCardRows 参照)。
  const cardRows = useMemo(
    () =>
      buildSheetCardRows(table, visibleColumns, {
        mitigation: variant === "mitigation",
        columnLabels,
        ignoreRows,
        locale,
      }),
    [table, visibleColumns, variant, columnLabels, ignoreRows, locale],
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
          <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground">
            {m.sheetCards.rows(table.rows.length)}
          </span>
        </div>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-sm border border-border/50 px-2 py-1 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase transition-colors hover:text-foreground"
          >
            {m.sheetCards.editInSheets}
            <ExternalLink className="h-2.5 w-2.5 opacity-70" aria-hidden />
          </a>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* UI-4 (2026-09-08): 全部 / 自分のロール / 自分だけ。
            ⚠ 自分のロールが分からないときは「自分のロール」を出さない
            (押しても全部が残るだけのボタンは壊れて見える)。 */}
        {hasMine && !editingName ? (
          <span className="inline-flex overflow-hidden rounded-md border border-border/60">
            {(
              [
                ["all", m.sheetCards.filterAll],
                ...(myRole !== null
                  ? ([
                      [
                        "role",
                        // L-8: どのロールで絞るのかを名前で出す
                        // (「自分のロール」だけでは何が残るか分からない)。
                        `${m.sheetCards.filterRole} (${m.nativeMembers.roleNames[myRole]})`,
                      ],
                    ] as const)
                  : []),
                ["mine", m.sheetCards.onlyMine],
              ] as ReadonlyArray<readonly [typeof filterMode, string]>
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setFilterMode(mode)}
                aria-pressed={filterMode === mode}
                className={
                  "px-2 py-1 text-[11px] tracking-normal transition-colors " +
                  (filterMode === mode
                    ? "bg-[var(--neon-cyan)]/15 text-[var(--neon-cyan)]"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {mode === "all" && (
                  <Filter className="mr-1 inline h-3 w-3" aria-hidden />
                )}
                {label}
              </button>
            ))}
          </span>
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
              placeholder={m.sheetCards.namePlaceholder}
              className="h-8 w-52 text-[12px]"
              aria-label={m.sheetCards.nameAria}
            />
            <Button type="submit" size="sm" className="text-[11px]">
              {m.common.save}
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
            {name ? m.sheetCards.displayName(name) : m.sheetCards.setDisplayName}
          </Button>
        )}
        {filterMode !== "all" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setFilterMode("all")}
            className="gap-1.5 text-[11px] tracking-normal text-muted-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {m.sheetCards.showAll}
          </Button>
        )}
      </div>

      {/* L-8 (2026-09-08): ジョブの設定をこの画面に置く。設定ダイアログの
          メンバー一覧の奥にしか無く、しかも admin しか触れなかったのが
          「ロール設定が分かりにくい」の実体だった。 */}
      {variant === "mitigation" && (
        <MyJobPicker
          job={job}
          registered={myRegistered}
          onChanged={setJobDraft}
        />
      )}

      {/* ロール色の凡例。どの色がどのロールかを画面に書いておく
          (実機報告「どこが対応するロール名か分からない」)。 */}
      {variant === "mitigation" && roleOfColumn.size > 0 && (
        <p className="flex flex-wrap items-center gap-2 px-1 text-[11px] text-muted-foreground">
          {(["tank", "healer", "dps"] as const).map((r) => (
            <span key={r} className="inline-flex items-center gap-1">
              <span
                className={"inline-block h-2.5 w-2.5 rounded-sm border " + ROLE_TONE[r]}
                aria-hidden
              />
              {m.nativeMembers.roleNames[r]}
            </span>
          ))}
        </p>
      )}

      {name.trim() && !hasMine && (
        <p className="rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          {m.sheetCards.noMatchingColumn(name)}
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
                  <span className="text-muted-foreground/70">
                    {m.sheetCards.untitled}
                  </span>
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
                          className="text-[12px] text-muted-foreground/60"
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
                        <span className="max-w-[8rem] truncate font-mono text-[11px] tracking-[0.1em] text-muted-foreground">
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
                      title={m.sheetCards.target}
                    >
                      <span className="font-mono text-[11px] tracking-[0.1em] text-muted-foreground uppercase">
                        {m.sheetCards.target}
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
                      title={`${c.label || m.sheetCards.ownerFallback}: ${c.value}`}
                    >
                      <span className="font-mono text-[11px] tracking-[0.08em] text-[var(--neon-cyan)]/85">
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
                      <span aria-hidden className="text-[12px] text-[var(--neon-violet)]">
                        ✓
                      </span>
                      {c.owner && (
                        <span className="font-mono text-[11px] tracking-[0.08em] text-[var(--neon-violet)]/85">
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
                      <dt className="truncate font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
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
                  {m.sheetCards.noAssignment}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {hidden > 0 && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {m.sheetCards.hiddenRows(hidden)}
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
  // L-8 (2026-09-08): 実物の軽減表は `アドル (赤魔道士)` のように**ジョブ名**
  // で担当を書く。略号だけを見ていたので色が 1 つも付いていなかった。
  return roleOfJob(jobFromColumnLabel(label)?.key ?? null);
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
