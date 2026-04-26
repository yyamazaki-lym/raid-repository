/**
 * FF14 expansion-themed color palettes.
 * Each entry maps to a `.theme-<id>` CSS class in globals.css.
 *
 * `swatch` = three CSS color expressions used to render a tiny preview pill in
 * the theme switcher. They're intentionally hand-tuned (not pulled from the
 * theme variables) so the preview is consistent across themes.
 */

export type ThemeId =
  | "evercold"
  | "dawntrail"
  | "endwalker"
  | "shadowbringers"
  | "stormblood"
  | "heavensward"
  | "arr";

export type ThemeDef = {
  id: ThemeId;
  /** Short label shown in the trigger button. */
  label: string;
  /** Full title shown in the dropdown. */
  title: string;
  /** Roman/英字 subtitle. */
  subtitle: string;
  /** Expansion number (e.g. "8.0"). */
  version: string;
  /** Three colors for the preview swatch. */
  swatch: [string, string, string];
};

export const THEMES: ThemeDef[] = [
  {
    id: "evercold",
    label: "白銀",
    title: "白銀のワンダラー",
    subtitle: "Evercold",
    version: "8.0",
    swatch: ["#0e1622", "#a9c8de", "#f5f8fb"],
  },
  {
    id: "dawntrail",
    label: "黄金",
    title: "黄金のレガシー",
    subtitle: "Dawntrail",
    version: "7.0",
    swatch: ["#1c1c08", "#f0c849", "#45c98a"],
  },
  {
    id: "endwalker",
    label: "暁月",
    title: "暁月のフィナーレ",
    subtitle: "Endwalker",
    version: "6.0",
    swatch: ["#1c1230", "#e8a87c", "#b48bc4"],
  },
  {
    id: "shadowbringers",
    label: "漆黒",
    title: "漆黒のヴィランズ",
    subtitle: "Shadowbringers",
    version: "5.0",
    swatch: ["#0a0814", "#7ad9e8", "#f0e6d2"],
  },
  {
    id: "stormblood",
    label: "紅蓮",
    title: "紅蓮のリベレーター",
    subtitle: "Stormblood",
    version: "4.0",
    swatch: ["#0c0303", "#dd2a2f", "#f49545"],
  },
  {
    id: "heavensward",
    label: "蒼天",
    title: "蒼天のイシュガルド",
    subtitle: "Heavensward",
    version: "3.0",
    swatch: ["#0d1832", "#5fa9d6", "#e8b945"],
  },
  {
    id: "arr",
    label: "新生",
    title: "新生エオルゼア",
    subtitle: "A Realm Reborn",
    version: "2.0",
    swatch: ["#0c1f14", "#3fb878", "#e0b558"],
  },
];

export const DEFAULT_THEME_ID: ThemeId = "evercold";
export const THEME_STORAGE_KEY = "raid-repo:theme";

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

export function findTheme(id: ThemeId): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
