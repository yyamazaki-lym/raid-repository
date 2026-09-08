/**
 * レポートの発見元 (W-5、2026-09-07 / L-4、2026-09-08)。
 *
 * portal がどのレポートを取り込むかは、これまで**リンクから逆算**して
 * いた: 動画に貼った FFLogs URL、日付メモの URL、活動日に紐づけた URL。
 * つまり誰かが URL を貼るまで portal はレポートの存在を知らない
 * (調査ノート第 4 回 W-5)。
 *
 * FFLogs の `reportData.reports(...)` を引けば貼らなくても見つかる。
 * 見に行ける場所は 2 つある:
 *
 *   - FFLogs 上に static (guild) を作って Uploader でそれを選んでいる固定
 *     → guild のレポート一覧が「その固定の全ログ」になる
 *   - guild を作っていない固定 (計測担当が個人アカウントで上げている)
 *     → 接続した本人のレポート一覧を見る方が合う
 *
 * ## 3 択 → 経路ごとの ON/OFF (L-4、2026-09-08)
 *
 * 2026-09-07 版はこれを `links` / `guild` / `user` の**排他 3 択**にして
 * いたが、実機で「guild にも上げているし個人アカウントの分もある」が普通
 * だと分かった。排他にする理由が無いので、
 *
 *   - **貼られた URL は常時 ON** — portal の土台の経路で、切る意味が無い
 *     (切ると台帳が空になる)。だから設定値に持たない
 *   - その上に「guild から自動」「自分のアカウントから自動」を**独立した
 *     トグル**で足す
 *
 * という形に変えた。集合なので両方 ON にできる。
 *
 * ## 保存形は同じキーの CSV (後方互換)
 *
 * `app_settings.fflogs_report_source` はそのまま使い、値を CSV にする:
 *
 *   | 保存値          | 意味                          |
 *   |-----------------|-------------------------------|
 *   | `""` / 未設定   | 自動発見なし (= 従来の links) |
 *   | `"links"` (旧)  | 同上 — 空集合として読む       |
 *   | `"guild"`       | guild だけ                    |
 *   | `"user"`        | 自分のアカウントだけ          |
 *   | `"guild,user"`  | 両方                          |
 *
 * 旧値の `links` は「自動発見しない」の意味だったので**空集合**に落ちる。
 * `guild` / `user` はそれぞれ 1 件の集合として読めるので、**旧 3 択の
 * どの値からも移行で設定が変わらない**。
 *
 * ## 既定は「自動発見なし」(従来のまま)
 *
 * 自動発見を既定にすると、guild で他のコンテンツ (討滅・レイド以外) も
 * 回している固定で無関係なレポートが大量に台帳へ入る。取り込み枠を食う上、
 * 未分類レポートの一覧が伸びて診断が読みにくくなる。だから **明示的に
 * ON にしたときだけ**自動発見する。
 *
 * ## ⚠ Unlisted 運用ではどちらの経路も実質 0 件
 *
 * `reports(userID:)` は実測で **Public のレポートだけ**を返す
 * (`fflogs.ts` の調査コメント参照)。guild 一覧が Unlisted を返すかは未確認
 * (v2 のスキーマは `report(code:)` にだけ `allowUnlisted` を持ち、一覧の
 * `reports()` には可視性の引数が無い)。Unlisted 運用を推奨している
 * (`docs/guides/log-runner.md`) 固定では拾えないので、**UI 側で期待値を
 * 併記する**こと (トグルを ON にしても「0 件」は変わらない)。
 *
 * 検証: `node scripts/check-fflogs-report-source.mjs`
 */

/** `app_settings` のキー (3 択時代から変えない — 値の形だけ変わる)。 */
export const FFLOGS_REPORT_SOURCE_KEY = "fflogs_report_source";

/**
 * 自動発見の経路。
 *
 * 「貼られた URL」はここに**入れない** — 常時 ON で切れないものを
 * トグルの集合に混ぜると「全部 OFF にしたら何も取り込まれない」という
 * 誤解を招く。
 */
export const FFLOGS_AUTO_ROUTES = [
  /** guild のレポート一覧も見る (guild ID が必要)。 */
  "guild",
  /** 接続した FFLogs アカウントのレポート一覧も見る (Public のみ)。 */
  "user",
] as const;
export type FflogsAutoRoute = (typeof FFLOGS_AUTO_ROUTES)[number];

/**
 * 有効な自動発見経路の集合。
 *
 * `Set` ではなくフラグの record にしてある: Server Action の戻り値と
 * React の state をそのまま同じ形で持ちたいため (`Set` は境界を越える
 * ときの直列化が保証されていない)。
 */
export type FflogsAutoRoutes = Readonly<Record<FflogsAutoRoute, boolean>>;

/** 既定 = 自動発見なし (従来の `links` と同じ挙動)。 */
export const FFLOGS_AUTO_ROUTES_NONE: FflogsAutoRoutes = Object.freeze({
  guild: false,
  user: false,
});

export function isFflogsAutoRoute(v: unknown): v is FflogsAutoRoute {
  return (
    typeof v === "string" && (FFLOGS_AUTO_ROUTES as readonly string[]).includes(v)
  );
}

