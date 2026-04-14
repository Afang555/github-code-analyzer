export interface GitHubNode {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url: string;
}

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
  url?: string;
}

export interface GitHubRepositoryInfo {
  default_branch: string;
  html_url: string;
  description: string | null;
}
