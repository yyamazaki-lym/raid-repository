/**
 * ウェイマークプリセット (PaisleyPark 形式 JSON) の検証 (2026-08-30、
 * 調査 第3回 §B / Tier2-7)。
 *
 * ゲーム内にウェイマークの共有機能は無く、配布は「ツールが出力した JSON を
 * テキストで渡す」しかない。portal は中身を解釈して描画まではしない
 * (調査ノート §4「作図エディタの自作」= 非推奨) が、**貼った文字列が
 * 壊れていないか / 座標がアリーナ外を指していないか** の粗い検品だけは
 * その場でできた方がよい:
 *
 *   - 形式が違う JSON を配って「取り込めない」と現地で気づく事故を防ぐ
 *   - 2022-09 の「脱法マーカー」(ツールで場外・空中に置いたプリセットが
 *     野良に蔓延し、作成者が処罰された) の混入を、配布前に弾ける
 *
 * 外部依存なしの純関数。判定は保守的で、**確信を持って壊れていると
 * 言えるときだけ警告**する (未知の形式は「判定不能」= 何も言わない)。
 */

export type WaymarkPoint = { x: number; y: number; z: number; active: boolean };

export type WaymarkPresetInfo = {
  /** 解析できたマーカー (A-D / 1-4 のうち Active なもの)。 */
  points: Record<string, WaymarkPoint>;
  /** Active なマーカー数。 */
  activeCount: number;
  /** プリセット名 (Name フィールド)。 */
  name: string | null;
  /** MapID (あれば)。 */
  mapId: number | null;
  /**
   * 座標の粗い健全性チェックに引っかかった内容。空なら問題なし。
   * 「脱法マーカー」検出が主目的だが、単位取り違え等の事故も拾える。
   */
  warnings: string[];
};

export type WaymarkPresetCheck =
  | { kind: "valid"; info: WaymarkPresetInfo }
  /** JSON ではあるが PaisleyPark 形式のマーカーが見つからない。 */
  | { kind: "unknown-json" }
  /** JSON ですらない (Waymark Studio の共有 URL やメモ書き等)。 */
  | { kind: "not-json" };

/** マーカーのキー名。PaisleyPark / WaymarkPresetPlugin 共通。 */
const MARKER_KEYS = ["A", "B", "C", "D", "One", "Two", "Three", "Four"] as const;

/** 表示用のラベル (One→1 など)。 */
export const MARKER_LABEL: Record<string, string> = {
  A: "A",
  B: "B",
  C: "C",
  D: "D",
  One: "1",
  Two: "2",
  Three: "3",
  Four: "4",
};

/**
 * FF14 のフィールド座標の常識的な範囲。
 *
 * アリーナ中心は概ね原点付近だが、マップによっては数百単位の絶対座標を
 * 持つ (例: Z=-693)。したがって「絶対座標そのものの大小」では判定できない。
 * ここで見るのは **マーカー同士の相対的な広がり** と **高さ (Y) の差**:
 *   - 8 点が数百メートル四方にばらけている → 明らかにおかしい
 *   - Y (高さ) が他から極端に離れている → 空中設置の疑い
 * いずれも保守的な閾値にして、正常なプリセットを誤って警告しない。
 */
const MAX_SPREAD = 200;
const MAX_HEIGHT_DIFF = 30;

function toPoint(raw: unknown): WaymarkPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  // PaisleyPark は X/Y/Z + Active、大文字小文字の揺れも許容する。
  const x = num(o.X ?? o.x);
  const y = num(o.Y ?? o.y);
  const z = num(o.Z ?? o.z);
  if (x === null || y === null || z === null) return null;
  const activeRaw = o.Active ?? o.active;
  return { x, y, z, active: activeRaw === undefined ? true : Boolean(activeRaw) };
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * body 文字列を検査する。UI はこの結果に応じて
 * 「✓ 取り込める形式」バッジ or 警告を出す。
 */
