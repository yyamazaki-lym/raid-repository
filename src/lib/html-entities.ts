/**
 * HTML エンティティ decoder。スクレイピングや og:title 抽出など、
 * HTML から取り出した文字列に対して名前付き / 数値参照を Unicode 文字に
 * 復号する共通ユーティリティ。
 *
 * カバー範囲:
 *   - HTML4 / HTML5 で頻出する名前付きエンティティ (`&times;`, `&hellip;`,
 *     `&laquo;` など)
 *   - 数値参照 (`&#1234;`, `&#xABCD;`) — `String.fromCodePoint` で全 BMP
 *     + Supplementary plane に対応 (絵文字含む)
 *
 * `&amp;` を最初に処理することで `&amp;hellip;` のような二重エンコードも
 * `&hellip;` → `…` の連鎖で正しく復号できる。
 *
 * 1.9 (2026-04-28) — TODO #13: 散在していた 3 種の不完全 decoder
 * (`schedule/parse.ts` の `stripHtmlToText` と `decodeEntities`、
 * `server/page-title.ts` の `decodeEntities`) を統合してこの 1 箇所に集約。
 * 「読み込んだ文字が文字コードのまま表示される」報告への対応。
 *
 * Pure server-friendly (no DOM dep) なので server / client 両方から呼べる。
 */
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    // 算術 / 記号
    .replace(/&times;/g, "×")
    .replace(/&divide;/g, "÷")
    .replace(/&plusmn;/g, "±")
    .replace(/&deg;/g, "°")
    .replace(/&micro;/g, "µ")
    // 句読点
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&middot;/g, "·")
    .replace(/&bull;/g, "•")
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rsquo;/g, "’")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&sbquo;/g, "‚")
    .replace(/&bdquo;/g, "„")
    .replace(/&sect;/g, "§")
    .replace(/&para;/g, "¶")
    .replace(/&iexcl;/g, "¡")
    .replace(/&iquest;/g, "¿")
    // 矢印
    .replace(/&larr;/g, "←")
    .replace(/&uarr;/g, "↑")
    .replace(/&rarr;/g, "→")
    .replace(/&darr;/g, "↓")
    .replace(/&harr;/g, "↔")
    // 通貨
    .replace(/&yen;/g, "¥")
    .replace(/&pound;/g, "£")
    .replace(/&euro;/g, "€")
    .replace(/&cent;/g, "¢")
    // ブランド / 記号
    .replace(/&copy;/g, "©")
    .replace(/&reg;/g, "®")
    .replace(/&trade;/g, "™")
    // カードスート
    .replace(/&hearts;/g, "♥")
    .replace(/&clubs;/g, "♣")
    .replace(/&spades;/g, "♠")
    .replace(/&diams;/g, "♦")
    // 数値参照 (汎用フォールバック)
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return "";
      }
    });
}
