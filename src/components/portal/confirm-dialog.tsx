"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ConfirmOptions = {
  /** ダイアログ見出し (既定 "確認")。 */
  title?: string;
  /** 本文。文字列の改行 (\n) はそのまま改行表示される。 */
  description?: ReactNode;
  /** 実行ボタンのラベル (既定 "OK")。 */
  confirmText?: string;
  /** キャンセルボタンのラベル (既定 "キャンセル")。 */
  cancelText?: string;
  /** 破壊的操作 (削除等) は true で実行ボタンを destructive スタイルにし、
   *  初期フォーカスをキャンセル側に置いて誤実行を防ぐ。 */
  destructive?: boolean;
};

type ConfirmFn = (options?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

type PendingState = {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
};

/**
 * Promise ベースの確認ダイアログ基盤 (総合レビュー F-4)。
 *
 * ネイティブ `window.confirm` (ブラウザ既定 UI・1 段階・テーマ非追従・誤
 * クリック耐性が低い) を、既存 Dialog primitive で統一した確認ダイアログに
 * 置き換える。`(portal)/layout` に 1 つだけ mount し、配下の client component
 * は `useConfirm()` で呼ぶ:
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "削除しますか?", destructive: true }))) return;
 *
 * 解決値: 実行ボタン=true / キャンセル・Esc・×・外側クリック=false。
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null);

  const confirm = useCallback<ConfirmFn>((options = {}) => {
    return new Promise<boolean>((resolve) => {
      setPending({ options, resolve });
    });
  }, []);

  // 解決して閉じる。pending が二重に解決されないよう setState 内で resolve。
  const settle = useCallback((value: boolean) => {
    setPending((curr) => {
      curr?.resolve(value);
      return null;
    });
  }, []);

  const options = pending?.options;
  const destructive = options?.destructive ?? false;

  return (
    <ConfirmContext value={confirm}>
      {children}
      <Dialog
        open={pending !== null}
        onOpenChange={(next) => {
          // 閉じる操作 (Esc / × / 外側クリック) はキャンセル扱い。
          if (!next) settle(false);
        }}
      >
        {/* PC では基底 DialogContent の sm:max-w-sm (384px) だとタイトルが
            折り返して窮屈なため、sm:max-w-lg (512px) に広げる。モバイルは基底の
            余白付き全幅 (max-w-[calc(100%-2rem)]) のまま。 */}
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle
              className={
                destructive ? "flex items-center gap-2 text-rose-300" : undefined
              }
            >
              {destructive && <AlertTriangle className="h-5 w-5" aria-hidden />}
              {options?.title ?? "確認"}
            </DialogTitle>
            {options?.description != null && (
              <DialogDescription className="whitespace-pre-line text-[12px] leading-relaxed">
                {options.description}
              </DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter className="flex-row items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              autoFocus={destructive}
              onClick={() => settle(false)}
            >
              {options?.cancelText ?? "キャンセル"}
            </Button>
            <Button
              type="button"
              variant={destructive ? "destructive" : "default"}
              size="sm"
              autoFocus={!destructive}
              onClick={() => settle(true)}
            >
              {options?.confirmText ?? "OK"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm は ConfirmProvider 配下で使用してください");
  }
  return ctx;
}
