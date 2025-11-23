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
  const [spacing, setSpacing] = useState(20); // User adjustable spacing
  const [highlightNodes, setHighlightNodes] = useState(new Set<string>());
  const [highlightLinks, setHighlightLinks] = useState(new Set<string>());
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [hoverGroup, setHoverGroup] = useState<string | null>(null);
  const [focusedGroup, setFocusedGroup] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const lastClickTimeRef = useRef(0);
  const hasZoomedRef = useRef(false);

  const finalData = useMemo(() => data || { nodes: [], links: [] }, [data]);

  // Reset zoom flag when data changes (new file loaded)
  useEffect(() => {
      hasZoomedRef.current = false;
  }, [data]);

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

  // 1. Setup Static Forces & Cluster Force
  useEffect(() => {
    if (graphRef.current) {
      const fg = graphRef.current;
      
      // Collision Force: Prevent overlap strictly
      // Increased buffer significantly to +12 and iterations to 6
      fg.d3Force('collide', d3.forceCollide((node: any) => (node.val || 4) + 12).strength(1).iterations(6));

      // Charge Force: Repulsion
      fg.d3Force('charge').strength(-150).distanceMax(500);

      // Link Force
      fg.d3Force('link').distance(70);

      // Center Force: Keep graph centered
      fg.d3Force('center').strength(0.8);
      
      // Custom Cluster Force: Pull nodes of same group together
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

            const strength = 0.2;

            nodes.forEach(n => {
                if (n.x !== undefined && n.y !== undefined) {
                    n.vx! += (cx - n.x) * strength * alpha;
                    n.vy! += (cy - n.y) * strength * alpha;
                }
            });
        });
      });
    }
  }, [graphRef.current, groups]);

  // 2. Setup Dynamic Group Repulsion (Depends on spacing)
  useEffect(() => {
    if (graphRef.current) {
      const fg = graphRef.current;

      // Custom Group Repulsion: Only repel sibling groups
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
            const level = groupName.split('/').length;
            
            // Use state-based spacing
            const padding = spacing + (5 - Math.min(level, 5)) * 5; 
            
            groupData.push({ name: groupName, parent: parentGroup, x: cx, y: cy, r: r + padding, nodes });
        });

        // Apply repulsion only between sibling groups
        for (let i = 0; i < groupData.length; i++) {
            for (let j = i + 1; j < groupData.length; j++) {
                const g1 = groupData[i];
                const g2 = groupData[j];
                
                // Only repel if they share the same parent (siblings)
                if (g1.parent === g2.parent) {
                    const dx = g1.x - g2.x;
                    const dy = g1.y - g2.y;
                    const dist = Math.sqrt(dx*dx + dy*dy);
                    // Reduced buffer for text
                    const minDist = g1.r + g2.r + 5; 

                    if (dist < minDist && dist > 0) {
                        const overlap = minDist - dist;
                        // Moderate repulsion
                        const f = overlap / dist * alpha * 0.8; 
                        const fx = dx * f;
                        const fy = dy * f;
                        
                        g1.nodes.forEach((n: any) => { n.vx += fx; n.vy += fy; });
                        g2.nodes.forEach((n: any) => { n.vx -= fx; n.vy -= fy; });
                    }
                }
            }
        }
      });
      
      // Only reheat if alpha is low, otherwise just let it run
      fg.d3ReheatSimulation();
    }
  }, [graphRef.current, groups, spacing]);

  // Auto-zoom to fit when data changes
  useEffect(() => {
    if (graphRef.current && finalData.nodes.length > 0 && !hasZoomedRef.current) {
        hasZoomedRef.current = true;
        // Wait a bit for simulation to start spreading nodes
        setTimeout(() => {
            if (graphRef.current) graphRef.current.zoomToFit(400, 50);
        }, 1000);
        // And again after it settles more
        setTimeout(() => {
            if (graphRef.current) graphRef.current.zoomToFit(400, 50);
        }, 3000);
    }
  }, [finalData, graphRef.current]);

  // Handle node click for highlighting
  const handleNodeClick = (node: any) => {
    setHighlightNodes((prev) => {
      const newHighlights = new Set<string>();
      const newLinks = new Set<string>();
      
      // If clicking the same node, clear selection (toggle off)
      if (prev.has(node.id) && prev.size === 1) {
        setHighlightLinks(new Set());
        return new Set();
      }

      // Add clicked node
      newHighlights.add(node.id);

      // Add neighbors
      finalData.links.forEach((link: any) => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;

        if (sourceId === node.id) {
          newHighlights.add(targetId);
          newLinks.add(link.id || `${sourceId}-${targetId}`); // Assuming link has ID or we use composite
        } else if (targetId === node.id) {
          newHighlights.add(sourceId);
          newLinks.add(link.id || `${sourceId}-${targetId}`);
        }
      });

      setHighlightLinks(newLinks);
      return newHighlights;
    });
  };

  // Handle background click to clear selection or detect double click on groups
  const handleBackgroundClick = (event: MouseEvent) => {
    const now = Date.now();
    const isDoubleClick = (now - lastClickTimeRef.current) < 300;
    lastClickTimeRef.current = now;

    if (isDoubleClick) {
        // Handle Double Click Logic
        if (!graphRef.current) return;
        
        // Convert to graph coordinates
        // event is a native MouseEvent, so we need to calculate relative to canvas/container
        // But react-force-graph might pass the event with different properties?
        // Usually it passes the event object.
        // Let's try to use the coordinates from the event if possible, or fallback to clientX/Y
        
        // We need to find the container bounds
        // Since we don't have easy access to the canvas element directly here (it's inside the lib),
        // we rely on containerRef.
        if (!containerRef.current) return;
        
        const rect = containerRef.current.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        const coords = graphRef.current.screen2GraphCoords(x, y);
        if (!coords) return;

        // Find deepest group containing the point
        let deepestGroup: string | null = null;
        let maxDepth = -1;

        groups.forEach((nodes, groupName) => {
            if (nodes.length === 0) return;

            // Calculate bounding circle
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
            const level = groupName.split('/').length;
            const padding = spacing + (5 - Math.min(level, 5)) * 5;
            const radius = Math.max(maxX - minX, maxY - minY) / 2 + padding;

            // Check if point is inside circle
            const dx = coords.x - centerX;
            const dy = coords.y - centerY;
            if (dx*dx + dy*dy <= radius*radius) {
                if (level > maxDepth) {
                    maxDepth = level;
                    deepestGroup = groupName;
                }
            }
        });

        if (deepestGroup) {
            if (focusedGroup === deepestGroup) {
                setFocusedGroup(null);
            } else {
                setFocusedGroup(deepestGroup);
            }
            // Clear node highlights
            setHighlightNodes(new Set());
            setHighlightLinks(new Set());
        }
    } else {
        // Single Click
        setHighlightNodes(new Set());
        setHighlightLinks(new Set());
        setFocusedGroup(null);
    }
  };

  // Handle mouse move to detect group hover
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!graphRef.current || !containerRef.current) return;
    
    // Get mouse position relative to container
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Convert to graph coordinates
    const coords = graphRef.current.screen2GraphCoords(x, y);
    if (!coords) return;

    // Find deepest group containing the point
    let deepestGroup: string | null = null;
    let maxDepth = -1;

    groups.forEach((nodes, groupName) => {
        if (nodes.length === 0) return;

        // Calculate bounding circle (same logic as drawGroupCircles)
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
        const level = groupName.split('/').length;
        const padding = spacing + (5 - Math.min(level, 5)) * 5;
        const radius = Math.max(maxX - minX, maxY - minY) / 2 + padding;

        // Check if point is inside circle
        const dx = coords.x - centerX;
        const dy = coords.y - centerY;
        if (dx*dx + dy*dy <= radius*radius) {
            if (level > maxDepth) {
                maxDepth = level;
                deepestGroup = groupName;
            }
        }
    });

    setHoverGroup(deepestGroup);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    // Deprecated in favor of handleBackgroundClick logic
  };

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
      
      // Dynamic padding based on hierarchy level
      // Parents get MORE padding to ensure they enclose children
      const level = groupName.split('/').length;
      // Match the physics padding exactly to ensure visual consistency
      const padding = spacing + (5 - Math.min(level, 5)) * 5;
      
      const radius = Math.max(maxX - minX, maxY - minY) / 2 + padding;

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI, false);
      
      // Highlight logic for groups
      const isHovered = groupName === hoverGroup;
      const isFocused = groupName === focusedGroup;
      
      // Dim if a group is focused AND this group is NOT the focused group AND NOT a parent/child of it
      // Actually, usually we want to dim everything except the focused subtree.
      // So if focusedGroup is "src/components", "src" (parent) is visible? 
      // Let's keep parents visible but maybe less prominent.
      // And children visible.
      const isRelatedToFocus = focusedGroup ? (groupName.startsWith(focusedGroup) || focusedGroup.startsWith(groupName)) : true;
      
      if (focusedGroup && !isRelatedToFocus) {
          // Dimmed
          ctx.fillStyle = 'rgba(255, 255, 255, 0.005)'; 
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
          ctx.lineWidth = 1;
      } else if (isFocused) {
          // Focused style
          ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'; 
          ctx.strokeStyle = 'rgba(100, 149, 237, 0.5)'; // Blueish border
          ctx.lineWidth = 3;
      } else if (isHovered) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'; // Lighter background
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'; // Lighter border
          ctx.lineWidth = 2;
      } else {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.03)'; // Subtle background
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
          ctx.lineWidth = 1;
      }
      
      ctx.fill();
      ctx.stroke();
      
      // Draw group label
      // Only draw if radius is substantial
      if (radius > 30) {
          ctx.font = (isHovered || isFocused) ? 'bold 13px Sans-Serif' : '12px Sans-Serif';
          
          if (focusedGroup && !isRelatedToFocus) {
              ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
          } else {
              ctx.fillStyle = (isHovered || isFocused) ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 255, 255, 0.3)';
          }
          
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          // Draw label at the top of the circle
          ctx.fillText(groupName.split('/').pop() || groupName, centerX, centerY - radius - 5);
      }
    });
    ctx.restore();
  };

  return (
    <div ref={containerRef} className="w-full h-full bg-slate-950 relative">
      {/* Controls Overlay */}
      <div className="absolute bottom-15 right-4 z-10 flex flex-col gap-4 bg-slate-900/80 p-4 rounded-lg border border-slate-700 backdrop-blur-sm">
        <div className="flex flex-col gap-2">
            <label className="text-xs text-slate-400 font-medium">Folder Spacing</label>
            <input 
                type="range" 
                min="0" 
                max="100" 
                value={spacing} 
                onChange={(e) => setSpacing(parseInt(e.target.value))}
                className="w-32 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
        </div>
        <button 
            onClick={() => {
                if (graphRef.current) {
                    graphRef.current.zoomToFit(400, 50);
                }
            }}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded transition-colors"
        >
            Zoom to Fit
        </button>
      </div>

      <div onMouseMove={handleMouseMove} className="w-full h-full">
      <ForceGraph2DNoSSR
        ref={graphRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={finalData}
        nodeLabel="name"
        nodeAutoColorBy="group"
        
        // Interaction
        onNodeClick={handleNodeClick}
        onBackgroundClick={handleBackgroundClick}
        
        // Edges
        linkColor={(link: any) => {
            const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
            const targetId = typeof link.target === 'object' ? link.target.id : link.target;
            
            // Check focus state
            if (focusedGroup) {
                // If focused, only show links where BOTH ends are in the focused group (or sub-groups)
                // We need to find the node objects to check their groups
                const sourceNode = finalData.nodes.find(n => n.id === sourceId);
                const targetNode = finalData.nodes.find(n => n.id === targetId);
                
                if (sourceNode && targetNode) {
                    const sourceInGroup = sourceNode.group.startsWith(focusedGroup);
                    const targetInGroup = targetNode.group.startsWith(focusedGroup);
                    
                    if (!sourceInGroup || !targetInGroup) {
                        return "rgba(100, 149, 237, 0.02)"; // Very dim
                    }
                }
            }

            if (highlightNodes.size > 0) {
                // If highlighting, only show links connected to highlighted nodes
                const linkId = link.id || `${sourceId}-${targetId}`;
                
                if (highlightLinks.has(linkId)) {
                    return "rgba(100, 149, 237, 0.6)"; // Brighter
                }
                return "rgba(100, 149, 237, 0.05)"; // Dimmed
            }
            return "rgba(100, 149, 237, 0.2)"; // Default
        }} 
        linkWidth={(link: any) => {
            if (highlightNodes.size > 0) {
                const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
                const targetId = typeof link.target === 'object' ? link.target.id : link.target;
                const linkId = link.id || `${sourceId}-${targetId}`;
                return highlightLinks.has(linkId) ? 2.5 : 0.5;
            }
            return 1.5;
        }}
        linkDirectionalParticles={highlightNodes.size > 0 ? 0 : 2} // Disable particles when highlighting to reduce noise
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
            
            // Check highlight state
            const isHighlighted = highlightNodes.has(node.id);
            // Check focus state
            const isFocused = focusedGroup ? node.group.startsWith(focusedGroup) : true;
            
            const isDimmed = (highlightNodes.size > 0 && !isHighlighted) || !isFocused;

            // Draw Circle
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
            
            if (isDimmed) {
                ctx.fillStyle = 'rgba(100, 100, 100, 0.1)'; // Dimmed color
            } else {
                ctx.fillStyle = node.color || 'rgba(255, 255, 255, 0.8)';
            }
            ctx.fill();
            
            // Draw Label (Outside)
            // Show label if zoomed in OR if highlighted
            // Hide if dimmed due to focus
            if ((globalScale > 0.8 || isHighlighted) && !isDimmed) { 
                ctx.font = `${fontSize}px Sans-Serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                
                ctx.fillStyle = isHighlighted ? 'rgba(255, 255, 255, 1)' : 'rgba(255, 255, 255, 0.7)';
                if (isHighlighted) ctx.font = `bold ${fontSize}px Sans-Serif`;
                
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
    </div>
  );
}
