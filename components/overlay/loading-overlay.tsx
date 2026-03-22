"use client"

import React, { useState, useEffect } from "react"

interface LoadingOverlayProps {
  onComplete?: () => void
  children: React.ReactNode
  duration?: number
}

const STATUS_MESSAGES = [
  "Initialising coach engine...",
  "Warming up AI systems...",
  "Calibrating voice analysis...",
  "Loading tactical modules...",
  "Almost ready..."
]

// Cubic ease-in function: starts slow, accelerates at the end
function easeInCubic(t: number): number {
  return t * t * t;
}

export function LoadingOverlay({ onComplete, children, duration = 10000 }: LoadingOverlayProps) {
  const [percentage, setPercentage] = useState(0)
  const [isClipping, setIsClipping] = useState(false)
  const [showContent, setShowContent] = useState(false)
  const [messageIndex, setMessageIndex] = useState(0)

  // Cycle messages every 2 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % STATUS_MESSAGES.length)
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const startTime = Date.now()
    
    const animatePercentage = () => {
      const elapsed = Date.now() - startTime
      const linearProgress = Math.min(elapsed / duration, 1)
      
      // Apply cubic ease-in to the progress
      const easedProgress = easeInCubic(linearProgress)
      const currentPercentage = Math.round(easedProgress * 100)
      
      setPercentage(currentPercentage)
      
      if (linearProgress < 1) {
        requestAnimationFrame(animatePercentage)
      } else {
        // Start clipping animation after percentage reaches 100%
        setTimeout(() => {
          setIsClipping(true)
          // Show content and call onComplete after clip animation
          setTimeout(() => {
            setShowContent(true)
            onComplete?.()
          }, 400)
        }, 100)
      }
    }
    
    requestAnimationFrame(animatePercentage)
  }, [onComplete, duration])

  // Calculate SVG circle properties
  const radius = 40
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (percentage / 100) * circumference

  return (
    <>
      {/* Loading Overlay */}
      <div
        className="flex flex-col items-center justify-center"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 50,
          backgroundColor: "#0d0d0d",
          clipPath: isClipping ? "inset(0 0 100% 0)" : "inset(0 0 0% 0)",
          pointerEvents: isClipping ? "none" : "auto",
          transition: "clip-path 0.4s ease-in-out",
        }}
      >
        {/* Branding Label */}
        <div className="absolute top-8 text-[10px] font-mono font-bold tracking-widest text-[#52525b] uppercase">
          Velto Sales Coach
        </div>

        {/* Circular Progress Ring */}
        <div className="relative flex items-center justify-center mb-8">
          <svg width="120" height="120" className="transform -rotate-90">
            {/* Track */}
            <circle
              cx="60"
              cy="60"
              r={radius}
              stroke="#27272a"
              strokeWidth="4"
              fill="none"
            />
            {/* Progress */}
            <circle
              cx="60"
              cy="60"
              r={radius}
              stroke="#c8e14a"
              strokeWidth="4"
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className="transition-all duration-100 ease-linear"
            />
          </svg>
          {/* Percentage Text */}
          <div className="absolute text-[#c8e14a] font-mono text-2xl font-bold">
            {percentage}%
          </div>
        </div>

        {/* Rotating Status Message */}
        <div className="h-6 relative w-full flex justify-center overflow-hidden">
          {STATUS_MESSAGES.map((msg, idx) => (
            <div
              key={idx}
              className="absolute text-xs text-[#a1a1aa] font-medium transition-all duration-500"
              style={{
                opacity: messageIndex === idx ? 1 : 0,
                transform: messageIndex === idx ? "translateY(0)" : "translateY(10px)",
              }}
            >
              {msg}
            </div>
          ))}
        </div>

        {/* Bottom Progress Bar */}
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#27272a]">
          <div
            className="h-full bg-[#c8e14a] transition-all duration-100 ease-linear"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      {/* Page Content */}
      <div
        style={{
          opacity: showContent ? 1 : 0,
          transform: showContent ? "scale(1)" : "scale(0.98)",
          transition: "opacity 0.6s ease-out, transform 0.6s ease-out",
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column"
        }}
      >
        {children}
      </div>
    </>
  )
}
