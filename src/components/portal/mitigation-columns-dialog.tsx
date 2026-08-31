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
 * **ほとんどの列は自動で埋まる** (2026-08-31、実物の xlsx を解析): 軽減表
 * テンプレートは列ごとに「ジョブ名 / アビリティ名 / 対象種別」の 3 行を
 * 持ち、アイコンはそのアビリティ名で `Skill` シートから引かれているだけ
 * だった。名前はプレーンテキストで CSV にも出るので、画像を解析しなくても
 * 読める。この画面はその**上書き**と、シート側が空の列の補完に使う。
 *
 *   - 自動で読めた名前は入力欄の placeholder に出す (そのままでよい)
 *   - 「どの攻撃でチェックが入っているか」も添える
 *   - よく使う軽減名のワンタップ / まとめて貼り付け (`DO=牽制`)
 *   - アイコン画像の取得も残す (シート側が空の列を目で判断するため)
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
  autoLabels,
}: {
  categoryId: string;
  /** 現在表示中のシート (層) の gid。列構成が層ごとに違うため必須。 */
  gid: string;
  columns: SheetColumnDiagnostic[];
  initialLabels: Record<number, string>;
  /**
   * シートの見出し行から自動で読めた名前 (2026-08-31)。
   * ほとんどの列はこれで埋まるので、手入力は「シート側が空/誤りの列」
   * だけで済む。入力欄の placeholder に出して、上書きしたい人だけが
   * 書けばよい形にする。
   */
  autoLabels: Record<number, { name: string; job: string | null }>;
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
  /** アイコンが取れた列だけに絞る (取れていないうちは効かない)。 */
  const [onlyIcons, setOnlyIcons] = useState(true);
  /** 選び直せるアイコン行の候補と、いま選ばれているもの。 */
  const [candidates, setCandidates] = useState<
    Array<{ key: string; sheet: string; row: number; count: number; overlap: number }>
  >([]);
  const [selected, setSelected] = useState<string>("");
  /**
   * 自動判定で入れた列。選び直したときはこれだけ差し替える —
   * 手で書いた名前を消さず、かつ誤ったシートの名前を残さないため。
   */
  const [autoFilled, setAutoFilled] = useState<string[]>([]);
  /** 取得経路ごとの結果。失敗の切り分けに要るので成功時も残す。 */
  const [detectLog, setDetectLog] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [detecting, startDetect] = useTransition();

  // 名前を付ける対象 = チェック列 (と、既に名前を付けた列)。
  // ON が多い順に並べる — よく使う軽減ほど先に決められる。
  const checkColumns = useMemo(
    () => columns.filter((c) => c.role === "check").map((c) => c.index),
    [columns],
  );
  // アイコンが取れたら、それが「本当のアビリティ列」の定義。軽減表には
  // TRUE/FALSE を持つ非表示の計算列も多く、チェック列すべてを並べると
  // 無関係な列が混ざる (2026-08-31 実機で 172 列中の大半がノイズだった)。
  const iconColumns = useMemo(() => new Set(Object.keys(icons)), [icons]);
  const targets = useMemo(() => {
    const named = (c: SheetColumnDiagnostic) => Boolean(labels[String(c.index)]);
    // 使っていないジョブの列も TRUE/FALSE を持つため、チェックが 1 つも
    // 無い列を並べるとノイズになる (実機で 172 列中の大半)。
    const pool = columns.filter(
      (c) => (c.role === "check" && c.checkedCount > 0) || named(c),
    );
    const withIcon = pool.filter((c) => iconColumns.has(String(c.index)));
    const list = onlyIcons && withIcon.length > 0 ? withIcon : pool;
    return [...list].sort((a, b) => b.checkedCount - a.checkedCount);
  }, [columns, labels, iconColumns, onlyIcons]);
  const namedCount = targets.filter((c) => labels[String(c.index)]?.trim()).length;

  /**
   * シートの HTML ビューからアイコン画像を取り、公式ジョブガイドと
   * 突き合わせて名前を埋める。名前が引けなかった列もアイコンだけは出す。
   * 既に入力済みの名前は上書きしない (人の入力を機械が壊さない)。
   */
  const onDetect = (pick: string | null = null) => {
    startDetect(async () => {
      const r = await detectMitigationIconsAction(
        categoryId,
        gid,
        checkColumns,
        pick,
      );
      setDetectLog(r.diagnostics);
      if (!r.ok) {
        setDetectNote(r.reason);
        setCandidates([]);
        toast.error("アイコンを取得できませんでした");
        return;
      }
      setCandidates(r.candidates);
      setSelected(r.selected);
      const nextIcons: Record<string, string> = {};
      const filled: Record<string, string> = {};
      // 前回の自動判定ぶんは一旦外す (選び直し = 前回が誤りだったということ)。
      const base: Record<string, string> = { ...labels };
      for (const k of autoFilled) delete base[k];
      for (const icon of r.icons) {
        const key = String(icon.column);
        nextIcons[key] = icon.iconUrl;
        if (icon.guessedName && !base[key]?.trim()) {
          // ジョブも分かるなら添える (同名のアビリティを持つジョブが複数
          // あるため、どのジョブが入れるのかが分かる方が実用的)。
          filled[key] = icon.job
            ? `${icon.guessedName} (${icon.job})`
            : icon.guessedName;
        }
      }
      setIcons(nextIcons);
      const added = Object.keys(filled).length;
      setAutoFilled(Object.keys(filled));
      setLabels({ ...base, ...filled });
      setDetectNote(
        r.namedCount === 0
          ? `${r.source} から ${r.icons.length} 列を読み取りましたが、名前は分かりませんでした。アイコンを見て入力してください。`
          : `${r.source} から ${r.icons.length} 列を読み取り、${added} 列に名前を入れました。保存すると以降は自動で表示されます。`,
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
              軽減表は列ごとに<strong>ジョブ名 / アビリティ名 / 対象種別</strong>
              の見出しを持っています。「シートから読み取る」でそこから名前を
              取り込めます。読めなかった列だけ、
              <strong>どの攻撃でチェックされているか</strong>
              を手がかりに入力してください。名前はカードの種別の横に ✓ 付きで
              並びます。
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-secondary/15 px-3 py-1.5 text-[11px]">
            <span className="text-muted-foreground">
              対象 {targets.length} 列 / 名前あり{" "}
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
              onClick={() => onDetect(null)}
              disabled={detecting}
              className="text-[11px] tracking-normal"
            >
              <Wand2 className="h-3.5 w-3.5" aria-hidden />
              {detecting ? "読み取り中..." : "シートから読み取る"}
            </Button>
            {iconColumns.size > 0 && (
              <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={onlyIcons}
                  onChange={(e) => setOnlyIcons(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--neon-cyan)]"
                />
                アイコンのある列だけ ({iconColumns.size})
              </label>
            )}
            <span className="text-[10px] leading-relaxed text-muted-foreground/70">
              シートの見出し行からアビリティ名とジョブを読み取り、アイコンと
              一緒に埋めます。<strong>保存すると以降は自動で表示されます</strong>。
            </span>
          </div>
          {candidates.length > 1 && (
            // gid (層) と xlsx のシートは機械的に結び付けられないため、
            // 自動選択が外れたら人が選び直せるようにする。
            <label className="flex flex-wrap items-center gap-2 rounded-md border border-border/40 bg-secondary/10 px-3 py-2 text-[11px] text-muted-foreground">
              <span>アイコン行</span>
              <select
                value={selected}
                onChange={(e) => onDetect(e.target.value)}
                disabled={detecting}
                className="min-w-0 flex-1 rounded-md border border-input/70 bg-background/60 px-2 py-1 text-[11px] text-foreground"
              >
                {candidates.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.sheet} / {c.row + 1}行目 / アイコン{c.count} / 一致
                    {c.overlap}
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-muted-foreground/70">
                違うシートが選ばれていたらここで変更
              </span>
            </label>
          )}
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
                const auto = autoLabels[c.index];
                return (
                  <li
                    key={c.index}
                    className={
                      "flex flex-col gap-1.5 rounded-md border px-3 py-2 " +
                      (value.trim() || autoLabels[c.index]
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
                      {auto && (
                        <span className="inline-flex items-center gap-1 rounded-sm border border-emerald-400/30 bg-emerald-400/5 px-1.5 py-0.5 text-[10px] text-emerald-200/90">
                          {auto.name}
                          {auto.job ? ` / ${auto.job}` : ""}
                        </span>
                      )}
                      <Input
                        value={value}
                        onChange={(e) =>
                          setLabels((prev) => ({
                            ...prev,
                            [key]: e.target.value,
                          }))
                        }
                        placeholder={
                          auto ? `${auto.name} (シートの名前を使用)` : "アビリティ名 (例: 牽制)"
                        }
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
