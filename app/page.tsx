import { SalesCoachOverlay } from "@/components/overlay/sales-coach-overlay"

export default function Page() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0a0a0a] text-[#ffffff]">
      {/* Overlay widget */}
      <SalesCoachOverlay />
    </main>
  )
}
