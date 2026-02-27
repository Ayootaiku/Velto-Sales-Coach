"use client"

import { cn } from "@/lib/utils"
import { Orb } from "@/components/ui/orb"

type OrbState = "idle" | "listening" | "active" | "processing"

export function PresenceOrb({
  state = "idle",
  size = "default",
  label,
}: {
  state: OrbState
  size?: "default" | "compact"
  label?: string
}) {
  const isActive = state === "listening" || state === "active"
  let mappedAgentState: any = null;
  if (state === "listening") mappedAgentState = "listening";
  if (state === "active" || state === "processing") mappedAgentState = "thinking";

  if (size === "compact") {
    return (
      <div className="relative h-9 w-9 flex items-center justify-center rounded-full bg-[#2c2c2e] border border-[#3f3f46] shadow-sm overflow-hidden">
        <div className="absolute inset-0 scale-[2.0]">
          <Orb colors={["#d4ff32", "#16a34a"]} agentState={mappedAgentState} />
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex flex-col items-center justify-center h-32 w-full bg-transparent gap-3">
      {/* Status text - Now in flow above the orb */}
      <div className="flex flex-col items-center">
        <p
          className={cn(
            "text-[9px] font-bold uppercase tracking-widest transition-all duration-500",
            isActive ? "text-[#d4ff32]" : "text-[#71717a]"
          )}
        >
          {label ? label : (
            <>
              {state === "idle" && "Ready"}
              {state === "listening" && "Listening"}
              {state === "active" && "Analysis Active"}
              {state === "processing" && "Processing"}
            </>
          )}
        </p>
      </div>

      {/* 3D Orb Agent */}
      <div className="relative flex items-center justify-center w-[100px] h-[100px] rounded-full overflow-hidden">
        <div className="absolute inset-0 scale-[1.2]">
          <Orb
            colors={["#d4ff32", "#10b981"]}
            agentState={mappedAgentState}
          />
        </div>
      </div>
    </div>
  )
}
