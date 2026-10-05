/**
 * Discord のボタンで出欠に答える (2026-10-05、2026-10-01 全体精査 F-6 の W-21)。
 *
 * 出欠の催促メッセージに予定ごとの回答ボタン (○ / △ / × …) を付け、押すと
 * ポータルの出欠 (自前作成式) に入る。Web を開かない人の入力を減らすのが目的
 * (調査ノート第 4 回 W-21)。
 *
 * ## 仕組み
 *
 * ボタンが押されると Discord が Bot のアプリに設定した **Interactions Endpoint URL**
 * (`/api/discord/interactions`) へ POST する。要求には Discord の秘密鍵で付けた
 * Ed25519 の署名が付くので、アプリの公開鍵 (`DISCORD_PUBLIC_KEY`) で検証してから
 * 中身を信じる。押した人の Discord ユーザー ID は署名された要求の中にあり、
 * ポータルのメンバー (`native_schedule_members.discord_user_id`) と突き合わせる。
 *
 * ⚠ Endpoint URL を設定すると、そのアプリの**すべての**ボタン・スラッシュ
 * コマンドがここに届く (Gateway では受けなくなる)。Bot はポータル専用という
 * 前提 (2026-10-05 ユーザー確認)。
 *
 * `@/` を import しない純モジュール (`scripts/check-discord-interactions.mjs`)。
 */
import { DISCORD_ID_RE, isUnanswered } from "./schedule/attendance-reminder-core";
import { symbolAllowsTimes } from "./schedule/attendance-times";

/** Discord の Interaction の種類 (受け取る側)。 */
export const INTERACTION_PING = 1;
export const INTERACTION_MESSAGE_COMPONENT = 3;
/** 応答の種類。 */
export const RESPONSE_PONG = 1;
export const RESPONSE_CHANNEL_MESSAGE = 4;
/** 押した本人にだけ見える返事。 */
export const MESSAGE_FLAG_EPHEMERAL = 64;

/**
 * 署名の時刻の許容幅 (秒)。Discord は押された直後に送ってくるので、これより
 * 古い / 未来の要求は使い回し (リプレイ) とみなして弾く。
 */
export const SIGNATURE_MAX_AGE_SECONDS = 300;

const HEX_RE = /^[0-9a-f]+$/i;

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Discord の署名 (`X-Signature-Ed25519` / `X-Signature-Timestamp`) を検証する。
 * 署名の対象は `timestamp + 生の本文`。形が違う・古い・検証に失敗したら false
 * (例外は投げない — 呼び出し側は false なら 401 を返すだけにする)。
 */
export async function verifyDiscordSignature(input: {
  /** Developer Portal の「PUBLIC KEY」(64 桁の 16 進)。 */
  publicKeyHex: string;
  signatureHex: string;
  timestamp: string;
  /** 生の本文 (JSON を読み直した文字列ではなく、届いたままのもの)。 */
  body: string;
  nowSeconds: number;
}): Promise<boolean> {
  const { publicKeyHex, signatureHex, timestamp, body } = input;
  if (publicKeyHex.length !== 64 || !HEX_RE.test(publicKeyHex)) return false;
  if (signatureHex.length !== 128 || !HEX_RE.test(signatureHex)) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(input.nowSeconds - Number(timestamp)) > SIGNATURE_MAX_AGE_SECONDS) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKeyHex),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      hexToBytes(signatureHex),
      new TextEncoder().encode(timestamp + body),
    );
  } catch {
    return false;
  }
}

/** ボタンの `custom_id` の頭。形を変えたら番号を上げる (古いメッセージのボタンと区別する)。 */
export const ATTENDANCE_CUSTOM_ID_PREFIX = "att1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 記号の長さの上限 (Web の出欠の保存と同じ 32 字)。 */
const SYMBOL_MAX_LENGTH = 32;

/**
 * 回答ボタンの `custom_id` (`att1:<予定の ID>:<記号>`)。記号そのものを入れる —
 * 選択肢の何番目かで持つと、送った後に管理者が選択肢を並べ替えたときに別の
 * 記号で書いてしまう。
 */
export function attendanceCustomId(sessionId: string, symbol: string): string {
  return `${ATTENDANCE_CUSTOM_ID_PREFIX}:${sessionId}:${symbol}`;
}

