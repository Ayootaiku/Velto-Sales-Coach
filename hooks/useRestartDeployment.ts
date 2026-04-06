import { useState } from "react";
import { getApiOrigin } from "@/lib/salescoach-ai";

export function useRestartDeployment() {
  const [isRestarting, setIsRestarting] = useState(false);

  const restartDeployment = async () => {
    setIsRestarting(true);
    try {
      const origin = getApiOrigin().replace(/\/$/, "");
      const url = origin ? `${origin}/api/restart` : "/api/restart";

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: process.env.NEXT_PUBLIC_RESTART_SECRET || 'velto-restart-secret-2024',
        }),
      });

      if (!res.ok) throw new Error("Restart failed");
      console.log("✅ Deployment restarted");
    } catch (err) {
      console.error("❌ Restart error:", err);
    } finally {
      setIsRestarting(false);
    }
  };

  return { restartDeployment, isRestarting };
}
