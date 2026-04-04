interface Issue {
  detail: string
  type: IssueType
}
type IssueType =
  | 'bun'
  | 'ci'
  | 'dep'
  | 'deploy'
  | 'drift'
  | 'duplicate'
  | 'error'
  | 'file'
  | 'forbidden'
  | 'git'
  | 'info'
  | 'lintmax'
  | 'missing'
  | 'synced'
  | 'up.sh'
interface PackageJson {
  bin?: unknown
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  exports?: unknown
  files?: string[]
  license?: string
  main?: string
  name?: string
  packageManager?: string
  peerDependencies?: Record<string, string>
  private?: boolean
  repository?: unknown
  scripts?: Record<string, string>
  'simple-git-hooks'?: Record<string, string>
  type?: string
  workspaces?: string[]
}
export type { Issue, IssueType, PackageJson }
