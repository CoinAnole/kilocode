// kilocode_change - new file
import fs from "fs"
import os from "os"
import path from "path"
import { getGitSha } from "../getGitSha"

const makeTempRepo = () => fs.mkdtempSync(path.join(os.tmpdir(), "kilo-git-sha-test-"))

describe("getGitSha", () => {
	it("returns direct HEAD commit when HEAD contains a SHA", () => {
		const repoPath = makeTempRepo()
		try {
			const gitDir = path.join(repoPath, ".git")
			fs.mkdirSync(gitDir, { recursive: true })
			fs.writeFileSync(path.join(gitDir, "HEAD"), "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n")

			expect(getGitSha(repoPath)).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
		} finally {
			fs.rmSync(repoPath, { recursive: true, force: true })
		}
	})

	it("returns SHA from referenced ref file", () => {
		const repoPath = makeTempRepo()
		try {
			const gitDir = path.join(repoPath, ".git")
			const refPath = path.join(gitDir, "refs", "heads")
			fs.mkdirSync(refPath, { recursive: true })
			fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n")
			fs.writeFileSync(path.join(refPath, "main"), "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n")

			expect(getGitSha(repoPath)).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
		} finally {
			fs.rmSync(repoPath, { recursive: true, force: true })
		}
	})

	it("returns SHA from packed-refs when loose ref is missing", () => {
		const repoPath = makeTempRepo()
		try {
			const gitDir = path.join(repoPath, ".git")
			fs.mkdirSync(gitDir, { recursive: true })
			fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n")
			fs.writeFileSync(
				path.join(gitDir, "packed-refs"),
				"# pack-refs with: peeled fully-peeled sorted\ncccccccccccccccccccccccccccccccccccccccc refs/heads/main\n",
			)

			expect(getGitSha(repoPath)).toBe("cccccccccccccccccccccccccccccccccccccccc")
		} finally {
			fs.rmSync(repoPath, { recursive: true, force: true })
		}
	})

	it("supports worktree-style .git files that point to a gitdir", () => {
		const repoPath = makeTempRepo()
		const actualGitDir = makeTempRepo()
		try {
			fs.writeFileSync(path.join(repoPath, ".git"), `gitdir: ${actualGitDir}\n`)
			fs.mkdirSync(actualGitDir, { recursive: true })
			fs.writeFileSync(path.join(actualGitDir, "HEAD"), "dddddddddddddddddddddddddddddddddddddddd\n")

			expect(getGitSha(repoPath)).toBe("dddddddddddddddddddddddddddddddddddddddd")
		} finally {
			fs.rmSync(repoPath, { recursive: true, force: true })
			fs.rmSync(actualGitDir, { recursive: true, force: true })
		}
	})
})
