"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users, Trash2, Plus, Loader2, Save, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  addNativeScheduleMemberAction,
  updateNativeScheduleMemberAction,
  deleteNativeScheduleMemberAction,
} from "@/lib/server/native-schedule-actions";
import type { NativeMemberRowFull } from "@/lib/schedule/native-admin-client";

/**
 * TODO #2 phase 2-C (2026-05-07): native スケジュール member CRUD section。
 *
 * - 一覧 (Discord ID または ローカルキー + 表示名 + sort_order + is_active toggle + delete)
 * - 「+ 追加」inline form (キー入力 + ローカルキー自動生成 button + 表示名 + sort_order + 追加)
 *
 * メンバーキーは下記 2 種を受け付ける:
 *   - 17〜20 桁数字 = 通常 Discord ID (本人 popover / 個別通知の対象)
 *   - `local_<英数字_->{3,32}` = Discord アカウント未取得メンバー用ローカルキー。
 *     本人 popover は出ない (一致しないため) ので admin が代理運用する想定。
 *
 * 表示名 / sort_order は inline 編集 (drafts state)、変更後に「保存」ボタンを
 * 出して `updateNativeScheduleMemberAction` を呼ぶ。is_active toggle と削除
 * は即時 commit。client / server で同一の regex で 2 重 validate。
 *
 * CRUD 後は `onChanged()` callback で settings-dialog の adminAux fetch を
 * 再走させ、`router.refresh()` でトップ schedule-list も更新。
 */

const MEMBER_KEY_RE = /^(?:\d{17,20}|local_[A-Za-z0-9_-]{3,32})$/;
const MEMBER_KEY_REASON =
  "Discord ID (17〜20 桁の数字) または ローカルキー (local_<英数字>, 3〜32 文字) を入力してください";

const generateLocalKey = () =>
  // 衝突しにくく短めの suffix。Date.now base36 (約 8 文字) + random base36 4 文字。
  `local_${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0")}`;

type DraftMap = Record<string, { displayName: string; sortOrder: string }>;

