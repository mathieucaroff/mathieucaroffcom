export interface GitHubRepo {
  id: number
  name: string
  description: string | null
  html_url: string
  homepage: string | null
  created_at: string
  updated_at: string
  pushed_at: string
  topics: string[]
  languages_url: string
  default_branch: string
  fork: boolean
  archived: boolean
}

export interface RepoLanguages {
  [key: string]: number
}

export interface Project {
  id: number
  title: string
  description: string
  repoUrl: string
  liveUrl: string | null
  createdAt: Date
  updatedAt: Date
  topics: string[]
  languages: string[]
  imageUrl: string | null
  archived: boolean
}

const GITHUB_API = "https://api.github.com"
const EXCLUDE_KEYWORD_LIST = ["UNLISTED", "EMPTY"]

function extractFirstImageFromMarkdown(
  markdown: string,
  repoUrl: string,
  branch: string,
): string | null {
  // Find both markdown and HTML images with their positions
  const mdImageMatch = markdown.match(/!\[.*?\]\((.*?)\)/)
  const htmlImageMatch = markdown.match(/<img[^>]+src=["']([^"']+)["']/)

  const mdPosition = mdImageMatch ? markdown.indexOf(mdImageMatch[0]) : Infinity
  const htmlPosition = htmlImageMatch
    ? markdown.indexOf(htmlImageMatch[0])
    : Infinity

  // Determine which image comes first
  let imageUrl: string | null = null

  if (mdPosition < htmlPosition && mdImageMatch) {
    imageUrl = mdImageMatch[1].trim()
  } else if (htmlImageMatch) {
    imageUrl = htmlImageMatch[1].trim()
  }

  if (!imageUrl) {
    return null
  }

  // Convert relative URLs to absolute
  if (
    imageUrl.startsWith("./") ||
    imageUrl.startsWith("../") ||
    !imageUrl.includes("://")
  ) {
    imageUrl = imageUrl.replace(/^\.\//, "")
    const repoPath = repoUrl.replace("https://github.com/", "")
    imageUrl = `https://raw.githubusercontent.com/${repoPath}/${branch}/${imageUrl}`
  }

  return imageUrl
}

export async function fetchGitHubProjects(
  username: string,
  token?: string,
): Promise<Project[]> {
  // Fetch all public repositories
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  }

  if (token) {
    headers.Authorization = `token ${token}`
  }

  const reposResponse = await fetch(
    `${GITHUB_API}/users/${username}/repos?type=public&per_page=100&sort=updated`,
    {
      headers,
    },
  )

  if (!reposResponse.ok) {
    throw new Error(`Failed to fetch repositories: ${reposResponse.statusText}`)
  }

  const repos: GitHubRepo[] = await reposResponse.json()

  // Filter out forked repositories
  const nonForkedRepos = repos.filter((repo) => !repo.fork)

  // Filter out repositories containing excluded keywords
  const filteredRepos = nonForkedRepos.filter((repo) => {
    return !EXCLUDE_KEYWORD_LIST.some((keyword) =>
      repo.description?.includes(keyword),
    )
  })

  // Fetch languages for each repository
  const projects = await Promise.all(
    filteredRepos.map(async (repo) => {
      const languagesResponse = await fetch(repo.languages_url, {
        headers,
      })

      const languages: RepoLanguages = languagesResponse.ok
        ? await languagesResponse.json()
        : {}

      // Calculate total bytes and filter languages >= 10%
      const totalBytes = Object.values(languages).reduce(
        (sum, bytes) => sum + bytes,
        0,
      )
      const significantLanguages = Object.entries(languages)
        .filter(([_, bytes]) => bytes / totalBytes >= 0.1)
        .map(([lang, _]) => lang)
        .sort()

      // Fetch README to extract first image
      let imageUrl: string | null = null
      try {
        const readmeResponse = await fetch(
          `${GITHUB_API}/repos/${username}/${repo.name}/readme`,
          { headers },
        )
        if (readmeResponse.ok) {
          const readmeData = await readmeResponse.json()
          // README content is base64 encoded
          const readmeContent = atob(readmeData.content)
          imageUrl = extractFirstImageFromMarkdown(
            readmeContent,
            repo.html_url,
            repo.default_branch,
          )
        }
      } catch (error) {
        // Ignore errors fetching README
        console.warn(`Failed to fetch README for ${repo.name}:`, error)
      }

      return {
        id: repo.id,
        title: repo.name,
        description: repo.description || "",
        repoUrl: repo.html_url,
        liveUrl: repo.homepage || null,
        createdAt: new Date(repo.created_at),
        updatedAt: new Date(repo.pushed_at || repo.updated_at),
        topics: repo.topics || [],
        languages: significantLanguages,
        imageUrl,
        archived: repo.archived,
      }
    }),
  )

  return projects
}
