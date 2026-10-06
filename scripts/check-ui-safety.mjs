/**
 * 操作の安全性と読み上げの修正 (2026-10-01 監査 U-15 / U-16 / U-17 / U-18 /
 * U-20 / F-8) の検査。
 * 実行: `node scripts/check-ui-safety.mjs`
 *
 *   1. U-16: 確認なしで消していた 4 箇所が `useConfirm` で確かめてから消す
 *      (ミス注釈 / 予定表の「Logs 整理」/ 設定の「重複 Logs を整理」/
 *      動画の紐づけを外す)。`confirm` が window.confirm ではなく
 *      `useConfirm()` の戻り値であること
 *   2. U-15: ジョブの上書きを消すとき、Server Action の結果を見てから画面を
 *      変える
 *   3. U-17: 祝日は色と hover だけでなく、見える目印と読み上げの名前を出す
 *      (予定表の日付セルと過去の日付チップ)
 *   4. U-18: 英語固定だった読み上げ (dialog の閉じる / エラー画面) が表示言語
 *   5. U-20: 週制限チェックの表示名の上限が、入力元 (日付メモの名前欄) と
 *      同じ 100 字 (画面からは上限を超えた値が届かない)
 *   6. F-8: 週制限の消化チェックをコンテンツ設定で出し分ける (既定は出す)
 */