/** `attendanceCustomId` の逆。形が違えば null。 */
export function parseAttendanceCustomId(
  raw: unknown,
): { sessionId: string; symbol: string } | null {
  if (typeof raw !== "string" || raw.length > 100) return null;
  const head = `${ATTENDANCE_CUSTOM_ID_PREFIX}:`;
  if (!raw.startsWith(head)) return null;
  const rest = raw.slice(head.length);
  const sep = rest.indexOf(":");
  if (sep < 0) return null;
  const sessionId = rest.slice(0, sep);
  const symbol = rest.slice(sep + 1);
  if (!UUID_RE.test(sessionId)) return null;
  if (!symbol || symbol.length > SYMBOL_MAX_LENGTH || /\p{Cc}/u.test(symbol)) return null;
  return { sessionId: sessionId.toLowerCase(), symbol };
}

/** 1 行に置けるボタンの数 / 1 通に置ける行の数 (Discord の上限)。 */
export const MAX_BUTTONS_PER_ROW = 5;
export const MAX_ROWS = 5;
/** ボタンの文字の上限 (Discord の上限)。 */
const BUTTON_LABEL_MAX = 80;

/**
 * ボタンにする選択肢。未回答の印 (`－` など) と空を外し、重複を除いて
 * 1 行に収まる 5 つまで (並びは管理者の選択肢の順)。
 */
export function attendanceButtonChoices(choices: ReadonlyArray<string>): string[] {
  const out: string[] = [];
  for (const raw of choices) {
    const s = raw.trim();
    if (!s || isUnanswered(s) || s.length > SYMBOL_MAX_LENGTH || out.includes(s)) continue;
    out.push(s);
    if (out.length === MAX_BUTTONS_PER_ROW) break;
  }
  return out;
}

/**
 * ボタンの色。○ 系は緑、出られない記号 (× 系、`symbolAllowsTimes` が false)
 * は赤、それ以外は灰。
 */
export function attendanceButtonStyle(symbol: string): 2 | 3 | 4 {
  if (!symbolAllowsTimes(symbol)) return 4;
  if (symbol === "○" || symbol === "◯" || symbol === "〇") return 3;
  return 2;
}

/**
 * 予定を見分ける短い名前 (1 通に予定が 2 つ以上あるときだけボタンに付ける)。
 * `2026/10/07(水) 22:00~0:00` → `10/07(水)`、スケジュール名があれば後ろに付ける。
 */
export function sessionButtonLabel(rawDate: string, scheduleName: string | null): string {
  const m = rawDate.match(/^\d{4}\/(\d{1,2}\/\d{1,2}(?:\([^)]*\))?)/);
  const date = m ? m[1]! : rawDate.slice(0, 16);
  return (scheduleName ? `${date} ${scheduleName}` : date).slice(0, 40);
}

export type ActionRow = {
  type: 1;
  components: Array<{ type: 2; style: 2 | 3 | 4; label: string; custom_id: string }>;
};

/**
 * 催促メッセージに付けるボタン。予定ごとに 1 行。予定が 2 つ以上なら
 * ボタンの文字に予定の名前を付ける。Discord の上限 (5 行) を超える予定は
 * 付けない (本文のポータルへの案内から入力する)。
 */
export function attendanceComponents(
  sessions: ReadonlyArray<{ sessionId: string; label: string }>,
  choices: ReadonlyArray<string>,
): ActionRow[] {
  if (choices.length === 0) return [];
  const many = sessions.length > 1;
  return sessions.slice(0, MAX_ROWS).map((s) => ({
    type: 1,
    components: choices.slice(0, MAX_BUTTONS_PER_ROW).map((symbol) => ({
      type: 2,
      style: attendanceButtonStyle(symbol),
      label: (many ? `${s.label} ${symbol}` : symbol).slice(0, BUTTON_LABEL_MAX),
      custom_id: attendanceCustomId(s.sessionId, symbol),
    })),
  }));
}

/**
 * 押した人の Discord ユーザー ID。サーバー (ギルド) のチャンネルでは
 * `member.user`、DM では `user` に入る。形が違えば null。
 */
export function interactionUserId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { member?: { user?: { id?: unknown } }; user?: { id?: unknown } };
  const id = p.member?.user?.id ?? p.user?.id;
  return typeof id === "string" && DISCORD_ID_RE.test(id) ? id : null;
}

/** 押した本人にだけ見える返事 (メンションは飛ばさない)。 */
export function ephemeralReply(content: string): {
  type: typeof RESPONSE_CHANNEL_MESSAGE;
  data: { content: string; flags: typeof MESSAGE_FLAG_EPHEMERAL; allowed_mentions: { parse: [] } };
} {
  return {
    type: RESPONSE_CHANNEL_MESSAGE,
    data: { content, flags: MESSAGE_FLAG_EPHEMERAL, allowed_mentions: { parse: [] } },
  };
}
