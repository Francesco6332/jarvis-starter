import { useEffect, useRef } from 'react';

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
export function NeuralCore({ active, thinking }: { active: boolean; thinking: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0, width = 0, height = 0, dpr = 1, time = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width; height = rect.height;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    const render = () => {
      ctx.clearRect(0, 0, width, height);
      const cx = width / 2, cy = height / 2;
      const base = Math.min(width, height) * .32;
      const t = time * (thinking ? .025 : active ? .018 : .008);
      const breathing = 1 + Math.sin(time * .028) * (thinking ? .09 : .025);
      const projected = POINTS.map(p => {
        const x = p.x * Math.cos(t) - p.z * Math.sin(t);
        const z = p.x * Math.sin(t) + p.z * Math.cos(t);
        const y = p.y * Math.cos(t * .43) - z * Math.sin(t * .43);
        const depth = p.y * Math.sin(t * .43) + z * Math.cos(t * .43);
        const scale = 2.8 / (3.5 - depth);
        return { x: cx + x * base * scale * breathing, y: cy + y * base * scale * breathing, z: depth, phase: p.phase };
      });
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 1.65);
      glow.addColorStop(0, thinking ? 'rgba(34,201,252,.20)' : 'rgba(20,145,216,.12)');
      glow.addColorStop(1, 'rgba(12,40,75,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
      CONNECTIONS.forEach(([a,b]) => {
        const p = projected[a], q = projected[b];
        const alpha = Math.max(.07, Math.min(.55, .18 + (p.z+q.z)*.13));
        ctx.strokeStyle = `rgba(44,193,254,${alpha})`;
        ctx.lineWidth = thinking ? 1.05 : .72;
        ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(q.x,q.y); ctx.stroke();
      });
      projected.forEach(p => {
        const pulse = .5 + .5*Math.sin(time*.045 + p.phase);
        ctx.beginPath(); ctx.arc(p.x,p.y, Math.max(.7, 1.25+p.z*.25+(active?pulse*.85:0)), 0, Math.PI*2);
        ctx.fillStyle = `rgba(105,229,255,${.48+pulse*.5})`; ctx.fill();
      });
      ctx.beginPath(); ctx.arc(cx,cy,base*1.11,0,Math.PI*2);
      ctx.strokeStyle = 'rgba(65,198,255,.13)'; ctx.lineWidth = 1; ctx.stroke();
      if (!reduceMotion) { time++; raf = requestAnimationFrame(render); }
    };
    render();
    const visibility = () => { if (document.hidden) cancelAnimationFrame(raf); else if (!reduceMotion) raf=requestAnimationFrame(render); };
    document.addEventListener('visibilitychange', visibility);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); document.removeEventListener('visibilitychange', visibility); };
  }, [active, thinking]);
  return <canvas aria-label="Rappresentazione animata astratta di una rete neurale" role="img" ref={canvasRef} className="neural-canvas" />;
}
