import Image from "next/image";
import Link from "next/link";
import { getMessages } from "@/lib/i18n/server";

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.denied.title };
}

export const dynamic = "force-dynamic";

export default async function DeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const m = await getMessages();
  const isMissingRole = reason === "missing_role";
  const isNotAdmin = reason === "not_admin";
  const isAuthenticated = isMissingRole || isNotAdmin;

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-md flex-col items-center justify-center gap-6 px-4 py-12 text-center">
      {/* 2026-09-06: ログイン画面と同じマークを置き、同じサイトの画面だと
          分かるようにする (彩度は落として「拒否」の文脈に合わせる)。 */}
      <Image
        src="/brand/logo-mark.svg"
        alt=""
        width={64}
        height={64}
        unoptimized
        className="h-16 w-16 opacity-70 saturate-50"
      />
      <h1 className="font-display text-xl tracking-[0.18em] text-foreground">
        ACCESS DENIED
      </h1>
      {isNotAdmin ? (
        // TODO #21 (2.1): admin role-gated edit. The user is authenticated
        // and a guild member but lacks any of the DISCORD_ADMIN_ROLE_IDS.
        <p className="text-sm text-muted-foreground">
          {m.denied.notAdminLine1}
          <br />
          {m.denied.notAdminLine2}
        </p>
      ) : isMissingRole ? (
        // TODO #19: role-gated category. The user is authenticated and a
        // guild member but lacks any of the category's `requiredRoleIds`.
        // 1 行目は「です」を省いて言い切り型に — max-w-md の幅で 2 行折り
        // 返しになると「です。」だけが孤立して見苦しくなるため。
        <p className="text-sm text-muted-foreground">
          {m.denied.missingRoleLine1}
          <br />
          {m.denied.missingRoleLine2}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {m.denied.notMemberLine1}
          <br />
          {m.denied.notMemberLine2}
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
            {m.denied.backToSchedule}
          </Link>
        )}
        <Link
          href="/login"
          className="inline-flex h-10 items-center justify-center rounded-md border border-primary/40 bg-background/40 px-4 text-sm text-foreground transition hover:bg-background/60"
        >
          {isAuthenticated ? m.denied.loginAsOther : m.denied.backToLogin}
        </Link>
      </div>
    </main>
  );
}
