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
  const isNotAdmin = reason === "not_admin";
  const isAuthenticated = isMissingRole || isNotAdmin;

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-md flex-col items-center justify-center gap-6 px-4 py-12 text-center">
      <h1 className="font-display text-xl tracking-[0.18em] text-foreground">
        ACCESS DENIED
      </h1>
      {isNotAdmin ? (
        // TODO #21 (2.1): admin role-gated edit. The user is authenticated
        // and a guild member but lacks any of the DISCORD_ADMIN_ROLE_IDS.
        <p className="text-sm text-muted-foreground">
          この操作は管理者ロールを持つメンバー限定。
          <br />
          サーバー管理者に管理者ロール付与を依頼してください。
        </p>
      ) : isMissingRole ? (
        // TODO #19: role-gated category. The user is authenticated and a
        // guild member but lacks any of the category's `requiredRoleIds`.
        // 1 行目は「です」を省いて言い切り型に — max-w-md の幅で 2 行折り
        // 返しになると「です。」だけが孤立して見苦しくなるため。
        <p className="text-sm text-muted-foreground">
          このコンテンツは特定の Discord ロールを持つメンバー限定。
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
        {isAuthenticated && (
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
          {isAuthenticated ? "別アカでログイン" : "ログインに戻る"}
        </Link>
      </div>
    </main>
  );
}
