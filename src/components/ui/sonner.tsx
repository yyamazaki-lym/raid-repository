"use client"

import { useEffect } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"
import { markToasterReady } from "@/lib/toaster-ready"

const Toaster = ({ ...props }: ToasterProps) => {
  // 2.14 (2026-09-06): mount 完了を通知。子 <Sonner> の subscribe effect
  // は親のこの effect より先に走るので、ここで ready にすれば以降の
  // toast() は取りこぼさない。詳細は src/lib/toaster-ready.ts。
  useEffect(() => {
    markToasterReady()
  }, [])
  return (
    <Sonner
      // 既定値。実際の描画は layout.tsx の <DynamicToaster theme="dark"
      // position="top-center" .../> が末尾の {...props} で上書きする
      // (theme / position はここでなく呼び出し側が単一ソース)。
      theme="dark"
      className="toaster group"
      position="bottom-right"
      duration={4000}
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
