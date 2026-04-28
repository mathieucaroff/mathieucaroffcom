export interface GitHubRepo {
  id: number
  owner: {
    login: string
  }
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
  liveUrl: string
  createdAt: Date
  updatedAt: Date
  topics: string[]
  languages: string[]
  imageUrl: string
  archived: boolean
}

const GITHUB_API = "https://api.github.com"
const EXCLUDE_KEYWORD_LIST = ["UNLISTED", "EMPTY"]
const EXTRA_REPOSITORIES = [
  { owner: "mathieucaroff", name: "lidy" },
  { owner: "mathieucaroff", name: "ponyTranslator" },
  { owner: "ditrit", name: "specimen" },
]

function extractFirstImageFromMarkdown(
  markdown: string,
  repoUrl: string,
  branch: string,
): string {
  // Find both markdown and HTML images with their positions
  const mdImageMatch = markdown.match(/!\[.*?\]\((.*?)\)/)
  const htmlImageMatch = markdown.match(/<img[^>]+src=["']([^"']+)["']/)

  const mdPosition = mdImageMatch ? markdown.indexOf(mdImageMatch[0]) : Infinity
  const htmlPosition = htmlImageMatch
    ? markdown.indexOf(htmlImageMatch[0])
    : Infinity

  // Determine which image comes first
  let imageUrl: string = ""

  if (mdPosition < htmlPosition && mdImageMatch) {
    imageUrl = mdImageMatch[1].trim()
  } else if (htmlImageMatch) {
    imageUrl = htmlImageMatch[1].trim()
  }

  if (!imageUrl) {
    return ""
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

  const extraRepos = await Promise.all(
    EXTRA_REPOSITORIES.map(async ({ owner, name }) => {
      const { Authorization: _, ...tokenlessHeaders } = headers
      const extraRepoResponse = await fetch(
        `${GITHUB_API}/repos/${owner}/${name}`,
        {
          headers: tokenlessHeaders,
        },
      )

      if (!extraRepoResponse.ok) {
        console.log(`${GITHUB_API}/repos/${owner}/${name}`)
        console.log(headers)

        const repo = `${owner}/${name}`
        const code = extraRepoResponse.status
        const text = extraRepoResponse.statusText
        throw new Error(`Failed to fetch repository ${repo}: ${code} ${text}`)
      }

      return (await extraRepoResponse.json()) as GitHubRepo
    }),
  )

  const reposByFullName = new Map<string, GitHubRepo>()
  for (const repo of [...repos, ...extraRepos]) {
    reposByFullName.set(`${repo.owner.login}/${repo.name}`.toLowerCase(), repo)
  }

  const mergedRepos = [...reposByFullName.values()]

  // Filter out forked repositories
  const nonForkedRepos = mergedRepos.filter((repo) => {
    const isExplicitlyIncluded = EXTRA_REPOSITORIES.some(
      ({ owner, name }) =>
        repo.owner.login.toLowerCase() === owner.toLowerCase() &&
        repo.name.toLowerCase() === name.toLowerCase(),
    )

    return !repo.fork || isExplicitlyIncluded
  })

  // Filter out repositories containing excluded keywords
  const filteredRepos = nonForkedRepos.filter((repo) => {
    return !EXCLUDE_KEYWORD_LIST.some((keyword) =>
      repo.description?.includes(keyword),
    )
  })

  // Fetch languages for each repository
  const projects = await Promise.all(
    filteredRepos.map(async (repo): Promise<Project> => {
      const liveUrl = repo.homepage?.match(
        /^https?:[/][/](mathieucaroff.com|[^/]*\.(ea9c.com|vercel.app))/,
      )
        ? repo.homepage
        : ""

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
      let imageUrl: string = ""
      try {
        const readmeResponse = await fetch(
          `${GITHUB_API}/repos/${repo.owner.login}/${repo.name}/readme`,
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
        liveUrl,
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
