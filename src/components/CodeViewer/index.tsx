"use client";

import { useEffect, useState } from "react";
import { AlertCircle, FileCode2, Loader2 } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

import { getFileContent } from "@/services/githubService";

const TEXT = {
  loadFailed: "\u52a0\u8f7d\u6587\u4ef6\u5185\u5bb9\u5931\u8d25",
  empty: "\u8bf7\u9009\u62e9\u6587\u4ef6\u67e5\u770b\u4ee3\u7801\u5185\u5bb9",
} as const;

interface CodeViewerProps {
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

export function CodeViewer({ owner, repo, branch, path }: CodeViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchContent() {
      if (!path) return;

      setIsLoading(true);
      setError(null);

      try {
        const text = await getFileContent(owner, repo, branch, path);
        setContent(text);
      } catch (err) {
        setError(err instanceof Error ? err.message : TEXT.loadFailed);
        setContent(null);
      } finally {
        setIsLoading(false);
      }
    }

    void fetchContent();
  }, [owner, repo, branch, path]);

  const getLanguage = (fileName: string) => {
    const ext = fileName.split(".").pop()?.toLowerCase();

    const languageMap: Record<string, string> = {
      js: "javascript",
      jsx: "jsx",
      ts: "typescript",
      tsx: "tsx",
      json: "json",
      md: "markdown",
      html: "html",
      css: "css",
      py: "python",
      rb: "ruby",
      go: "go",
      java: "java",
      cpp: "cpp",
      c: "c",
      cs: "csharp",
      php: "php",
      sh: "bash",
      yaml: "yaml",
      yml: "yaml",
      xml: "xml",
      sql: "sql",
      rs: "rust",
      toml: "toml",
    };

    return ext && languageMap[ext] ? languageMap[ext] : "text";
  };

  const language = getLanguage(path);

  if (!path) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-gray-50 text-gray-400 dark:bg-[#1e1e1e]">
        <FileCode2 className="mb-4 h-10 w-10 text-gray-300 dark:text-gray-700" />
        <p>{TEXT.empty}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden border-l border-gray-200 bg-[#1e1e1e] dark:border-gray-800">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-100 px-4 py-2 dark:border-gray-700 dark:bg-gray-800">
        <span
          className="truncate font-mono text-sm text-gray-700 dark:text-gray-300"
          title={path}
        >
          {path}
        </span>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-gray-500" />}
      </div>

      <div className="relative min-w-0 flex-1 overflow-auto">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#1e1e1e]/50">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        )}

        {error && (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center text-red-500">
            <AlertCircle className="mb-2 h-6 w-6" />
            <p>{error}</p>
          </div>
        )}

        {!isLoading && !error && content !== null && (
          <SyntaxHighlighter
            language={language}
            style={vscDarkPlus}
            customStyle={{
              margin: 0,
              padding: "1rem",
              minHeight: "100%",
              width: "100%",
              minWidth: 0,
              fontSize: "14px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              overflowWrap: "anywhere",
              backgroundColor: "transparent",
            }}
            codeTagProps={{
              style: {
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                overflowWrap: "anywhere",
              },
            }}
            showLineNumbers={true}
            wrapLines={true}
            wrapLongLines={true}
          >
            {content}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}
