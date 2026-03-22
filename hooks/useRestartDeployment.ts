import { useState } from "react";

export function useRestartDeployment() {
  const [isRestarting, setIsRestarting] = useState(false);

  const restartDeployment = async () => {
    setIsRestarting(true);
    try {
      const res = await fetch("/api/restart", {
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
