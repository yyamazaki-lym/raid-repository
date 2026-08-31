"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Columns3, Save, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  detectMitigationIconsAction,
  setMitigationColumnLabelsAction,
} from "@/lib/server/categories-actions";
import type { SheetColumnDiagnostic } from "@/lib/sheet-csv";

/**
 * 軽減表の「アビリティ列に名前を付ける」設定 (2026-08-30 実機報告)。
 *
 * **なぜ手動なのか**: シート 26 行目のアビリティは *アイコン画像* で置かれて
 * おり、Google Sheets の CSV には画像が一切出力されない。ただし HTML ビュー
 * には `<img>` として出るので、
 *
 *   - 「アイコンから判定」で各列のアイコン画像を取り、公式ジョブガイドの
 *     アクションアイコンと突き合わせて **名前まで自動で埋める**
 *   - 名前が引けなくてもアイコン自体は列の横に表示する (見れば分かる)
 *   - 「どの攻撃でチェックが入っているか」も添える
 *     (例: キング・オブ・アルカディアで ON → 牽制)
 *   - よく使う軽減名のワンタップ / まとめて貼り付け (`DO=牽制`)
 *
 * という経路を用意して、入力の手間を最小にする。自動判定はあくまで補助で、
 * 失敗しても手入力で完結できる。
 */

/** ワンタップ用のよく使う軽減 / バフ (足りなければ自由入力)。 */
const QUICK_NAMES = [
  "リプライザル",
  "牽制",
  "アドル",
  "フェイイルミネーション",
  "ダークミッショナリー",
  "ハートオブライト",
  "士気高揚の策",
  "野戦治療の陣",
  "テンパランス",
  "疾風怒濤の計",
  "マクロコスモス",
  "光の囁き",
  "堅陣",
  "ランパート",
  "センチネル",
  "ネビュラ",
];

const ROLE_LABEL: Record<SheetColumnDiagnostic["role"], string> = {
  damage: "ダメージ",
  rate: "軽減率",
  final: "最終ダメージ",
  target: "対象",
  check: "チェック",
  text: "データ",
  empty: "空",
};