/**
 * Server Action が受け取った値が集合の形をしているか。
 *
 * client から来る値なので、`boolean` が全経路そろっていることまで見る
 * (欠けた経路を false と解釈すると、client 側の書き損じで設定が黙って
 * OFF になる)。
 */
export function isFflogsAutoRoutes(v: unknown): v is FflogsAutoRoutes {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return FFLOGS_AUTO_ROUTES.every((r) => typeof o[r] === "boolean");
}

/**
 * 設定値の正規化。未設定・未知のトークンは無視して空集合に倒す。
 *
 * 旧 3 択の値もここで吸収する (`links` → 空集合、`guild` / `user` →
 * 1 件の集合)。
 */
export function parseFflogsReportSource(
  raw: string | null | undefined,
): FflogsAutoRoutes {
  const out: Record<FflogsAutoRoute, boolean> = { guild: false, user: false };
  for (const token of (raw ?? "").split(",")) {
    const t = token.trim();
    // 旧値の `links` は「自動発見しない」なので、未知の値と同じく無視する。
    if (isFflogsAutoRoute(t)) out[t] = true;
  }
  return out;
}

/**
 * 保存形へ。
 *
 * 並びは `FFLOGS_AUTO_ROUTES` の順に固定する — 同じ集合が
 * `"guild,user"` と `"user,guild"` の 2 通りで保存されると、
 * 設定値の diff や目視確認で「変わった」と誤読される。
 */
export function serializeFflogsReportSource(
  routes: FflogsAutoRoutes,
): string {
  return FFLOGS_AUTO_ROUTES.filter((r) => routes[r]).join(",");
}

/** 自動発見を行うか (同期処理の分岐用)。 */
export function usesAutoDiscovery(routes: FflogsAutoRoutes): boolean {
  return FFLOGS_AUTO_ROUTES.some((r) => routes[r]);
}

/** 経路 1 本が動かない理由。 */
export type FflogsRouteMissing = "guildId" | "oauth";

/**
 * ON にした経路が実際に動く状態か、**経路ごとに**返す。
 *
 * 設定だけして条件が足りていない (guild を ON にしたのに guild ID が空) と
 * 「自動発見にしたのに増えない」が起きて原因が見えない。UI と同期処理の
 * 両方でここを通し、動く経路と足りないものを分けて返す。
 *
 * 3 択時代は 1 本ぶんの `{ ready, missing }` だったが、2 経路が独立に
 * ON/OFF できるようになったので「guild は guild ID 待ち / user は動く」を
 * 同時に表せる形が要る。
 */
export function reportSourceReadiness(input: {
  routes: FflogsAutoRoutes;
  guildId: string | null | undefined;
  /** OAuth 接続済みか。 */
  oauthConnected: boolean;
}): {
  /** ON かつ実際に引ける経路 (この順で同期が回る)。 */
  usable: FflogsAutoRoute[];
  /** ON にしたのに引けない経路と、足りないもの。 */
  blocked: Array<{ route: FflogsAutoRoute; missing: FflogsRouteMissing }>;
} {
  const usable: FflogsAutoRoute[] = [];
  const blocked: Array<{ route: FflogsAutoRoute; missing: FflogsRouteMissing }> =
    [];
  const hasGuildId = (input.guildId ?? "").trim() !== "";
  for (const route of FFLOGS_AUTO_ROUTES) {
    if (!input.routes[route]) continue;
    // guild / user はどちらも v2 API を叩くので OAuth が必須。
    // OAuth 不足は guild ID 不足より先に出す (OAuth が無ければ guild ID を
    // 入れても動かないので、先に直すべきものを名指しする)。
    if (!input.oauthConnected) {
      blocked.push({ route, missing: "oauth" });
      continue;
    }
    if (route === "guild" && !hasGuildId) {
      blocked.push({ route, missing: "guildId" });
      continue;
    }
    usable.push(route);
  }
  return { usable, blocked };
}

/**
 * 1 回の同期で自動発見に使うレポート件数 (全経路の合計)。
 *
 * 「直近のページ 1 枚」だけ見る。取り込み枠 (1 回 40 件) より多く発見しても
 * その回では取り込めず、次回また同じ一覧を引くので、ページを跨いで漁る
 * 意味が薄い。過去分をまとめて入れたいときは URL 貼り付けの導線がある。
 *
 * 2 経路 ON のときは**この枠を分け合う** (経路ごとに 25 件ずつではない)。
 * 片方の一覧だけで枠を埋めてしまうと、もう片方が毎回 0 件になる。
 */
export const AUTO_DISCOVERY_LIMIT = 25;

/**
 * 経路 1 本ぶんの取得件数。
 *
 * 端数は切り上げる (2 経路なら 13 + 13)。合計が枠を超えうるので、
 * **発見側で `AUTO_DISCOVERY_LIMIT` に達したら打ち切る**こと
 * (`fflogs-fights.ts`)。切り捨てにすると経路が 3 本以上になったときに
 * 0 件になる経路が出る。
 */
export function autoDiscoveryLimitPerRoute(routeCount: number): number {
  if (routeCount <= 0) return 0;
  return Math.ceil(AUTO_DISCOVERY_LIMIT / routeCount);
}
