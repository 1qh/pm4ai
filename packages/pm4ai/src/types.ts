type DepField = 'dependencies' | 'devDependencies' | 'peerDependencies'
interface Issue {
  detail: string
  type: IssueType
}
type IssueType =
  | 'bun'
  | 'check'
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
  | 'unused'
  | 'up.sh'
interface PackageJson {
  bin?: Record<string, string> | string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  exports?: Record<string, Record<string, string> | string>
  files?: string[]
  license?: string
  main?: string
  name?: string
  packageManager?: string
  peerDependencies?: Record<string, string>
  private?: boolean
  repository?: { directory?: string; type?: string; url?: string }
  scripts?: Record<string, string>
  'simple-git-hooks'?: Record<string, string>
  trustedDependencies?: string[]
  type?: string
  workspaces?: string[]
}
const DEP_FIELDS: DepField[] = ['dependencies', 'devDependencies']
const ALL_DEP_FIELDS: DepField[] = ['dependencies', 'devDependencies', 'peerDependencies']
export { ALL_DEP_FIELDS, DEP_FIELDS }
export type { DepField, Issue, IssueType, PackageJson }
