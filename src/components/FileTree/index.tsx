'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown, File, Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FileNode } from '@/types/repository';

interface FileTreeProps {
  nodes: FileNode[];
  onSelectFile: (path: string) => void;
  selectedPath?: string;
}

export function FileTree({ nodes, onSelectFile, selectedPath }: FileTreeProps) {
  return (
    <div className="w-full h-full overflow-y-auto overflow-x-hidden p-2 text-sm text-gray-700 bg-gray-50 dark:bg-gray-900 dark:text-gray-300">
      {nodes.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          onSelectFile={onSelectFile}
          selectedPath={selectedPath}
          level={0}
        />
      ))}
    </div>
  );
}

interface TreeNodeProps {
  node: FileNode;
  onSelectFile: (path: string) => void;
  selectedPath?: string;
  level: number;
}

function TreeNode({ node, onSelectFile, selectedPath, level }: TreeNodeProps) {
  const [isOpen, setIsOpen] = useState(level === 0); // Root level open by default
  const isFolder = node.type === 'folder';
  const isSelected = selectedPath === node.path;

  const handleToggle = () => {
    if (isFolder) {
      setIsOpen(!isOpen);
    } else {
      onSelectFile(node.path);
    }
  };

  return (
    <div>
      <div
        className={cn(
          "flex items-center py-1 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-800 rounded px-1 transition-colors select-none",
          isSelected && "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400"
        )}
        style={{ paddingLeft: `${level * 12 + 4}px` }}
        onClick={handleToggle}
      >
        <div className="w-4 h-4 mr-1 flex items-center justify-center shrink-0">
          {isFolder ? (
            isOpen ? (
              <ChevronDown className="w-4 h-4 text-gray-500" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-500" />
            )
          ) : (
            <span className="w-4" /> // Placeholder for alignment
          )}
        </div>
        
        <div className="w-4 h-4 mr-2 flex items-center justify-center shrink-0">
          {isFolder ? (
            <Folder className={cn("w-4 h-4", isOpen ? "text-blue-500" : "text-gray-400")} />
          ) : (
            <File className="w-4 h-4 text-gray-400" />
          )}
        </div>
        
        <span className="truncate" title={node.name}>{node.name}</span>
      </div>

      {isFolder && isOpen && node.children && (
        <div className="flex flex-col">
          {node.children.map((childNode) => (
            <TreeNode
              key={childNode.path}
              node={childNode}
              onSelectFile={onSelectFile}
              selectedPath={selectedPath}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
