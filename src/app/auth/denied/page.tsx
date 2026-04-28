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

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-md flex-col items-center justify-center gap-6 px-4 py-12 text-center">
      <h1 className="font-display text-xl tracking-[0.18em] text-foreground">
        ACCESS DENIED
      </h1>
      <p className="text-sm text-muted-foreground">
        このポータルは指定 Discord サーバーのメンバー限定です。
        <br />
        対象サーバーに参加してから、もう一度ログインしてください。
      </p>
      {reason && (
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground/70">
          reason: {reason}
        </p>
      )}
      <Link
        href="/login"
        className="inline-flex h-10 items-center justify-center rounded-md border border-primary/40 bg-background/40 px-4 text-sm text-foreground transition hover:bg-background/60"
      >
        ログインに戻る
      </Link>
    </main>
  );
}
