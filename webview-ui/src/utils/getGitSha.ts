// kilocode_change - new file
import fs from "fs"
import path from "path"
import { execSync } from "child_process"

const readTextFile = (filePath: string): string | undefined => {
	try {
		return fs.readFileSync(filePath, "utf8").trim()
	} catch {
		return undefined
	}
}

const resolveGitDir = (repoPath: string): string | undefined => {
	const dotGitPath = path.join(repoPath, ".git")

	try {
		const stat = fs.statSync(dotGitPath)
		if (stat.isDirectory()) {
			return dotGitPath
		}
		if (!stat.isFile()) {
			return undefined
		}
	} catch {
		return undefined
	}

	const dotGitContent = readTextFile(dotGitPath)
	if (!dotGitContent) {
		return undefined
	}

	const gitDirMatch = dotGitContent.match(/^gitdir:\s*(.+)$/i)
	if (!gitDirMatch?.[1]) {
		return undefined
	}

	return path.isAbsolute(gitDirMatch[1]) ? gitDirMatch[1] : path.resolve(repoPath, gitDirMatch[1])
}

const resolvePackedRefSha = (gitDir: string, refName: string): string | undefined => {
	const packedRefs = readTextFile(path.join(gitDir, "packed-refs"))
	if (!packedRefs) {
		return undefined
	}

	for (const line of packedRefs.split(/\r?\n/)) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("^")) {
			continue
		}

		const [sha, ref] = trimmed.split(" ")
		if (ref === refName && sha) {
			return sha
		}
	}

	return undefined
}

const resolveGitShaFromFiles = (repoPath: string): string | undefined => {
	const gitDir = resolveGitDir(repoPath)
	if (!gitDir) {
		return undefined
	}

	const headContent = readTextFile(path.join(gitDir, "HEAD"))
	if (!headContent) {
		return undefined
	}

	if (!headContent.startsWith("ref:")) {
		return headContent
	}

	const refName = headContent.slice(4).trim()
	if (!refName) {
		return undefined
	}

	return readTextFile(path.join(gitDir, refName)) ?? resolvePackedRefSha(gitDir, refName)
}

export const getGitSha = (repoPath: string): string | undefined => {
	const gitShaFromFiles = resolveGitShaFromFiles(repoPath)
	if (gitShaFromFiles) {
		return gitShaFromFiles
	}

	try {
		return execSync("git rev-parse HEAD", {
			cwd: repoPath,
			stdio: ["ignore", "pipe", "ignore"],
		})
			.toString()
			.trim()
	} catch {
		return undefined
	}
}
