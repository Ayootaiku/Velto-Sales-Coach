"use client";

import React, { useEffect, useRef } from 'react';

export function AnimatedWaveVisualizer() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let time = 0;
        let animationFrameId: number;

        const waveData = Array.from({ length: 8 }).map(() => ({
            value: Math.random() * 0.5 + 0.1,
            targetValue: Math.random() * 0.5 + 0.1,
            speed: Math.random() * 0.02 + 0.01
        }));

        function resizeCanvas() {
            if (!canvas) return;
            const parent = canvas.parentElement;
            if (parent) {
                // Adjust for retina displays to fix blurriness
                const dpr = window.devicePixelRatio || 1;
                canvas.width = parent.clientWidth * dpr;
                canvas.height = parent.clientHeight * dpr;
                ctx!.scale(dpr, dpr);
                canvas.style.width = `${parent.clientWidth}px`;
                canvas.style.height = `${parent.clientHeight}px`;
            }
        }

        function updateWaveData() {
            waveData.forEach(data => {
                if (Math.random() < 0.01) data.targetValue = Math.random() * 0.7 + 0.1;
                const diff = data.targetValue - data.value;
                data.value += diff * data.speed;
            });
        }

        function draw() {
            if (!ctx || !canvas) return;
            const parent = canvas.parentElement;
            if (!parent) return;

            ctx.clearRect(0, 0, parent.clientWidth, parent.clientHeight);

            waveData.forEach((data, i) => {
                const freq = data.value * 7;
                ctx.beginPath();
                for (let x = 0; x < parent.clientWidth; x++) {
                    const nx = (x / parent.clientWidth) * 2 - 1;
                    const px = nx + i * 0.04 + freq * 0.03;
                    // Scale wave height to make troughs come up and down more
                    const py = Math.sin(px * 10 + time) * Math.cos(px * 2) * freq * 0.16 * ((i + 1) / 8);
                    const y = (py * 0.5 + 0.5) * parent.clientHeight;
                    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
                }

                const intensity = Math.min(1, freq * 0.3);

                // Custom Lime Theme (#d4ff32)
                const r = 212 + intensity * 20;
                const g = 255;
                const b = 50 + intensity * 20;

                ctx.lineWidth = 1 + i * 0.3;
                ctx.strokeStyle = `rgba(${r},${g},${b},0.4)`;
                ctx.shadowColor = `rgba(${r},${g},${b},0.6)`;
                ctx.shadowBlur = 8;
                ctx.stroke();
                ctx.shadowBlur = 0;
            });
        }

        function animate() {
            time += 0.015; // Slowed down slightly for a more elegant feel
            updateWaveData();
            draw();
            animationFrameId = requestAnimationFrame(animate);
        }

        const resizeObserver = new ResizeObserver(() => resizeCanvas());
        if (canvas.parentElement) {
            resizeObserver.observe(canvas.parentElement);
        }
        resizeCanvas();
        animate();

        return () => {
            cancelAnimationFrame(animationFrameId);
            resizeObserver.disconnect();
        };
    }, []);

    return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />;
}
