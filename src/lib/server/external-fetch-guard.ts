import "server-only";
import { headers } from "next/headers";
import { requireDiscordMember, type AuthorizedUser } from "./auth";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";

/**
 * 外部サービスを叩く「メンバーなら誰でも呼べる」Server Action の入口
 * (2026-10-01 監査 S-1)。
 *
 * ## 直した問題
 *
 * 次の 4 本は `requireDiscordMember()` だけで外部へ取りに行っていた:
 *
 *   - XivGear の BiS 要約 (api.xivgear.app、最大 4MB / 10s)
 *   - pull 詳細の技名 (XIVAPI)
 *   - ボスの被ダメージ時系列 / 死亡の直前 (FFLogs GraphQL。固定運用の
 *     OAuth トークンでポイントを消費する)
 *
 * 公開デモ (`PUBLIC_DEMO_MODE`) では `requireDiscordMember()` が redirect
 * せず匿名ゲストを返すので、**ログインしていない訪問者が POST を投げ続け
 * られた**。`proxy.ts` と `/api/page-title` は同じ脅威 (踏み台・DoS 中継) を
 * ゲストに 403 で閉じているが、2026-08-30〜09-08 に足したこの 4 本は漏れて
 * いた。Server Action は `proxy.ts` のレート制限 (パス一致) にも当たらない。
 *
 * ## 方針
 *
 * - `allowDemoGuest: false` — 固定の資源 (FFLogs の OAuth トークン) を使う
 *   経路。ゲストは弾く (そもそも公開デモの DB には pull が無い)
 * - `allowDemoGuest: true` — 公開デモでも見せている機能 (BiS の要約・技名)。
 *   ゲストは弾かず、**IP ごと**に回数を絞る (ゲストは全員同じ ID なので)
 * - メンバーは Discord ID ごとに回数を絞る。上限は画面の正規の使い方
 *   (行を開くたびに 1 回) を大きく超える値にしてある
 */

export type ExternalFetchScope =
  | "xivgear"
  | "pull-detail"
  | "fflogs-boss-damage"
  | "fflogs-death-leadup";

/** scope ごとの上限 (回 / 分)。FFLogs はポイント制なので低めにする。 */
export const EXTERNAL_FETCH_LIMITS: Record<
  ExternalFetchScope,
  { limit: number; windowMs: number }
> = {
  xivgear: { limit: 30, windowMs: 60_000 },
  "pull-detail": { limit: 60, windowMs: 60_000 },
  "fflogs-boss-damage": { limit: 10, windowMs: 60_000 },
  "fflogs-death-leadup": { limit: 20, windowMs: 60_000 },
};

/**
 * 公開デモの匿名ゲストだけ、IP ごとに回数を絞る (メンバーは絞らない。2026-10-08)。
 * 外部を叩かないが service role で DB を読む Action (出席サマリー・ミス注釈の取得) 用。
 * 絞ったときは画面に出す理由、通してよいときは null を返す。
 *
 * scope は `action-${scope}` の器になる。`EXTERNAL_FETCH_LIMITS` のキーと同じ名前を
 * 使わないこと (メンバーの user: とゲストの ip: が同じ器に混ざる)。
 * ⚠ Upstash の env が無いと回数はインスタンスごと (rate-limit.ts)。
 */
export async function limitDemoGuest(
  member: AuthorizedUser,
  scope: string,
  opts: { limit: number; windowMs: number },
): Promise<string | null> {
  if (!member.isDemoGuest) return null;
  const rl = await checkRateLimit(
    `action-${scope}`,
    `ip:${clientIpFromHeaders(await headers())}`,
    opts.limit,
    opts.windowMs,
  );
  if (rl.allowed) return null;
  return `短時間に何度も取得しています。${rl.retryAfterSeconds} 秒ほど待ってから試してください`;
}

export type ExternalFetchGuard =
  | { ok: true; member: AuthorizedUser }
  | { ok: false; reason: string };

export async function guardExternalFetch(
  scope: ExternalFetchScope,
  opts: { allowDemoGuest: boolean },
): Promise<ExternalFetchGuard> {
  const member = await requireDiscordMember();
  if (member.isDemoGuest && !opts.allowDemoGuest) {
    return { ok: false, reason: "デモ表示中は利用できません" };
  }
  const identifier = member.isDemoGuest
    ? `ip:${clientIpFromHeaders(await headers())}`
    : `user:${member.discordId}`;
  const { limit, windowMs } = EXTERNAL_FETCH_LIMITS[scope];
  const rl = await checkRateLimit(`action-${scope}`, identifier, limit, windowMs);
  if (!rl.allowed) {
    return {
      ok: false,
      reason: `短時間に何度も取得しています。${rl.retryAfterSeconds} 秒ほど待ってから試してください`,
    };
  }
  return { ok: true, member };
}
