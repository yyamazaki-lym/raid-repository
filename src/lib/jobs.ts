import { JOB_ABBR } from "./fflogs-fight-detail";
import type { MemberRole } from "./member-roles";

/**
 * ジョブ (L-8、2026-09-08)。
 *
 * ## なぜジョブを持つのか
 *
 * 実機報告 L-8「ロール設定が分かりにくい / 軽減表のどの列が自分か
 * 分からない」への対応。軽減表の担当は**シートのジョブ名の行**に入って
 * いる (`sheet-csv.ts` の `AbilityHeaderRows.jobRow` → `buildAutoColumnLabels`
 * が `アドル (赤魔道士)` の形に組む)。つまり **列と本人を結ぶキーはジョブ名**
 * で、表示名やロールでは当たらない。
 *
 * ロールはジョブから**導出できる**ので、本人に選ばせるのはジョブだけに
 * する。設定が 1 つ減り、しかも軽減表の列に当たるようになる。
 *
 * ## これは「ゲームデータの表」ではないのか
 *
 * ⚠ この repo は軽減率・アイテムの層対応・技の CD といった
 * **パッチごとに変わる表は持たない**方針。ジョブの一覧は事情が違う:
 *
 * - 既に `fflogs-fight-detail.ts` の `JOB_ABBR` として**同じ表がある**
 *   (ワイプ原因の略称表示に使っている)。ここはその**キーをそのまま使い**、
 *   日本語名とロールを足しているだけで、新しい表は増やしていない。
 *   ⚠ 追加・変更は `JOB_ABBR` 側と**必ず両方**直すこと (この対応が
 *   崩れていないかは `scripts/check-jobs.mjs` が CI で見る)。
 * - 増えるのは**拡張パッチでジョブが実装されたときだけ**で、頻度が
 *   パッチ単位ではない。
 * - 外れても壊れない: 未知のジョブ名は「ロール不明」として扱い、
 *   絞り込みをしない (空の表を出すより全部見せる)。
 *
 * ## 保存する値
 *
 * DB (`native_schedule_members.job`) に入れるのは **FFLogs 名**
 * (`RedMage` 等)。死亡イベントの `job` と同じ体系なので、将来ログ側の
 * ジョブと突き合わせるときに変換が要らない。
 *
 * 検証: `node scripts/check-jobs.mjs`
 */

export type JobInfo = {
  /** DB / FFLogs のキー (例: RedMage)。 */
  key: string;
  /** 3 文字略称 (例: RDM)。`JOB_ABBR` と同じ値。 */
  abbr: string;
  /** 日本語名 (例: 赤魔道士)。 */
  ja: string;
  /** 英語名 (例: Red Mage)。 */
  en: string;
  role: MemberRole;
};

/**
 * ジョブの一覧 (ロールごと・ゲーム内の並び)。
 *
 * ⚠ キーは `JOB_ABBR` と 1 対 1。BLU (青魔道士) はレイド用ではないが、
 * `JOB_ABBR` にあるので落とさない (対応が崩れると検査で落ちる)。
 */
export const JOBS: readonly JobInfo[] = [
  { key: "Paladin", abbr: "PLD", ja: "ナイト", en: "Paladin", role: "tank" },
  { key: "Warrior", abbr: "WAR", ja: "戦士", en: "Warrior", role: "tank" },
  { key: "DarkKnight", abbr: "DRK", ja: "暗黒騎士", en: "Dark Knight", role: "tank" },
  { key: "Gunbreaker", abbr: "GNB", ja: "ガンブレイカー", en: "Gunbreaker", role: "tank" },
  { key: "WhiteMage", abbr: "WHM", ja: "白魔道士", en: "White Mage", role: "healer" },
  { key: "Scholar", abbr: "SCH", ja: "学者", en: "Scholar", role: "healer" },
  { key: "Astrologian", abbr: "AST", ja: "占星術師", en: "Astrologian", role: "healer" },
  { key: "Sage", abbr: "SGE", ja: "賢者", en: "Sage", role: "healer" },
  { key: "Monk", abbr: "MNK", ja: "モンク", en: "Monk", role: "dps" },
  { key: "Dragoon", abbr: "DRG", ja: "竜騎士", en: "Dragoon", role: "dps" },
  { key: "Ninja", abbr: "NIN", ja: "忍者", en: "Ninja", role: "dps" },
  { key: "Samurai", abbr: "SAM", ja: "侍", en: "Samurai", role: "dps" },
  { key: "Reaper", abbr: "RPR", ja: "リーパー", en: "Reaper", role: "dps" },
  { key: "Viper", abbr: "VPR", ja: "ヴァイパー", en: "Viper", role: "dps" },
  { key: "Bard", abbr: "BRD", ja: "吟遊詩人", en: "Bard", role: "dps" },
  { key: "Machinist", abbr: "MCH", ja: "機工士", en: "Machinist", role: "dps" },
  { key: "Dancer", abbr: "DNC", ja: "踊り子", en: "Dancer", role: "dps" },
  { key: "BlackMage", abbr: "BLM", ja: "黒魔道士", en: "Black Mage", role: "dps" },
  { key: "Summoner", abbr: "SMN", ja: "召喚士", en: "Summoner", role: "dps" },
  { key: "RedMage", abbr: "RDM", ja: "赤魔道士", en: "Red Mage", role: "dps" },
  { key: "Pictomancer", abbr: "PCT", ja: "ピクトマンサー", en: "Pictomancer", role: "dps" },
  { key: "BlueMage", abbr: "BLU", ja: "青魔道士", en: "Blue Mage", role: "dps" },
];

