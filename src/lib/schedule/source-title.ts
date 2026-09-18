/**
 * character-sheets (デイコード) のスケジュールページ HTML から
 * **スケジュール名**を取り出す純関数。
 *
 * 2026-09-18: 複数スケジュールの登録・切替 UI で、URL だけでは
 * どれがどれか分からないため、元ページの名前を取得して並べる。
 *
 * ## 抽出元
 *
 * ページ共通レイアウトの見出し枠:
 *
 * ```html
 * <h1 id="title" class="title is-6">
 *     <span>スケジュール名</span>
 * </h1>
 * ```
 *
 * 実測 (2026-09-18, 存在しない key を GET): 無効な key でも
 * **HTTP 200** が返り、同じ枠に「画面を閉じてください。」、`<title>` に
 * 「データが存在しません。」が入るエラーページになる。つまり status では
 * 有効・無効を判別できないので、この枠の文言で判定する。
 *
 * 取れなかった場合は `<title>` を代替に使い、それも定型文なら null。
 * 呼び出し側 (設定 UI) は null のとき URL の key を代わりに表示し、
 * admin が手で名前を入れられるようにしてある。
 */
import { decodeHtmlEntities } from "@/lib/html-entities";
import { MAX_SCHEDULE_NAME_LENGTH } from "./registered-schedules";

/**
 * 名前として採用しない定型文 (エラーページ / サービス名そのもの)。
 * 完全一致でのみ弾く — ユーザーが付けた名前に偶然含まれても消さない。
 */
const NON_NAME_TITLES: ReadonlySet<string> = new Set([
  "画面を閉じてください。",
  "データが存在しません。",
  "エラーページ",
  "ログインしてください。",
  "デイコード（Discord連携日程調整サービス）",
]);

function htmlToText(fragment: string): string {
  return decodeHtmlEntities(fragment.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function pick(candidate: string | undefined): string | null {
  if (!candidate) return null;
  const text = htmlToText(candidate);
  if (!text) return null;
  if (NON_NAME_TITLES.has(text)) return null;
  return text.slice(0, MAX_SCHEDULE_NAME_LENGTH);
}

const H1_TITLE_RE = /<h1\b[^>]*\bid=["']title["'][^>]*>([\s\S]*?)<\/h1>/i;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;

/**
 * スケジュール名を返す。取れなければ null。
 *
 * 引数は list ページ (`/schedule/list?key=…`) の HTML を想定。
 */
export function extractScheduleName(html: string): string | null {
  return pick(html.match(H1_TITLE_RE)?.[1]) ?? pick(html.match(TITLE_RE)?.[1]);
}

/**
 * 「key が無効 / 削除済み」のエラーページかどうか。
 *
 * 有効判定ではなく **明確な不在の検出**に限る (レイアウト変更で誤検出
 * したときに、正常なページを登録できなくなる方が困るため)。
 */
export function isMissingSchedulePage(html: string): boolean {
  const h1 = html.match(H1_TITLE_RE)?.[1];
  const title = html.match(TITLE_RE)?.[1];
  for (const fragment of [h1, title]) {
    if (!fragment) continue;
    const text = htmlToText(fragment);
    if (text === "画面を閉じてください。" || text === "データが存在しません。") {
      return true;
    }
  }
  return false;
}
