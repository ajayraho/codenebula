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
    ],
    // Java
    java: [
        /import\s+([\w.]+);/g,                 // import java.util.List;
        /import\s+static\s+([\w.]+);/g,        // import static java.util.Arrays.*;
    ],
    // C#
    cs: [
        /using\s+([\w.]+);/g,                  // using System.Collections;
    ],
    // C++
    cpp: [
        /#include\s+["<]([^\s">]+)[">]/g,     // #include "header.h" or #include <iostream>
    ],
    // Ruby
    rb: [
        /require\s+['"]([^'"]+)['"]/g,        // require 'module'
        /require_relative\s+['"]([^'"]+)['"]/g, // require_relative './file'
    ],
    // PHP
    php: [
        /require\s+['"]([^'"]+)['"]/g,        // require 'file.php'
        /require_once\s+['"]([^'"]+)['"]/g,   // require_once 'file.php'
        /include\s+['"]([^'"]+)['"]/g,        // include 'file.php'
        /include_once\s+['"]([^'"]+)['"]/g,   // include_once 'file.php'
        /use\s+([\w\\]+);/g,                   // use App\Controller;
    ],
    // ISML (Internet Store Markup Language - Salesforce Commerce Cloud)
    isml: [
        /<isinclude\s+template\s*=\s*['"]([^'"]+)['"]/gi,  // <isinclude template="path/to/template" />
        /<ismodule\s+template\s*=\s*['"]([^'"]+)['"]/gi,   // <ismodule template="path/to/module" />
        /<isdecorate\s+template\s*=\s*['"]([^'"]+)['"]/gi, // <isdecorate template="decorator" />
        /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,            // require('module') - for ISML script blocks
        /\$\{Resource\.msg\(['"]([^'"]+)['"]/g,             // ${Resource.msg('key', 'file')} - resource includes
    ],
    // JSP (JavaServer Pages)
    jsp: [
        /<%@\s*include\s+file\s*=\s*['"]([^'"]+)['"]/gi,   // <%@ include file="header.jsp" %>
        /<%@\s*page\s+import\s*=\s*['"]([^'"]+)['"]/gi,    // <%@ page import="java.util.*" %>
        /<%@\s*taglib\s+uri\s*=\s*['"]([^'"]+)['"]/gi,     // <%@ taglib uri="/tags/custom" prefix="c" %>
        /<jsp:include\s+page\s*=\s*['"]([^'"]+)['"]/gi,    // <jsp:include page="fragment.jsp" />
        /<jsp:forward\s+page\s*=\s*['"]([^'"]+)['"]/gi,    // <jsp:forward page="target.jsp" />
        /<c:import\s+url\s*=\s*['"]([^'"]+)['"]/gi,        // <c:import url="/includes/nav.jsp" />
        /import\s+([\w.]+);/g,                              // Java import statements in scriptlets
    ],
    // ASP (Active Server Pages - Classic ASP)
    asp: [
        /<!--\s*#include\s+(file|virtual)\s*=\s*['"]([^'"]+)['"]\s*-->/gi,  // <!--#include file="header.asp" -->
        /Server\.Execute\s*\(\s*['"]([^'"]+)['"]/gi,        // Server.Execute("path.asp")
        /Server\.Transfer\s*\(\s*['"]([^'"]+)['"]/gi,       // Server.Transfer("page.asp")
        /Response\.Redirect\s*\(\s*['"]([^'"]+)['"]/gi,     // Response.Redirect("newpage.asp")
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
    'java': 'java',
    'cs': 'cs',
    'cpp': 'cpp', 'cc': 'cpp', 'cxx': 'cpp', 'c': 'cpp', 'h': 'cpp', 'hpp': 'cpp',
    'rb': 'rb',
    'php': 'php',
    'isml': 'isml',
    'jsp': 'jsp', 'jspx': 'jsp', 'jspf': 'jsp',
    'asp': 'asp', 'aspx': 'asp', 'asa': 'asp',
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

function resolveImportPath(currentPath: string, importPath: string, fileMap: Map<string, FileNode>, lang?: string): string | null {
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
        const extensions = [".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".py", ".dart", ".rs", ".go", ".java", ".cs", ".cpp", ".rb", ".php", ".isml", ".jsp", ".jspx", ".asp", ".aspx"]
        for (const ext of extensions) {
            if (fileMap.has(resolvedPath + ext)) return resolvedPath + ext
        }

        // Try index files
        for (const ext of extensions) {
            if (fileMap.has(resolvedPath + "/index" + ext)) return resolvedPath + "/index" + ext
        }
    } else {
        // 2. Handle non-relative / package imports
        const potentialSuffixes: string[] = []

        if (lang === 'java') {
            const basePath = importPath.replace(/\./g, "/")
            potentialSuffixes.push(basePath + ".java")
        } else if (lang === 'py') {
            const basePath = importPath.replace(/\./g, "/")
            potentialSuffixes.push(basePath + ".py")
            potentialSuffixes.push(basePath + "/__init__.py")
        } else {
            // Default behavior for others
            potentialSuffixes.push(importPath)
            // Add common extensions if not present
            if (!importPath.split("/").pop()?.includes(".")) {
                const exts = [".js", ".ts", ".tsx", ".jsx", ".css", ".scss", ".h", ".hpp", ".cpp", ".cs"]
                for (const ext of exts) {
                    potentialSuffixes.push(importPath + ext)
                }
            }
        }

        for (const suffix of potentialSuffixes) {
            for (const path of fileMap.keys()) {
                // Check if path ends with suffix
                // And ensure it's a full path segment match (preceded by / or start of string)
                if (path.endsWith(suffix)) {
                    const prefixIndex = path.length - suffix.length
                    if (prefixIndex === 0 || path[prefixIndex - 1] === '/') {
                        return path
                    }
                }
            }
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
                    // For ASP includes, capture group 2 has the path, otherwise use group 1
                    const importPath = match[2] || match[1]
                    if (!importPath) continue

                    const resolved = resolveImportPath(node.path, importPath, fileMap, lang)
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