const BY_KEY = new Map(JOBS.map((j) => [j.key, j]));

/** DB に入っている値がジョブのキーとして妥当か。 */
export function isJobKey(v: unknown): v is string {
  return typeof v === "string" && BY_KEY.has(v);
}

export function jobInfo(key: string | null | undefined): JobInfo | null {
  if (!key) return null;
  return BY_KEY.get(key) ?? null;
}

/** ジョブのロール (未知は null = 絞り込みをしない)。 */
export function roleOfJob(key: string | null | undefined): MemberRole | null {
  return jobInfo(key)?.role ?? null;
}

/** 表示名 (表示言語に合わせる。略称は言語共通)。 */
export function jobLabel(
  key: string | null | undefined,
  locale: "ja" | "en" = "ja",
): string | null {
  const info = jobInfo(key);
  if (!info) return null;
  return locale === "en" ? info.en : info.ja;
}

/**
 * 表記からジョブを引く (シートのジョブ名の行を当てるため)。
 *
 * 当てる対象は日本語名 / 英語名 / 3 文字略称。⚠ **部分一致は取らない** —
 * 「白」「戦」のような 1 文字表記まで拾おうとすると別のジョブや
 * アビリティ名に誤爆する (「戦士」と「歴戦」など)。当たらなければ null で、
 * その列は「ジョブ不明」として絞り込みから外れるだけ。
 */
export function jobFromText(text: string | null | undefined): JobInfo | null {
  const t = normalizeJobText(text);
  if (!t) return null;
  for (const j of JOBS) {
    if (
      t === normalizeJobText(j.ja) ||
      t === normalizeJobText(j.en) ||
      t === normalizeJobText(j.abbr)
    ) {
      return j;
    }
  }
  return null;
}

/**
 * 「アドル (赤魔道士)」のような列ラベルからジョブを取り出す。
 *
 * `buildAutoColumnLabels` が `名前 (ジョブ)` の形に組むので、括弧の中を
 * 見る。括弧が無ければラベル全体をジョブ名として試す (ジョブ名だけが
 * 見出しに入っているシートのため)。
 */
export function jobFromColumnLabel(
  label: string | null | undefined,
): JobInfo | null {
  const raw = (label ?? "").trim();
  if (!raw) return null;
  // 全角括弧も見る。最後の括弧を採る (「牽制 (忍者)」のように末尾に付く)。
  const m = raw.match(/[(（]([^()（）]+)[)）]\s*$/);
  return jobFromText(m ? m[1] : raw);
}

/**
 * 列ラベルの表から「列番号 → ジョブのキー」を作る (L-8、2026-09-08)。
 *
 * 軽減表のカードを「自分の担当だけ」に絞るための対応表。ジョブが
 * 読み取れなかった列は**入れない** (絞り込みの対象外になるだけ)。
 */
export function buildColumnJobs(
  labels: Record<number, string> | undefined | null,
): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [k, v] of Object.entries(labels ?? {})) {
    const index = Number(k);
    if (!Number.isInteger(index) || index < 0) continue;
    const info = jobFromColumnLabel(v);
    if (info) out[index] = info.key;
  }
  return out;
}

/** 比較キー: 全角英数を半角化し、空白と中黒を落として小文字化。 */
function normalizeJobText(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .replace(/[\s　・]+/g, "")
    .toLowerCase();
}

/**
 * `JOB_ABBR` との対応が崩れていないかの自己点検 (検査スクリプトが使う)。
 * 戻り値は不一致の説明。空配列なら健全。
 */
export function jobTableMismatches(): string[] {
  const out: string[] = [];
  for (const j of JOBS) {
    const expected = JOB_ABBR[j.key];
    if (expected === undefined) {
      out.push(`JOB_ABBR に ${j.key} が無い`);
    } else if (expected !== j.abbr) {
      out.push(`${j.key}: JOBS=${j.abbr} / JOB_ABBR=${expected}`);
    }
  }
  for (const key of Object.keys(JOB_ABBR)) {
    if (!BY_KEY.has(key)) out.push(`JOBS に ${key} が無い`);
  }
  return out;
}
