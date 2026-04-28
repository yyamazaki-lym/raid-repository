import "server-only";
import { cache } from "react";

/**
 * Discord guild role list — fetched server-side via bot token.
 *
 * Used by the category edit dialog to populate the "閲覧可能ロール" multi-select
 * (TODO #19). Wrapped in React `cache()` so the same render shares one fetch.
 *
 * `@everyone` (id == guildId) is filtered out — adding it as a required role
 * is meaningless (every guild member already has it).
 *
 * Sort: Discord's `position` is bottom-up integer. We sort descending so
 * the role list reads top-down (高位ロール → 低位ロール) matching Discord UI.
 */

export type DiscordGuildRole = {
  id: string;
  name: string;
  /** Decimal RGB color (Discord serves it as integer). 0 = default. */
  color: number;
  /** Position in role list. Higher = higher in Discord settings UI. */
  position: number;
  /** True for bot-managed integration roles — visible but not assignable. */
  managed: boolean;
};

const DISCORD_API = "https://discord.com/api/v10";

export const fetchGuildRoles = cache(async (): Promise<DiscordGuildRole[]> => {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  if (!botToken || !guildId) return [];

  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/roles`, {
    headers: { Authorization: `Bot ${botToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    console.warn("[discord-roles] fetch failed", res.status);
    return [];
  }
  const data = (await res.json()) as DiscordGuildRole[];
  return data
    .filter((r) => r.id !== guildId)
    .sort((a, b) => b.position - a.position);
});
