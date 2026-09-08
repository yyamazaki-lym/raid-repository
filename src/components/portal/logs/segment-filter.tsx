/**
 * 練習ログ: 区間 (層 / フェーズ) の絞り込みセグメント (UI-5、2026-09-08)。
 *
 * 2026-08-30 の層フィルタは独立したチップが横に並ぶ形で、押せることは
 * 分かっても「1 つだけ選ぶ排他の選択」には見えていなかった。調査ノート
 * 第 4 回 8-3 UI-5 の「ネストタブが深くなる → **セグメントコントロールで
 * 1 段に**」に合わせ、枠を 1 つ持つ連結した 1 段のコントロールにする。
 * 絶では同じ形でフェーズ (P1〜) を絞れるようにした (従来は絶に絞り込みが
 * 無かった)。
 *
 * ## 選択中だけ識別色にする
 *
 * 非選択は全部 `text-muted-foreground` で、選択中のセグメントだけ層 /
 * フェーズの識別色 (`floorToneClass` / `phaseToneClass`) を載せる。全部に
 * 色を付けると「どれを選んでいるか」が色の濃さでしか分からなくなる
 * (色だけで状態を伝えないという `globals.css` の方針にも反する)。
 * 選択中は `aria-current="true"` も立てるので、色を見ない経路でも分かる。
 *
 * ⚠ 渡された識別色から `border-*` は落として使う (`withoutBorderTone`)。
 * この控えは枠を外側の 1 本に集約し、内側は `divide-x` で区切っているので、
 * セグメント側に border 色が乗ると**区切り線だけがその色になる** — しかも
 * `divide-border/40` とは同じ詳細度でスタイルシートの順序勝負になり、
 * 見た目が Tailwind の出力順に左右される。色表を二重に持たないために
 * 既存の tone をそのまま受け取り、ここで表示に要らない指定だけ外す。
 *
 * ## 押し直しで解除できる
 *
 * 選択中のセグメントをもう一度押すと「すべて」に戻る (2026-08-30 の
 * チップから引き継いだ挙動)。左端の「すべて」も残してあり、どちらでも
 * 解除できる — スマホでセグメントが多いときに端まで戻るのが面倒なため。
 */
"use client";

import { useMessages } from "@/lib/i18n/client";

export type SegmentChoice = {
  /** 内部の値 (層 index / フェーズ番号)。 */
  value: number;
  /** 表示ラベル (例: "3層" / "4層後半" / "P2")。 */
  label: string;
  /** 選択中のときに載せる識別色クラス (border + bg + text)。 */
  toneClass: string;
  /** hover / 読み上げの説明。 */
  title?: string;
};

export function SegmentFilter({
  choices,
  value,
  onChange,
  ariaLabel,
  allTitle,
}: {
  choices: SegmentChoice[];
  /** null = すべて。 */
  value: number | null;
  onChange: (next: number | null) => void;
  ariaLabel: string;
  /** 「すべて」の hover 説明。 */
  allTitle?: string;
}) {
  const m = useMessages();
  // 区間が 1 つしか無いカテゴリでは絞り込む意味が無い (「すべて」と
  // 「その 1 つ」が同じ結果になる)。
  if (choices.length <= 1) return null;

  // 連結した 1 段のコントロール。枠は外側の 1 本だけにして、内側は
  // 区切り線 (divide-x) で分ける — セグメントごとに枠を持つと、選択中の
  // 識別色の枠と二重になって太さが揃わない。
  const base =
    "px-2 py-0.5 font-mono text-[11px] tracking-normal tabular-nums transition-colors";
  const idle = "text-muted-foreground hover:bg-secondary/40 hover:text-foreground";
  // 既存の識別色 (border + bg + text) から border 指定だけ落とす。クラスを
  // 増やすのではなく減らすだけなので、Tailwind の生成対象は変わらない。
  const withoutBorderTone = (tone: string) =>
    tone
      .split(/\s+/)
      .filter((c) => c && !c.startsWith("border-"))
      .join(" ");

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex shrink-0 divide-x divide-border/40 overflow-hidden rounded-md border border-border/50"
    >
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-current={value === null ? "true" : undefined}
        title={allTitle}
        className={
          base +
          " " +
          (value === null
            ? "bg-[var(--neon-cyan)]/12 text-[var(--neon-cyan)]"
            : idle)
        }
      >
        {m.logs.allFloors}
      </button>
      {choices.map((c) => {
        const active = value === c.value;
        return (
          <button
            key={c.value}
            type="button"
            // 押し直しで解除 (docstring 参照)。
            onClick={() => onChange(active ? null : c.value)}
            aria-current={active ? "true" : undefined}
            title={c.title}
            className={
              base + " " + (active ? withoutBorderTone(c.toneClass) : idle)
            }
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
