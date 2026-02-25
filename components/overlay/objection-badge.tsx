"use client"

import { AlertTriangle } from "lucide-react"

export function ObjectionBadge({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/20 animate-enter">
      <AlertTriangle className="w-4 h-4 text-orange-400" />
      <span className="text-[11px] font-bold uppercase tracking-wider text-orange-300">
        OBJECTION: {text.toUpperCase()}
      </span>
    </div>
  )
}
