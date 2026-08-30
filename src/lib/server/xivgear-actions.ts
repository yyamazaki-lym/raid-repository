"use server";

import { requireDiscordMember } from "./auth";
import {
  fetchXivgearSummary,
  type XivgearSummaryResult,
} from "./xivgear-fetch";

/**
 * BiS リンクの中身 (XivGear) を要約して返す Server Action (2026-08-30)。
 *
 * 読み取り専用なので admin gate ではなく「Discord メンバーであること」だけ
 * を要求する (BiS の閲覧自体がメンバー向け機能のため)。
 */
export async function fetchXivgearSummaryAction(
  bisUrl: string,
): Promise<XivgearSummaryResult> {
  await requireDiscordMember();
  return fetchXivgearSummary(bisUrl);
}
