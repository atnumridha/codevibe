import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { normalizeMcpMarketplaceCatalog } from "../mcp"

describe("MCP marketplace normalization", () => {
	it("keeps compatibility identifiers while branding visible text for CodeVibe", () => {
		const catalog = normalizeMcpMarketplaceCatalog({
			items: [
				{
					mcpId: "github.com/test/sendgrid",
					name: "Cline SendGrid",
					author: "Test",
					description: "Ask Cline's SendGrid agent to inspect campaigns",
					readmeContent: "Install this server in Cline and ask cline to send a report.",
					llmsInstallationContent: "Configure Cline before launch.",
					githubStars: undefined as unknown as number,
					downloadCount: undefined as unknown as number,
					tags: undefined as unknown as string[],
					githubUrl: "https://github.com/test/sendgrid",
					codiconIcon: "mail",
					logoUrl: "https://storage.googleapis.com/cline_public_images/sendgrid.png",
					category: "marketing",
					requiresApiKey: false,
					isRecommended: false,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
					lastGithubSync: "2024-01-01T00:00:00Z",
				},
			],
		})

		assert.equal(catalog.items[0].mcpId, "github.com/test/sendgrid")
		assert.equal(
			catalog.items[0].logoUrl,
			"https://storage.googleapis.com/cline_public_images/sendgrid.png",
		)
		assert.equal(catalog.items[0].name, "CodeVibe SendGrid")
		assert.equal(
			catalog.items[0].description,
			"Ask CodeVibe's SendGrid agent to inspect campaigns",
		)
		assert.equal(
			catalog.items[0].readmeContent,
			"Install this server in CodeVibe and ask CodeVibe to send a report.",
		)
		assert.equal(
			catalog.items[0].llmsInstallationContent,
			"Configure CodeVibe before launch.",
		)
		assert.equal(catalog.items[0].githubStars, 0)
		assert.equal(catalog.items[0].downloadCount, 0)
		assert.deepEqual(catalog.items[0].tags, [])
	})
})
