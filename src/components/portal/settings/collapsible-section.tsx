"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 設定ダイアログの節を折りたたむ殻 (2026-09-08 実機要望)。
 *
 * 「Settings が長くなってきたので、折り畳めそうなものは折り畳めるように
 * したい」。節が 15 を超えて、目的の節まで縦に長くスクロールする状態に
 * なっていた。
 *
 * ## なぜ共通コンポーネントにしたか
 *
 * 折りたたみ自体は既に 3 箇所 (Danger Zone / 出欠の催促 / FFLogs の
 * OAuth・Cookie) にあったが、**それぞれが同じ `<details>` + `<summary>` +
 * 回転する `▸` を手で書き写していた**。畳める節を 10 個以上に増やすと
 * 写し間違いが確実に出る (Tailwind の group 名は節ごとに別名が必要で、
 * 名前を変え忘れると別の節の開閉で矢印が回る) ので、殻を 1 つにする。
 *
 * ## 既定は畳む / 開閉は localStorage に覚える
 *
 * 既定を「開く」にすると長さの問題が畳んだ後しか解決しない。既定は畳む。
 * ただし毎回同じ節を開き直すのは手間なので、**開閉を端末ごとに覚える**
 * (共有設定ではないので DB には持たない — 持つと他の人の画面でも畳まれる)。
 *
 * 状態の持ち方は `useSyncExternalStore` にしてある。理由が 3 つある:
 *
 *   - **初回描画は必ず畳んだ状態**にしたい。`useState` の初期値で
 *     localStorage を読むとサーバ描画と食い違ってハイドレーションが壊れる。
 *     `getServerSnapshot` を `false` 固定にすればこれが構造で保証される
 *   - `useEffect` + `setState` で復元する形は `react-hooks/set-state-in-effect`
 *     の error になる (CI が落ちる)。外部ストアの購読はまさにこの API の用途
 *   - localStorage は Private モードやサイトデータ拒否で**読み書きそのものが
 *     throw する**。真の値をモジュール内の Map に持ち、localStorage は
 *     永続化層としてだけ使うことで、書けない環境でも開閉が動く
 *     (書けたつもりで getSnapshot が旧値を返すと、開いた直後に畳まれる)
 *
 * ## 畳んでいても状態が読めるようにする
 *
 * 畳むと「ON になっているのか」が見えなくなる。`badge` に現在の運用状態
 * (ON/OFF・件数) を渡すと見出しの右端に出るので、**開かずに分かる**。
 * 出欠の催促が 2026-09-04 の折りたたみ化でこの形にしていたので踏襲する。
 */
