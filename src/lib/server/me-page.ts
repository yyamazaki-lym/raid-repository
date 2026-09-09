import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { requireDiscordMember } from "./auth";
import { userIsAdmin } from "./admin-roles";
import { bisProgress } from "@/lib/bis-slots";
import { normalizeName } from "@/lib/schedule/attendance-reminder-core";
import type { MemberRole } from "@/lib/member-roles";
import { fetchMyJobs, resolveMyJobsFor } from "./my-jobs";
import {
  buildOnboardingProgress,
  isOnboardingStepId,
  type OnboardingStepId,
} from "@/lib/onboarding-steps";
import type { XivgearEquipSlot } from "@/lib/xivgear-set";

/**
 * 個人ページ `/me` のデータ (B-5、2026-09-08)。
 *
 * 調査ノート第 1 回 B-5 は「自分の担当軽減 / 残り BiS / 出欠 / 直近ログ」。
 * 第 4 回 7-E の再評価どおり **新しいデータは 1 つも増やさない** —
 * W-19 (出席) / W-23 (BiS) / B-3 (学習パス) が揃ったので、**既にある値を
 * 自分の視点で 1 枚に集める**だけで成立する。
 *
 * ## 自分のぶんだけを返す
 *
 * ⚠ 他人の行は**組み立てない**。admin であっても `/me` は自分のページで、
 * 全員の集計は出席サマリー (予定表のクリップボード) 側にある。ここで
 * 全員分を返すと「/me を開けば全員の進捗が見える」導線ができてしまう。
 *
 * ## 自分の担当軽減は出さない
 *
 * ⚠ 軽減表は Google Sheets が正で、担当は**シートの列**にある。コンテンツを
 * またいで集めるにはシートを 1 枚ずつ取りに行くことになり (外部 fetch が
 * コンテンツ数ぶん)、`/me` の表示が Sheets の応答に引きずられる。
 * 軽減表タブに「自分のロールだけ」(UI-4) を入れたので、そこへのリンクで
 * 足りると判断した。
 */

export type MyBisRow = {
  categoryName: string;
  categorySlug: string;
  label: string;
  job: string | null;
  obtained: number;
  total: number;
  remaining: XivgearEquipSlot[];
};

export type MyOnboardingRow = {
  categoryName: string;
  categorySlug: string;
  done: number;
  total: number;
  next: OnboardingStepId | null;
};

export type MyProfile = {
  discordId: string;
  displayName: string | null;
  /**
   * ジョブ (L-8 2026-09-08 / L-10 2026-09-09)。
   * `native_schedule_member_jobs` の割り当て。`defaults` が既定で、
   * `byCategory` はコンテンツ別の上書き (既定と合併しない —
   * `lib/jobs.ts` の `jobsForCategory` が正)。ロールはここから導出する。
   */
  jobs: { defaults: string[]; byCategory: Record<string, string[]> };
  /**
   * 既定のジョブから導いたロール (複数あり得る)。ジョブが 1 つも無ければ
   * 手動指定の `native_schedule_members.role` 1 件に落ちる。
   */
  roles: MemberRole[];
  characterName: string | null;
  isAdmin: boolean;
  /** メンバー一覧に自分の行があるか (無いと出席も BiS も引けない)。 */
  registered: boolean;
};

export type MyDashboard = {
  profile: MyProfile;
  bis: MyBisRow[];
  onboarding: MyOnboardingRow[];
  /**
   * L-10 (2026-09-09): ジョブの上書き先を選ぶための一覧。閲覧できる
   * コンテンツだけ (`categories` の読み取りに RLS が効く)。
   */
  categories: { id: string; name: string }[];
};

/**
 * `/me` に出す値をまとめて読む。
 *
 * 失敗した節は**空で返す** (ページ全体を落とさない)。出席は既存の
 * Server Action (`fetchAttendanceSummaryAction`) がそのまま使えるので
 * ここでは扱わない — 可視範囲の判定をあの 1 箇所に集めておきたい。
 */
