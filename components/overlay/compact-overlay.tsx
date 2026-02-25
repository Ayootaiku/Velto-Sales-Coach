"use client"

import type { CoachingStatus } from "./status-indicator"
import { PresenceOrb } from "./presence-orb"
import { Maximize2 } from "lucide-react"

const statusToOrbState = {
  ready: "idle",
  listening: "listening",
  coaching: "active",
  summary: "idle",
} as const

const statusLabel: Record<CoachingStatus, string> = {
  ready: "Ready",
  listening: "Listening...",
  coaching: "Coaching",
  summary: "Summary",
}

export function CompactOverlay({
  status,
  onExpand,
}: {
  status: CoachingStatus
  onExpand: () => void
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="bg-[#18181b] border border-[#27272a] rounded-full p-1.5 pr-4 flex items-center gap-3 cursor-pointer hover:bg-[#27272a] transition-all shadow-2xl shadow-black/50"
    >
      <PresenceOrb state={statusToOrbState[status]} size="compact" />

      <div className="flex flex-col">
        <span className="text-xs font-bold text-[#ffffff]">
          {statusLabel[status]}
        </span>
      </div>

      <div className="h-3 w-px bg-[#3f3f46] mx-1" />

      <Maximize2 className="w-3.5 h-3.5 text-[#a1a1aa] hover:text-[#d4ff32] transition-colors" />
    </button>
  )
}