import { readFileSync } from "node:fs";

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}\n       expected: ${e}\n       actual:   ${a}`);
  }
}
const read = (p) => readFileSync(p, "utf8");

/** `start` から始まる関数 / ハンドラ本体 (次の空行 2 つ相当まで) を雑に切り出す。 */
function sliceFrom(src, start, len = 1200) {
  const at = src.indexOf(start);
  return at < 0 ? "" : src.slice(at, at + len);
}

console.log("1. U-16 削除の前に確かめる");
{
  const cases = [
    {
      file: "src/components/portal/logs/pull-detail-panel.tsx",
      fn: "export function PullDetailPanel(",
      handler: "onDelete={async (id) => {",
      action: "deletePullNoteAction(id)",
    },
    {
      file: "src/components/portal/schedule/legend.tsx",
      fn: "export function Legend(",
      handler: "const runDedupeLogs = async () => {",
      action: "dedupeSessionLogs()",
    },
    {
      file: "src/components/portal/settings/fflogs-sync-section.tsx",
      fn: "export function FflogsSyncSection(",
      handler: "const onDedupeLogs = async () => {",
      action: "dedupeSessionLogs()",
    },
    {
      file: "src/components/portal/logs/offset-dialog.tsx",
      fn: "export function OffsetDialog(",
      handler: "const remove = async () => {",
      action: "deleteReportVideoAction(target.id)",
    },
  ];
  for (const c of cases) {
    const src = read(c.file);
    const body = sliceFrom(src, c.handler);
    const confirmAt = body.indexOf("const ok = await confirm({");
    const actionAt = body.indexOf(c.action);
    check(`${c.file}: ハンドラがある`, body.length > 0, true);
    check(`${c.file}: 実行より前に確かめる`, confirmAt >= 0 && actionAt > confirmAt, true);
    check(`${c.file}: 断られたら何もしない`, /if \(!ok\) return;/.test(body.slice(confirmAt, actionAt)), true);
    check(`${c.file}: 破壊的操作として出す`, /destructive: true,/.test(body.slice(confirmAt, actionAt)), true);
    const fnBody = sliceFrom(src, c.fn, 4000);
    check(`${c.file}: confirm は useConfirm() の戻り値 (window.confirm ではない)`, /const confirm = useConfirm\(\);/.test(fnBody), true);
    check(`${c.file}: useConfirm を import`, /import \{ useConfirm \} from "@\/components\/portal\/confirm-dialog";/.test(src), true);
  }
}

console.log("2. U-15 ジョブの上書きの削除");
{
  const src = read("src/components/portal/my-job-scopes.tsx");
  const body = sliceFrom(src, "const clear = (categoryId: string) => {", 800);
  check("結果を受け取る", /const res = await setMyJobsAction\(\{ categoryId, jobs: \[\] \}\);/.test(body), true);
  const failAt = body.indexOf("if (!res.ok)");
  const removeAt = body.indexOf("setOpenIds(");
  check("失敗なら画面を変えずに知らせる", failAt >= 0 && removeAt > failAt && /toast\.error\(m\.myJob\.clearOverrideFailed\(res\.reason\)\);\s*return;/.test(body), true);
}

console.log("3. U-17 祝日の目印");
{
  const mark = read("src/components/portal/schedule/holiday-mark.tsx");
  check("目印は見える (読み上げからは外す)", /<span aria-hidden>\{m\.pastSimple\.holidayMark\}<\/span>/.test(mark), true);
  check("読み上げには祝日名", /<span className="sr-only">\{name \?\? m\.pastSimple\.holidayFallback\}<\/span>/.test(mark), true);
  check("11px 以上", /text-\[11px\]/.test(mark), true);
  const list = read("src/components/portal/schedule-list.tsx");
  check("予定表の日付セルに出す", /\{text\}\s*\{holiday \? \(\s*<HolidayMark name=\{holidayName\} \/>/.test(list), true);
  // 2026-10-06: 祝日の行だけ時刻・出欠のチップが右へずれていたので、表に祝日が
  // あれば祝日でない行にも同じ幅の見えない枠を置く。枠は読み上げに出さない。
  check("祝日でない行には見えない枠 (表に祝日があるとき)", /: reserveHoliday \? \(\s*<HolidayMark name=\{null\} placeholder \/>/.test(list), true);
  check("表に祝日があるかを数える", /if \(!holiday && isJapaneseHoliday\(s\.date, holidays\)\) holiday = true;/.test(list), true);
  const placeholderAt = mark.indexOf("if (placeholder)");
  const placeholderBody = placeholderAt >= 0 ? mark.slice(placeholderAt, mark.indexOf("}", mark.indexOf("</span>", placeholderAt))) : "";
  check("見えない枠は読み上げない", /aria-hidden/.test(placeholderBody) && /invisible/.test(placeholderBody) && !/sr-only/.test(placeholderBody), true);
  const chips = read("src/components/portal/schedule-past-simple.tsx");
  check("過去の日付チップに出す", /<\/SessionMemoPopover>\s*\{holiday && <HolidayMark name=\{holidayName\} \/>\}/.test(chips), true);
}

console.log("4. U-18 読み上げの言語");
{
  const dialog = read("src/components/ui/dialog.tsx");
  check("dialog の閉じる: 英語固定をやめる", /sr-only">Close</.test(dialog), false);
  check("dialog の閉じる: 表示言語", /<span className="sr-only">\{m\.common\.close\}<\/span>/.test(dialog), true);
  const err = read("src/app/(portal)/error.tsx");
  check("エラー画面の見出し: 英字は飾り", /<span aria-hidden>Page Error<\/span>/.test(err), true);
  check("エラー画面の見出し: 読み上げは表示言語", /<span className="sr-only">\{m\.app\.pageErrorTitle\}<\/span>/.test(err), true);
  check("リトライ: 読み上げは表示言語", /aria-label=\{m\.app\.retry\}/.test(err), true);
}

console.log("5. U-20 表示名の上限");
{
  const actions = read("src/lib/server/loot-weekly-actions.ts");
  const memos = read("src/lib/schedule-memos-client.ts");
  const nameMax = Number(/const NAME_MAX = (\d+);/.exec(actions)?.[1]);
  const memoMax = Number(/export const MEMO_AUTHOR_NAME_MAX = (\d+);/.exec(memos)?.[1]);
  check("週制限チェックの NAME_MAX と日付メモの名前欄の上限が同じ", [nameMax, memoMax], [100, 100]);
  const panel = read("src/components/portal/loot-extras.tsx");
  const call = sliceFrom(panel, "await setMyLootWeeklyStatusAction({", 500);
  check("画面からは note を送らない (上限を超えた一言は届かない)", /\bnote:/.test(call.slice(0, call.indexOf("});"))), false);
}

console.log("6. F-8 週制限の消化チェックの出し分け");
{
  const page = read("src/app/(portal)/category/[slug]/loot/page.tsx");
  check("既定は出す (!== false)", /const weeklyEnabled = category\.tabConfig\?\.\["loot"\]\?\.weekly !== false;/.test(page), true);
  check("出さないときは週を読まない", /const weeks = weeklyEnabled \? openWeekStarts\(new Date\(\), windowWeeks\) : \[\];/.test(page), true);
  const form = read("src/components/portal/category-form-dialog.tsx");
  check("編集画面: 初期値は !== false", /weekly: c\?\.weekly !== false,/.test(form), true);
  check("編集画面: 既定なら書かない", /const isDefault = s\.enabled && !trimmedLabel && s\.wantMatrix && s\.weekly;/.test(form), true);
  check("編集画面: OFF のときだけ weekly: false を保存", /\.\.\.\(id === "loot" && !s\.weekly \? \{ weekly: false \} : \{\}\),/.test(form), true);
  check("編集画面: チェックボックス", /checked=\{s\.weekly\}/.test(form) && /m\.categoryForm\.lootWeeklyLabel/.test(form), true);
  const types = read("src/lib/supabase/types.ts");
  check("型に weekly", /weekly\?: boolean;/.test(types), true);
}

if (failures > 0) {
  console.log(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて ok");
