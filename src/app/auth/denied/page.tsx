import Link from "next/link";

export const metadata = {
  title: "アクセス権がありません",
};

export const dynamic = "force-dynamic";

export default async function DeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const isMissingRole = reason === "missing_role";

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-md flex-col items-center justify-center gap-6 px-4 py-12 text-center">
      <h1 className="font-display text-xl tracking-[0.18em] text-foreground">
        ACCESS DENIED
      </h1>
      {isMissingRole ? (
        // TODO #19: role-gated category. The user is authenticated and a
        // guild member but lacks any of the category's `requiredRoleIds`.
        <p className="text-sm text-muted-foreground">
          このコンテンツは特定の Discord ロールを持つメンバー限定です。
          <br />
          サーバー管理者にロール付与を依頼してください。
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          このポータルは指定 Discord サーバーのメンバー限定です。
          <br />
          対象サーバーに参加してから、もう一度ログインしてください。
        </p>
      )}
      {reason && (
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground/70">
          reason: {reason}
        </p>
      )}
      <div className="flex gap-2">
        {isMissingRole && (
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-md border border-border/40 bg-background/40 px-4 text-sm text-foreground transition hover:bg-background/60"
          >
            スケジュールへ戻る
          </Link>
        )}
        <Link
          href="/login"
          className="inline-flex h-10 items-center justify-center rounded-md border border-primary/40 bg-background/40 px-4 text-sm text-foreground transition hover:bg-background/60"
        >
          {isMissingRole ? "別アカでログイン" : "ログインに戻る"}
        </Link>
      </div>
    </main>
  );
}
