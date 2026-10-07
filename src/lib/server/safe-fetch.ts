import "server-only";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import {
  lookup as dnsLookup,
  promises as dnsPromises,
  type LookupAddress,
} from "node:dns";
import { isBlockedIpLiteral } from "@/lib/url-safe";

/**
 * SSRF 対策の要: **DNS 解決結果を検証してから、その IP にピン留めして接続する**
 * fetch (2026-08-05 監査 H-3)。
 *
 * ## 直した問題
 *
 * `isPublicHttpUrl` は IP リテラルを網羅的に潰していたが、ホスト名は
 * 「解決時に内部 IP を引かない前提」で無条件に通していた。コメントは DNS
 * rebinding を受容リスクとして挙げていたが、実際には **rebinding すら不要**で、
 * 公開 DNS が静的に private IP を返すだけで突破できた:
 *
 *   /api/page-title?url=http://169.254.169.254.nip.io/latest/meta-data/
 *   /api/page-title?url=http://127.0.0.1.nip.io:3000/
 *   /api/page-title?url=http://localtest.me/
 *
 * `nip.io` / `localtest.me` は IPv4 リテラル正規表現にも `.local` / `.internal`
 * 判定にも当たらない。リダイレクト再検証も同じ関数を使っていたため 2 段目でも
 * 同様に突破できた。
 *
 * ## 仕組み
 *
 * undici `Agent` の `connect.lookup` を差し替え、
 *   1. `dns.lookup(host, { all: true })` で候補アドレスを全件取得
 *   2. 1 つでも内部アドレスが混ざっていたら **接続前に** エラーで倒す
 *   3. 検証済みアドレスをそのまま undici に返す = そのアドレスへ接続する
 * とする。3 により「検証した IP」と「接続する IP」が同一になるので、
 * TOCTOU である DNS rebinding も同時に塞げる。
 *
 * 1 件でも内部が混ざれば全体を拒否する厳しめの判定にしてあるのは、A レコードを
 * 複数返して公開 IP と内部 IP を混ぜる回避を防ぐため。
 *
 * ## なぜ undici パッケージを直接使うのか
 *
 * Node 22 の global `fetch` は内蔵 undici 実装だが、`lookup` を差し込む口が無く、
 * 別コピーの `Agent` を `dispatcher` として渡しても内部の instanceof 判定と
 * 噛み合わない。`undici.fetch` + `undici.Agent` を同一コピーで揃えるのが確実。
 * 戻り値は spec 準拠の Response なので、呼び出し側 (`res.body.getReader()` /
 * `res.headers.get()` / `res.text()`) は global fetch と同じまま使える。
 */

/** 検証に失敗した接続で投げるエラー。呼び出し側は通常の fetch 失敗として扱う。 */
export class BlockedAddressError extends Error {
  constructor(host: string, address: string) {
    super(`blocked internal address for ${host}: ${address}`);
    this.name = "BlockedAddressError";
  }
}

const safeAgent = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) {
          callback(err, "", 0);
          return;
        }
        const list: LookupAddress[] = Array.isArray(addresses)
          ? addresses
          : [addresses as unknown as LookupAddress];
        if (list.length === 0) {
          callback(new BlockedAddressError(hostname, "(no address)"), "", 0);
          return;
        }
        const blocked = list.find((a) => isBlockedIpLiteral(a.address));
        if (blocked) {
          callback(new BlockedAddressError(hostname, blocked.address), "", 0);
          return;
        }
        // 検証済みアドレスをそのまま返す = このアドレスに接続される。
        // 再解決を挟まないので rebinding の窓が無い。
        callback(
          null,
          list as unknown as Parameters<typeof callback>[1],
          list[0]!.family,
        );
      });
    },
  },
});

