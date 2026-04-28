/**
 * URL から「サイト種別」を判定するユーティリティ。
 *
 * 主に攻略リンク (`strategy`) と 動画リンク (`videos`) でサイト別アイコン /
 * 色を出し分けるために使う。判定結果 (`LinkSite`) は最も細かい粒度で、
 * UI 側で必要に応じて coarse バケット (`web` / `video` / `x`) に丸めて使う。
 *
 * 未知ドメインや URL parse エラーは `"web"` にフォールバック。
 * SSR / クライアント双方で動かすため `URL` のみ使用 (DOM API 不使用)。
 */

export type LinkSite = "youtube" | "twitch" | "niconico" | "x" | "web";

/** 攻略リンク用の coarse バケット (動画系をまとめる) */
export type CoarseLinkSite = "video" | "x" | "web";

/** Host が指定パターンのいずれかに完全一致 or サブドメインで終わる場合 true */
function hostMatches(host: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (host === p || host.endsWith("." + p)) return true;
  }
  return false;
}

/**
 * URL からサイト種別を判定する。
 *
 * `http(s):` 以外のスキーム、parse 失敗、unknown host はすべて `"web"` に倒す。
 * `safeHref` でガード済みの URL でも、念のためここでも単独でセーフに動く。
 */
export function detectLinkSite(url: string): LinkSite {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "web";
    host = u.hostname.toLowerCase();
  } catch {
    return "web";
  }

  if (hostMatches(host, ["youtube.com", "youtu.be"])) return "youtube";
  if (hostMatches(host, ["twitch.tv"])) return "twitch";
  if (hostMatches(host, ["nicovideo.jp", "nico.ms"])) return "niconico";
  if (hostMatches(host, ["twitter.com", "x.com"])) return "x";
  return "web";
}

/** fine な LinkSite を coarse バケットに丸める (攻略リンクの 3 区分用) */
export function coarseSite(site: LinkSite): CoarseLinkSite {
  if (site === "youtube" || site === "twitch" || site === "niconico") {
    return "video";
  }
  if (site === "x") return "x";
  return "web";
}

/**
 * UI 表示用のラベル (alt / aria-label / tooltip などに使用)。
 * lucide のブランド非対応に合わせて X 以外は日本語ベース。
 */
export const LINK_SITE_LABEL: Record<LinkSite, string> = {
  youtube: "YouTube",
  twitch: "Twitch",
  niconico: "ニコニコ動画",
  x: "X (Twitter)",
  web: "Web",
};

export const COARSE_SITE_LABEL: Record<CoarseLinkSite, string> = {
  video: "動画",
  x: "X (Twitter)",
  web: "Web",
};
