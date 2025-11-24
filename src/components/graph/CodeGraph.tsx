"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import * as d3 from "d3";
import { ChevronRight, ChevronLeft } from "lucide-react";

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
  const [highlightNodes, setHighlightNodes] = useState(new Set<string>());
  const [highlightLinks, setHighlightLinks] = useState(new Set<string>());
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [hoverGroup, setHoverGroup] = useState<string | null>(null);
  const [focusedGroup, setFocusedGroup] = useState<string | null>(null);
  const [chargeMultiplier, setChargeMultiplier] = useState(1.0);
  const [linkMultiplier, setLinkMultiplier] = useState(1.0);
  const [clusterMultiplier, setClusterMultiplier] = useState(1.0);
  const spacing = 100;
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const lastClickTimeRef = useRef(0);
  const hasZoomedRef = useRef(false);
  const lastMouseMoveRef = useRef(0);
  const hoverGroupRef = useRef<string | null>(null);
  const focusedGroupRef = useRef<string | null>(null);
  const [isControlsOpen, setIsControlsOpen] = useState(true);
  
  // Folder drag state
  const draggedFolderRef = useRef<string | null>(null);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const folderOffsetsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Sync only focusedGroup (used for clicks)
  useEffect(() => {
    focusedGroupRef.current = focusedGroup;
  }, [focusedGroup]);

  const finalData = useMemo(() => data || { nodes: [], links: [] }, [data]);
  const nodeCount = finalData.nodes.length;

  // Reset zoom flag when data changes (new file loaded)
  useEffect(() => {
      hasZoomedRef.current = false;
      // Reset sliders to default values
      setChargeMultiplier(1.0);
      setLinkMultiplier(1.0);
      setClusterMultiplier(1.0);
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

  // 1. Setup Simple Forces
  useEffect(() => {
    if (!graphRef.current) return;
    
    const fg = graphRef.current;
    const nodeCount = finalData.nodes.length;
    
    // Simple scaling with user controls
    const scaleFactor = Math.max(0.3, 1 - Math.log10(nodeCount / 200) * 0.4);
    const chargeStrength = -500 * scaleFactor * chargeMultiplier; // User controlled - increased repulsion
    const linkDistance = 150 * scaleFactor * linkMultiplier; // User controlled - increased distance
    const collisionBuffer = Math.max(12, 20 * scaleFactor); // Increased collision buffer
    
    fg.d3Force('collide', d3.forceCollide((node: any) => (node.val || 4) + collisionBuffer).strength(1).iterations(5));
    fg.d3Force('charge').strength(chargeStrength).distanceMax(600);
    fg.d3Force('link').distance(linkDistance).strength(0.4); // Weaker links allow more spreading
    fg.d3Force('center').strength(0.3); // Weaker center to allow expansion
    
    // Simple clustering
    fg.d3Force('cluster', (alpha: number) => {
      groups.forEach((nodes) => {
          if (nodes.length < 2) return;
          let cx = 0, cy = 0, count = 0;
          nodes.forEach(n => {
              if (n.x !== undefined && n.y !== undefined) {
                  cx += n.x; cy += n.y; count++;
              }
          });
          if (count === 0) return;
          cx /= count; cy /= count;
          const strength = 0.15 * scaleFactor * clusterMultiplier; // User controlled
          nodes.forEach(n => {
              if (n.x !== undefined && n.y !== undefined) {
                  n.vx! += (cx - n.x) * strength * alpha;
                  n.vy! += (cy - n.y) * strength * alpha;
              }
          });
      });
    });

    // Reheat simulation to apply changes when sliders move
    fg.d3ReheatSimulation();
  }, [groups, chargeMultiplier, linkMultiplier, clusterMultiplier]);

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

  // Handle background click to clear selection or detect folder label clicks
  const handleBackgroundClick = (event: MouseEvent) => {
    if (!graphRef.current || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    const coords = graphRef.current.screen2GraphCoords(x, y);
    if (!coords) return;

    // Check if click is near any folder label (text area)
    let clickedFolder: string | null = null;
    
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

      // Check if click is in the label area (top of circle)
      const labelY = centerY - radius;
      const text = groupName.split('/').pop() || groupName;
      
      // Approximate label dimensions (rough estimate)
      const labelHeight = 20; // Approximate text height in graph units
      const labelWidth = text.length * 8; // Approximate width per character
      
      // Check if click is within label bounding box
      if (coords.y >= labelY - labelHeight - 10 && coords.y <= labelY + 5 &&
          coords.x >= centerX - labelWidth / 2 && coords.x <= centerX + labelWidth / 2) {
        clickedFolder = groupName;
      }
    });

    if (clickedFolder) {
      // Toggle folder focus
      if (focusedGroup === clickedFolder) {
        setFocusedGroup(null);
      } else {
        setFocusedGroup(clickedFolder);
      }
      // Clear node highlights
      setHighlightNodes(new Set());
      setHighlightLinks(new Set());
    } else {
      // Clear everything on background click
      setHighlightNodes(new Set());
      setHighlightLinks(new Set());
      setFocusedGroup(null);
    }
  };

  // Handle mouse up to end folder dragging
  const handleMouseUp = (e: React.MouseEvent) => {
    if (draggedFolderRef.current) {
      e.stopPropagation();
      draggedFolderRef.current = null;
      dragStartPosRef.current = null;
    }
  };

  // Handle mouse down to start folder dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!graphRef.current || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const coords = graphRef.current.screen2GraphCoords(x, y);
    if (!coords) return;

    // Check if mouse down is on any folder label
    groups.forEach((nodes, groupName) => {
      if (nodes.length === 0) return;

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      nodes.forEach(n => {
        if (n.x === undefined || n.y === undefined) return;
        minX = Math.min(minX, n.x);
        maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y);
        maxY = Math.max(maxY, n.y);
      });

      if (minX === Infinity) return;

      let centerX = (minX + maxX) / 2;
      let centerY = (minY + maxY) / 2;
      
      // Apply existing offset
      const offset = folderOffsetsRef.current.get(groupName);
      if (offset) {
        centerX += offset.x;
        centerY += offset.y;
      }

      const level = groupName.split('/').length;
      const padding = spacing + (5 - Math.min(level, 5)) * 5;
      const radius = Math.max(maxX - minX, maxY - minY) / 2 + padding;

      const labelY = centerY - radius;
      const text = groupName.split('/').pop() || groupName;
      const labelHeight = 20;
      const labelWidth = text.length * 8;
      
      if (coords.y >= labelY - labelHeight - 10 && coords.y <= labelY + 5 &&
          coords.x >= centerX - labelWidth / 2 && coords.x <= centerX + labelWidth / 2) {
        draggedFolderRef.current = groupName;
        dragStartPosRef.current = coords;
        e.preventDefault(); // Prevent default drag behavior
        e.stopPropagation(); // Stop event from bubbling
      }
    });
  };

  // Handle mouse move to detect group hover
  const handleMouseMove = (e: React.MouseEvent) => {
    // Handle folder dragging
    if (draggedFolderRef.current && dragStartPosRef.current && graphRef.current && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const coords = graphRef.current.screen2GraphCoords(x, y);
      if (coords) {
        const dx = coords.x - dragStartPosRef.current.x;
        const dy = coords.y - dragStartPosRef.current.y;
        
        // Update folder offset
        const currentOffset = folderOffsetsRef.current.get(draggedFolderRef.current) || { x: 0, y: 0 };
        folderOffsetsRef.current.set(draggedFolderRef.current, {
          x: currentOffset.x + dx,
          y: currentOffset.y + dy
        });
        
        dragStartPosRef.current = coords;
      }
      return;
    }
    
    // Throttle to prevent excessive re-renders
    const now = Date.now();
    if (now - lastMouseMoveRef.current < 100) return;
    lastMouseMoveRef.current = now;
    
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

    // Update ref directly instead of state to avoid re-renders
    hoverGroupRef.current = deepestGroup;
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    // Deprecated in favor of handleBackgroundClick logic
  };

  const drawGroupCircles = (ctx: CanvasRenderingContext2D, globalScale: number) => {
    ctx.save();
    
    const currentHoverGroup = hoverGroupRef.current;
    const currentFocusedGroup = focusedGroupRef.current;
    
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

      let centerX = (minX + maxX) / 2;
      let centerY = (minY + maxY) / 2;
      
      // Apply folder offset if dragged
      const offset = folderOffsetsRef.current.get(groupName);
      if (offset) {
        centerX += offset.x;
        centerY += offset.y;
      }
      
      // Dynamic padding based on hierarchy level
      // Parents get MORE padding to ensure they enclose children
      const level = groupName.split('/').length;
      // Match the physics padding exactly to ensure visual consistency
      const padding = spacing + (5 - Math.min(level, 5)) * 5;
      
      const radius = Math.max(maxX - minX, maxY - minY) / 2 + padding;

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI, false);
      
      // Highlight logic for groups
      const isHovered = groupName === currentHoverGroup;
      const isFocused = groupName === currentFocusedGroup;
      const isRelatedToFocus = currentFocusedGroup ? (groupName.startsWith(currentFocusedGroup) || currentFocusedGroup.startsWith(groupName)) : true;
      
      // Only draw stroke, no fill - this prevents blocking node clicks
      if (currentFocusedGroup && !isRelatedToFocus) {
          // Dimmed
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
          ctx.lineWidth = 1;
      } else if (isFocused) {
          // Focused style
          ctx.strokeStyle = 'rgba(100, 149, 237, 0.6)'; // Blueish border
          ctx.lineWidth = 3;
      } else if (isHovered) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; // Lighter border
          ctx.lineWidth = 2;
      } else {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
          ctx.lineWidth = 1;
      }
      
      ctx.stroke(); // Only stroke, no fill!
      
      // Draw group label - always visible with adaptive sizing
      // Calculate font size to be constant in screen space
      const baseFontSize = 14; // Target size in screen pixels
      const fontSize = baseFontSize / globalScale;
      const minRadius = 40 / globalScale; // Minimum circle size to show label
      
      if (radius > minRadius) {
          const isHovered = groupName === currentHoverGroup;
          const isFocused = groupName === currentFocusedGroup;
          const isRelatedToFocus = currentFocusedGroup ? (groupName.startsWith(currentFocusedGroup) || currentFocusedGroup.startsWith(groupName)) : true;
          
          ctx.font = (isHovered || isFocused) ? `bold ${fontSize}px Sans-Serif` : `${fontSize}px Sans-Serif`;
          
          if (currentFocusedGroup && !isRelatedToFocus) {
              ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
          } else {
              ctx.fillStyle = (isHovered || isFocused) ? 'rgba(255, 255, 255, 1)' : 'rgba(255, 255, 255, 0.7)';
          }
          
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          
          // Add text background for better readability
          const text = groupName.split('/').pop() || groupName;
          const metrics = ctx.measureText(text);
          const textHeight = fontSize;
          const padding = 4 / globalScale;
          
          // Draw semi-transparent background
          ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
          ctx.fillRect(
            centerX - metrics.width / 2 - padding,
            centerY - radius - textHeight - padding * 2,
            metrics.width + padding * 2,
            textHeight + padding * 2
          );
          
          // Draw text
          if (currentFocusedGroup && !isRelatedToFocus) {
              ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
          } else {
              ctx.fillStyle = (isHovered || isFocused) ? 'rgba(255, 255, 255, 1)' : 'rgba(255, 255, 255, 0.7)';
          }
          ctx.fillText(text, centerX, centerY - radius - padding);
      }
    });
    ctx.restore();
  };

  return (
    <div ref={containerRef} className="w-full h-full bg-slate-950 relative">
      {/* Controls Overlay */}
      <div className={`absolute bottom-15 right-4 z-10 flex flex-col gap-4 bg-slate-900/80 p-4 rounded-lg border border-slate-700 backdrop-blur-sm transition-all duration-300 ease-in-out ${isControlsOpen ? 'translate-x-0 opacity-100' : 'translate-x-[120%] opacity-0 pointer-events-none'}`}>
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
        
        <div className="flex flex-col gap-2">
          <label className="text-white text-xs font-medium">Spread: {chargeMultiplier.toFixed(1)}x</label>
          <input 
            type="range" 
            min="0.5" 
            max="3" 
            step="0.1"
            value={chargeMultiplier} 
            onChange={(e) => setChargeMultiplier(Number(e.target.value))}
            className="w-full"
          />
        </div>
        
        <div className="flex flex-col gap-2">
          <label className="text-white text-xs font-medium">Link Distance: {linkMultiplier.toFixed(1)}x</label>
          <input 
            type="range" 
            min="0.5" 
            max="2" 
            step="0.1"
            value={linkMultiplier} 
            onChange={(e) => setLinkMultiplier(Number(e.target.value))}
            className="w-full"
          />
        </div>
        
        <div className="flex flex-col gap-2">
          <label className="text-white text-xs font-medium">Folder Grouping: {clusterMultiplier.toFixed(1)}x</label>
          <input 
            type="range" 
            min="0" 
            max="2" 
            step="0.1"
            value={clusterMultiplier} 
            onChange={(e) => setClusterMultiplier(Number(e.target.value))}
            className="w-full"
          />
        </div>
      </div>

      {/* Controls Toggle Button */}
      <div className="absolute bottom-15 right-0 z-20 transform -translate-y-1/2">
        <button 
          onClick={() => setIsControlsOpen(!isControlsOpen)}
          className="p-1 bg-slate-900/80 border-l border-t border-b border-slate-700 rounded-l-md text-slate-400 hover:text-slate-200 backdrop-blur-sm transition-colors"
          style={{ right: isControlsOpen ? '240px' : '0', position: 'absolute', transition: 'right 0.3s ease-in-out' }}
        >
          {isControlsOpen ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>
      </div>

      <div onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} className="w-full h-full">
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
        d3AlphaDecay={0.015} // Slower decay for better spreading
        d3VelocityDecay={0.3} // Less drag
        cooldownTicks={300} // More time to settle
        
        // Rendering - Draw group circles BEFORE nodes so nodes are on top
        onRenderFramePre={(ctx, globalScale) => drawGroupCircles(ctx, globalScale)}
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
            // Larger clickable area to make nodes easier to click
            ctx.fillStyle = color;
            ctx.beginPath();
            const clickRadius = Math.max((node.val || 4) * 2, 12); // Much larger click area
            ctx.arc(node.x, node.y, clickRadius, 0, 2 * Math.PI, false);
            ctx.fill();
        }}
      />
      </div>
    </div>
  );
}
