import { expect } from "chai"
import { describe, it } from "mocha"
import {
	normalizeGitBranchName,
	normalizeGitCheckoutTarget,
	normalizeGitCommitMessage,
} from "../git-helper"

function expectOk(result: ReturnType<typeof normalizeGitBranchName>): string {
	if (!result.ok) {
		throw new Error(`expected valid git helper input, got: ${result.error}`)
	}
	return result.value
}

describe("git-helper", () => {
	describe("normalizeGitBranchName", () => {
		it("accepts normal local and remote-style branch names", () => {
			expect(expectOk(normalizeGitBranchName(" feature/cursor-parity "))).to.equal("feature/cursor-parity")
			expect(expectOk(normalizeGitBranchName("origin/main"))).to.equal("origin/main")
		})

		it("rejects option-looking and reflog-style branch names", () => {
			const optionResult = normalizeGitBranchName("--detach")
			const reflogResult = normalizeGitBranchName("main@{1}")

			expect(optionResult.ok).to.equal(false)
			expect(reflogResult.ok).to.equal(false)
		})

		it("rejects symbolic refs for branch creation or checkout", () => {
			const result = normalizeGitBranchName("HEAD")

			expect(result.ok).to.equal(false)
		})
	})

	describe("normalizeGitCheckoutTarget", () => {
		it("allows symbolic refs and commit-like hashes for reviewed checkout flows", () => {
			expect(expectOk(normalizeGitCheckoutTarget("HEAD"))).to.equal("HEAD")
			expect(expectOk(normalizeGitCheckoutTarget("abc1234"))).to.equal("abc1234")
		})

		it("rejects unsafe checkout targets", () => {
			const result = normalizeGitCheckoutTarget("feature;git-reset")

			expect(result.ok).to.equal(false)
		})
	})

	describe("normalizeGitCommitMessage", () => {
		it("trims non-empty commit messages", () => {
			expect(expectOk(normalizeGitCommitMessage(" fix: add helper parity "))).to.equal("fix: add helper parity")
		})

		it("rejects empty commit messages", () => {
			const result = normalizeGitCommitMessage("   ")

			expect(result.ok).to.equal(false)
		})
	})
})
