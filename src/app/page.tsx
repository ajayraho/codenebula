"use client";

import CodeGraph from "@/components/graph/CodeGraph";
import { FolderOpen, Github, Loader2 } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { getFileTree, treeToGraphData, processFileList } from "@/lib/file-system";
import { parseFiles } from "@/lib/parser";

export default function Home() {
  const [graphData, setGraphData] = useState<any>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("Ready");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Initial Mock Data
    const N = 50;
    const nodes = [...Array(N).keys()].map((i) => ({
      id: `node-${i}`,
      name: `File ${i}.ts`,
      group: Math.floor(Math.random() * 5).toString(),
      val: Math.random() * 10 + 2,
    }));
    
    const links = [...Array(N).keys()]
      .filter((id) => id)
      .map((id) => ({
        source: `node-${id}`,
        target: `node-${Math.floor(Math.random() * (id - 1))}`,
        width: Math.random() * 3 + 1,
      }));

    setGraphData({ nodes, links });
  }, []);

  const processGraph = async (tree: any[]) => {
    setStatus(`Found ${tree.length} files. Building structure...`);
    const initialData = treeToGraphData(tree);
    setGraphData(initialData);
    
    setStatus(`Parsing ${initialData.nodes.length} files for dependencies...`);
    
    // Run parsing in a "worker" (async)
    // In a real app, use a Web Worker to avoid blocking UI
    setTimeout(async () => {
      try {
        const dependencies = await parseFiles(tree, (msg) => setStatus(msg));
        
        // 1. Create a Set of all valid node IDs for O(1) lookup
        const nodeIds = new Set(initialData.nodes.map(n => n.id));

        // 2. Filter links to ensure both source and target exist (removes "ghost" nodes)
        const validLinks = dependencies
          .filter(dep => nodeIds.has(dep.source) && nodeIds.has(dep.target))
          .map(dep => ({
            source: dep.source,
            target: dep.target,
            width: 1
          }));
        
        // 3. Calculate node sizes based on in-degree (number of files importing this file)
        const inDegree = new Map<string, number>();
        validLinks.forEach(link => {
          inDegree.set(link.target, (inDegree.get(link.target) || 0) + 1);
        });
        
        const nodes = initialData.nodes.map(node => {
          const degree = inDegree.get(node.id) || 0;
          // Base size 4, plus logarithmic scale of degree to prevent huge nodes
          // or linear scale if preferred. Let's use a capped linear scale for visibility.
          const size = 4 + Math.min(20, degree * 1.5); 
          
          return {
            ...node,
            val: size,
            // Add degree to data for debugging or tooltip
            degree
          };
        });
        
        setGraphData({ nodes, links: validLinks });
        setStatus(`Done! ${nodes.length} nodes, ${validLinks.length} edges.`);
        setLoading(false);
      } catch (err) {
        console.error(err);
        setStatus("Error parsing files");
        setLoading(false);
      }
    }, 100);
  };

  const handleOpenLocal = async () => {
    // Check if File System Access API is supported
    if ('showDirectoryPicker' in window) {
      try {
        // @ts-ignore - showDirectoryPicker is experimental
        const dirHandle = await window.showDirectoryPicker();
        setLoading(true);
        setStatus(`Scanning ${dirHandle.name}...`);

        const tree = await getFileTree(dirHandle);
        await processGraph(tree);
      } catch (err) {
        console.error(err);
        setStatus("Error opening folder");
        setLoading(false);
      }
    } else {
      // Fallback for browsers that don't support showDirectoryPicker (e.g. Firefox)
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setLoading(true);
      setStatus("Processing files...");
      
      // Small timeout to allow UI to update
      setTimeout(async () => {
        const tree = processFileList(e.target.files!);
        await processGraph(tree);
      }, 100);
    }
  };

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-slate-950 text-slate-100 font-sans">
      {/* Hidden Input for Fallback */}
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        // @ts-ignore
        webkitdirectory=""
        directory=""
        multiple
        onChange={handleFileChange}
      />

      {/* Graph Background */}
      <div className="absolute inset-0 z-0">
        <CodeGraph data={graphData} />
      </div>

      {/* Overlay UI */}
      <div className="absolute inset-0 z-10 pointer-events-none flex flex-col">
        {/* Header */}
        <header className="p-6 flex justify-between items-center pointer-events-auto">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-500 blur-sm absolute opacity-50"></div>
            <h1 className="text-2xl font-bold tracking-tighter relative z-10 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              CodeNebula
            </h1>
          </div>
          
          <div className="flex gap-4">
            <button className="px-4 py-2 rounded-full bg-slate-900/80 border border-slate-800 hover:border-slate-600 backdrop-blur-md transition-all flex items-center gap-2 text-sm font-medium">
              <Github className="w-4 h-4" />
              Import Repo
            </button>
            <button 
              onClick={handleOpenLocal}
              disabled={loading}
              className="px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/20 transition-all flex items-center gap-2 text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4" />}
              Open Local
            </button>
          </div>
        </header>

        {/* Main Content Area (Empty for now, graph is the hero) */}
        <div className="flex-1"></div>

        {/* Footer / Status Bar */}
        <footer className="p-4 border-t border-slate-800/50 bg-slate-950/50 backdrop-blur-md pointer-events-auto">
          <div className="flex justify-between items-center text-xs text-slate-500">
            <div className="flex gap-4">
              <span>Nodes: {graphData.nodes.length}</span>
              <span>Edges: {graphData.links.length}</span>
            </div>
            <div>
              {status}
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