export function checkWaymarkPreset(
  body: string,
  locale: "ja" | "en" = "ja",
): WaymarkPresetCheck {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return { kind: "not-json" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: "not-json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "unknown-json" };
  }
  const obj = parsed as Record<string, unknown>;

  const points: Record<string, WaymarkPoint> = {};
  for (const key of MARKER_KEYS) {
    const p = toPoint(obj[key]);
    if (p) points[key] = p;
  }
  if (Object.keys(points).length === 0) return { kind: "unknown-json" };

  const active = Object.entries(points).filter(([, p]) => p.active);
  const warnings: string[] = [];
  if (active.length >= 2) {
    const xs = active.map(([, p]) => p.x);
    const zs = active.map(([, p]) => p.z);
    const ys = active.map(([, p]) => p.y);
    const spread = Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...zs) - Math.min(...zs),
    );
    if (spread > MAX_SPREAD) {
      warnings.push(
        locale === "en"
          ? `Markers spread over ${Math.round(spread)} or more (may be outside the arena)`
          : `マーカーが ${Math.round(spread)} 以上に広がっています (アリーナ外の座標かもしれません)`,
      );
    }
    const heightDiff = Math.max(...ys) - Math.min(...ys);
    if (heightDiff > MAX_HEIGHT_DIFF) {
      warnings.push(
        locale === "en"
          ? `Height differs by ${Math.round(heightDiff)} (a marker may be placed in mid-air)`
          : `高さの差が ${Math.round(heightDiff)} あります (空中に置かれたマーカーかもしれません)`,
      );
    }
  }

  const nameRaw = obj.Name ?? obj.name;
  const mapRaw = obj.MapID ?? obj.MapId ?? obj.mapId;
  return {
    kind: "valid",
    info: {
      points,
      activeCount: active.length,
      name: typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : null,
      mapId: num(mapRaw),
      warnings,
    },
  };
}

/**
 * Waymark Studio の共有 URL か (プラグイン無しでもブラウザで配置を
 * 見られる形式)。該当すればそのままリンクとして開ける旨を UI に出す。
 */
export function isWaymarkStudioUrl(body: string): boolean {
  const t = body.trim();
  if (!/^https?:\/\//i.test(t)) return false;
  try {
    const u = new URL(t);
    return (
      u.hostname.toLowerCase() === "sourpuh.github.io" &&
      u.pathname.includes("waymarkstudio")
    );
  } catch {
    return false;
  }
}

/**
 * 簡易プレビュー用のレイアウト計算 (2026-08-30、Tier2-7 follow-up)。
 *
 * FF14 のフィールド座標は X (東西) / Z (南北) が地面、Y が高さ。真上から
 * 見た図にするので **X を横・Z を縦** に取り、Z が増える方向を下 (= 北が上)
 * にする。これは Waymark 系ツールの慣例と同じ。
 *
 * アリーナの形状データ (MapID → 地形) は持っていないので、**描けるのは
 * 「8 点の相対配置」だけ** — 円形/方形の縁は描かない (それらしく描くと
 * 実際の地形と食い違って誤解を生む)。
 *
 * 返す座標は 0..1 の正規化値。呼び出し側が SVG のサイズに掛ける。
 * 点が 1 個以下 / 全点が同一座標なら中央に寄せる (0 除算回避)。
 */
export type WaymarkLayoutPoint = {
  key: string;
  /** 表示ラベル (A-D / 1-4)。 */
  label: string;
  /** 0..1 (左→右)。 */
  nx: number;
  /** 0..1 (上→下 = 北→南)。 */
  ny: number;
};

export function buildWaymarkLayout(
  points: Record<string, WaymarkPoint>,
): WaymarkLayoutPoint[] {
  const active = Object.entries(points).filter(([, p]) => p.active);
  if (active.length === 0) return [];

  const xs = active.map(([, p]) => p.x);
  const zs = active.map(([, p]) => p.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  // 縦横比を保つため、広い方の辺を基準にした正方形へ収める
  // (アスペクトが崩れると散開の形が別物に見える)。
  const span = Math.max(maxX - minX, maxZ - minZ);
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;

  return active.map(([key, p]) => {
    if (span <= 0) {
      // 全点が同一座標。潰れて重なるだけなので中央に置く。
      return { key, label: MARKER_LABEL[key] ?? key, nx: 0.5, ny: 0.5 };
    }
    return {
      key,
      label: MARKER_LABEL[key] ?? key,
      nx: (p.x - centerX) / span + 0.5,
      ny: (p.z - centerZ) / span + 0.5,
    };
  });
}

/** マーカーの配色 (ゲーム内の色に合わせる: A/1=赤 B/2=黄 C/3=青 D/4=紫)。 */
export const MARKER_COLOR: Record<string, string> = {
  A: "#f87171",
  One: "#f87171",
  B: "#facc15",
  Two: "#facc15",
  C: "#60a5fa",
  Three: "#60a5fa",
  D: "#c084fc",
  Four: "#c084fc",
};
