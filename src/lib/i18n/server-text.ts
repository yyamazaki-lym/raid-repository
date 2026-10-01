/**
 * Server Action が返す日本語の失敗理由を、表示言語に合わせて訳す
 * (2026-10-01 監査 U-6)。
 *
 * ## なぜ client で訳すのか
 *
 * Server Action の `reason` は日本語固定 (40 ファイル 360 箇所超) で、
 * `toast.error(r.reason)` などで素通しされるため、英語表示でも日本語の
 * トーストが出ていた。Action を error code 方式へ作り替えるのが本筋だが、
 * 呼び出し側 65 ファイル・Action 40 ファイルを一度に触ることになる。
 * そこで **日本語を正**のまま、表示の手前で 1 箇所だけ訳す:
 *
 *   - 完全一致 (`exact`): 固定の文言
 *   - 雛形 (`templates`): `${...}` を含む文言。差し込み部分はそのまま運ぶ
 *   - `dbError()` の「{見出し}に失敗しました」(`labels`): 見出しだけ訳す
 *   - 文中の部分一致: 「保存失敗: 保存できませんでした」のように、client 側の
 *     英語の雛形に日本語の理由が埋め込まれた形も、日本語の部分だけ訳す
 *
 * 辞書に無い日本語はそのまま出す (意味の分からない英語を作らない)。新しい
 * 日本語の理由を足したのに辞書に無いと `scripts/check-server-text.mjs` が
 * CI で落ちる。
 *
 * `@/` を import しない純モジュール (check スクリプトが単体でコンパイルする)。
 */

export type ServerTextDictRaw = {
  /** 固定の文言 → 訳。キーはソースの文字列と完全一致させる。 */
  exact: Record<string, string>;
  /**
   * `${...}` を含む雛形 → 訳。訳の `{0}` `{1}` … に差し込み部分が順に入る。
   * キーはソースのテンプレートリテラルの中身と完全一致させる。
   */
  templates: Record<string, string>;
  /**
   * `dbError(見出し, …)` の見出し → 動詞句 (例: "create the link")。
   * 「{見出し}に失敗しました」を「Failed to {動詞句}」にする。見出しが
   * `${...}` を含むときは雛形と同じく `{0}` に差し込む。
   */
  labels: Record<string, string>;
};

type Rule = { re: RegExp; to: (m: RegExpExecArray) => string };

export type ServerTextDict = {
  /** 長い順 (部分一致で短いものが先に当たらないように)。 */
  exact: Array<[string, string]>;
  rules: Rule[];
};

const JA_RE = /[ぁ-んァ-ヶ一-龠ー]/;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `${...}` を含む雛形を正規表現に。先頭の差し込みは空白まで、末尾は最後まで。 */
function templateToRegex(template: string): RegExp {
  const parts = template.split(/\$\{[^}]*\}/);
  let src = "";
  parts.forEach((part, i) => {
    src += escapeRe(part);
    if (i < parts.length - 1) {
      const atStart = i === 0 && part === "";
      const atEnd = i === parts.length - 2 && parts[parts.length - 1] === "";
      src += atStart ? "(\\S+)" : atEnd ? "(.+)" : "(.+?)";
    }
  });
  return new RegExp(src, "g");
}

function fill(to: string, m: RegExpExecArray): string {
  return to.replace(/\{(\d+)\}/g, (_, i: string) => m[Number(i) + 1] ?? "");
}

export function compileServerTextDict(raw: ServerTextDictRaw): ServerTextDict {
  const exact = Object.entries(raw.exact).sort((a, b) => b[0].length - a[0].length);
  const rules: Rule[] = [];
  // 見出しつき「…に失敗しました」は雛形より先に当てる (雛形の末尾が
  // 「失敗しました」で終わるものと取り合わないように、長い順)。
  const labelEntries = Object.entries(raw.labels).sort((a, b) => b[0].length - a[0].length);
  for (const [label, phrase] of labelEntries) {
    rules.push({
      re: templateToRegex(`${label}に失敗しました`),
      to: (m) => `Failed to ${fill(phrase, m)}`,
    });
  }
  const templateEntries = Object.entries(raw.templates).sort((a, b) => b[0].length - a[0].length);
  for (const [template, to] of templateEntries) {
    rules.push({ re: templateToRegex(template), to: (m) => fill(to, m) });
  }
  return { exact, rules };
}

/**
 * `text` の中の既知の日本語を訳す。`dict` が null (= 日本語表示、または
 * 辞書の読み込み前) なら何もしない。
 */
export function localizeServerText(text: string, dict: ServerTextDict | null): string {
  if (!dict || !JA_RE.test(text)) return text;
  // 1. 文全体が固定の文言
  for (const [ja, en] of dict.exact) if (text === ja) return en;
  let out = text;
  // 2. 雛形と「…に失敗しました」(文中にあっても訳す)
  for (const rule of dict.rules) {
    rule.re.lastIndex = 0;
    out = out.replace(rule.re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray;
      return rule.to(m);
    });
    if (!JA_RE.test(out)) return out;
  }
  // 3. 文中の固定の文言 (長い順)
  for (const [ja, en] of dict.exact) {
    if (out.includes(ja)) out = out.split(ja).join(en);
    if (!JA_RE.test(out)) break;
  }
  return out;
}

type ToastLike = Record<string, unknown>;
type ToastFn = (message: unknown, data?: unknown) => unknown;

/** 訳す対象のトースト関数 (sonner の `toast.*`)。 */
export const LOCALIZED_TOAST_METHODS = [
  "error",
  "warning",
  "info",
  "success",
  "message",
] as const;

/**
 * トーストの関数を「文言を訳してから出す」ものに差し替え、元に戻す関数を
 * 返す。訳すのは文字列の本文と `description` だけ (JSX はそのまま)。
 * 同じオブジェクトに二重に掛けない (HMR / StrictMode の二重 mount 対策)。
 */
export function patchToastMethods(
  toast: ToastLike,
  translate: (text: string) => string,
): () => void {
  const MARK = "__serverTextPatched";
  if ((toast as Record<string, unknown>)[MARK]) return () => {};
  const originals = new Map<string, ToastFn>();
  for (const name of LOCALIZED_TOAST_METHODS) {
    const orig = toast[name];
    if (typeof orig !== "function") continue;
    originals.set(name, orig as ToastFn);
    toast[name] = (message: unknown, data?: unknown) => {
      const msg = typeof message === "string" ? translate(message) : message;
      let opts = data;
      if (
        data &&
        typeof data === "object" &&
        typeof (data as { description?: unknown }).description === "string"
      ) {
        opts = {
          ...(data as object),
          description: translate((data as { description: string }).description),
        };
      }
      return (orig as ToastFn)(msg, opts);
    };
  }
  (toast as Record<string, unknown>)[MARK] = true;
  return () => {
    for (const [name, fn] of originals) toast[name] = fn;
    delete (toast as Record<string, unknown>)[MARK];
  };
}
