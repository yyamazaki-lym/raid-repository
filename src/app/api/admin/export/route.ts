import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { assertAdminResult } from "@/lib/server/auth";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { jstYmdString } from "@/lib/jst-date";
import {
  EXPORT_FORMAT,
  EXPORT_PAGE_SIZE,
  EXPORT_VERSION,
  exportFileName,
  findExportPart,
  isSensitiveSettingKey,
} from "@/lib/data-export";

/**
 * データの書き出し (2026-10-01 監査 F-3)。admin のみ。
 * `GET /api/admin/export?part=schedule|logs|fights|loot|content|settings`
 *
 * 形: `{"format","version","part","exportedAt","tables":{"<表>":[行…]},"errors":[…]}`
 *
 * 表ごとに `EXPORT_PAGE_SIZE` 行ずつ読みながら流す (全件をメモリに載せない)。
 * 応答のヘッダはもう送っているので、途中で読み取りに失敗した表は取れた
 * 分までで閉じ、最後の `errors` に表の名前と理由を入れる (JSON は壊さない)。
 * 対象と除外は `src/lib/data-export.ts`。
 *
 * service role で読む (表ごとの RLS は本人 / admin 向けで、他人の自分用の
 * 注釈なども含めて丸ごと読む経路が無いため)。admin 判定は先に済ませる。
 * 読み取りだけの GET だが、別サイトから踏ませる経路は塞いでおく
 * (`Sec-Fetch-Site: cross-site` は拒否)。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const auth = await assertAdminResult();
  if (!auth.ok) {
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  }
  const part = findExportPart(req.nextUrl.searchParams.get("part"));
  if (!part) {
    return NextResponse.json({ error: "unknown part" }, { status: 400 });
  }

  const supabase = createSupabaseServiceRoleClient();
  const encoder = new TextEncoder();
  const now = new Date();
  // 下の generator (関数宣言) の中では `part` の null 除外が引き継がれないので、
  // 確定した値を別名で持つ。
  const exportPart = part;

  // 2026-10-07 セキュリティ精査: 1 ページずつ「受け手が読んだら次を読む」形に
  // する (`pull`)。以前は `start()` の中で全ページを読んで無条件に enqueue して
  // いたため、受け手が遅いと読んだ分が関数のメモリに溜まり、docstring の
  // 「全件をメモリに載せない」が成り立たなかった (dev で受け手を止めたまま
  // 29 ページ・約 116MB を読み切ることを確認。直した後は途中のバッファ分の
  // 5 ページで止まる)。
  async function* chunks(): AsyncGenerator<string> {
    const errors: Array<{ table: string; reason: string }> = [];
    // 表の配列の内側にいるか (途中で落ちたときに閉じ忘れ / 二重閉じをしない)。
    let inArray = false;
    yield `{"format":${JSON.stringify(EXPORT_FORMAT)},"version":${EXPORT_VERSION},` +
      `"part":${JSON.stringify(exportPart.id)},"exportedAt":${JSON.stringify(now.toISOString())},"tables":{`;
    try {
      for (const [ti, t] of exportPart.tables.entries()) {
        yield `${ti > 0 ? "," : ""}${JSON.stringify(t.table)}:[`;
        inArray = true;
        let first = true;
        for (let from = 0; ; from += EXPORT_PAGE_SIZE) {
          let q = supabase.from(t.table).select("*");
          for (const col of t.order) q = q.order(col, { ascending: true, nullsFirst: true });
          const { data, error } = await q.range(from, from + EXPORT_PAGE_SIZE - 1);
          if (error) {
            console.warn("[admin/export] read failed", t.table, error.message);
            errors.push({ table: t.table, reason: error.message.slice(0, 200) });
            break;
          }
          const rows = (data ?? []) as Array<Record<string, unknown>>;
          let page = "";
          for (const row of rows) {
            if (t.table === "app_settings" && isSensitiveSettingKey(String(row.key ?? ""))) {
              continue;
            }
            page += `${first ? "" : ","}${JSON.stringify(row)}`;
            first = false;
          }
          // 1 ページ = 1 塊。受け手が読むまで次のページを読まない。
          if (page) yield page;
          if (rows.length < EXPORT_PAGE_SIZE) break;
        }
        yield "]";
        inArray = false;
      }
    } catch (err) {
      // 表の途中で落ちても JSON を閉じる。
      console.warn("[admin/export] failed", String(err));
      errors.push({ table: "*", reason: String(err).slice(0, 200) });
    }
    yield `${inArray ? "]" : ""}},"errors":${JSON.stringify(errors)}}`;
  }

  const source = chunks();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await source.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(value));
    },
    async cancel() {
      // 受け手が切断した — 残りのページは読まない。
      await source.return(undefined);
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(part.id, jstYmdString(now))}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
