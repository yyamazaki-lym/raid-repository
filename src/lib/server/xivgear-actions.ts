"use server";

import { guardExternalFetch } from "./external-fetch-guard";
import {
  fetchXivgearSummary,
  type XivgearSummaryResult,
} from "./xivgear-fetch";

/**
 * BiS リンクの中身 (XivGear) を要約して返す Server Action (2026-08-30)。
 *
 * 読み取り専用なので admin gate ではなく「Discord メンバーであること」だけ
 * を要求する (BiS の閲覧自体がメンバー向け機能のため)。
 *
 * 2026-10-01 監査 S-1: 外部 (api.xivgear.app) を叩くので回数を絞る。
 * 公開デモでも見せている機能なので、ゲストは弾かず IP ごとに絞る。
 */
export async function fetchXivgearSummaryAction(
  bisUrl: string,
): Promise<XivgearSummaryResult> {
  const guard = await guardExternalFetch("xivgear", { allowDemoGuest: true });
  if (!guard.ok) return guard;
  return fetchXivgearSummary(bisUrl);
}
