/**
 * 本番の依存の advisory の見張り (2026-10-21)。週 1 回 GitHub Actions で動かす
 * (.github/workflows/advisory-watch.yml)。手元では `GITHUB_TOKEN=$(gh auth token) node scripts/advisory-watch.mjs`。
 *
 * ## なぜ npm audit だけでは足りないか
 *
 * npm audit と Dependabot は GitHub の全体の advisory DB を見る。2026-10-14 公開の
 * Next.js / React の advisory と 10-15 公開の undici の advisory は、パッケージの
 * リポジトリでは公開済みなのに、10-21 の時点でも全体の DB には入っておらず、
 * npm audit は 0 件のままだった (会社側の共有知識の「制約」に記録)。
 *
 * ## 何を見るか
 *
 * package.json の本番の依存 (dependencies) と EXTRA_PACKAGES の、package-lock の版について:
 *   1. 全体の DB: `GET /advisories?ecosystem=npm&affects=<pkg>@<版>` で当たったもの → 対象
 *   2. パッケージのリポジトリの advisory (repository は npm の registry から引く):
 *      直近 RECENT_DAYS 日に公開され、全体の DB にまだ無いものだけを、範囲の文字列で
 *      照合する (`advisory-range.mjs`)。当たれば対象、解釈できなければ要確認
 *   3. Node の security release: NODE_MAJOR 系列で NODE_NOTICE_DAYS 日以内に出たもの
 *      (本番の Node は Vercel が入れるので、runtime logs の `[runtime] node` で確かめる合図)
 *
 * 1 件でもあれば exit 1 (scheduled の workflow が失敗し、GitHub がメールで知らせる)。
 * 結果は `$GITHUB_STEP_SUMMARY` にも書く。
 *
 * 引数: `--as next=16.3.8,undici=8.10.2` で使っている版を差し替える (検知できるかの確かめ用)。
 * workflow の手動の実行では入力 `simulate` が環境変数 `ADVISORY_SIMULATE` で同じ形で届く。
 */
import { appendFileSync, readFileSync } from "node:fs";
import { githubRepoOf, isAffected } from "./advisory-range.mjs";

/** dependencies に無いが本番に載る依存 (next の画像最適化が使う)。 */
const EXTRA_PACKAGES = ["sharp"];
/** リポジトリの advisory をこの日数より前に公開されたものまで見る (全体の DB に入るまでの遅れの窓)。 */
const RECENT_DAYS = 120;
const NODE_MAJOR = process.env.NODE_MAJOR ?? "24";
/** Node の security release を知らせる日数 (週 1 回なので 1 回だけ知らせる幅)。 */
const NODE_NOTICE_DAYS = 8;

const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
if (!token) {
  console.error("GITHUB_TOKEN (または GH_TOKEN) が要ります");
  process.exit(2);
}

/**
 * `--as a=1.2.3,b=4.5.6` (または環境変数 `ADVISORY_SIMULATE`) を { a: "1.2.3", b: "4.5.6" } に。
 * 形が違えば止める (手動の実行の入力をそのまま信じない)。
 */
function parseOverrides(argv) {
  const i = argv.indexOf("--as");
  const raw = (i >= 0 ? argv[i + 1] : process.env.ADVISORY_SIMULATE)?.trim();
  if (!raw) return {};
  const pairs = raw.split(",").map((pair) => pair.trim());
  const bad = pairs.filter((pair) => !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+=\d+\.\d+\.\d+$/i.test(pair));
  if (bad.length > 0) {
    console.error(`版の差し替えの形が違います (名前=x.y.z をカンマ区切り): ${bad.join(", ")}`);
    process.exit(2);
  }
  return Object.fromEntries(
    pairs.map((pair) => {
      const at = pair.lastIndexOf("=");
      return [pair.slice(0, at), pair.slice(at + 1)];
    }),
  );
}

