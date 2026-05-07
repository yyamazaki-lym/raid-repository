import "server-only";

/**
 * TODO #2 phase 3 (2026-05-08): Discord channel への POST 共通ラッパ。
 *
 * 既存の取り込み (discord-schedule.ts / discord-import.ts) は GET 専用なので、
 * native スケジュールの 4 イベント通知 (候補日追加 / 確定 / 中止 / 削除) で初めて
 * POST 経路を使う。fire-and-forget なので caller には例外を投げず、`ok` boolean
 * と reason 列挙で返す。
 *
 * - `DISCORD_BOT_TOKEN` 不在 → no_token (silent skip)
 * - `channelId` 空 → no_channel (silent skip)
 * - `DISCORD_NOTIFY_DRY_RUN=true` → dry_run (payload を console.info に吐いて skip)
 * - 429 → `retry_after` 秒待機して 1 回だけ retry
 * - 4xx/5xx → discord_error (text 200 文字まで保存)
 * - network/timeout → discord_error
 */

const DISCORD_API_BASE = "https://discord.com/api/v10";
const FETCH_TIMEOUT_MS = 15_000;

export type DiscordEmbed = {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
};

export type DiscordAllowedMentions = {
  parse?: Array<"everyone" | "users" | "roles">;
  roles?: string[];
  users?: string[];
};

export type DiscordPostInput = {
  channelId: string;
  embed?: DiscordEmbed;
  content?: string;
  allowedMentions?: DiscordAllowedMentions;
};

export type DiscordPostResult =
  | { ok: true; messageId: string }
  | {
      ok: false;
      reason:
        | "no_token"
        | "no_channel"
        | "dry_run"
        | "rate_limited"
        | "discord_error";
      detail?: string;
    };

export async function postDiscordMessage(
  input: DiscordPostInput,
): Promise<DiscordPostResult> {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) return { ok: false, reason: "no_token" };

  const channelId = input.channelId?.trim();
  if (!channelId) return { ok: false, reason: "no_channel" };

  const body: Record<string, unknown> = {
    embeds: input.embed ? [input.embed] : [],
  };
  if (input.content) body.content = input.content;
  if (input.allowedMentions) body.allowed_mentions = input.allowedMentions;

  if (process.env.DISCORD_NOTIFY_DRY_RUN === "true") {
    console.info("[discord-post] DRY_RUN", { channelId, body });
    return { ok: false, reason: "dry_run" };
  }

  return await sendOnce({ token, channelId, body, allowRetry: true });
}

async function sendOnce(args: {
  token: string;
  channelId: string;
  body: Record<string, unknown>;
  allowRetry: boolean;
}): Promise<DiscordPostResult> {
  const { token, channelId, body, allowRetry } = args;
  let res: Response;
  try {
    res = await fetch(
      `${DISCORD_API_BASE}/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${token}`,
          "User-Agent": "RaidRepositoryBot/0.1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
  } catch (e) {
    return { ok: false, reason: "discord_error", detail: String(e) };
  }

  if (res.status === 429) {
    const retryAfterSec = await readRetryAfter(res);
    if (allowRetry && retryAfterSec !== null && retryAfterSec <= 5) {
      await delay(retryAfterSec * 1000);
      return await sendOnce({ token, channelId, body, allowRetry: false });
    }
    return { ok: false, reason: "rate_limited", detail: `retry_after=${retryAfterSec ?? "?"}` };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return {
      ok: false,
      reason: "discord_error",
      detail: `${res.status}: ${detail.slice(0, 200)}`,
    };
  }

  type DiscordMessageResponse = { id?: string };
  const json = (await res.json().catch(() => ({}))) as DiscordMessageResponse;
  const id = typeof json.id === "string" ? json.id : "";
  return { ok: true, messageId: id };
}

async function readRetryAfter(res: Response): Promise<number | null> {
  try {
    const json = (await res.clone().json()) as { retry_after?: number };
    if (typeof json.retry_after === "number" && json.retry_after >= 0) {
      return json.retry_after;
    }
  } catch {
    // body 読めなくてもヘッダーから拾えれば良い
  }
  const header = res.headers.get("retry-after");
  if (header) {
    const n = Number(header);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
