"use client";

import CodeGraph from "@/components/graph/CodeGraph";
import { FolderOpen, Github, Loader2, Filter, X, Search, ChevronDown, ChevronUp } from "lucide-react";
import { useState, useEffect, useRef, useMemo } from "react";
import { getFileTree, treeToGraphData, processFileList } from "@/lib/file-system";
import { parseFiles } from "@/lib/parser";

interface GraphNode {
  id: string;
  name: string;
  group: string;
  val: number;
  degree?: number;
}

interface GraphLink {
  source: string;
  target: string;
  width: number;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

interface FolderNode {
  path: string;
  name: string;
  children: FolderNode[];
}

export default function Home() {
  const [initialGraphData, setInitialGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isFooterOpen, setIsFooterOpen] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  // Handle click outside filter
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false);
      }
    }

    if (isFilterOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isFilterOpen]);

  // Filters State
  const [filters, setFilters] = useState({
    search: "",
    folders: new Set<string>(),
    extensions: new Set<string>(),
    showHidden: false,
    showIsolated: true,
  });

  // Derived lists for filter UI
  const { folderTree, availableExtensions, allFolderPaths } = useMemo(() => {
    const extensions = new Set<string>();
    const allPaths = new Set<string>();
    const rootFolders: FolderNode[] = [];
    const folderMap = new Map<string, FolderNode>();

    // Helper to get or create folder node
    const getOrCreateNode = (path: string, name: string): FolderNode => {
      if (!folderMap.has(path)) {
        const newNode: FolderNode = { path, name, children: [] };
        folderMap.set(path, newNode);
        return newNode;
      }
      return folderMap.get(path)!;
    };

    initialGraphData.nodes.forEach(node => {
      // Extract extension
      const ext = node.name.split('.').pop();
      if (ext && ext !== node.name) {
        extensions.add(ext.toLowerCase());
      } else {
        extensions.add("no-ext");
      }

      // Build Folder Tree
      const parts = node.id.split('/');
      // Remove filename
      parts.pop();
      
      if (parts.length === 0) {
        // Root file
        return;
      }

      let currentPath = "";
      let parentNode: FolderNode | null = null;

      parts.forEach((part, index) => {
        if (part === "node_modules") return; // Skip node_modules

        currentPath = currentPath ? `${currentPath}/${part}` : part;
        allPaths.add(currentPath);

        const node = getOrCreateNode(currentPath, part);

        if (index === 0) {
          if (!rootFolders.includes(node)) {
            rootFolders.push(node);
          }
        } else {
          if (parentNode && !parentNode.children.includes(node)) {
            parentNode.children.push(node);
          }
        }
        parentNode = node;
      });
    });

    // Sort folders
    const sortNodes = (nodes: FolderNode[]) => {
      nodes.sort((a, b) => a.name.localeCompare(b.name));
      nodes.forEach(node => sortNodes(node.children));
    };
    sortNodes(rootFolders);

    return {
      folderTree: rootFolders,
      availableExtensions: Array.from(extensions).sort(),
      allFolderPaths: allPaths
    };
  }, [initialGraphData]);

  // Initialize filters when data loads
  useEffect(() => {
    if (initialGraphData.nodes.length > 0) {
      setFilters(prev => ({
        ...prev,
        folders: new Set(allFolderPaths),
        extensions: new Set(availableExtensions)
      }));
      
      // Show full graph immediately to avoid blank screen
      setGraphData(initialGraphData);
    }
  }, [allFolderPaths, availableExtensions, initialGraphData]);

  // Apply filters
  useEffect(() => {
    if (initialGraphData.nodes.length === 0) return;

    const { nodes, links } = initialGraphData;
    const { search, folders, extensions, showHidden, showIsolated } = filters;

    // If filters are empty (and we have available options), it might be initialization lag.
    // But since we setGraphData(initialGraphData) in the init effect, we are safe.
    // However, if user genuinely deselects all, we should respect that.
    // The only edge case is if this effect runs BEFORE the init effect updates filters.
    // But since init effect updates filters, this effect will run AGAIN with updated filters.
    // So we can just let it run.

    const filteredNodes = nodes.filter(node => {
      // 1. Search
      if (search && !node.name.toLowerCase().includes(search.toLowerCase())) return false;

      // 2. Hidden Files / Folders (start with .)
      if (!showHidden && (node.name.startsWith('.') || node.id.split('/').some(p => p.startsWith('.')))) return false;

      // 3. node_modules (Always hidden)
      if (node.id.includes('node_modules')) return false;

      // 4. Folders
      const parts = node.id.split('/');
      parts.pop(); // Remove filename
      const folderPath = parts.join('/');
      
      // If file is at root, it's always shown if we are not filtering specifically for root (which we aren't tracking explicitly as a folder)
      // Or we can assume root files are part of "Root" folder?
      // Let's say if folderPath is empty, it's visible.
      // If folderPath is not empty, it must be in selected folders.
      if (folderPath && !folders.has(folderPath)) return false;

      // 5. Extensions
      const ext = node.name.split('.').pop()?.toLowerCase() || "no-ext";
      const finalExt = node.name.includes('.') ? ext : "no-ext";
      if (!extensions.has(finalExt)) return false;

      return true;
    });

    const nodeIds = new Set(filteredNodes.map(n => n.id));

    const filteredLinks = links.filter(link => 
      nodeIds.has(link.source) && nodeIds.has(link.target)
    );

    // 6. Isolated Nodes
    let finalNodes = filteredNodes;
    if (!showIsolated) {
      const connectedNodeIds = new Set<string>();
      filteredLinks.forEach(link => {
        connectedNodeIds.add(link.source);
        connectedNodeIds.add(link.target);
      });
      finalNodes = filteredNodes.filter(node => connectedNodeIds.has(node.id));
    }

    setGraphData({ nodes: finalNodes, links: filteredLinks });

  }, [initialGraphData, filters]);

  const processGraph = async (tree: any[]) => {
    setStatus(`Found ${tree.length} files. Building structure...`);
    const initialData = treeToGraphData(tree);
    // Don't set graphData directly, set initialGraphData
    
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
        
        setInitialGraphData({ nodes, links: validLinks });
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

  const toggleFolder = (folderPath: string, checked: boolean) => {
    setFilters(prev => {
      const newFolders = new Set(prev.folders);
      
      // Helper to find all descendants
      // Simple string matching for descendants is safer and easier
      // Add/Remove self
      if (checked) {
        newFolders.add(folderPath);
        // Add all descendants
        allFolderPaths.forEach(path => {
          if (path.startsWith(folderPath + '/')) {
            newFolders.add(path);
          }
        });
        
        // Add all ancestors
        const parts = folderPath.split('/');
        let current = "";
        parts.forEach((part, i) => {
           current = current ? `${current}/${part}` : part;
           newFolders.add(current);
        });

      } else {
        newFolders.delete(folderPath);
        // Remove all descendants
        allFolderPaths.forEach(path => {
          if (path.startsWith(folderPath + '/')) {
            newFolders.delete(path);
          }
        });
      }

      return { ...prev, folders: newFolders };
    });
  };

  const toggleExtension = (ext: string) => {
    setFilters(prev => {
      const newSet = new Set(prev.extensions);
      if (newSet.has(ext)) {
        newSet.delete(ext);
      } else {
        newSet.add(ext);
      }
      return { ...prev, extensions: newSet };
    });
  };

  // Recursive Folder Component
  const FolderItem = ({ node }: { node: FolderNode }) => {
    const isChecked = filters.folders.has(node.path);
    
    return (
      <div className="mb-1">
        <div className="flex items-center gap-2 text-sm text-slate-300 hover:text-white">
          <input 
            type="checkbox" 
            checked={isChecked}
            onChange={(e) => toggleFolder(node.path, e.target.checked)}
            className="rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-0 focus:ring-offset-0"
          />
          <span className="truncate font-medium">{node.name}</span>
        </div>
        
        {node.children.length > 0 && (
          <div className="ml-2 mt-1 pl-2 border-l border-slate-800 flex flex-wrap gap-2">
            {node.children.map(child => (
              <FolderItem key={child.path} node={child} />
            ))}
          </div>
        )}
      </div>
    );
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
        <header className="p-6 flex justify-between items-center pointer-events-auto relative">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-500 blur-sm absolute opacity-50"></div>
            <h1 className="text-2xl font-bold tracking-tighter relative z-10 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              CodeNebula
            </h1>
          </div>
          
          <div className="flex gap-4 items-center">
             {/* Filter Button */}
             <div className="relative" ref={filterRef}>
              <button 
                onClick={() => setIsFilterOpen(!isFilterOpen)}
                className={`p-2 rounded-full border transition-all flex items-center justify-center ${isFilterOpen ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-900/80 border-slate-800 hover:border-slate-600 text-slate-400 hover:text-slate-200'}`}
              >
                <Filter className="w-5 h-5" />
              </button>

              {/* Filter Dropdown */}
              {isFilterOpen && (
                <div className="absolute top-full right-0 mt-2 w-80 bg-slate-900/95 backdrop-blur-xl border border-slate-800 rounded-xl shadow-2xl p-4 flex flex-col gap-4 max-h-[80vh] overflow-y-auto z-50">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                    <h3 className="font-semibold text-sm text-slate-300">Filters</h3>
                    <button onClick={() => setIsFilterOpen(false)} className="text-slate-500 hover:text-slate-300">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Search */}
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input 
                      type="text" 
                      placeholder="Search files..." 
                      value={filters.search}
                      onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 pl-9 pr-3 text-sm text-slate-300 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>

                  {/* Folders */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider">Folders</h4>
                    <div className="max-h-64 overflow-y-auto space-y-1 pr-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                      {folderTree.map(node => (
                        <FolderItem key={node.path} node={node} />
                      ))}
                    </div>
                  </div>

                  {/* Extensions */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider">Extensions</h4>
                    <div className="max-h-32 overflow-y-auto space-y-1 pr-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                      {availableExtensions.map(ext => (
                        <label key={ext} className="flex items-center gap-2 text-sm text-slate-300 hover:text-white cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={filters.extensions.has(ext)}
                            onChange={() => toggleExtension(ext)}
                            className="rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-0 focus:ring-offset-0"
                          />
                          <span className="truncate">.{ext}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Other Options */}
                  <div className="space-y-2 border-t border-slate-800 pt-2">
                    <label className="flex items-center gap-2 text-sm text-slate-300 hover:text-white cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={filters.showHidden}
                        onChange={() => setFilters(prev => ({ ...prev, showHidden: !prev.showHidden }))}
                        className="rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-0 focus:ring-offset-0"
                      />
                      <span>Show Hidden Files (.*)</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-300 hover:text-white cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={filters.showIsolated}
                        onChange={() => setFilters(prev => ({ ...prev, showIsolated: !prev.showIsolated }))}
                        className="rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-0 focus:ring-offset-0"
                      />
                      <span>Show Isolated Nodes</span>
                    </label>
                  </div>
                </div>
              )}
            </div>

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
        <footer className={`border-t border-slate-800/50 bg-slate-950/50 backdrop-blur-md pointer-events-auto transition-all duration-300 ease-in-out ${isFooterOpen ? 'h-12' : 'h-0 border-t-0 overflow-hidden'}`}>
          <div className="h-full px-4 flex justify-between items-center text-xs text-slate-500">
            <div className="flex gap-4">
              <span>Nodes: {graphData.nodes.length}</span>
              <span>Edges: {graphData.links.length}</span>
            </div>
            <div className="text-slate-600">
              Made with <span className="text-red-500">♥</span> by Ajit
            </div>
            <div>
              {status}
            </div>
          </div>
        </footer>
        
        {/* Footer Toggle Button */}
        <div 
          className="absolute right-4 z-20 pointer-events-auto transition-all duration-300 ease-in-out"
          style={{ bottom: isFooterOpen ? '3rem' : '0' }}
        >
           <button 
             onClick={() => setIsFooterOpen(!isFooterOpen)}
             className="p-1 rounded-t-md bg-slate-900/80 border border-b-0 border-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
           >
             {isFooterOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
           </button>
        </div>
      </div>
    </main>
  );
}
