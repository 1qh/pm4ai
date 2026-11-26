import { file, spawn, write } from 'bun'
import { describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const releasePath = join(import.meta.dirname, '..', '..', '..', '..', 'tools', 'release.ts')
const commandShim = `#!/bin/sh
set -eu
root=$(dirname "$(dirname "$0")")
command=$(basename "$0")
printf '%s|%s|%s|%s\n' "$command" "$PWD" "$*" "$NPM_CONFIG_TOKEN" >> "$root/calls"
case "$command" in
  npm)
    case "$2" in
      package-a|package-b) cat "$root/versions.json";;
      *) printf 'E404 Not Found\n' >&2; exit 1;;
    esac;;
  bunx)
    printf 'cleanup stdout\n'
    printf 'cleanup stderr\n' >&2
    case "$PWD" in
      */packages/b) exit "$(cat "$root/cleanup-exit")";;
    esac;;
  git)
    if [ "$1" = tag ]; then exit "$(cat "$root/tag-exit")"; fi;;
esac
`
interface ReleaseScenario {
  cleanupExit: number
  published: boolean
  tagExit: number
}
const writeReleasePackages = async (root: string) => {
  for (const name of ['a', 'b', 'new', 'private'])
    await write(
      join(root, 'packages', name, 'package.json'),
      JSON.stringify({ name: `package-${name}`, private: name === 'private', version: '1.0.0' })
    )
}
const writeCommandShims = async (binDir: string) => {
  for (const name of ['npm', 'bun', 'bunx', 'git', 'gh']) {
    const path = join(binDir, name)
    await write(path, commandShim)
    await chmod(path, 0o755)
  }
}
const writeReleaseSettings = async (root: string, { cleanupExit, published, tagExit }: ReleaseScenario) => {
  await write(join(root, 'package.json'), JSON.stringify({ private: true, workspaces: ['packages/*'] }))
  await write(join(root, 'versions.json'), JSON.stringify([published ? '1.0.0' : '0.9.0']))
  await write(join(root, 'cleanup-exit'), String(cleanupExit))
  await write(join(root, 'tag-exit'), String(tagExit))
}
const makeReleaseFixture = async (scenario: ReleaseScenario) => {
  const tmp = await mkdtemp(join(tmpdir(), 'pm4ai-release-'))
  const root = await realpath(tmp)
  const binDir = join(root, 'bin')
  await mkdir(binDir)
  await writeReleaseSettings(root, scenario)
  await writeReleasePackages(root)
  await writeCommandShims(binDir)
  return { binDir, root }
}
const releaseOrder = (calls: string[]) => {
  const tagIndex = calls.findIndex(c => c.includes('|tag v1.0.0|'))
  const firstCleanup = calls.findIndex(c => c.startsWith('bunx|'))
  const releaseIndex = calls.findIndex(c => c.includes('|release create v1.0.0 '))
  return {
    cleanupAfterRelease: firstCleanup > releaseIndex,
    cleanupAfterTag: firstCleanup > tagIndex,
    publishCount: calls.filter(c => c.startsWith('bun|')).length,
    releaseAfterTag: releaseIndex > tagIndex,
    tagFound: tagIndex !== -1
  }
}
const runReleaseFixture = async (scenario: ReleaseScenario) => {
  const { binDir, root } = await makeReleaseFixture(scenario)
  try {
    const proc = spawn([process.execPath, releasePath], {
      cwd: root,
      env: { ...process.env, NPM_CONFIG_TOKEN: 'fixture-token', PATH: `${binDir}:/usr/bin:/bin` },
      stderr: 'pipe',
      stdin: 'ignore',
      stdout: 'pipe',
      timeout: 15_000
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text()
    ])
    const calls = (await file(join(root, 'calls')).text()).trim().split('\n')
    return { calls, exitCode, root, stderr, stdout }
  } finally {
    await rm(root, { recursive: true })
  }
}
describe('release cleanup', () => {
  test.each([
    { cleanupExit: 0, published: true, tagExit: 0 },
    { cleanupExit: 0, published: false, tagExit: 0 },
    { cleanupExit: 0, published: false, tagExit: 1 },
    { cleanupExit: 7, published: true, tagExit: 0 }
  ])(
    'runs package cleanup for $published / $tagExit / $cleanupExit',
    async scenario => {
      const result = await runReleaseFixture(scenario)
      const cleanups = result.calls.filter(c => c.startsWith('bunx|'))
      expect(cleanups.toSorted((a, b) => a.localeCompare(b))).toStrictEqual([
        `bunx|${result.root}/packages/a|pm4ai@latest cleanup|fixture-token`,
        `bunx|${result.root}/packages/b|pm4ai@latest cleanup|fixture-token`
      ])
      expect({
        exitCode: result.exitCode,
        stderr: result.stderr.includes('cleanup stderr'),
        stdout: result.stdout.includes('cleanup stdout')
      }).toStrictEqual({
        exitCode: scenario.cleanupExit !== 0 || scenario.tagExit !== 0 ? 1 : 0,
        stderr: true,
        stdout: true
      })
      if (scenario.published) expect(result.calls.some(c => c.startsWith('bun|') || c.startsWith('git|'))).toBe(false)
      else {
        const order = releaseOrder(result.calls)
        expect({
          cleanupAfterTag: order.cleanupAfterTag,
          publishCount: order.publishCount,
          tagFound: order.tagFound
        }).toStrictEqual({ cleanupAfterTag: true, publishCount: 2, tagFound: true })
        if (scenario.tagExit === 0)
          expect({
            cleanupAfterRelease: order.cleanupAfterRelease,
            releaseAfterTag: order.releaseAfterTag
          }).toStrictEqual({ cleanupAfterRelease: true, releaseAfterTag: true })
      }
    },
    30_000
  )
})
