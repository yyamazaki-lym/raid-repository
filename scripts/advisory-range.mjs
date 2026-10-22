/**
 * advisory の「影響する版の範囲」を解釈する純関数 (2026-10-21)。
 * `scripts/advisory-watch.mjs` から使い、`scripts/check-advisory-range.mjs` で検査する。
 *
 * GitHub の全体の advisory DB の範囲は `>= 16.0.0, < 16.4.1` の形に揃っているが、
 * パッケージのリポジトリの advisory (全体の DB に入る前の、いちばん早い知らせ) は
 * 書き方がばらばら (2026-10-21 に next.js / react / undici / sharp で実物を確認):
 *   - `>= 16.0.0 < 16.2.11` / `>=13.0.0 <= 15.5.27`   比較の並び (区切りはスペースかカンマ)
 *   - `12.0.0 <= 12.0.8` / `6.17.0 < 6.27.0`           先頭の版に演算子が無い = その版以上
 *   - `6.17.0 < 6.27.0; 7.0.0 < 7.28.0`                `;` か `||` で別の系列
 *   - `19.0.0, 19.0.1, …` / カンマ抜け                  版の列挙
 *   - `10.x` / `16.3.?`                                 その系列のどこか
 *   - `10.0.0`                                          版 1 つだけ (「この版から」とも
 *                                                       「この版だけ」とも読める)
 *
 * `isAffected` は true (対象) / false (対象外) / null (解釈できない) を返す。null は
 * 呼び出し側で「要確認」として知らせる (見落とさない側に倒す)。
 */

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)/;

/** `16.4.2` → [16, 4, 2]。prerelease (`-canary…`) は落とす。解釈できなければ null。 */
export function parseVersion(text) {
  const m = VERSION_RE.exec(String(text ?? "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** 版の比較 (a < b で負、a > b で正)。 */
export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * 範囲の 1 要素 (`16.4.0` / `10.x` / `16.3.?`) を、下端 lo と上端 hi (含まない) に直す。
 * 完全な版なら lo = hi = その版 (exact)。解釈できなければ null。
 */
function parseBound(text) {
  const t = text.replace(/^v/, "");
  const full = /^(\d+)\.(\d+)\.(\d+)$/.exec(t);
  if (full) {
    const v = [Number(full[1]), Number(full[2]), Number(full[3])];
    return { exact: true, lo: v, hi: v };
  }
  const minorWild = /^(\d+)\.(\d+)\.(?:x|\*|\?)$/.exec(t);
  if (minorWild) {
    const major = Number(minorWild[1]);
    const minor = Number(minorWild[2]);
    return { exact: false, lo: [major, minor, 0], hi: [major, minor + 1, 0] };
  }
  const majorWild = /^(\d+)(?:\.(?:x|\*|\?))+$/.exec(t);
  if (majorWild) {
    const major = Number(majorWild[1]);
    return { exact: false, lo: [major, 0, 0], hi: [major + 1, 0, 0] };
  }
  return null;
}

function inBound(v, bound) {
  if (bound.exact) return compareVersions(v, bound.lo) === 0;
  return compareVersions(v, bound.lo) >= 0 && compareVersions(v, bound.hi) < 0;
}

/** 演算子つきの比較 1 つを確かめる。ワイルドカードは系列ぜんぶを含む側に倒す。 */
function satisfies(v, op, bound) {
  switch (op) {
    case ">=":
      return compareVersions(v, bound.lo) >= 0;
    case ">":
      return bound.exact ? compareVersions(v, bound.lo) > 0 : compareVersions(v, bound.hi) >= 0;
    case "<=":
      return bound.exact ? compareVersions(v, bound.lo) <= 0 : compareVersions(v, bound.hi) < 0;
    case "<":
      // `< 16.3.?` は「16.3 のどこかで直った」なので、16.3 系はぜんぶ対象に含める
      return bound.exact ? compareVersions(v, bound.lo) < 0 : compareVersions(v, bound.hi) < 0;
    case "=":
      return inBound(v, bound);
    default:
      return false;
  }
}

const TOKEN_RE = /(>=|<=|>|<|=)?\s*(v?\d+(?:\.(?:\d+|x|\*|\?)){1,2})/g;

/** `;` / `||` で区切った 1 系列を確かめる。true / false / null (解釈できない)。 */
function matchAlternative(alt, v, patched) {
  const tokens = [];
  let rest = alt;
  for (const m of alt.matchAll(TOKEN_RE)) {
    const bound = parseBound(m[2]);
    if (!bound) return null;
    tokens.push({ op: m[1] ?? null, bound });
    rest = rest.replace(m[0], " ");
  }
  // 版と演算子のほかに文字が残っていれば (`before 1.2` など) 解釈しない
  if (tokens.length === 0 || /[^\s,]/.test(rest)) return null;

  if (tokens.every((t) => t.op === null)) {
    if (tokens.length >= 2) return tokens.some((t) => inBound(v, t.bound)); // 版の列挙
    const only = tokens[0].bound;
    if (!only.exact) return inBound(v, only); // `10.x`
    // 版 1 つだけ: 「この版から」と「この版だけ」のどちらでも、前なら対象外・同じなら対象
    const cmp = compareVersions(v, only.lo);
    if (cmp < 0) return false;
    if (cmp === 0) return true;
    // 後ろなら、その版以上で、使っている版以下の修正版があれば対象外。無ければ判断できない
    const fixedBefore = patched.some(
      (p) => compareVersions(p, only.lo) >= 0 && compareVersions(p, v) <= 0,
    );
    return fixedBefore ? false : null;
  }

  // 比較の並び。演算子の無い版は先頭だけ許し、「その版以上」と読む (`12.0.0 <= 12.0.8`)
  if (tokens.some((t, i) => t.op === null && i !== 0)) return null;
  return tokens.every((t) => satisfies(v, t.op ?? ">=", t.bound));
}

/** advisory の `patched_versions` (`15.5.28, 16.4.1` / `>= 0.35.5`) から版を拾う。 */
export function parsePatchedVersions(text) {
  return [...String(text ?? "").matchAll(/v?\d+\.\d+\.\d+/g)]
    .map((m) => parseVersion(m[0]))
    .filter(Boolean);
}

/**
 * `version` が `range` の対象か。true (対象) / false (対象外) / null (解釈できない)。
 * `patched` は `patched_versions` の文字列 (版 1 つだけの範囲を読むときに使う)。
 */
export function isAffected(range, version, patched = "") {
  const v = parseVersion(version);
  if (!v || typeof range !== "string" || range.trim() === "") return null;
  const patchedList = parsePatchedVersions(patched);
  let unknown = false;
  for (const alt of range.split(/;|\|\|/).map((s) => s.trim()).filter(Boolean)) {
    const result = matchAlternative(alt, v, patchedList);
    if (result === true) return true;
    if (result === null) unknown = true;
  }
  return unknown ? null : false;
}

/** repository の書き方 (`git+https://github.com/o/r.git` / `github:o/r` / `o/r` / `git@github.com:o/r.git`) から `o/r` を取る。 */
export function githubRepoOf(repository) {
  const url = typeof repository === "string" ? repository : repository?.url;
  if (!url) return null;
  const s = String(url).trim();
  const m =
    /github\.com[/:]([^/\s]+)\/([^/\s#]+?)(?:\.git)?(?:[/#].*)?$/.exec(s) ??
    /^github:([^/\s]+)\/([^/\s#]+?)(?:\.git)?$/.exec(s) ??
    /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(s);
  return m ? `${m[1]}/${m[2]}` : null;
}