/**
 * JSON を取る。`missingStatuses` の状態コードは「無い」として `{ status, body: null }` を返す
 * (それ以外の失敗は投げる)。回数の上限に当たった 403 は、無いことにせず投げる。
 */
async function getJson(url, { github = false, missingStatuses = [] } = {}) {
  const res = await fetch(url, {
    headers: github
      ? {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "raid-repository-advisory-watch",
        }
      : { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const rateLimited = res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0";
  if (missingStatuses.includes(res.status) && !rateLimited) {
    return { status: res.status, body: null, link: null };
  }
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}${rateLimited ? " (rate limit)" : ""}`);
  return { status: res.status, body: await res.json(), link: res.headers.get("link") };
}

const nextLink = (link) => /<([^>]+)>;\s*rel="next"/.exec(link ?? "")?.[1] ?? null;

// ---- 使っている依存と版 ----
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8")).packages ?? {};
const overrides = parseOverrides(process.argv.slice(2));
const names = [...new Set([...Object.keys(pkg.dependencies ?? {}), ...EXTRA_PACKAGES])];
const deps = names
  .map((name) => ({ name, version: overrides[name] ?? lock[`node_modules/${name}`]?.version }))
  .filter((d) => d.version);

/** @type {{kind: "対象" | "要確認" | "Node", pkg?: string, version?: string, id: string, severity?: string, summary: string, url: string, source: string, patched?: string}[]} */
const findings = [];
const notes = [];

// ---- 1. 全体の DB ----
for (const d of deps) {
  const url = `https://api.github.com/advisories?ecosystem=npm&affects=${encodeURIComponent(`${d.name}@${d.version}`)}&per_page=100`;
  const { body } = await getJson(url, { github: true });
  for (const a of body) {
    const vuln = (a.vulnerabilities ?? []).find((v) => v.package?.name === d.name);
    findings.push({
      kind: "対象",
      pkg: d.name,
      version: d.version,
      id: a.ghsa_id,
      severity: a.severity,
      summary: a.summary,
      url: a.html_url,
      source: "全体の DB",
      patched: vuln?.first_patched_version ?? "",
    });
  }
}
const knownIds = new Set(findings.map((f) => f.id));

// ---- 2. パッケージのリポジトリの advisory ----
const reposToDeps = new Map();
for (const d of deps) {
  let meta;
  try {
    ({ body: meta } = await getJson(`https://registry.npmjs.org/${d.name.replace("/", "%2F")}/${d.version}`));
  } catch (e) {
    notes.push(`${d.name}@${d.version}: registry から repository を取れなかった (${e.message})`);
    continue;
  }
  const repo = githubRepoOf(meta.repository);
  if (!repo) {
    notes.push(`${d.name}: repository が GitHub ではないか書かれていない (全体の DB だけで見る)`);
    continue;
  }
  if (!reposToDeps.has(repo)) reposToDeps.set(repo, []);
  reposToDeps.get(repo).push(d);
}

const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
const inGlobalDb = new Map();
for (const [repo, repoDeps] of reposToDeps) {
  let url = `https://api.github.com/repos/${repo}/security-advisories?state=published&sort=published&direction=desc&per_page=100`;
  const recent = [];
  while (url) {
    const res = await getJson(url, { github: true, missingStatuses: [404] });
    if (res.status === 404) {
      notes.push(`${repo}: リポジトリの advisory を引けなかった (404)`);
      break;
    }
    const page = res.body;
    recent.push(...page.filter((a) => Date.parse(a.published_at) >= cutoff));
    const reachedOld = page.some((a) => Date.parse(a.published_at) < cutoff);
    url = reachedOld ? null : nextLink(res.link);
  }
  for (const a of recent) {
    if (knownIds.has(a.ghsa_id)) continue;
    if (!inGlobalDb.has(a.ghsa_id)) {
      // 全体の DB に未掲載の advisory は、手元のトークンでは 404、Actions の GITHUB_TOKEN
      // では 403 が返る (2026-10-22 に実測)。どちらも「全体の DB で確かめられない」として、
      // 下の範囲の照合に回す (見落とさない側)。
      const g = await getJson(`https://api.github.com/advisories/${a.ghsa_id}`, {
        github: true,
        missingStatuses: [403, 404],
      });
      inGlobalDb.set(a.ghsa_id, g.body !== null);
    }
    // 全体の DB に入っていれば、1. の `affects` の答え (範囲が整っている) に任せる
    if (inGlobalDb.get(a.ghsa_id)) continue;
    for (const d of repoDeps) {
      const repoName = repo.split("/")[1];
      const entries = (a.vulnerabilities ?? []).filter((v) => {
        const n = v.package?.name ?? "";
        return n === d.name || n === repo || n === repoName;
      });
      for (const v of entries) {
        const result = isAffected(v.vulnerable_version_range, d.version, v.patched_versions);
        if (result === false) continue;
        findings.push({
          kind: result === true ? "対象" : "要確認",
          pkg: d.name,
          version: d.version,
          id: a.ghsa_id,
          severity: a.severity,
          summary: a.summary,
          url: a.html_url,
          source: `リポジトリ ${repo} (全体の DB に未掲載・範囲 ${JSON.stringify(v.vulnerable_version_range)})`,
          patched: v.patched_versions ?? "",
        });
        break;
      }
    }
  }
}

// ---- 3. Node の security release ----
// PR のとき (NODE_NOTICE=off) は出さない。PR の中身と関係なく 8 日間 PR が赤くなるため。
if (process.env.NODE_NOTICE !== "off") {
  const { body: releases } = await getJson("https://nodejs.org/dist/index.json");
  const since = Date.now() - NODE_NOTICE_DAYS * 24 * 60 * 60 * 1000;
  for (const r of releases) {
    if (!r.version.startsWith(`v${NODE_MAJOR}.`) || !r.security) continue;
    if (Date.parse(r.date) < since) continue;
    findings.push({
      kind: "Node",
      id: r.version,
      summary: `Node ${r.version} (${r.date}) が security release。本番の Node は Vercel が入れるので、本番・デモを開いた後の runtime logs の \`[runtime] node\` の版を確かめる`,
      url: "https://nodejs.org/en/blog/vulnerability",
      source: "nodejs.org/dist/index.json",
    });
  }
}

// ---- 出力 ----
const lines = [];
lines.push(`# 依存の advisory の見張り (${new Date().toISOString().slice(0, 10)})`, "");
lines.push(`見た依存: ${deps.map((d) => `${d.name}@${d.version}`).join(", ")}`, "");
if (Object.keys(overrides).length > 0) lines.push(`⚠ 版を差し替えて実行: ${JSON.stringify(overrides)}`, "");
if (findings.length === 0) {
  lines.push("対象・要確認はありません。");
} else {
  lines.push("| 種別 | 依存 | advisory | 重大度 | 修正版 | 出どころ |", "|---|---|---|---|---|---|");
  for (const f of findings) {
    const dep = f.pkg ? `${f.pkg}@${f.version}` : "Node";
    lines.push(
      `| ${f.kind} | ${dep} | [${f.id}](${f.url}) ${f.summary.replace(/\|/g, "\\|")} | ${f.severity ?? "-"} | ${f.patched || "-"} | ${f.source} |`,
    );
  }
}
if (notes.length > 0) {
  lines.push("", "## メモ", ...notes.map((n) => `- ${n}`));
}
const out = lines.join("\n");
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${out}\n`);

if (findings.length > 0) {
  console.error(`\n${findings.length} 件 (対象 ${findings.filter((f) => f.kind === "対象").length}・要確認 ${findings.filter((f) => f.kind === "要確認").length}・Node ${findings.filter((f) => f.kind === "Node").length})`);
  process.exit(1);
}
