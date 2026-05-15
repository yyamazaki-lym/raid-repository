import "server-only";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * Phase 17 (2.x, 2026-05-15): Discord CDN URL の自動 Storage 退避。
 *
 * Discord の添付ファイル URL (`cdn.discordapp.com` / `media.discordapp.net`)
 * は 2023年末以降 `?ex=...&hm=...` の署名付きで配信され 24時間で失効する。
 * これを `kind='image'` リンクとして DB に直接保存すると、翌日以降に閲覧
 * したとき 403 を返して「画像URL不正」表示に化ける。
 *
 * 本 helper は CDN URL を検知してサーバ側で画像バイトを取得し、既存の
 * `category-strategy-images` バケット (image-form-dialog のローカル経路と
 * 同じ bucket / path 規則) にコピーしてから公開 URL を返す。呼び出し側は
 * 取得した URL を `category_links.url` / `thumbnail_url` に保存する。
 *
 * Storage 書き込みは service role client を使う (RLS バイパス)。呼び出し側で
 * `assertAdminResult()` を通過した直後の操作なので、admin gate は親に委譲。
 */

const DISCORD_CDN_HOSTS = new Set([
  "cdn.discordapp.com",
  "media.discordapp.net",
]);

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

// バケット側 `file_size_limit` と揃える (5MB)。事前判定はメッセージのため。
const MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;

export function isDiscordCdnUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      (u.protocol === "https:" || u.protocol === "http:") &&
      DISCORD_CDN_HOSTS.has(u.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export type MigrateResult =
  | { ok: true; publicUrl: string }
  | { ok: false; reason: string };

/**
 * Discord CDN URL から画像バイトを取得し category-strategy-images バケットに
 * upload して公開 URL を返す。失敗時は throw せず `{ ok: false, reason }` を
 * 返す (server action 側でそのままユーザー向け文言に使えるよう)。
 *
 * path 規則: `${categoryId}/${Date.now()}-${rand}.${ext}` (ローカル経路と同型)。
 */
export async function migrateDiscordImageToStorage(
  sourceUrl: string,
  categoryId: string,
): Promise<MigrateResult> {
  if (!isDiscordCdnUrl(sourceUrl)) {
    return { ok: false, reason: "Discord CDN URL ではありません" };
  }

  let res: Response;
  try {
    res = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
      headers: { "User-Agent": "RaidRepository/0.1" },
    });
  } catch (e) {
    return {
      ok: false,
      reason:
        "Discord 画像取得失敗 — URL 期限切れ / タイムアウトの可能性 (" +
        (e instanceof Error ? e.message : "unknown") +
        ")",
    };
  }
  if (!res.ok) {
    // 403 = 署名期限切れ、404 = 削除済、429 = レート制限。いずれも同じ文言で
    // ユーザーに「貼り直しを促す」のが妥当。
    return {
      ok: false,
      reason: `Discord 画像取得失敗 (HTTP ${res.status}) — URL 期限切れの可能性`,
    };
  }

  const contentType = (res.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!ALLOWED_MIME.has(contentType)) {
    return {
      ok: false,
      reason: `画像 MIME (${contentType || "unknown"}) は許可されていません`,
    };
  }

  const lenHeader = Number(res.headers.get("content-length") ?? "0");
  if (lenHeader > MAX_BYTES) {
    return { ok: false, reason: "画像サイズが 5MB を超えています" };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) {
    return { ok: false, reason: "画像サイズが 5MB を超えています" };
  }

  const ext = mimeToExt(contentType);
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${categoryId}/${Date.now()}-${rand}.${ext}`;

  let supabase;
  try {
    supabase = createSupabaseServiceRoleClient();
  } catch (e) {
    return {
      ok: false,
      reason:
        "Storage クライアント初期化失敗 — SUPABASE_SERVICE_ROLE_KEY 未設定の可能性 (" +
        (e instanceof Error ? e.message : "unknown") +
        ")",
    };
  }

  const { error: upErr } = await supabase.storage
    .from("category-strategy-images")
    .upload(path, buf, {
      cacheControl: "3600",
      upsert: false,
      contentType,
    });
  if (upErr) {
    return { ok: false, reason: `Storage アップロード失敗: ${upErr.message}` };
  }

  const { data } = supabase.storage
    .from("category-strategy-images")
    .getPublicUrl(path);
  return { ok: true, publicUrl: data.publicUrl };
}

function mimeToExt(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}
