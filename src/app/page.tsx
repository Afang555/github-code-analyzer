"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Code2 } from "lucide-react";
import { SiGithub } from "react-icons/si";

import { parseGitHubUrl } from "@/utils/github";

const TEXT = {
  emptyUrl: "\u8bf7\u8f93\u5165 GitHub \u4ed3\u5e93\u5730\u5740",
  invalidUrl:
    "GitHub \u5730\u5740\u683c\u5f0f\u4e0d\u6b63\u786e\uff0c\u4f8b\u5982\uff1ahttps://github.com/owner/repo",
  title: "GitHub \u4ee3\u7801\u5206\u6790\u5668",
  subtitle:
    "\u8f93\u5165\u516c\u5f00 GitHub \u4ed3\u5e93\u5730\u5740\uff0c\u5feb\u901f\u67e5\u770b\u76ee\u5f55\u7ed3\u6784\u3001\u6e90\u7801\u5185\u5bb9\u4e0e AI \u5206\u6790\u7ed3\u679c\u3002",
  analyze: "\u5f00\u59cb\u5206\u6790",
  feature1Title: "\u7ed3\u6784\u53ef\u89c6\u5316",
  feature1Desc:
    "\u65e0\u9700\u514b\u9686\u4ed3\u5e93\uff0c\u76f4\u63a5\u67e5\u770b\u5b8c\u6574\u7684\u9879\u76ee\u6587\u4ef6\u6811\u3002",
  feature2Title: "\u8bed\u6cd5\u9ad8\u4eae",
  feature2Desc:
    "\u4f7f\u7528\u7b2c\u4e09\u65b9\u9ad8\u4eae\u7ec4\u4ef6\uff0c\u6309\u8bed\u8a00\u53cb\u597d\u5c55\u793a\u6e90\u7801\u5185\u5bb9\u3002",
  feature3Title: "AI \u8f85\u52a9\u5206\u6790",
  feature3Desc:
    "\u81ea\u52a8\u8bc6\u522b\u4e3b\u8981\u8bed\u8a00\u3001\u6280\u672f\u6808\u6807\u7b7e\u548c\u53ef\u80fd\u7684\u9879\u76ee\u5165\u53e3\u6587\u4ef6\u3002",
} as const;

export default function Home() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  const handleAnalyze = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const normalizedUrl = url.trim();

    if (!normalizedUrl) {
      setError(TEXT.emptyUrl);
      return;
    }

    const parsed = parseGitHubUrl(normalizedUrl);
    if (!parsed) {
      setError(TEXT.invalidUrl);
      return;
    }

    router.push(`/analyze?repo=${parsed.owner}/${parsed.repo}`);
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gray-50 p-4 dark:bg-gray-950">
      <div className="absolute top-1/2 left-1/2 -z-10 h-[800px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/5 blur-3xl dark:bg-blue-500/10" />

      <main className="w-full max-w-2xl space-y-12 text-center">
        <div className="space-y-6">
          <div className="flex justify-center">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <SiGithub className="h-16 w-16 text-gray-900 dark:text-white" />
            </div>
          </div>

          <div className="space-y-4">
            <h1 className="text-4xl font-bold tracking-tight text-gray-900 md:text-5xl dark:text-white">
              {TEXT.title}
            </h1>
            <p className="mx-auto max-w-xl text-lg text-gray-600 dark:text-gray-400">
              {TEXT.subtitle}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-lg dark:border-gray-800 dark:bg-gray-900">
          <form onSubmit={handleAnalyze} className="space-y-4">
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                <Search className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError("");
                }}
                className="block w-full rounded-xl border border-gray-300 bg-gray-50 py-4 pr-4 pl-11 text-lg text-gray-900 transition-shadow focus:border-blue-500 focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                placeholder="https://github.com/facebook/react"
                autoFocus
              />
            </div>

            {error && <p className="px-2 text-left text-sm text-red-500">{error}</p>}

            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-transparent bg-blue-600 px-8 py-4 text-lg font-medium text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none"
            >
              <Code2 className="h-5 w-5" />
              {TEXT.analyze}
            </button>
          </form>
        </div>

        <div className="grid grid-cols-1 gap-6 border-t border-gray-200 pt-8 text-left md:grid-cols-3 dark:border-gray-800">
          <div>
            <h3 className="mb-2 font-semibold text-gray-900 dark:text-white">
              {TEXT.feature1Title}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {TEXT.feature1Desc}
            </p>
          </div>
          <div>
            <h3 className="mb-2 font-semibold text-gray-900 dark:text-white">
              {TEXT.feature2Title}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {TEXT.feature2Desc}
            </p>
          </div>
          <div>
            <h3 className="mb-2 font-semibold text-gray-900 dark:text-white">
              {TEXT.feature3Title}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {TEXT.feature3Desc}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
