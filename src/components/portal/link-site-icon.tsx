"use client";

/**
 * リンクのサイト種別を視覚化するアイコンコンポーネント。
 *
 * 攻略リンク (coarse: web / video / x) と動画リンク (fine: youtube /
 * twitch / niconico / x / web) の両方で使えるよう `variant` で粒度を切り替え。
 *
 * Lucide v1.11 はブランドアイコン非搭載のため、X (Twitter) はインライン SVG、
 * YouTube/Twitch/ニコニコ動画はブランドカラー付きの `Video` アイコンで代用。
 */

import { Globe, Video } from "lucide-react";
import {
  coarseSite,
  coarseSiteLabel,
  detectLinkSite,
  linkSiteLabel,
  type CoarseLinkSite,
  type LinkSite,
} from "@/lib/link-site";
import { useLocale } from "@/lib/i18n/client";

type Props = {
  /** 判定対象 URL。`safeHref` で前段フィルタ済みでも、ここでも parse error はセーフに倒す */
  url: string;
  /** `coarse`: Web / 動画 / X の 3 区分 (攻略リンク向け)。`fine`: YouTube / Twitch / ニコニコ / X / Web の 5 区分 (動画リンク向け) */
  variant?: "coarse" | "fine";
  /** 追加 className (sizing 等は呼び出し側で指定) */
  className?: string;
};

/** X (Twitter) のロゴ風 SVG (currentColor を使うので親の `text-*` でカラー指定可) */
function XGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

const FINE_COLOR: Record<LinkSite, string> = {
  youtube: "text-red-500",
  twitch: "text-violet-400",
  niconico: "text-orange-300",
  x: "text-foreground",
  web: "text-[var(--neon-magenta)]",
};

const COARSE_COLOR: Record<CoarseLinkSite, string> = {
  video: "text-[var(--neon-cyan)]",
  x: "text-foreground",
  web: "text-[var(--neon-magenta)]",
};

export function LinkSiteIcon({ url, variant = "coarse", className }: Props) {
  const locale = useLocale();
  const fine = detectLinkSite(url);

  if (variant === "fine") {
    const color = FINE_COLOR[fine];
    const label = linkSiteLabel(fine, locale);
    if (fine === "x") {
      return (
        <span aria-label={label} title={label} className={className}>
          <XGlyph className={`h-full w-full ${color}`} />
        </span>
      );
    }
    if (fine === "web") {
      return (
        <Globe
          aria-label={label}
          className={`${className ?? ""} ${color}`}
        />
      );
    }
    // youtube / twitch / niconico
    return (
      <Video
        aria-label={label}
        className={`${className ?? ""} ${color}`}
      />
    );
  }

  // coarse: web / video / x
  const coarse = coarseSite(fine);
  const color = COARSE_COLOR[coarse];
  const label = coarseSiteLabel(coarse, locale);
  if (coarse === "x") {
    return (
      <span aria-label={label} title={label} className={className}>
        <XGlyph className={`h-full w-full ${color}`} />
      </span>
    );
  }
  if (coarse === "video") {
    return (
      <Video
        aria-label={label}
        className={`${className ?? ""} ${color}`}
      />
    );
  }
  return (
    <Globe aria-label={label} className={`${className ?? ""} ${color}`} />
  );
}
