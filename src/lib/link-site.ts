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

export type LinkSite =
  | "youtube"
  | "twitch"
  | "niconico"
  | "googlephotos"
  // L-21 (2026-09-09 実機報告): Google ドキュメント系。攻略リンクとして
  // 貼られる固定管理シートがこれで、**og:image が使い物にならない**
  // (`lh7-*.googleusercontent.com/docs/<署名>` は時間が経つと 404)。
  // サムネの代わりに種別を出すため、種類まで見分ける。
  | "googlesheets"
  | "googledocs"
  | "googleslides"
  | "x"
  | "web";

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
  // 2026-09-07: Google フォト (実機要望「動画登録に Google フォト対応」)。
  // 共有リンクは `photos.app.goo.gl/...` (短縮) と `photos.google.com/share/...`
  // の 2 形。`photos.googleusercontent.com` は本体が返す実体 URL。
  if (
    hostMatches(host, [
      "photos.google.com",
      "photos.app.goo.gl",
      "photos.googleusercontent.com",
    ])
  ) {
    return "googlephotos";
  }
  // L-21: docs.google.com はパスで種類が決まる (spreadsheets / document /
  // presentation)。それ以外の docs.google.com (forms 等) は googledocs に倒す。
  // ⚠ `drive.google.com` は含めない — 中身が何か URL からは分からない。
  if (hostMatches(host, ["docs.google.com"])) {
    const path = pathOf(url);
    if (path.startsWith("/spreadsheets")) return "googlesheets";
    if (path.startsWith("/presentation")) return "googleslides";
    return "googledocs";
  }
  if (hostMatches(host, ["twitter.com", "x.com"])) return "x";
  return "web";
}

/** URL のパス部分 (parse できなければ空文字)。 */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

/** Google ドキュメント系か (サムネの代わりに種別カードを出す対象)。 */
export function isGoogleDocsSite(site: LinkSite): boolean {
  return (
    site === "googlesheets" || site === "googledocs" || site === "googleslides"
  );
}

/** fine な LinkSite を coarse バケットに丸める (攻略リンクの 3 区分用) */
export function coarseSite(site: LinkSite): CoarseLinkSite {
  if (
    site === "youtube" ||
    site === "twitch" ||
    site === "niconico" ||
    site === "googlephotos"
  ) {
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
  googlephotos: "Google フォト",
  googlesheets: "Google スプレッドシート",
  googledocs: "Google ドキュメント",
  googleslides: "Google スライド",
  x: "X (Twitter)",
  web: "Web",
};

export const COARSE_SITE_LABEL: Record<CoarseLinkSite, string> = {
  video: "動画",
  x: "X (Twitter)",
  web: "Web",
};

/** 表示言語つきの LINK_SITE_LABEL (辞書は import しない — 純関数のまま)。 */
export function linkSiteLabel(
  site: LinkSite,
  locale: "ja" | "en" = "ja",
): string {
  if (locale === "en" && site === "niconico") return "Niconico";
  if (locale === "en" && site === "googlephotos") return "Google Photos";
  if (locale === "en" && site === "googlesheets") return "Google Sheets";
  if (locale === "en" && site === "googledocs") return "Google Docs";
  if (locale === "en" && site === "googleslides") return "Google Slides";
  return LINK_SITE_LABEL[site];
}

/** 表示言語つきの COARSE_SITE_LABEL。 */
export function coarseSiteLabel(
  site: CoarseLinkSite,
  locale: "ja" | "en" = "ja",
): string {
  if (locale === "en" && site === "video") return "Video";
  return COARSE_SITE_LABEL[site];
}

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
  | "plan" // 作図・ストラテジーボード共有
  | "recruit"; // 固定・PT 募集 (W-32、2026-09-07)

export const FF14_RESOURCE_LABEL: Record<Ff14ResourceKind, string> = {
  guide: "攻略",
  meta: "野良主流",
  logs: "ログ",
  gear: "装備",
  sim: "シム",
  plan: "作図",
  recruit: "募集",
};

const FF14_RESOURCE_LABEL_EN: Record<Ff14ResourceKind, string> = {
  guide: "Guide",
  meta: "PF meta",
  logs: "Logs",
  gear: "Gear",
  sim: "Sim",
  plan: "Diagram",
  recruit: "Recruit",
};

/** 表示言語つきの FF14_RESOURCE_LABEL。 */
export function ff14ResourceLabel(
  kind: Ff14ResourceKind,
  locale: "ja" | "en" = "ja",
): string {
  return locale === "en"
    ? FF14_RESOURCE_LABEL_EN[kind]
    : FF14_RESOURCE_LABEL[kind];
}

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
      // W-32 (2026-09-07): 調査ノート第 4 回 3-1 / 3-2 で挙がった追加分。
      "knt-a.com",
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
    hosts: [
      "fflogs.com",
      "xivanalysis.com",
      "tomestone.gg",
      "archon.gg",
      // W-32: FFLogs のリプレイビューア。**公開ホスト名を確認できていない**
      // ものは足していない (誤った host を入れると別サイトのリンクに
      // 「ログ」バッジが付く)。確認できたら追加する。
    ],
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
      // W-32 (2026-09-07): 固定運営 / BiS 進捗の Web ツール。作図そのもの
      // ではないが「計画を共有するページ」として plan に寄せる。
      "xivraidplanner.app",
    ],
  },
  {
    // W-32 (2026-09-07): 固定 / PT 募集サイト。攻略資料ではないので専用の
    // 種別にする (「攻略」バッジが付くと中身を誤解させる)。
    kind: "recruit",
    hosts: ["xivrecruit.com"],
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
