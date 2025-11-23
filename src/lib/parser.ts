import { FileNode } from "./file-system"

export interface FileDependency {
    source: string
    target: string
}

// Regex patterns for different languages
const PATTERNS: Record<string, RegExp[]> = {
    // JavaScript / TypeScript / React
    js: [
        /from\s+['"]([^'"]+)['"]/g,            // import ... from 'path'
        /import\s+['"]([^'"]+)['"]/g,          // import 'path'
        /import\s*\(['"]([^'"]+)['"]\)/g,      // import('path')
        /require\s*\(['"]([^'"]+)['"]\)/g,     // require('path')
    ],
    ts: [
        /from\s+['"]([^'"]+)['"]/g,
        /import\s+['"]([^'"]+)['"]/g,
        /import\s*\(['"]([^'"]+)['"]\)/g,
        /require\s*\(['"]([^'"]+)['"]\)/g,
    ],
    jsx: [
        /from\s+['"]([^'"]+)['"]/g,
        /import\s+['"]([^'"]+)['"]/g,
        /require\s*\(['"]([^'"]+)['"]\)/g,
    ],
    tsx: [
        /from\s+['"]([^'"]+)['"]/g,
        /import\s+['"]([^'"]+)['"]/g,
        /require\s*\(['"]([^'"]+)['"]\)/g,
    ],
    // CSS / SCSS
    css: [
        /@import\s+['"]([^'"]+)['"]/g,         // @import 'path'
        /url\s*\(['"]?([^'"\)]+)['"]?\)/g,     // url('path')
    ],
    scss: [
        /@import\s+['"]([^'"]+)['"]/g,
        /@use\s+['"]([^'"]+)['"]/g,
    ],
    // Python
    py: [
        /from\s+(\.?\S+)\s+import/g,           // from .module import ...
        /^import\s+(\S+)/gm,                   // import module (start of line)
    ],
    // Dart / Flutter
    dart: [
        /import\s+['"]([^'"]+)['"]/g,          // import 'package:...'
    ],
    // Rust
    rs: [
        /use\s+([\w:]+)/g,                     // use crate::module
        /mod\s+(\w+);/g,                       // mod module;
    ],
    // Go
    go: [
        /import\s+['"]([^'"]+)['"]/g,          // import "fmt"
        /import\s+\(\s*([\s\S]*?)\s*\)/g,      // import ( ... ) - requires secondary parsing, skipping for simplicity
    ]
}

// Map extensions to pattern keys
const EXT_MAP: Record<string, string> = {
    'js': 'js', 'mjs': 'js', 'cjs': 'js',
    'ts': 'ts', 'mts': 'ts',
    'jsx': 'jsx',
    'tsx': 'tsx',
    'css': 'css',
    'scss': 'scss', 'sass': 'scss',
    'py': 'py',
    'dart': 'dart',
    'rs': 'rs',
    'go': 'go',
}

async function readFileContent(node: FileNode): Promise<string> {
    if (!node.handle) return ""

    let file: File
    if ("getFile" in node.handle) {
        // FileSystemFileHandle
        file = await (node.handle as any).getFile()
    } else {
        // File object
        file = node.handle as File
    }

    return await file.text()
}

function resolveImportPath(currentPath: string, importPath: string, fileMap: Map<string, FileNode>): string | null {
    // 1. Handle relative paths (./, ../)
    if (importPath.startsWith(".")) {
        const currentDir = currentPath.split("/").slice(0, -1).join("/")
        const parts = importPath.split("/")
        const stack = currentDir.split("/").filter(Boolean)

        for (const part of parts) {
            if (part === ".") continue
            if (part === "..") {
                stack.pop()
            } else {
                stack.push(part)
            }
        }

        const resolvedPath = stack.join("/")

        // Try exact match
        if (fileMap.has(resolvedPath)) return resolvedPath

        // Try extensions
        const extensions = [".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".py", ".dart"]
        for (const ext of extensions) {
            if (fileMap.has(resolvedPath + ext)) return resolvedPath + ext
        }

        // Try index files
        for (const ext of extensions) {
            if (fileMap.has(resolvedPath + "/index" + ext)) return resolvedPath + "/index" + ext
        }
    }

    return null
}

export async function parseFiles(files: FileNode[], onProgress?: (msg: string) => void): Promise<FileDependency[]> {
    const dependencies: FileDependency[] = []
    const fileMap = new Map<string, FileNode>()
    const nodesToProcess: FileNode[] = []

    // 1. Flatten and Map files
    function mapFiles(nodes: FileNode[]) {
        for (const node of nodes) {
            if (node.kind === 'file') {
                fileMap.set(node.path, node)
                nodesToProcess.push(node)
            } else if (node.children) {
                mapFiles(node.children)
            }
        }
    }
    mapFiles(files)

    // 2. Parse each file
    let processed = 0
    for (const node of nodesToProcess) {
        processed++
        if (processed % 10 === 0 && onProgress) {
            onProgress(`Parsing ${processed}/${nodesToProcess.length}: ${node.name}`)
        }

        const ext = node.name.split(".").pop()?.toLowerCase()
        if (!ext || !EXT_MAP[ext]) continue

        const lang = EXT_MAP[ext]
        const patterns = PATTERNS[lang]

        try {
            const content = await readFileContent(node)

            for (const pattern of patterns) {
                // Reset regex state
                pattern.lastIndex = 0
                let match
                while ((match = pattern.exec(content)) !== null) {
                    const importPath = match[1]
                    if (!importPath) continue

                    const resolved = resolveImportPath(node.path, importPath, fileMap)
                    if (resolved) {
                        dependencies.push({
                            source: node.path,
                            target: resolved
                        })
                    }
                }
            }
        } catch (err) {
            console.error(`Error parsing ${node.path}`, err)
        }
    }

    return dependencies
}
