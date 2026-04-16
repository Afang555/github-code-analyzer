import type { FileNode } from "@/types/repository";

export function flattenFileTreePaths(nodes: FileNode[]): string[] {
  const filePaths: string[] = [];

  const visit = (items: FileNode[]) => {
    for (const node of items) {
      if (node.type === "file") {
        filePaths.push(node.path);
        continue;
      }

      if (node.children) {
        visit(node.children);
      }
    }
  };

  visit(nodes);

  return Array.from(
    new Set(
      filePaths
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

export function createFileTreeFromFileList(fileList: string[]): FileNode[] {
  const root: FileNode[] = [];
  const nodeMap = new Map<string, FileNode>();

  const normalizedPaths = Array.from(
    new Set(
      fileList
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().replace(/\\/g, "/"))
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));

  for (const path of normalizedPaths) {
    const parts = path.split("/").filter(Boolean);
    let parentPath = "";

    for (const [index, segment] of parts.entries()) {
      const currentPath = parentPath ? `${parentPath}/${segment}` : segment;
      const isFile = index === parts.length - 1;
      const existing = nodeMap.get(currentPath);

      if (!existing) {
        const node: FileNode = {
          name: segment,
          path: currentPath,
          type: isFile ? "file" : "folder",
          children: isFile ? undefined : [],
        };
        nodeMap.set(currentPath, node);

        if (!parentPath) {
          root.push(node);
        } else {
          const parent = nodeMap.get(parentPath);
          if (parent?.children) {
            parent.children.push(node);
          }
        }
      }

      parentPath = currentPath;
    }
  }

  const sortNodes = (items: FileNode[]) => {
    items.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "folder" ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });

    for (const node of items) {
      if (node.children) {
        sortNodes(node.children);
      }
    }
  };

  sortNodes(root);
  return root;
}
