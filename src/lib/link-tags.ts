/**
 * 攻略リンクのタグ (B-1、2026-09-07)。
 *
 * Discord 自動取り込みでリンクは溜まるが、「いま練習しているフェーズの
 * 資料」を探せない、というのが元の課題 (調査ノート第 1 回 B-1)。`tags`
 * テーブル (target_type='category_link') に人がラベルを付け、攻略タブで
 * 絞り込めるようにする。
 *
 * 本モジュールは **純関数だけ**。ラベルの正規化と、タイトル / URL からの
 * **候補**の推測を持つ。推測は候補止まりで、確定は人がチップを押す —
 * タイトル文字列は投稿者の書き方に依存し (「P3 練習」「3 フェーズ目」
 * 「ヘヴンリー」…)、機械的に付けると外れたタグが溜まって絞り込みが
 * かえって使えなくなる。
 *
 * 検証: `node scripts/check-link-tags.mjs`
 */

/** ラベルの最大長 (DB 側の CHECK と揃える)。 */
export const LINK_TAG_MAX_LENGTH = 24;
/** 1 リンクに付けられるタグ数の上限 (カードの表示が崩れない範囲)。 */
export const LINK_TAG_MAX_PER_LINK = 8;

/**
 * ラベルの正規化。前後の空白と全角空白を落とし、内部の連続空白を 1 つに
 * 畳む。大文字小文字は**変えない** (「AoE」「P3」の見た目を保つため)。
 */
export function normalizeLinkTag(raw: string): string {
  return raw.replace(/[\s　]+/g, " ").trim();
}

/**
 * ラベルが使えるか。空 / 長すぎるものを弾く。
 * 戻り値は「エラー理由」で、問題なければ null (repo の他の検証と同じ形)。
 */
export function linkTagError(raw: string): "empty" | "too_long" | null {
  const label = normalizeLinkTag(raw);
  if (label.length === 0) return "empty";
  if (label.length > LINK_TAG_MAX_LENGTH) return "too_long";
  return null;
}

/**
 * 2 つのラベルが同じものか (絞り込みと重複判定用)。
 * 正規化して大文字小文字を無視する — 「p3」と「P3」を別タグとして
 * 溜めたくない。
 */
export function sameLinkTag(a: string, b: string): boolean {
  return normalizeLinkTag(a).toLowerCase() === normalizeLinkTag(b).toLowerCase();
}

/**
 * フェーズ表記の検出。`P3` / `p3` / `フェーズ3` / `Phase 3` / `3フェーズ目`
 * を拾って `P3` に正規化する。
 *
 * 1〜9 に限る — 絶でも観測されている最深フェーズは 7 (絶竜詩) で、2 桁を
 * 許すと「P2026」のような年号や「P10 分」のような誤検出が増える。
 */
function detectPhases(text: string): string[] {
  const found = new Set<number>();
  const patterns = [
    // P3 / p3 / P3〜 (前後が英数字でないときだけ = 「MVP3」を拾わない)
    /(?:^|[^0-9A-Za-z])[Pp]\s?([1-9])(?![0-9])/g,
    // フェーズ3 / フェーズ 3
    /フェーズ\s?([1-9])(?![0-9])/g,
    // Phase 3 / phase3
    /[Pp]hase\s?([1-9])(?![0-9])/g,
    // 3フェーズ目 / 3 フェーズ目
    /([1-9])\s?フェーズ目/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) found.add(Number(m[1]));
  }
  return [...found].sort((a, b) => a - b).map((n) => `P${n}`);
}

/**
 * 資料の種別を表すキーワード辞書 (日英)。
 *
 * ここは**意図的に短く**保つ。ティア固有のギミック名 (「ヘヴンリー」
 * 「エクサフレア」…) を並べ始めると、パッチごとに辞書の保守が必要になり、
 * 外れたタグが絞り込みを汚す。どのティアでも意味が変わらない「資料の
 * 種類」だけを候補に出し、ギミック名は人が自由入力で足す。
 *
 * サイト種別 (Tomestone / FFLogs / xivgear …) は `link-site.ts` の
 * `detectFf14Resource()` がカードのバッジとして既に出しているので、
 * ここでは扱わない (二重表示を避ける)。
 */
