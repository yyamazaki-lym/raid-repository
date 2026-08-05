import "server-only";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
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
  const res = await undiciFetch(url, {
    ...(init as UndiciRequestInit),
    dispatcher: safeAgent,
  });
  return res as unknown as Response;
}
