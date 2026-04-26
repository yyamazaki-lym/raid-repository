"use client";

import { useState } from "react";
import Image from "next/image";
import { ExternalLink, Film, Play } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LinkFormDialog } from "@/components/portal/link-form-dialog";
import { LinkCardMenu } from "@/components/portal/link-card-menu";
import { useRealtimeCategoryLinks } from "@/lib/category-links-client";
import {
  parseYouTubeId,
  youtubeEmbedUrl,
  youtubeThumbnailUrl,
} from "@/lib/youtube";
import type { CategoryLink } from "@/lib/supabase/types";

type Props = {
  categoryId: string;
  initial: CategoryLink[];
};

export function VideosList({ categoryId, initial }: Props) {
  const videos = useRealtimeCategoryLinks(categoryId, "video", initial);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
          {videos.length} video{videos.length === 1 ? "" : "s"}
        </p>
        <LinkFormDialog categoryId={categoryId} kind="video" />
      </div>

      {videos.length === 0 ? (
        <Card className="glass flex flex-col items-center gap-3 p-10 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-md border border-[var(--neon-cyan)]/40 bg-background/40 text-[var(--neon-cyan)]">
            <Film className="h-4 w-4" aria-hidden />
          </span>
          <p className="font-display text-foreground text-sm">動画未登録</p>
          <p className="text-muted-foreground max-w-md text-xs leading-relaxed">
            YouTube の URL を登録するとサムネイル付きで表示されます。
            その他の動画サイト URL もリンク表示できます。
          </p>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {videos.map((v) => (
            <li key={v.id}>
              <VideoCard video={v} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VideoCard({ video }: { video: CategoryLink }) {
  const ytId = parseYouTubeId(video.url);
  return (
    <Card className="glass neon-edge group flex flex-col gap-2 overflow-hidden p-0 transition-transform hover:-translate-y-0.5">
      {ytId ? (
        <YouTubePreview id={ytId} url={video.url} title={video.title} />
      ) : (
        <a
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          className="grid aspect-video place-items-center bg-secondary/30 text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
        >
          <div className="flex flex-col items-center gap-2">
            <Film className="h-8 w-8" aria-hidden />
            <span className="font-mono text-[10px] tracking-widest uppercase">
              External Video
            </span>
          </div>
        </a>
      )}

      <div className="flex items-start gap-2 px-3 pb-1">
        <a
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 break-words font-display text-sm text-foreground transition-colors hover:text-[var(--neon-cyan)]"
        >
          {video.title}
        </a>
        <LinkCardMenu link={video} />
      </div>
      {video.description && (
        <p className="px-3 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
          {video.description}
        </p>
      )}
      <a
        href={video.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 px-3 pb-3 font-mono text-[10px] break-all text-muted-foreground/70 hover:text-foreground/80"
      >
        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
        <span className="break-all">{video.url}</span>
      </a>
    </Card>
  );
}

/**
 * Click-to-load YouTube preview. Avoids embedding N iframes upfront so the
 * page stays fast — only the cards the user clicks become full <iframe>s.
 */
function YouTubePreview({
  id,
  url,
  title,
}: {
  id: string;
  url: string;
  title: string;
}) {
  const [active, setActive] = useState(false);

  if (active) {
    return (
      <div className="relative aspect-video w-full bg-black">
        <iframe
          src={youtubeEmbedUrl(id) + "?autoplay=1"}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 h-full w-full"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setActive(true)}
      className="group/play relative aspect-video w-full overflow-hidden bg-black"
      aria-label={`${title} を再生`}
    >
      <Image
        src={youtubeThumbnailUrl(id)}
        alt={title}
        fill
        sizes="(min-width: 640px) 50vw, 100vw"
        className="object-cover opacity-90 transition-opacity group-hover/play:opacity-100"
        unoptimized
      />
      <span className="absolute inset-0 grid place-items-center bg-gradient-to-t from-black/60 via-transparent to-transparent">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-black/70 text-white shadow-[0_0_24px_-4px_rgba(255,255,255,0.6)] transition-transform group-hover/play:scale-110">
          <Play className="h-5 w-5 fill-white" aria-hidden />
        </span>
      </span>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-1 font-mono text-[9px] tracking-widest text-white/80 uppercase transition-colors hover:text-white"
        aria-label="YouTubeで開く"
      >
        <ExternalLink className="h-3 w-3" aria-hidden />
        YouTube
      </a>
    </button>
  );
}
