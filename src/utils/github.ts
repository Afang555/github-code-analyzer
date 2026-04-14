/**
 * Validates a GitHub repository URL and extracts the owner and repo name.
 * @param url The GitHub URL to parse
 * @returns An object with owner and repo, or null if invalid
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  if (!url) return null;
  
  // Handle various formats:
  // https://github.com/owner/repo
  // http://github.com/owner/repo
  // github.com/owner/repo
  // owner/repo
  
  try {
    // Basic format: owner/repo
    const basicMatch = url.match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/);
    if (basicMatch) {
      return { owner: basicMatch[1], repo: basicMatch[2] };
    }

    // URL format
    const urlString = url.startsWith('http') ? url : `https://${url}`;
    const parsedUrl = new URL(urlString);
    
    if (parsedUrl.hostname !== 'github.com' && parsedUrl.hostname !== 'www.github.com') {
      return null;
    }

    const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 2) {
      return {
        owner: pathParts[0],
        repo: pathParts[1].replace(/\.git$/, '') // Remove .git suffix if present
      };
    }
    
    return null;
  } catch {
    return null;
  }
}
