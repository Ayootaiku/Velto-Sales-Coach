"use client"

import { CheckCircle2, TrendingUp, Target } from "lucide-react"

interface SummaryData {
  outcome: string
  wentWell: string
  improvement: string
  nextFocus: string
  duration: string
  objectionsHandled: number
}

const summaryConfig = {
  outcome: {
    label: "Outcome",
    icon: CheckCircle2,
    iconColor: "text-[#0ea5e9]", // Blue
    bgColor: "bg-[#0ea5e9]/10",
    borderColor: "border-[#0ea5e9]/20",
    glowColor: "bg-[#0ea5e9]",
  },
  wentWell: {
    label: "Highlights",
    icon: TrendingUp,
    iconColor: "text-[#d946ef]", // Purple
    bgColor: "bg-[#d946ef]/10",
    borderColor: "border-[#d946ef]/20",
    glowColor: "bg-[#d946ef]",
  },
  nextFocus: {
    label: "Next Focus",
    icon: Target,
    iconColor: "text-[#f97316]", // Orange
    bgColor: "bg-[#f97316]/10",
    borderColor: "border-[#f97316]/20",
    glowColor: "bg-[#f97316]",
  },
}

export function CallSummary({
  data,
  onClose,
}: {
  data: SummaryData
  onClose: () => void
}) {
  const sections = [
    { key: "outcome" as const, value: data.outcome },
    { key: "wentWell" as const, value: data.wentWell },
    { key: "nextFocus" as const, value: data.nextFocus },
  ]

  return (
    <div className="flex flex-col gap-5 animate-slide-up">
      {/* Summary Header */}
      <div className="flex items-center gap-4 pb-2">
        <div className="w-10 h-10 rounded-[0.75rem] border border-[#3f3f46] bg-[#27272a] flex items-center justify-center text-[#d4ff32] shadow-sm">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"></line>
            <line x1="12" y1="20" x2="12" y2="4"></line>
            <line x1="6" y1="20" x2="6" y2="14"></line>
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-bold text-[#ffffff] tracking-tight">Session Summary</h2>
          <p className="text-[11px] text-[#888888] font-medium mt-0.5">
            {data.duration} duration · {data.objectionsHandled} objections
          </p>
        </div>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-3">
        {sections.map((section, index) => {
          const config = summaryConfig[section.key]
          const Icon = config.icon

          return (
            <div
              key={section.key}
              className="bg-[#27272a] border border-[#3f3f46] rounded-xl p-4 relative overflow-hidden group animate-slide-up hover:bg-[#3f3f46] transition-colors"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              {/* Accent line left */}
              <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${config.bgColor.replace('/10', '')}`} />

              {/* Subtle glowing orb effect from reference image */}
              <div className={`absolute -top-10 -right-10 w-32 h-32 rounded-full ${config.glowColor} opacity-10 blur-2xl pointer-events-none`} />

              <div className="pl-2 relative z-10">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`p-1.5 rounded-md ${config.bgColor}`}>
                    <Icon className={`w-3.5 h-3.5 ${config.iconColor}`} />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#888888]">
                    {config.label}
                  </span>
                </div>
                <p className="text-[13px] text-[#ffffff] leading-relaxed tracking-tight">
                  {section.value}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Start New Session Button */}
      <div className="pt-2">
        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 text-sm font-bold bg-[#d4ff32] text-[#000000] rounded-xl hover:bg-[#e0ff66] transition-all flex justify-center items-center gap-2"
        >
          <span>Start New Session</span>
        </button>
      </div>
    </div>
  )
}
