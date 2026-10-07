/**
 * Discord に流す文のうち、メンバーが書いた部分を無害にする純関数
 * (2026-10-07 セキュリティ精査)。client / server のどこからでも呼べるよう、
 * 何も import しない。
 *
 * - Bot が投稿する本文: `allowed_mentions` でメンションは飛ばないが、
 *   Markdown (マスクリンク `[文](URL)` など) はそのまま描画される
 * - 人がコピーして貼る本文: 貼った人の権限でメンションが飛ぶ
 *
 * 検証: `node scripts/check-discord-text.mjs`
 */

const ZWSP = String.fromCharCode(0x200b);

/**
 * `@everyone` / `@here` / `<@id>` / `<@!id>` / `<@&role>` / `<#channel>` の
 * 構文を、ゼロ幅スペースを挟んで崩す (見た目はほぼ変わらない)。
 * ソースに不可視文字を埋め込まないよう codePoint から組み立てる。
 */
export function neutralizeMentions(s: string): string {
  return s
    .replace(/@(everyone|here)/g, "@" + ZWSP + "$1")
    .replace(/<(@[!&]?|#)/g, "<" + ZWSP + "$1");
}

/**
 * 行の途中に入る文の Markdown を、文字としてそのまま出す。マスクリンク
 * (`[文](URL)`)・強調・取り消し線・スポイラー・コードの記号の前に `\` を
 * 付ける。Discord は `\(` を `(` と描画するので、普通の記号の見た目は
 * 変わらない。行頭でしか効かない `#` / `>` / `-` は対象外 (呼び出し側が
 * 行頭に置かない)。
 */
export function escapeDiscordMarkdown(s: string): string {
  return s.replace(/[\\`*_~|[\]()]/g, "\\$&");
}

/**
 * 1 行に収める: 制御文字 (改行を含む) と連続する空白を 1 つの空白にする。
 * 改行で偽の見出しや別の段落を作らせないため。
 */
export function toSingleLine(s: string): string {
  return s
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
