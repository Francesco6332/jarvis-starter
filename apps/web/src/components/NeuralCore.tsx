import { useEffect, useRef } from 'react';

export type CoreMode = 'idle' | 'listening' | 'thinking' | 'speaking';
type Node3D = { x: number; y: number; z: number; phase: number };
const POINTS: Node3D[] = Array.from({ length: 110 }, (_, i) => {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (i / 109) * 2;
  const radius = Math.sqrt(1 - y * y);
  const theta = goldenAngle * i;
  return { x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius, phase: i * 1.73 };
});
const CONNECTIONS: [number, number][] = [];
for (let i = 0; i < POINTS.length; i++) for (let j = i + 1; j < POINTS.length; j++) {
  const a = POINTS[i], b = POINTS[j];
  if ((a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2 < .19) CONNECTIONS.push([i,j]);
}
const COLORS: Record<CoreMode, number[]> = { idle: [44,170,240], listening: [60,220,255], thinking: [255,186,84], speaking: [140,240,255] };
const SPEED: Record<CoreMode, number> = { idle: .006, listening: .012, thinking: .028, speaking: .016 };

/** Abstract animated network. `level` (0..1) lets live audio drive the pulse without re-rendering React. */
export function NeuralCore({ mode, level }: { mode: CoreMode; level?: () => number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode), levelRef = useRef(level);
  modeRef.current = mode; levelRef.current = level;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0, width = 0, height = 0, time = 0, angle = 0, energy = 0;
    let color = [...COLORS[modeRef.current]], speed = SPEED[modeRef.current];
    const resize = () => {
      const rect = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width; height = rect.height;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    const render = () => {
      const current = modeRef.current, target = COLORS[current];
      color = color.map((c, i) => c + (target[i] - c) * .06);
      speed += ((reduceMotion ? 0 : SPEED[current]) - speed) * .05;
      const raw = reduceMotion ? 0 : Math.min(1, levelRef.current?.() ?? 0);
      energy += (raw - energy) * (raw > energy ? .35 : .08);
      angle += speed; if (!reduceMotion) time++;
      const rgb = color.map(Math.round).join(','), node = color.map(c => Math.round(c + (255 - c) * .45)).join(',');
      ctx.clearRect(0, 0, width, height);
      const cx = width / 2, cy = height / 2, base = Math.min(width, height) * .32;
      const breathing = 1 + Math.sin(time * .028) * (current === 'thinking' ? .07 : .025) + energy * .2;
      const projected = POINTS.map(p => {
        const x = p.x * Math.cos(angle) - p.z * Math.sin(angle);
        const z = p.x * Math.sin(angle) + p.z * Math.cos(angle);
        const y = p.y * Math.cos(angle * .43) - z * Math.sin(angle * .43);
        const depth = p.y * Math.sin(angle * .43) + z * Math.cos(angle * .43);
        const scale = 2.8 / (3.5 - depth);
        // Audio makes single nodes ripple outwards instead of the whole sphere just scaling.
        const ripple = 1 + energy * .14 * Math.sin(time * .2 + p.phase);
        return { x: cx + x * base * scale * breathing * ripple, y: cy + y * base * scale * breathing * ripple, z: depth, phase: p.phase };
      });
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * (1.65 + energy * .5));
      glow.addColorStop(0, `rgba(${rgb},${.13 + energy * .22 + (current === 'thinking' ? .06 : 0)})`);
      glow.addColorStop(1, 'rgba(12,40,75,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
      ctx.lineWidth = current === 'thinking' ? 1.05 : .72 + energy * .6;
      for (const [a, b] of CONNECTIONS) {
        const p = projected[a], q = projected[b];
        ctx.strokeStyle = `rgba(${rgb},${Math.max(.07, Math.min(.6, .18 + (p.z + q.z) * .13 + energy * .2))})`;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
      const lively = current !== 'idle';
      for (const p of projected) {
        const pulse = .5 + .5 * Math.sin(time * .045 + p.phase);
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(.7, 1.25 + p.z * .25 + (lively ? pulse * .85 : 0) + energy * 1.6), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${node},${.48 + pulse * .5})`; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(cx, cy, base * (1.11 + energy * .12), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${rgb},${.13 + energy * .3})`; ctx.lineWidth = 1; ctx.stroke();
      raf = requestAnimationFrame(render);
    };
    render();
    const visibility = () => { cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(render); };
    document.addEventListener('visibilitychange', visibility);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  return <canvas aria-label="Rappresentazione animata astratta di una rete neurale" role="img" ref={canvasRef} className="neural-canvas" />;
}
