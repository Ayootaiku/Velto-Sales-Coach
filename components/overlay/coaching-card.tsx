"use client"

import { AlertTriangle, Lightbulb, HelpCircle, Copy, Check, X } from "lucide-react"
import { useState } from "react"

export interface CoachingCardData {
  id: string
  suggestion: string
  reason: string
  type: "response" | "reframe" | "question"
}

const typeConfig = {
  response: {
    label: "Objection",
    sublabel: "Price",
    icon: AlertTriangle,
    iconColor: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/20",
  },
  reframe: {
    label: "SAY THIS NEXT",
    sublabel: "",
    icon: Lightbulb,
    iconColor: "text-[#d4ff32]",
    bgColor: "bg-[#d4ff32]/10",
    borderColor: "border-[#d4ff32]/20",
  },
  question: {
    label: "SAY THIS NEXT",
    sublabel: "",
    icon: HelpCircle,
    iconColor: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/20",
  },
}

export function CoachingCard({
  card,
  onDismiss,
  onUse,
}: {
  card: CoachingCardData
  onDismiss: (id: string) => void
  onUse?: (text: string) => void
}) {
  const config = typeConfig[card.type]
  const Icon = config.icon
  const [copied, setCopied] = useState(false)

  const isRecommended = card.type === "reframe"

  const handleCopy = () => {
    navigator.clipboard.writeText(card.suggestion)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleUse = () => {
    if (onUse) {
      onUse(card.suggestion)
    }
    // Flash effect
    const el = document.getElementById(`card-${card.id}`)
    if (el) {
      el.classList.add("ring-2", "ring-[#eaf57e]")
      setTimeout(() => el.classList.remove("ring-2", "ring-[#eaf57e]"), 400)
    }
  }

  return (
    <div
      id={`card-${card.id}`}
      className={`group relative p-5 rounded-2xl transition-all duration-400 animate-enter border ${isRecommended
        ? "bg-[#27272a] border-[#3f3f46] shadow-lg hover:bg-[#3f3f46] hover:border-[#52525b] hover:-translate-y-0.5"
        : "bg-[#18181b] border-[#27272a] hover:bg-[#27272a]"
        }`}
      style={{ animationDelay: `${parseInt(card.id) * 100}ms` }}
    >
      {/* Copy button - appears on hover */}
      <button
        onClick={handleCopy}
        className="absolute top-4 right-4 text-[#888888] hover:text-[#ffffff] opacity-0 group-hover:opacity-100 transition-all duration-300 p-1.5 hover:bg-[#333333] rounded-md z-10"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-[#d4ff32]" /> : <Copy className="w-3.5 h-3.5" />}
      </button>

      {/* Header with icon and label */}
      <div className="flex items-center gap-2.5 mb-3">
        <div className={`p-1.5 rounded-md ${config.bgColor}`}>
          <Icon className={`w-3.5 h-3.5 ${config.iconColor}`} />
        </div>
        <span className={`text-[11px] uppercase tracking-widest font-bold ${isRecommended ? "text-[#d4ff32]" : "text-[#888888]"}`}>
          {config.sublabel ? `${config.label}: ${config.sublabel}` : config.label}
        </span>
      </div>

      {/* What to say - MAIN/BOLD text */}
      <h3 className={`text-lg font-bold mb-2.5 tracking-tight leading-snug ${isRecommended ? "text-[#ffffff]" : "text-[#cccccc]"}`}>
        &ldquo;{card.suggestion}&rdquo;
      </h3>

      {/* Strategy/Reason - Secondary/faded text */}
      <p className={`text-[13px] leading-relaxed font-medium ${isRecommended ? "text-[#888888]" : "text-[#666666]"}`}>
        <span className="opacity-60 uppercase tracking-widest text-[10px] mr-2 font-bold">Why</span>
        {card.reason}
      </p>

      {/* Action buttons - only for recommended card */}
      {isRecommended && (
        <div className="mt-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-1 group-hover:translate-y-0">
          <button
            onClick={handleUse}
            className="flex-1 py-2 rounded-xl bg-[#d4ff32]/10 hover:bg-[#d4ff32]/20 text-[#d4ff32] text-[11px] font-bold tracking-wide transition-colors"
          >
            USE THIS
          </button>
          <button
            onClick={() => onDismiss(card.id)}
            className="px-3 py-2 rounded-xl bg-[#18181b] hover:bg-[#27272a] text-[#a1a1aa] hover:text-white transition-colors border border-[#3f3f46]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Simple dismiss for non-recommended cards */}
      {!isRecommended && (
        <div className="mt-4 flex justify-end opacity-0 group-hover:opacity-100 transition-all duration-300">
          <button
            onClick={() => onDismiss(card.id)}
            className="px-4 py-2 rounded-xl bg-[#27272a] hover:bg-[#3f3f46] text-[#a1a1aa] text-[11px] font-bold transition-colors flex items-center gap-2 border border-[#3f3f46]"
          >
            <span>Next</span>
            <span className="text-[#71717a]">→</span>
          </button>
        </div>
      )}
    </div>
  )
}
