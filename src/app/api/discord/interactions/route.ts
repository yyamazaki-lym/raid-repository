import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import {
  INTERACTION_MESSAGE_COMPONENT,
  INTERACTION_PING,
  RESPONSE_PONG,
  ephemeralReply,
  interactionUserId,
  parseAttendanceCustomId,
  verifyDiscordSignature,
} from "@/lib/discord-interactions";
import { answerAttendanceFromDiscord } from "@/lib/server/discord-attendance";

/**
 * Discord の Interactions Endpoint (W-21、2026-10-05)。出欠の催促メッセージの
 * 回答ボタンが押されると Discord がここへ POST する。仕組みと前提は
 * `src/lib/discord-interactions.ts` の docstring。
 *
 * 認証は Discord の Ed25519 署名だけ (ログインの cookie は無い)。proxy の
 * 公開パスに入れてあり、**署名を検証するまで本文を信じない**。公開鍵
 * (`DISCORD_PUBLIC_KEY`) が未設定なら全部 401 (fail-closed) — Developer Portal で
 * Endpoint URL を保存するときの確認 (署名付きの PING) も通らないので、鍵を
 * 入れ忘れたまま運用が始まることはない。
 *
 * Discord は 3 秒以内の応答を求める。書き込みは `answerAttendanceFromDiscord`
 * の中で読み取りを並べて済ませ、押した本人にだけ見える返事 (ephemeral) を返す。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY?.trim() ?? "";
  const signature = req.headers.get("x-signature-ed25519") ?? "";
  const timestamp = req.headers.get("x-signature-timestamp") ?? "";
  // 署名は届いたままの本文に付いているので、JSON として読む前に文字列で取る。
  const body = await req.text();

  const verified =
    publicKey !== "" &&
    (await verifyDiscordSignature({
      publicKeyHex: publicKey,
      signatureHex: signature,
      timestamp,
      body,
      nowSeconds: Math.floor(Date.now() / 1000),
    }));
  if (!verified) {
    return new NextResponse("invalid request signature", { status: 401 });
  }

  let payload: { type?: unknown; data?: { custom_id?: unknown } };
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch {
    return new NextResponse("bad request", { status: 400 });
  }

  if (payload.type === INTERACTION_PING) {
    return NextResponse.json({ type: RESPONSE_PONG });
  }

  if (payload.type === INTERACTION_MESSAGE_COMPONENT) {
    const parsed = parseAttendanceCustomId(payload.data?.custom_id);
    const userId = interactionUserId(payload);
    if (!parsed || !userId) {
      return NextResponse.json(ephemeralReply("このボタンには対応していません。"));
    }
    try {
      const message = await answerAttendanceFromDiscord({
        discordUserId: userId,
        sessionId: parsed.sessionId,
        symbol: parsed.symbol,
      });
      return NextResponse.json(ephemeralReply(message));
    } catch (e) {
      console.warn("[discord/interactions] answer failed:", e);
      return NextResponse.json(
        ephemeralReply("回答を保存できませんでした。ポータルから入力してください。"),
      );
    }
  }

  // スラッシュコマンドなど、ポータルが出していない操作。
  return NextResponse.json(ephemeralReply("この操作には対応していません。"));
}
