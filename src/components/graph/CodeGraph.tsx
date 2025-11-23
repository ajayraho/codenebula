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

  // Group nodes by directory hierarchy
  const groups = useMemo(() => {
    const g = new Map<string, GraphNode[]>();
    
    finalData.nodes.forEach((node) => {
      const pathParts = node.group.split('/');
      // Create groups for every level of the path
      // e.g. "src/components" -> add to "src" and "src/components"
      let currentPath = "";
      pathParts.forEach((part, i) => {
        currentPath += (i === 0 ? "" : "/") + part;
        if (!g.has(currentPath)) g.set(currentPath, []);
        g.get(currentPath)?.push(node);
      });
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
      fg.d3Force('collide', d3.forceCollide((node: any) => (node.val || 4) + 4).strength(1).iterations(3));

      // 2. Charge Force: Repulsion
      fg.d3Force('charge').strength(-150).distanceMax(500);

      // 3. Link Force
      fg.d3Force('link').distance(70);

      // 4. Center Force
      fg.d3Force('center').strength(0.05);
      
      // 5. Custom Cluster Force: Pull nodes of same group together
      fg.d3Force('cluster', (alpha: number) => {
        groups.forEach((nodes) => {
            if (nodes.length < 2) return;
            
            let cx = 0, cy = 0;
            let count = 0;
            nodes.forEach(n => {
                if (n.x !== undefined && n.y !== undefined) {
                    cx += n.x;
                    cy += n.y;
                    count++;
                }
            });
            if (count === 0) return;
            cx /= count;
            cy /= count;

            nodes.forEach(n => {
                if (n.x !== undefined && n.y !== undefined) {
                    // Pull gently towards center of this group
                    // This applies to all levels, so a node is pulled to 'src' center AND 'src/components' center
                    n.vx! += (cx - n.x) * 0.2 * alpha;
                    n.vy! += (cy - n.y) * 0.2 * alpha;
                }
            });
        });
      });

      // 6. Custom Group Repulsion: Only repel sibling groups
      fg.d3Force('groupRepulsion', (alpha: number) => {
        const groupData: any[] = [];
        
        // Calculate group bounding circles
        groups.forEach((nodes, groupName) => {
            if (nodes.length === 0) return;
            let cx = 0, cy = 0;
            let count = 0;
            nodes.forEach(n => { 
                if (n.x !== undefined && n.y !== undefined) {
                    cx += n.x; 
                    cy += n.y; 
                    count++;
                }
            });
            if (count === 0) return;
            cx /= count;
            cy /= count;
            
            let r = 0;
            nodes.forEach(n => {
                if (n.x !== undefined && n.y !== undefined) {
                    const dx = n.x - cx;
                    const dy = n.y - cy;
                    const d = Math.sqrt(dx*dx + dy*dy) + (n.val || 4);
                    if (d > r) r = d;
                }
            });
            
            // Determine parent group name
            const lastSlash = groupName.lastIndexOf('/');
            const parentGroup = lastSlash === -1 ? '' : groupName.substring(0, lastSlash);
            
            groupData.push({ name: groupName, parent: parentGroup, x: cx, y: cy, r: r + 20, nodes }); // +20 padding
        });

        // Apply repulsion only between sibling groups
        for (let i = 0; i < groupData.length; i++) {
            for (let j = i + 1; j < groupData.length; j++) {
                const g1 = groupData[i];
                const g2 = groupData[j];
                
                // Only repel if they share the same parent (siblings)
                // AND they are not the same (obviously)
                // AND one is not the parent of the other (already handled by parent check, but good to be safe)
                if (g1.parent === g2.parent) {
                    const dx = g1.x - g2.x;
                    const dy = g1.y - g2.y;
                    const dist = Math.sqrt(dx*dx + dy*dy);
                    const minDist = g1.r + g2.r;

                    if (dist < minDist && dist > 0) {
                        const overlap = minDist - dist;
                        // Reduced repulsion strength to avoid "way too far" issue
                        const f = overlap / dist * alpha * 0.5; 
                        const fx = dx * f;
                        const fy = dy * f;
                        
                        g1.nodes.forEach((n: any) => { n.vx += fx; n.vy += fy; });
                        g2.nodes.forEach((n: any) => { n.vx -= fx; n.vy -= fy; });
                    }
                }
            }
        }
      });
      
      fg.d3ReheatSimulation();
    }
  }, [graphRef.current, groups]);

  const drawGroupCircles = (ctx: CanvasRenderingContext2D) => {
    ctx.save();
    
    // Sort groups by depth (path length) so parents draw first
    const sortedGroups = Array.from(groups.entries()).sort((a, b) => a[0].length - b[0].length);

    sortedGroups.forEach(([groupName, nodes]) => {
      if (nodes.length === 0) return;

      // Calculate bounding circle
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let hasValidNode = false;
      
      nodes.forEach(n => {
        if (n.x === undefined || n.y === undefined) return;
        hasValidNode = true;
        minX = Math.min(minX, n.x);
        maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y);
        maxY = Math.max(maxY, n.y);
      });

      if (!hasValidNode) return;

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const radius = Math.max(maxX - minX, maxY - minY) / 2 + 20; // Match padding in physics

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI, false);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.03)'; // Subtle background
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.stroke();
      
      // Draw group label
      // Only draw if radius is substantial
      if (radius > 30) {
          ctx.font = '12px Sans-Serif';
          ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          // Draw label at the top of the circle
          ctx.fillText(groupName.split('/').pop() || groupName, centerX, centerY - radius - 5);
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
