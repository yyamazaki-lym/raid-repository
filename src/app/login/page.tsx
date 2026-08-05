import { LoginButton } from "./login-button";

export const metadata = {
  title: "ログイン",
};

// Discord OAuth はセッション cookie を扱うので edge / SSG で固めると
// 不整合になる。動的レンダリングを明示する。
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  // 2026-08-05 監査 L-7: `detail` (Supabase の内部エラー文字列) の受け渡しを
  // 廃止。診断はサーバーログ側に寄せた。クエリ由来の任意文字列をエラー
  // ボックスに描画する口でもあったため、パラメータごと落としている
  // (React のエスケープで XSS にはならないが、攻撃者が任意の「案内文」を
  // 出せる状態だった)。表示する文言は `describeError` の既知集合のみ。
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const errorMessage = describeError(error);

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-md flex-col items-center justify-center gap-6 px-4 py-12">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="font-display text-2xl tracking-[0.18em] text-foreground">
          RAID REPOSITORY
        </h1>
        <p className="text-sm text-muted-foreground">
          このポータルは Discord サーバーのメンバー限定です。
          <br />
          Discord アカウントでログインしてください。
        </p>
      </div>

      <LoginButton next={next ?? "/"} />

      {errorMessage && (
        <div
          role="alert"
          className="w-full rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-center text-xs text-destructive"
        >
          {errorMessage}
        </div>
      )}
    </main>
  );
}

function describeError(code: string | undefined): string | null {
  switch (code) {
    case undefined:
    case "":
      return null;
    case "missing_code":
      return "認可コードが届きませんでした。もう一度お試しください。";
    case "exchange_failed":
      return "Supabase とのセッション交換に失敗しました。";
    default:
      return `エラー: ${code}`;
  }
}
