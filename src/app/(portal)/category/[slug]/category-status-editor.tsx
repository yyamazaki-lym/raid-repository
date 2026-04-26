"use client";

import { useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/portal/status-badge";
import { updateCategoryStatus } from "@/lib/categories-client";
import type { CategoryStatus } from "@/lib/supabase/types";

/**
 * Inline status editor for the [slug] page header.
 *
 * Wraps `<StatusBadge>` with a Supabase mutation. Local state is updated
 * optimistically so the badge swaps colors instantly; on failure it reverts
 * and shows a toast. The Realtime subscription on other clients picks up
 * the change for free.
 */
export function CategoryStatusEditor({
  id,
  initialStatus,
  className,
}: {
  id: string;
  initialStatus: CategoryStatus;
  className?: string;
}) {
  const [status, setStatus] = useState<CategoryStatus>(initialStatus);

  const onChange = async (next: CategoryStatus) => {
    const previous = status;
    setStatus(next);
    const result = await updateCategoryStatus(id, next);
    if (!result.ok) {
      setStatus(previous);
      toast.error("ステータス更新失敗: " + result.reason);
    }
  };

  return (
    <StatusBadge status={status} onChange={onChange} className={className} />
  );
}
