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

/**
 * FF14 攻略リソースの種別 (2026-08-30 調査 D-2/D-4)。
 *
 * 攻略リンクは「大手 DB / 野良主流の観測サイト / ログ / 装備 / シム」で
 * 見る目的がまるで違うのに、カード上は全部 "Web" アイコンで並んでいて
 * 判別できなかった。ホストが既知ならバッジを 1 個出す。
 *
 * 未知ホストは null (= バッジ無し = 従来表示のまま)。
 */
export type Ff14ResourceKind =
  | "guide" // 大手攻略 DB (ゲーム8 等)
  | "meta" // 野良主流・カンペ観測サイト
  | "logs" // FFLogs / xivanalysis / Tomestone
  | "gear" // BiS / 装備シミュレータ
  | "sim" // ギミック練習シム
  | "plan"; // 作図・ストラテジーボード共有

export const FF14_RESOURCE_LABEL: Record<Ff14ResourceKind, string> = {
  guide: "攻略",
  meta: "野良主流",
  logs: "ログ",
  gear: "装備",
  sim: "シム",
  plan: "作図",
};

/**
 * ホスト → 種別の辞書。判定は hostMatches (完全一致 or サブドメイン) なので
 * パスは見ない。増える一方の辞書なので、種別ごとにまとめて列挙する。
 */
const FF14_RESOURCE_HOSTS: Array<{ kind: Ff14ResourceKind; hosts: string[] }> = [
  {
    kind: "guide",
    hosts: [
      "game8.jp",
      "altema.jp",
      "kamigame.jp",
      "materiaraiding.com",
      "naurffxiv.com",
      "icy-veins.com",
      "thebalanceffxiv.com",
    ],
  },
  {
    // 「今の野良で主流の処理法/カンペ」を追跡している系。攻略 DB とは
    // 用途が違う (合流前に見るもの) ので別バッジにする。
    kind: "meta",
    hosts: ["fuucdayo.com", "yan-flash.com", "ultistrats.com", "wtfdig.info"],
  },
  {
    kind: "logs",
    hosts: ["fflogs.com", "xivanalysis.com", "tomestone.gg", "archon.gg"],
  },
  {
    kind: "gear",
    hosts: ["xivgear.app", "etro.gg", "ffxiv.azizarar.com"],
  },
  {
    kind: "sim",
    hosts: ["xivsim.com", "ff14.toolboxgaming.space", "susybakaaa.itch.io"],
  },
  {
    kind: "plan",
    hosts: [
      "raidplan.io",
      "ffxivstrats.io",
      "board.wtfdig.info",
      "asellog.com",
      "sourpuh.github.io",
    ],
  },
];

/** URL が既知の FF14 攻略リソースなら種別を返す (未知は null)。 */
export function detectFf14Resource(url: string): Ff14ResourceKind | null {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    host = u.hostname.toLowerCase();
  } catch {
    return null;
  }
  // board.wtfdig.info は wtfdig.info のサブドメインでもあるため、
  // より具体的な plan の登録を先に見る (配列末尾から評価)。
  for (let i = FF14_RESOURCE_HOSTS.length - 1; i >= 0; i--) {
    const entry = FF14_RESOURCE_HOSTS[i]!;
    if (hostMatches(host, entry.hosts)) return entry.kind;
  }
  return null;
}