const KIND_KEYWORDS: ReadonlyArray<{ label: string; patterns: RegExp[] }> = [
  { label: "散開", patterns: [/散開/, /スプレッド/i, /\bspread/i, /\bstack/i, /頭割り/] },
  { label: "タイムライン", patterns: [/タイムライン/, /\btimeline/i, /早見表/] },
  { label: "マクロ", patterns: [/マクロ/, /\bmacro/i] },
  { label: "軽減", patterns: [/軽減/, /\bmit(?:igation)?\b/i, /バリア/] },
  {
    label: "ギミック解説",
    // guide / guides どちらも拾う (URL のパスは複数形が多い)。
    patterns: [/ギミック/, /解説/, /\bmechanics?\b/i, /\bguides?\b/i],
  },
  { label: "動画", patterns: [/\bpov\b/i, /視点/, /録画/] },
  { label: "装備", patterns: [/\bbis\b/i, /装備/, /\bgear\b/i] },
];

/**
 * タイトル (と URL) からタグ候補を出す。
 *
 * 順序は「フェーズ → 種別」。カードに並べたとき P1..P7 が先頭に来ると
 * 一覧として読みやすいため。既に付いているタグ (`existing`) は候補から
 * 外す。
 */
export function suggestLinkTags(
  title: string,
  url?: string | null,
  existing: ReadonlyArray<string> = [],
): string[] {
  // URL は「パス / クエリに書かれた語」だけを見る。ホスト名を混ぜると
  // 「phase」を含むドメインなどで誤検出するため。
  let urlText = "";
  if (url) {
    try {
      const u = new URL(url);
      urlText = decodeURIComponent(u.pathname + u.search);
    } catch {
      urlText = "";
    }
  }
  const text = `${title} ${urlText}`;
  const out: string[] = [];
  for (const label of detectPhases(text)) out.push(label);
  for (const { label, patterns } of KIND_KEYWORDS) {
    if (patterns.some((re) => re.test(text))) out.push(label);
  }
  return out.filter(
    (label) => !existing.some((e) => sameLinkTag(e, label)),
  );
}

/**
 * タグの表示色 (Tailwind クラス)。ラベル文字列から決定的に選ぶので、
 * 同じタグはどのカードでも同じ色になる。
 *
 * フェーズタグ (P1〜P7) だけは練習ログと同じ色相に合わせる — 同じ「P3」が
 * ログでは indigo、攻略タブでは別色だと対応が取れないため。
 */
export function linkTagToneClass(label: string): string {
  const phase = /^P([1-9])$/.exec(normalizeLinkTag(label));
  if (phase) {
    // 練習ログの phaseToneClass と同じ色相 (fflogs-progress.ts)。
    const tones = [
      "border-sky-400/45 bg-sky-400/10 text-sky-200",
      "border-teal-400/45 bg-teal-400/10 text-teal-200",
      "border-indigo-400/45 bg-indigo-400/10 text-indigo-200",
      "border-violet-400/45 bg-violet-400/10 text-violet-200",
      "border-fuchsia-400/45 bg-fuchsia-400/10 text-fuchsia-200",
      "border-rose-400/45 bg-rose-400/10 text-rose-200",
      "border-amber-400/45 bg-amber-400/10 text-amber-200",
    ];
    const tone = tones[Number(phase[1]) - 1];
    if (tone) return tone;
  }
  // それ以外はラベルのハッシュで 5 色から。テーマ var を経由しない固定色に
  // する (テーマで色相が動くとタグの見分けがテーマ依存になる)。
  const palette = [
    "border-slate-400/40 bg-slate-400/10 text-slate-200",
    "border-cyan-400/40 bg-cyan-400/10 text-cyan-200",
    "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
    "border-orange-400/40 bg-orange-400/10 text-orange-200",
    "border-pink-400/40 bg-pink-400/10 text-pink-200",
  ];
  let hash = 0;
  const key = normalizeLinkTag(label).toLowerCase();
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) % 100000;
  }
  return palette[hash % palette.length]!;
}

/**
 * 絞り込み: リンクのタグ集合が選択中タグ (AND) を満たすか。
 *
 * AND にしているのは「P3 の 散開図」を出したいのが実際の用途だから。
 * OR で足し合わせると選ぶほど結果が増えて絞り込みにならない。
 */
export function linkMatchesTagFilter(
  linkTags: ReadonlyArray<string>,
  selected: ReadonlyArray<string>,
): boolean {
  if (selected.length === 0) return true;
  return selected.every((s) => linkTags.some((t) => sameLinkTag(t, s)));
}
