"use client"

import { useEffect } from "react"
import { SalesCoachOverlay } from "@/components/overlay/sales-coach-overlay"
import { setApiBaseUrl } from "@/lib/salescoach-ai"
import { setWssBaseUrl } from "@/hooks/use-stt-stream-ws"

export default function Page() {
  // Parity with Manifest: Local website now defaults to production backend endpoints
  // unless manually overridden, ensuring 'Trace' and STT performance matches the extension.
  useEffect(() => {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    const prodUrl = "https://velto-sales-coach-production.up.railway.app"
    const prodWss = "wss://velto-sales-coach-production.up.railway.app"
    
    if (!isLocal) {
      setApiBaseUrl(prodUrl)
      setWssBaseUrl(prodWss)
      console.log(`[SYSTEM] Production Parity Enabled (API: ${prodUrl}, WSS: ${prodWss})`)
    } else {
      console.log(`[SYSTEM] Local Development Mode Detected. Using local API routes and env variables.`)
    }
  }, [])

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0a0a0a] text-[#ffffff]">
      {/* Overlay widget */}
      <SalesCoachOverlay />
    </main>
  )
}
