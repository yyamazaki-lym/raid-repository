/**
 * 1.9 (2026-04-28) TODO #11: Vercel Free tier の Function コールド
 * スタートを抑制するための warm-up エンドポイント。
 *
 * 外部 cron (GitHub Actions など) から定期的に GET でこの URL を叩く
 * ことで Function を warm 状態に保つ。`/` ページではなく軽量 API
 * ルートにすることで:
 *   - 余計な DB / 外部 fetch を発生させない
 *   - レスポンスが小さく cron 側の通信量も最小
 *
 * Edge Runtime で実行 — cold start ペナルティ自体が極小だが、`/` ページ
 * と同じ Function プールで warm を維持するため明示的に edge 指定。
 */
export const runtime = "edge";

export async function GET(): Promise<Response> {
  return Response.json(
    {
      ok: true,
      ts: new Date().toISOString(),
      runtime: "edge",
    },
    {
      headers: {
        // ブラウザ / CDN にキャッシュさせない (cron が常に function を
        // ヒットさせるため)。
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
