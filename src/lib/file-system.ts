export interface FileNode {
    name: string
    kind: 'file' | 'directory'
    path: string
    children?: FileNode[]
    handle?: FileSystemFileHandle | File // Store the handle or File object
}

export async function getFileTree(dirHandle: FileSystemDirectoryHandle, path = ''): Promise<FileNode[]> {
    const tree: FileNode[] = []
    // @ts-ignore - FileSystemDirectoryHandle is not yet in all TS definitions
    for await (const entry of dirHandle.values()) {
        const entryPath = `${path}/${entry.name}`
        if (entry.kind === 'file') {
            tree.push({ name: entry.name, kind: 'file', path: entryPath, handle: entry as FileSystemFileHandle })
        } else if (entry.kind === 'directory') {
            const children = await getFileTree(entry as FileSystemDirectoryHandle, entryPath)
            tree.push({ name: entry.name, kind: 'directory', path: entryPath, children })
        }
    }
    return tree
}

export function treeToGraphData(tree: FileNode[]) {
    const nodes: any[] = []
    const links: any[] = []

    function traverse(node: FileNode, parentPath: string) {
        const id = node.path

        if (node.kind === 'file') {
            nodes.push({
                id,
                name: node.name,
                group: parentPath || 'root',
                val: 5 // Default size
            })
        } else {
            // For directories, traverse children with this directory as the group/parent
            node.children?.forEach(child => traverse(child, id))
        }
    }

    tree.forEach(node => traverse(node, 'root'))
    return { nodes, links }
}

export function processFileList(files: FileList): FileNode[] {
    const root: FileNode[] = []

    Array.from(files).forEach((file) => {
        const pathParts = file.webkitRelativePath.split('/')
        let currentLevel = root
        let currentPath = ""

        pathParts.forEach((part, index) => {
            const isFile = index === pathParts.length - 1
            currentPath = currentPath ? `${currentPath}/${part}` : part

            let node = currentLevel.find((n) => n.name === part)

            if (!node) {
                if (isFile) {
                    node = { name: part, kind: 'file', path: currentPath, handle: file }
                    currentLevel.push(node)
                } else {
                    node = { name: part, kind: 'directory', path: currentPath, children: [] }
                    currentLevel.push(node)
                }
            }

            if (!isFile && node.kind === 'directory') {
                currentLevel = node.children!
            }
        })
    })

    return root
}