export async function fetchMyDashboard(): Promise<MyDashboard> {
  const user = await requireDiscordMember();
  const profile: MyProfile = {
    discordId: user.discordId,
    displayName: null,
    jobs: { defaults: [], byCategory: {} },
    roles: [],
    characterName: null,
    isAdmin: userIsAdmin(user.roles),
    registered: false,
  };
  const empty: MyDashboard = {
    profile,
    bis: [],
    onboarding: [],
    categories: [],
  };

  try {
    const db = createSupabaseServiceRoleClient();
    // L-10 (2026-09-09): メンバー行とジョブ割り当ての読み取りは
    // `fetchMyJobs` に集約した (既定 / コンテンツ別の解決と、旧 `job` 列への
    // fallback を 2 箇所に書かないため)。中では 2 本を Promise.all で引く。
    const myJobs = await fetchMyJobs();
    if (myJobs.registered) {
      profile.displayName = myJobs.displayName;
      profile.jobs = { defaults: myJobs.defaults, byCategory: myJobs.byCategory };
      // ロールは**ジョブから導出**したものを優先し、ジョブ未設定なら手動
      // 指定の `role` に落ちる (ジョブを入れる前の固定を壊さない)。
      profile.roles = resolveMyJobsFor(myJobs, null).roles;
      profile.characterName = myJobs.characterName;
      profile.registered = true;
    }

    const [catsRes, bisRes, stepsRes] = await Promise.all([
      db.from("categories").select("id, slug, name"),
      // BiS は `owner_name` (自由記述) でしか本人と紐づかない。表示名が
      // 未設定なら引けないので、その場合は空にする。
      profile.displayName
        ? db
            .from("category_bis_links")
            .select("id, category_id, label, job, owner_name")
        : Promise.resolve({ data: [] as never[] }),
      db
        .from("category_onboarding_steps")
        .select("category_id, step")
        .eq("discord_user_id", user.discordId),
    ]);

    const cats = new Map<string, { slug: string; name: string }>();
    for (const c of (catsRes.data ?? []) as Array<{
      id: string;
      slug: string;
      name: string;
    }>) {
      cats.set(c.id, { slug: c.slug, name: c.name });
    }

    // ---- 残り BiS ----
    const myKey = normalizeName((profile.displayName ?? "").trim());
    const myLinks = (
      (bisRes.data ?? []) as Array<{
        id: string;
        category_id: string;
        label: string;
        job: string | null;
        owner_name: string | null;
      }>
    ).filter(
      (l) => myKey !== "" && normalizeName((l.owner_name ?? "").trim()) === myKey,
    );
    let bis: MyBisRow[] = [];
    if (myLinks.length > 0) {
      const { data: slotRows } = await db
        .from("category_bis_slots")
        .select("bis_link_id, slot")
        .in(
          "bis_link_id",
          myLinks.map((l) => l.id),
        )
        .eq("obtained", true);
      const obtainedByLink = new Map<string, string[]>();
      for (const s of (slotRows ?? []) as Array<{
        bis_link_id: string;
        slot: string;
      }>) {
        const list = obtainedByLink.get(s.bis_link_id) ?? [];
        list.push(s.slot);
        obtainedByLink.set(s.bis_link_id, list);
      }
      bis = myLinks.map((l) => {
        const cat = cats.get(l.category_id);
        const p = bisProgress(l.job, obtainedByLink.get(l.id) ?? []);
        return {
          categoryName: cat?.name ?? "",
          categorySlug: cat?.slug ?? "",
          label: l.label,
          job: l.job,
          obtained: p.obtained,
          total: p.total,
          remaining: p.remaining,
        };
      });
    }

    // ---- 学習パス ----
    const stepsByCategory = new Map<string, string[]>();
    for (const s of (stepsRes.data ?? []) as Array<{
      category_id: string;
      step: string;
    }>) {
      if (!isOnboardingStepId(s.step)) continue;
      const list = stepsByCategory.get(s.category_id) ?? [];
      list.push(s.step);
      stepsByCategory.set(s.category_id, list);
    }
    // ⚠ 「中身があるか」はここでは見ない (コンテンツごとに動画 / マクロ /
    //   ウェイマークを数えると読み取りがコンテンツ数 × 3 本になる)。
    //   `/me` は「どこまで進んだか」の一覧なので 4 項目固定の分母で足りる。
    //   厳密な分母はコンテンツの攻略情報タブ側で出す。
    const onboarding: MyOnboardingRow[] = [...stepsByCategory.entries()]
      .map(([categoryId, doneIds]) => {
        const cat = cats.get(categoryId);
        const p = buildOnboardingProgress({ doneIds, availability: {} });
        return {
          categoryName: cat?.name ?? "",
          categorySlug: cat?.slug ?? "",
          done: p.done,
          total: p.total,
          next: p.next,
        };
      })
      .filter((r) => r.categorySlug !== "")
      .sort((a, b) => a.categoryName.localeCompare(b.categoryName, "ja"));

    return {
      profile,
      bis,
      onboarding,
      // L-10: 上書き先を選ぶための一覧 (名前順)。
      categories: [...cats.entries()]
        .map(([id, c]) => ({ id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name, "ja")),
    };
  } catch (e) {
    console.warn("[me-page] failed:", e);
    return empty;
  }
}
