"use client";

import Image from "next/image";
import { ImageOff } from "lucide-react";
import { useState } from "react";
import { useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * 読み込みに失敗した画像を代替表示に差し替える `next/image` のラッパー
 * (L-19、2026-09-09 実機要望「画像がない・読み込めない場合、代替画像など
 * にしたい」)。
 *
 * ## なぜ要るか
 *
 * URL の**形式**が壊れている場合は `safeHref` / `isSafeUrl` が弾いて
 * 「画像URL不正」のプレースホルダが出ていた。しかし **形式は正しいのに
 * 実体が取れない** ケース (Supabase Storage から消した / imgur 側で削除
 * された / 直リンク禁止で 403 / Google フォトの共有期限切れ) には受けが
 * 無く、`<Image>` が壊れた img を描いて終わりだった。alt が空の背景画像に
 * 至っては**何も出ない**ので、「登録したのに映らない」と区別が付かない。
 *
 * ## 表示
 *
 * 親の `relative` ボックスを `absolute inset-0` で埋め、アイコン + 文言
 * (`images.loadFailed`) を出す。文言は `showLabel={false}` で消せる —
 * コンテンツカードの背景のように、カード本体の文字と重なる場所で使う
 * ため (そこはアイコンだけ薄く出す)。
 *
 * ## 状態の持ち方
 *
 * 失敗した URL 自体を state に持つ (`failedSrc === src`)。boolean だと
 * 画像を差し替えた後も「失敗」が残り、直したのに代替表示のままになる。
 */
export function ImageWithFallback({
  src,
  alt,
  sizes,
  className,
  style,
  loading,
  unoptimized,
  showLabel = true,
  fallbackClassName,
}: {
  src: string;
  alt: string;
  sizes?: string;
  className?: string;
  style?: React.CSSProperties;
  loading?: "lazy" | "eager";
  unoptimized?: boolean;
  /** 代替表示に文言を出すか。背景など文字が重なる場所では false。 */
  showLabel?: boolean;
  /** 代替表示の面に足すクラス (背景では角丸・不透明度を合わせる)。 */
  fallbackClassName?: string;
}) {
  const m = useMessages();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (failedSrc === src) {
    return (
      <div
        // 文言を出さない (= 背景) ときは支援技術にも読ませない。カード
        // 本体の文字を邪魔しないための装飾なので、読み上げても情報が無い。
        aria-hidden={!showLabel}
        className={cn(
          "pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-secondary/30 text-muted-foreground",
          fallbackClassName,
        )}
      >
        {/* 文言なし (背景) のときはアイコンを薄めない。面ごと opacity-40 で
            敷くので、さらに 0.7 を掛けると何が起きたのか分からなくなる。 */}
        <ImageOff
          className={showLabel ? "h-5 w-5 opacity-70" : "h-5 w-5"}
          aria-hidden
        />
        {showLabel && (
          <span className="px-2 text-center text-[11px] leading-tight">
            {m.images.loadFailed}
          </span>
        )}
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      className={className}
      style={style}
      loading={loading}
      unoptimized={unoptimized}
      onError={() => setFailedSrc(src)}
    />
  );
}