/**
 * 解決先 IP を検証 + ピン留めしたうえで fetch する。
 *
 * **ユーザー入力 URL をサーバー側から取りに行く経路では必ずこれを使うこと。**
 * 入口の `isPublicHttpUrl`（スキーマ / 自明な内部名 / IP リテラルの early
 * reject）と二層で使う想定で、片方だけでは不十分:
 *   - `isPublicHttpUrl` 単独 → ホスト名経由の内部 IP を防げない (本 H-3)
 *   - `safeFetch` 単独 → `file://` 等のスキーマを弾けない
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  // 2026-10-07 セキュリティ精査: redirect は undici に任せず、ここで 1 段ずつ
  // 追う。以前は既定の `redirect: "follow"` のまま渡していたため、2 段目以降の
  // 行き先が IP リテラル (`http://169.254.169.254/` など) だと検査を通らずに
  // 接続した — Node の net はホストが IP リテラルだと `connect.lookup` を
  // 呼ばないので、上の safeAgent の検査は IP リテラルには効かない。
  // 呼び出し側が `redirect: "manual"` を渡したとき (fetchWithSafeRedirect) は
  // 従来どおり 3xx をそのまま返す。
  const mode = init.redirect ?? "follow";
  const method = (init.method ?? "GET").toUpperCase();
  let current = url;
  for (let hop = 0; ; hop++) {
    assertNotBlockedLiteral(current);
    const res = (await undiciFetch(current, {
      ...(init as UndiciRequestInit),
      redirect: "manual",
      dispatcher: safeAgent,
    })) as unknown as Response;
    const isRedirect = res.status >= 300 && res.status < 400;
    if (!isRedirect || mode === "manual") return res;
    if (mode === "error") {
      await res.body?.cancel().catch(() => {});
      throw new TypeError("unexpected redirect");
    }
    // 本文付きの要求 (POST など) の redirect は追わない (今の呼び出し元は
    // すべて GET。仕様どおりに method を書き換える処理を持たないため)。
    if (method !== "GET" && method !== "HEAD") return res;
    const loc = res.headers.get("location");
    if (!loc) return res;
    await res.body?.cancel().catch(() => {});
    if (hop >= SAFE_FETCH_MAX_REDIRECTS) {
      throw new TypeError("too many redirects");
    }
    const next = new URL(loc, current);
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      throw new TypeError("redirect to a non-http(s) URL");
    }
    current = next.toString();
  }
}

/** `safeFetch` が追う redirect の上限 (fetch 既定の 20 より絞る)。 */
const SAFE_FETCH_MAX_REDIRECTS = 5;

/**
 * 接続先が IP リテラルなら、内部アドレスかをここで確かめる。ホスト名は
 * safeAgent の `connect.lookup` が確かめるが、IP リテラルはそこを通らない。
 */
function assertNotBlockedLiteral(url: string): void {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (isBlockedIpLiteral(host)) throw new BlockedAddressError(host, host);
}

/** `assertPublicResolution` が「公開アドレスだった」と覚えておく時間。 */
const RESOLUTION_OK_TTL_MS = 10 * 60 * 1000;
/** ホスト名 → 確認済みの期限。描画のたびに DNS を引かないため。 */
const resolutionOk = new Map<string, number>();

/**
 * URL のホスト名が**公開アドレスにしか解決しない**ことを確かめる
 * (2026-10-01 監査 S-2)。内部アドレスが 1 つでも混ざれば
 * `BlockedAddressError` を投げる。
 *
 * `safeFetch` を使えない経路のためのもの。TOP のスケジュール取得は
 * Next.js の Data Cache (`fetch` の `next.tags` + `updateTag`) に乗っており、
 * undici を直接使う `safeFetch` に替えるとキャッシュと即時無効化が外れる。
 * そこで接続前にこの関数で解決先を検査し、`fetch` 自体はそのまま使う。
 *
 * ⚠ 検査と接続で 2 回解決するので、`safeFetch` (検査した IP にピン留め) と
 * 違い DNS rebinding の窓は残る。塞げるのは「公開 DNS が静的に内部 IP を
 * 返すホスト名」(`127.0.0.1.nip.io` 等、H-3 の本体) まで。新しい経路では
 * `safeFetch` を使うこと。
 */
export async function assertPublicResolution(url: string): Promise<void> {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (isBlockedIpLiteral(host)) throw new BlockedAddressError(host, host);
  const okUntil = resolutionOk.get(host);
  if (okUntil !== undefined && okUntil > Date.now()) return;
  const list = await dnsPromises.lookup(host, { all: true });
  if (list.length === 0) throw new BlockedAddressError(host, "(no address)");
  const blocked = list.find((a) => isBlockedIpLiteral(a.address));
  if (blocked) throw new BlockedAddressError(host, blocked.address);
  if (resolutionOk.size > 256) resolutionOk.clear();
  resolutionOk.set(host, Date.now() + RESOLUTION_OK_TTL_MS);
}