export function MitigationColumnsDialog({
  categoryId,
  gid,
  columns,
  initialLabels,
}: {
  categoryId: string;
  /** 現在表示中のシート (層) の gid。列構成が層ごとに違うため必須。 */
  gid: string;
  columns: SheetColumnDiagnostic[];
  initialLabels: Record<number, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [labels, setLabels] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(initialLabels).map(([k, v]) => [k, v]),
    ),
  );
  const [bulk, setBulk] = useState("");
  const [showDiag, setShowDiag] = useState(false);
  /** 列番号 → アイコン URL (「アイコンから判定」実行後に埋まる)。 */
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [detectNote, setDetectNote] = useState<string | null>(null);
  /** 取得経路ごとの結果。失敗の切り分けに要るので成功時も残す。 */
  const [detectLog, setDetectLog] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [detecting, startDetect] = useTransition();

  // 名前を付ける対象 = チェック列 (と、既に名前を付けた列)。
  // ON が多い順に並べる — よく使う軽減ほど先に決められる。
  const targets = useMemo(
    () =>
      columns
        .filter((c) => c.role === "check" || labels[String(c.index)])
        .sort((a, b) => b.checkedCount - a.checkedCount),
    [columns, labels],
  );
  const namedCount = targets.filter((c) => labels[String(c.index)]?.trim()).length;

  /**
   * シートの HTML ビューからアイコン画像を取り、公式ジョブガイドと
   * 突き合わせて名前を埋める。名前が引けなかった列もアイコンだけは出す。
   * 既に入力済みの名前は上書きしない (人の入力を機械が壊さない)。
   */
  const onDetect = () => {
    startDetect(async () => {
      const r = await detectMitigationIconsAction(categoryId, gid);
      setDetectLog(r.diagnostics);
      if (!r.ok) {
        setDetectNote(r.reason);
        toast.error("アイコンを取得できませんでした");
        return;
      }
      const nextIcons: Record<string, string> = {};
      const filled: Record<string, string> = {};
      for (const icon of r.icons) {
        const key = String(icon.column);
        nextIcons[key] = icon.iconUrl;
        if (icon.guessedName && !labels[key]?.trim()) {
          filled[key] = icon.guessedName;
        }
      }
      setIcons(nextIcons);
      const added = Object.keys(filled).length;
      if (added > 0) setLabels((prev) => ({ ...prev, ...filled }));
      setDetectNote(
        r.namedCount === 0
          ? `${r.source} からアイコン ${r.icons.length} 件を取得しましたが、名前は判定できませんでした。アイコンを見て入力してください。`
          : `${r.source} からアイコン ${r.icons.length} 件を取得し、${added} 列に名前を入れました (保存はまだです)。`,
      );
      toast.success(`アイコン ${r.icons.length} 件を取得しました`);
    });
  };

  const applyBulk = () => {
    // `DO=牽制` / `DO 牽制` / `DO:牽制` のいずれも受ける。
    const byLetter = new Map(columns.map((c) => [c.letter.toUpperCase(), c.index]));
    let applied = 0;
    const next = { ...labels };
    for (const line of bulk.split(/\r?\n/)) {
      const m = /^\s*([A-Za-z]{1,3})\s*[=:\s]\s*(.+?)\s*$/.exec(line);
      if (!m) continue;
      const idx = byLetter.get(m[1]!.toUpperCase());
      if (idx === undefined) continue;
      next[String(idx)] = m[2]!;
      applied += 1;
    }
    if (applied === 0) {
      toast.error("読み取れる行がありませんでした (例: DO=牽制)");
      return;
    }
    setLabels(next);
    setBulk("");
    toast.success(`${applied} 列に名前を入れました (保存はまだです)`);
  };

  const onSave = () => {
    startTransition(async () => {
      const r = await setMitigationColumnLabelsAction(categoryId, gid, labels);
      if (!r.ok) {
        toast.error("保存失敗: " + r.reason);
        return;
      }
      toast.success("アビリティ名を保存しました");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="チェック列にアビリティ名を付ける"
        className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 font-mono text-[11px] tracking-normal text-muted-foreground transition-colors hover:border-border hover:text-foreground"
      >
        <Columns3 className="h-3 w-3" aria-hidden />
        アビリティ名
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
      >
        <DialogContent className="flex max-h-[85dvh] w-[min(48rem,calc(100vw-2rem))] max-w-none flex-col overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>アビリティ名の設定 (このシート)</DialogTitle>
            <DialogDescription>
              シートのアビリティ欄は<strong>アイコン画像</strong>で作られており、
              名前の文字が読み取れません。各列が
              <strong>どの攻撃でチェックされているか</strong>
              を手がかりに名前を付けてください。付けた名前はカードの
              種別の横に ✓ 付きで並びます。
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-secondary/15 px-3 py-1.5 text-[11px]">
            <span className="text-muted-foreground">
              チェック列 {targets.length} 件 / 名前あり{" "}
              <strong className="text-foreground">{namedCount}</strong> 件
            </span>
            <span className="font-mono text-[10px] text-muted-foreground/70">
              gid {gid || "(既定)"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onDetect}
              disabled={detecting}
              className="text-[11px] tracking-normal"
            >
              <Wand2 className="h-3.5 w-3.5" aria-hidden />
              {detecting ? "判定中..." : "アイコンから判定"}
            </Button>
            <span className="text-[10px] leading-relaxed text-muted-foreground/70">
              シートのアイコン画像を読み取り、公式ジョブガイドの
              アクションアイコンと突き合わせて名前を埋めます。
            </span>
          </div>
          {detectNote && (
            <div className="rounded-md border border-border/40 bg-secondary/15 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              <p>{detectNote}</p>
              {detectLog.length > 0 && (
                // どの経路で何が返ったかをそのまま出す。「取得できません
                // でした」だけでは共有設定・URL・シートの作りのどれが原因か
                // 切り分けられないため。
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[10px] text-muted-foreground/70">
                    取得の詳細 ({detectLog.length} 件)
                  </summary>
                  <ul className="mt-1 flex flex-col gap-0.5 font-mono text-[10px] text-muted-foreground/80">
                    {detectLog.map((line, i) => (
                      <li key={i} className="break-all">
                        {line}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {targets.length === 0 ? (
            <p className="rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              チェックボックスの列が見つかりませんでした。下の「全列の判定
              結果」で、想定した列がどう判定されているか確認してください。
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {targets.map((c) => {
                const key = String(c.index);
                const value = labels[key] ?? "";
                return (
                  <li
                    key={c.index}
                    className={
                      "flex flex-col gap-1.5 rounded-md border px-3 py-2 " +
                      (value.trim()
                        ? "border-emerald-400/35 bg-emerald-400/5"
                        : "border-border/40 bg-background/30")
                    }
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex h-6 min-w-10 items-center justify-center rounded-sm border border-[var(--neon-cyan)]/45 bg-[var(--neon-cyan)]/10 px-1.5 font-mono text-[12px] text-[var(--neon-cyan)]">
                        {c.letter}
                      </span>
                      {icons[key] && (
                        // シート上の実アイコン。名前が引けなくても、これが
                        // 出ていれば何の軽減か人が判断できる。
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={icons[key]}
                          alt=""
                          className="h-6 w-6 shrink-0 rounded-sm border border-border/40 bg-background/40 object-contain"
                          loading="lazy"
                        />
                      )}
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                        ON {c.checkedCount}
                      </span>
                      <Input
                        value={value}
                        onChange={(e) =>
                          setLabels((prev) => ({
                            ...prev,
                            [key]: e.target.value,
                          }))
                        }
                        placeholder="アビリティ名 (例: 牽制)"
                        className="h-8 min-w-0 flex-1 text-[12px]"
                        aria-label={`${c.letter} 列のアビリティ名`}
                        list="mitigation-name-suggestions"
                      />
                      {value.trim() && (
                        <Check
                          className="h-3.5 w-3.5 shrink-0 text-emerald-300"
                          aria-hidden
                        />
                      )}
                    </div>
                    {c.checkedOn.length > 0 && (
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        <span className="text-muted-foreground/70">
                          チェックされている攻撃:{" "}
                        </span>
                        {c.checkedOn.join(" / ")}
                        {c.checkedCount > c.checkedOn.length && " …"}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* 候補のワンタップ入力 (datalist は入力欄の補完にも効く) */}
          <datalist id="mitigation-name-suggestions">
            {QUICK_NAMES.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>

          {/* まとめて入力 */}
          <details className="rounded-md border border-border/40 bg-secondary/10 px-3 py-2">
            <summary className="cursor-pointer text-[11px] text-muted-foreground">
              まとめて入力 (列記号 = 名前)
            </summary>
            <div className="mt-2 flex flex-col gap-1.5">
              <textarea
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
                rows={4}
                spellCheck={false}
                placeholder={"DO=牽制\nEA=アドル\nCQ=リプライザル"}
                className="w-full rounded-md border border-input/70 bg-background/40 px-2 py-1.5 font-mono text-[11px] focus:border-[var(--neon-cyan)]/60 focus:outline-none"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={applyBulk}
                className="w-fit text-[11px] tracking-normal"
              >
                反映する
              </Button>
            </div>
          </details>

          {/* 診断は通常畳んでおく (普段は名前を付けるだけで足りる) */}
          <div className="rounded-md border border-border/40">
            <button
              type="button"
              onClick={() => setShowDiag((v) => !v)}
              aria-expanded={showDiag}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ChevronDown
                className={
                  "h-3 w-3 transition-transform " +
                  (showDiag ? "rotate-0" : "-rotate-90")
                }
                aria-hidden
              />
              全列の判定結果を見る ({columns.length} 列)
            </button>
            {showDiag && (
              <div className="max-h-[16rem] overflow-auto border-t border-border/30">
                <table className="w-full min-w-[28rem] text-left text-[11px]">
                  <thead className="sticky top-0 bg-secondary/60">
                    <tr className="text-muted-foreground">
                      <th className="px-2 py-1 font-medium">列</th>
                      <th className="px-2 py-1 font-medium">見出し</th>
                      <th className="px-2 py-1 font-medium">判定</th>
                      <th className="px-2 py-1 font-medium">中身の例</th>
                    </tr>
                  </thead>
                  <tbody>
                    {columns.map((c) => (
                      <tr key={c.index} className="border-t border-border/30">
                        <td className="px-2 py-1 font-mono text-muted-foreground">
                          {c.letter}
                        </td>
                        <td className="max-w-[9rem] truncate px-2 py-1">
                          {c.header || (
                            <span className="text-muted-foreground/60">
                              (アイコン等)
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          {ROLE_LABEL[c.role]}
                          {c.role === "check" ? ` ${c.checkedCount}` : ""}
                        </td>
                        <td className="max-w-[12rem] truncate px-2 py-1 text-muted-foreground">
                          {c.samples.join(" / ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              閉じる
            </Button>
            <Button type="button" onClick={onSave} disabled={pending}>
              <Save className="h-3.5 w-3.5" aria-hidden />
              {pending ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
