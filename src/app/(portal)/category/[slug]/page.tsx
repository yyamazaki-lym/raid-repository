import { redirect } from "next/navigation";

export default async function CategoryRootPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Default sub-tab is loot.
  redirect(`/category/${slug}/loot`);
}
