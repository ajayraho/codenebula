"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useRef, useMemo } from "react";
import * as d3 from "d3";

// Dynamic import to avoid SSR issues with canvas
const ForceGraph2DNoSSR = dynamic(
  () => import("react-force-graph-2d"),
  { ssr: false }
);

interface GraphNode {
  id: string;
  name: string;
  group: string;
  val: number; // Size
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  width: number; // Thickness
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export default function CodeGraph({ data }: { data?: GraphData }) {
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);

  const finalData = useMemo(() => data || { nodes: [], links: [] }, [data]);

  // Group nodes by directory (group) for the background circles
  const groups = useMemo(() => {
    const g = new Map<string, GraphNode[]>();
    finalData.nodes.forEach((node) => {
      if (!g.has(node.group)) g.set(node.group, []);
      g.get(node.group)?.push(node);
    });
    return g;
  }, [finalData]);

  useEffect(() => {
    // Resize handler
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    };

    window.addEventListener("resize", updateDimensions);
    updateDimensions();

    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  useEffect(() => {
    if (graphRef.current) {
      const fg = graphRef.current;
      
      // 1. Collision Force: Prevent overlap strictly
      // Radius = node size + padding
      // Increased iterations for stability
      fg.d3Force('collide', d3.forceCollide((node: any) => (node.val || 4) + 4).strength(1).iterations(3));

      // 2. Charge Force: Repulsion
      // Strong repulsion to keep everything spread out
      fg.d3Force('charge').strength(-200).distanceMax(400);

      // 3. Link Force: Keep connected nodes reasonably close
      fg.d3Force('link').distance(60);

      // 4. Center Force: Keep graph centered
      fg.d3Force('center').strength(0.05);
      
      // 5. Custom Cluster Force: Pull nodes of same group together
      fg.d3Force('cluster', (alpha: number) => {
        groups.forEach((nodes) => {
            if (nodes.length < 2) return;
            
            // Calculate centroid of the group
            let cx = 0, cy = 0;
            nodes.forEach(n => {
                if (n.x && n.y) {
                    cx += n.x;
                    cy += n.y;
                }
            });
            cx /= nodes.length;
            cy /= nodes.length;

            // Pull nodes towards centroid
            nodes.forEach(n => {
                if (n.x && n.y) {
                    n.vx! += (cx - n.x) * 0.5 * alpha;
                    n.vy! += (cy - n.y) * 0.5 * alpha;
                }
            });
        });
      });

      // 6. Custom Group Repulsion: Prevent directory circles from overlapping
      fg.d3Force('groupRepulsion', (alpha: number) => {
        const groupData: any[] = [];
        
        // Calculate group bounding circles
        groups.forEach((nodes, group) => {
            if (nodes.length === 0) return;
            let cx = 0, cy = 0;
            nodes.forEach(n => { cx += n.x || 0; cy += n.y || 0; });
            cx /= nodes.length;
            cy /= nodes.length;
            
            let r = 0;
            nodes.forEach(n => {
                const dx = (n.x || 0) - cx;
                const dy = (n.y || 0) - cy;
                const d = Math.sqrt(dx*dx + dy*dy) + (n.val || 4);
                if (d > r) r = d;
            });
            groupData.push({ x: cx, y: cy, r: r + 10, nodes }); // +10 padding
        });

        // Apply repulsion between groups
        for (let i = 0; i < groupData.length; i++) {
            for (let j = i + 1; j < groupData.length; j++) {
                const g1 = groupData[i];
                const g2 = groupData[j];
                const dx = g1.x - g2.x;
                const dy = g1.y - g2.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                const minDist = g1.r + g2.r;

                if (dist < minDist && dist > 0) {
                    const overlap = minDist - dist;
                    const f = overlap / dist * alpha * 0.8; // Strong repulsion
                    const fx = dx * f;
                    const fy = dy * f;
                    
                    g1.nodes.forEach((n: any) => { n.vx += fx; n.vy += fy; });
                    g2.nodes.forEach((n: any) => { n.vx -= fx; n.vy -= fy; });
                }
            }
        }
      });
      
      // Reheat simulation
      fg.d3ReheatSimulation();
    }
  }, [graphRef.current, groups]);

  const drawGroupCircles = (ctx: CanvasRenderingContext2D) => {
    ctx.save();
    groups.forEach((nodes, groupName) => {
      if (nodes.length === 0) return;

      // Calculate bounding box/circle
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      nodes.forEach(n => {
        if (n.x === undefined || n.y === undefined) return;
        minX = Math.min(minX, n.x);
        maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y);
        maxY = Math.max(maxY, n.y);
      });

      if (minX === Infinity) return;

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const radius = Math.max(maxX - minX, maxY - minY) / 2 + 40; // Add padding

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI, false);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.02)'; // Very subtle background
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.stroke();
      
      // Draw group label
      ctx.font = '12px Sans-Serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Only draw label if radius is big enough
      if (radius > 50) {
          ctx.fillText(groupName.split('/').pop() || groupName, centerX, centerY - radius - 10);
      }
    });
    ctx.restore();
  };

  return (
    <div ref={containerRef} className="w-full h-full bg-slate-950">
      <ForceGraph2DNoSSR
        ref={graphRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={finalData}
        nodeLabel="name"
        nodeAutoColorBy="group"
        
        // Edges
        linkColor={() => "rgba(100, 149, 237, 0.2)"} // Visible edges
        linkWidth={1.5}
        linkDirectionalParticles={2}
        linkDirectionalParticleWidth={2}
        linkDirectionalParticleSpeed={0.005}

        // Physics
        d3AlphaDecay={0} // Keep simulation alive (constantly moving)
        d3VelocityDecay={0.3} // Add some drag so it doesn't explode
        cooldownTicks={100}
        
        // Rendering
        onRenderFramePre={drawGroupCircles}
        nodeCanvasObject={(node: any, ctx, globalScale) => {
            const label = node.name;
            const fontSize = 12 / globalScale;
            const r = node.val || 4;

            // Draw Circle
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
            ctx.fillStyle = node.color || 'rgba(255, 255, 255, 0.8)';
            ctx.fill();
            
            // Draw Label (Outside)
            if (globalScale > 0.8) { // Only show if zoomed in a bit
                ctx.font = `${fontSize}px Sans-Serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                // Draw label below the node
                ctx.fillText(label, node.x, node.y + r + 2);
            }
        }}
        nodePointerAreaPaint={(node: any, color, ctx) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x, node.y, (node.val || 4) + 2, 0, 2 * Math.PI, false);
            ctx.fill();
        }}
      />
    </div>
  );
}