export function NativeMembersSection({
  canEdit,
  members,
  loaded,
  onChanged,
}: {
  canEdit: boolean;
  members: NativeMemberRowFull[];
  loaded: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newDiscordId, setNewDiscordId] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newSortOrder, setNewSortOrder] = useState("0");
  const [drafts, setDrafts] = useState<DraftMap>({});

  const draftFor = (m: NativeMemberRowFull) =>
    drafts[m.discord_user_id] ?? {
      displayName: m.display_name,
      sortOrder: String(m.sort_order),
    };

  const setDraft = (
    id: string,
    patch: Partial<{ displayName: string; sortOrder: string }>,
  ) => {
    setDrafts((prev) => {
      const m = members.find((x) => x.discord_user_id === id);
      const cur =
        prev[id] ??
        (m
          ? { displayName: m.display_name, sortOrder: String(m.sort_order) }
          : { displayName: "", sortOrder: "0" });
      return { ...prev, [id]: { ...cur, ...patch } };
    });
  };

  const clearDraft = (id: string) =>
    setDrafts((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const onAdd = () => {
    const discordUserId = newDiscordId.trim();
    const displayName = newDisplayName.trim();
    const sortOrder = Number(newSortOrder);
    if (!MEMBER_KEY_RE.test(discordUserId)) {
      toast.error(MEMBER_KEY_REASON);
      return;
    }
    if (!displayName) {
      toast.error("表示名を入力してください");
      return;
    }
    if (!Number.isFinite(sortOrder)) {
      toast.error("並び順は数値で入力してください");
      return;
    }
    startTransition(async () => {
      const r = await addNativeScheduleMemberAction({
        discordUserId,
        displayName,
        sortOrder,
      });
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      toast.success(`メンバー「${displayName}」を追加しました`);
      setNewDiscordId("");
      setNewDisplayName("");
      setNewSortOrder("0");
      onChanged();
      router.refresh();
    });
  };

  const onSaveRow = (m: NativeMemberRowFull) => {
    const draft = draftFor(m);
    const patch: {
      displayName?: string;
      sortOrder?: number;
    } = {};
    if (draft.displayName.trim() !== m.display_name) {
      const v = draft.displayName.trim();
      if (!v) {
        toast.error("表示名を入力してください");
        return;
      }
      patch.displayName = v;
    }
    if (draft.sortOrder !== String(m.sort_order)) {
      const n = Number(draft.sortOrder);
      if (!Number.isFinite(n)) {
        toast.error("並び順は数値で入力してください");
        return;
      }
      patch.sortOrder = n;
    }
    if (Object.keys(patch).length === 0) {
      clearDraft(m.discord_user_id);
      return;
    }
    startTransition(async () => {
      const r = await updateNativeScheduleMemberAction(
        m.discord_user_id,
        patch,
      );
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      toast.success(`「${m.display_name}」を更新しました`);
      clearDraft(m.discord_user_id);
      onChanged();
      router.refresh();
    });
  };

  const onToggleActive = (m: NativeMemberRowFull, next: boolean) => {
    startTransition(async () => {
      const r = await updateNativeScheduleMemberAction(m.discord_user_id, {
        isActive: next,
      });
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      toast.success(
        `「${m.display_name}」を ${next ? "有効化" : "無効化"} しました`,
      );
      onChanged();
      router.refresh();
    });
  };

  const onDelete = (m: NativeMemberRowFull) => {
    if (
      !confirm(
        `「${m.display_name}」(${m.discord_user_id}) を削除します。\n` +
          `関連する出欠データも一緒に削除されます (元に戻せません)。\n` +
          `よろしいですか?`,
      )
    )
      return;
    startTransition(async () => {
      const r = await deleteNativeScheduleMemberAction(m.discord_user_id);
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      toast.success(`「${m.display_name}」を削除しました`);
      clearDraft(m.discord_user_id);
      onChanged();
      router.refresh();
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center gap-2 border-b border-border/30 pb-2">
        <Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
          Native Schedule Members
        </span>
      </header>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        スケジュール表に出欠列として表示するメンバー。Discord ID
        または ローカルキーで識別し、並び順 (昇順) で左から並びます。無効化された
        メンバーはスケジュール表に出ませんが、過去の出欠履歴は DB に残ります。
        <br />
        <span className="text-muted-foreground/80">
          ※ ローカルキー (
          <code className="font-mono">local_*</code>
          ) で登録したメンバーは本人として出欠入力できません (admin が代理運用)。
        </span>
      </p>

      {!loaded ? (
        <div className="text-[11px] text-muted-foreground italic">
          読み込み中...
        </div>
      ) : members.length === 0 ? (
        <div className="rounded-md border border-border/30 px-3 py-2 text-[11px] text-muted-foreground">
          メンバーがまだ登録されていません。下のフォームから追加してください。
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {members.map((m) => {
            const draft = draftFor(m);
            const dirty =
              draft.displayName !== m.display_name ||
              draft.sortOrder !== String(m.sort_order);
            return (
              <li
                key={m.discord_user_id}
                className={
                  "flex flex-col gap-2 rounded-md border px-3 py-2 transition-colors sm:flex-row sm:items-center " +
                  (m.is_active
                    ? "border-border/40"
                    : "border-border/20 bg-secondary/30 opacity-70")
                }
              >
                <div className="flex flex-col gap-0.5 sm:w-1/3">
                  <span className="font-mono text-[10px] text-muted-foreground/70">
                    {m.discord_user_id}
                  </span>
                  <Input
                    type="text"
                    value={draft.displayName}
                    onChange={(e) =>
                      setDraft(m.discord_user_id, {
                        displayName: e.target.value,
                      })
                    }
                    disabled={!canEdit || pending}
                    placeholder="表示名"
                    className="h-7 text-xs"
                  />
                </div>
                <div className="flex items-center gap-1.5 sm:w-28">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    並び
                  </span>
                  <Input
                    type="number"
                    value={draft.sortOrder}
                    onChange={(e) =>
                      setDraft(m.discord_user_id, {
                        sortOrder: e.target.value,
                      })
                    }
                    disabled={!canEdit || pending}
                    className="h-7 w-16 text-xs"
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px]">
                  <input
                    type="checkbox"
                    checked={m.is_active}
                    onChange={(e) => onToggleActive(m, e.target.checked)}
                    disabled={!canEdit || pending}
                    className="accent-[var(--neon-cyan)]"
                  />
                  有効
                </label>
                <div className="ml-auto flex gap-1.5">
                  {dirty && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!canEdit || pending}
                      onClick={() => onSaveRow(m)}
                      className="h-7 gap-1 px-2 text-[10px]"
                    >
                      <Save className="h-3 w-3" aria-hidden />
                      保存
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!canEdit || pending}
                    onClick={() => onDelete(m)}
                    aria-label={`「${m.display_name}」を削除`}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && (
        <div className="flex flex-col gap-2 rounded-md border border-dashed border-border/40 px-3 py-2.5">
          <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
            Add member
          </span>
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
            <div className="flex items-center gap-1 sm:flex-1">
              <Input
                type="text"
                value={newDiscordId}
                onChange={(e) => setNewDiscordId(e.target.value)}
                disabled={pending}
                placeholder="Discord ID または local_xxx"
                className="h-7 text-xs"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => setNewDiscordId(generateLocalKey())}
                aria-label="ローカルキーを自動生成"
                title="Discord アカウント未取得メンバー用のローカルキーを自動生成"
                className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-foreground"
              >
                <Wand2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
            <Input
              type="text"
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              disabled={pending}
              placeholder="表示名"
              className="h-7 text-xs sm:flex-1"
            />
            <Input
              type="number"
              value={newSortOrder}
              onChange={(e) => setNewSortOrder(e.target.value)}
              disabled={pending}
              placeholder="並び"
              className="h-7 text-xs sm:w-20"
            />
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={onAdd}
              className="h-7 gap-1 px-3 text-[10px]"
            >
              {pending ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <Plus className="h-3 w-3" aria-hidden />
              )}
              追加
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
