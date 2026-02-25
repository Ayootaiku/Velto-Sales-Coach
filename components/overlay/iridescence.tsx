"use client"

import { useEffect, useRef } from "react"

// Vertex shader - simple fullscreen triangle
const vertexShader = `
  attribute vec2 uv;
  attribute vec2 position;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0, 1);
  }
`

// Fragment shader - soft noise-based orb with gentle organic flow
// Incorporates simplex noise concepts from particle shader for smooth morphing
const fragmentShader = `
  precision highp float;
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uResolution;
  uniform float uAmplitude;
  uniform float uSpeed;
  varying vec2 vUv;

  // Simplex noise helpers (from ashima/webgl-noise)
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  void main() {
    float mr = min(uResolution.x, uResolution.y);
    vec2 uv = (vUv * 2.0 - 1.0) * uResolution.xy / mr;

    // Slow flowing time
    float t = uTime * uSpeed * 0.15;

    // Soft circular distance
    float dist = length(uv);

    // Edge softness for sphere shape
    float sphere = 1.0 - smoothstep(0.6, 1.0, dist);

    // Layered noise for organic flow (very slow, smooth)
    float n1 = snoise(vec3(uv * 1.2, t * 0.4)) * 0.5 + 0.5;
    float n2 = snoise(vec3(uv * 2.4 + 3.0, t * 0.3 + 10.0)) * 0.5 + 0.5;
    float n3 = snoise(vec3(uv * 0.8 - 5.0, t * 0.2 + 20.0)) * 0.5 + 0.5;

    // Blend noise layers
    float noise = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;

    // Gentle distortion from amplitude (very subtle)
    float distort = uAmplitude * 0.04;
    noise += snoise(vec3(uv * 1.5 + noise * distort, t * 0.5)) * distort * 2.0;

    // Color palette - deep blues with subtle variation
    vec3 col1 = uColor * 0.6;                         // Deep base
    vec3 col2 = uColor * 1.1;                         // Bright mid
    vec3 col3 = vec3(uColor.r * 0.8, uColor.g * 1.2, uColor.b * 1.3); // Lighter accent

    // Mix colors based on noise
    vec3 color = mix(col1, col2, noise);
    color = mix(color, col3, n3 * 0.3);

    // Soft inner glow toward center
    float glow = 1.0 - smoothstep(0.0, 0.7, dist);
    color += uColor * glow * 0.15;

    // Subtle specular highlight (top-left)
    vec2 highlightPos = uv - vec2(-0.25, -0.3);
    float highlight = 1.0 - smoothstep(0.0, 0.5, length(highlightPos));
    color += vec3(0.15, 0.18, 0.25) * highlight * highlight * 0.5;

    // Apply sphere mask with soft edge
    float alpha = sphere;

    // Very subtle edge brightening
    float rim = smoothstep(0.5, 0.85, dist) * sphere;
    color += uColor * rim * 0.1;

    gl_FragColor = vec4(color, alpha);
  }
`

interface IridescenceProps {
  color?: [number, number, number]
  speed?: number
  amplitude?: number
  className?: string
}

export function Iridescence({
  color = [0.3, 0.6, 1],
  speed = 0.2,
  amplitude = 0.1,
  className,
}: IridescenceProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const speedRef = useRef(speed)
  const amplitudeRef = useRef(amplitude)
  const colorRef = useRef(color)
  const cleanupRef = useRef<(() => void) | null>(null)

  speedRef.current = speed
  amplitudeRef.current = amplitude
  colorRef.current = color

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let animId: number
    let destroyed = false

    async function init() {
      const OGL = await import("ogl")
      if (destroyed) return

      const renderer = new OGL.Renderer({ alpha: true, depth: false, premultipliedAlpha: false })
      const gl = renderer.gl

      let program: InstanceType<typeof OGL.Program> | null = null

      const resize = () => {
        if (destroyed) return
        const w = container.offsetWidth || 200
        const h = container.offsetHeight || 200
        renderer.setSize(w, h)
        if (program) {
          program.uniforms.uResolution.value.set(
            gl.canvas.width,
            gl.canvas.height,
            gl.canvas.width / gl.canvas.height
          )
        }
      }

      const geometry = new OGL.Triangle(gl)
      program = new OGL.Program(gl, {
        vertex: vertexShader,
        fragment: fragmentShader,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new OGL.Color(...color) },
          uResolution: {
            value: new OGL.Color(
              gl.canvas.width,
              gl.canvas.height,
              gl.canvas.width / gl.canvas.height
            ),
          },
          uAmplitude: { value: amplitude },
          uSpeed: { value: speed },
        },
        transparent: true,
      })

      const mesh = new OGL.Mesh(gl, { geometry, program })

      gl.canvas.style.width = "100%"
      gl.canvas.style.height = "100%"
      container.appendChild(gl.canvas)

      resize()
      window.addEventListener("resize", resize)

      const animate = (t: number) => {
        if (destroyed) return
        if (program) {
          program.uniforms.uTime.value = t * 0.001
          program.uniforms.uAmplitude.value = amplitudeRef.current
          program.uniforms.uSpeed.value = speedRef.current

          const c = colorRef.current
          program.uniforms.uColor.value.set(c[0], c[1], c[2])
        }
        renderer.render({ scene: mesh })
        animId = requestAnimationFrame(animate)
      }
      animId = requestAnimationFrame(animate)

      cleanupRef.current = () => {
        destroyed = true
        cancelAnimationFrame(animId)
        window.removeEventListener("resize", resize)
        gl.getExtension("WEBGL_lose_context")?.loseContext()
        if (gl.canvas.parentNode) {
          gl.canvas.parentNode.removeChild(gl.canvas)
        }
      }
    }

    init()

    return () => {
      destroyed = true
      cancelAnimationFrame(animId!)
      cleanupRef.current?.()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={containerRef} className={className} />
}