export function CollapsibleSection({
  id,
  icon,
  title,
  badge,
  tone = "default",
  children,
  className,
}: {
  /**
   * 開閉を覚えるキー (節ごとに一意)。`localStorage` のキーに使うので、
   * **変えると覚えていた開閉が失われる**。節の名前ではなく用途で付ける。
   */
  id: string;
  /** 見出しの左に出すアイコン。`aria-hidden` を付けて渡すこと。 */
  icon?: ReactNode;
  title: ReactNode;
  /** 見出しの右端。畳んだままでも運用状態が読めるようにするための枠。 */
  badge?: ReactNode;
  /** `danger` は破壊的操作の節 (Danger Zone) 用の赤い見出し。 */
  tone?: "default" | "danger";
  children: ReactNode;
  className?: string;
}) {
  const open = useSyncExternalStore(
    subscribe,
    useCallback(() => readOpen(id), [id]),
    // サーバ描画と初回ハイドレーションは必ず畳んだ状態にする。
    getServerSnapshot,
  );

  return (
    // UI-8 (2026-09-08): コマンドパレットが節を名指しでスクロールできるよう
    // に id を DOM に出す (`openSettingsSection` が querySelector で引く)。
    <section className={className} data-settings-section={id}>
      <details
        open={open}
        onToggle={(e) => writeOpen(id, e.currentTarget.open)}
        className="flex flex-col gap-3"
      >
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <h3
            className={cn(
              "flex items-center gap-2 border-b border-border/30 pb-2 font-mono text-[11px] tracking-[0.22em] uppercase transition-colors",
              tone === "danger"
                ? "text-rose-300 hover:text-rose-200"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {/* 開閉の向きは React の状態から出す。Tailwind の
                `group-open/<名前>` は節ごとに別名が必要で、入れ子の
                `<details>` (FFLogs 節) があると名前の衝突で外側の開閉に
                内側の矢印が反応する。 */}
            <span
              aria-hidden
              className={cn(
                "transition-transform",
                tone === "danger"
                  ? "text-rose-300/80"
                  : "text-muted-foreground/80",
                open && "rotate-90",
              )}
            >
              ▸
            </span>
            {icon}
            {title}
            {badge !== undefined && badge !== null ? (
              <span className="ml-auto">{badge}</span>
            ) : null}
          </h3>
        </summary>
        {children}
      </details>
    </section>
  );
}

/**
 * 節を外から開いて画面内へ持ってくる (UI-8、2026-09-08)。
 *
 * コマンドパレットの「設定 → <節>」が、設定ダイアログを開いた直後に呼ぶ。
 * 開閉は既存の store をそのまま使う (= 次回もその節が開いたままになる。
 * 明示的に開いた節は覚えていてよい)。
 *
 * ⚠ スクロールは **ダイアログの中身が描かれた後** でないと効かない。
 * `requestAnimationFrame` を 2 回待つのは、1 回目が Dialog の mount、
 * 2 回目が `<details open>` の反映後になるため (実測で 1 回では
 * 畳まれた高さのままスクロールし、節が画面外に残った)。
 */
export function openSettingsSection(id: string): void {
  if (typeof window === "undefined") return;
  writeOpen(id, true);
  for (const l of listeners) l();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-settings-section="${id}"]`);
      el?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  });
}

/**
 * 折りたたみ状態の保存キー。
 *
 * 接頭辞を付けて、portal が localStorage に持つ他の値 (表示形式の記憶など)
 * と衝突しないようにする。
 */
function storageKey(id: string): string {
  return `portal:settings-open:${id}`;
}

/**
 * 開閉の真の値。
 *
 * localStorage から 1 度だけ読んでここに載せ、以降はこの Map が正。
 * `getSnapshot` は同じ値に対して同じ結果を返さなければならない
 * (毎回 localStorage を読むと、書き込みが拒否された環境で「開いたのに
 * 旧値が返る」→ 直後に畳まれる、が起きる)。
 */
const openState = new Map<string, boolean>();
const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getServerSnapshot(): boolean {
  return false;
}

function readOpen(id: string): boolean {
  const key = storageKey(id);
  const cached = openState.get(key);
  if (cached !== undefined) return cached;
  let stored = false;
  try {
    stored = window.localStorage.getItem(key) === "1";
  } catch {
    // サイトデータを拒否している環境では読み取りが throw する。
    // 畳んだ状態が正しいので、そのまま false で載せる。
  }
  openState.set(key, stored);
  return stored;
}

function writeOpen(id: string, next: boolean): void {
  const key = storageKey(id);
  if (openState.get(key) === next) return;
  openState.set(key, next);
  try {
    window.localStorage.setItem(key, next ? "1" : "0");
  } catch {
    // 書けなくても開閉自体は動く (次にページを開いたときに畳まれるだけ)。
  }
  for (const onStoreChange of listeners) onStoreChange();
}

/**
 * 見出しの右端に出す小さなバッジ。
 *
 * 折りたたんだ節の運用状態 (ON/OFF・件数) を開かずに読ませるための枠で、
 * 節ごとに同じ見た目を書き写さないために切り出してある。`state` は色分け
 * だけを決め、文字は呼び出し側が i18n 辞書から渡す。
 */
export function SectionBadge({
  state,
  children,
}: {
  /** `on` は有効 (色が付く) / `off` は無効 / `loading` は読み込み中。 */
  state: "on" | "off" | "loading";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-sm border px-1.5 py-px text-[11px] tracking-normal",
        state === "on"
          ? "border-[var(--neon-violet)]/50 bg-[var(--neon-violet)]/10 text-[var(--neon-violet)]"
          : "border-border/50 text-muted-foreground/70",
      )}
    >
      {children}
    </span>
  );
}
