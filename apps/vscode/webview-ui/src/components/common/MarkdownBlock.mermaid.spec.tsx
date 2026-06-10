import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MarkdownBlock from "./MarkdownBlock";

vi.mock("@/components/common/MermaidBlock", () => ({
	default: ({ code }: { code: string }) => (
		<div data-testid="mermaid-block">{code}</div>
	),
}));

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {
		openImage: vi.fn(),
		openFile: vi.fn(),
	},
	StateServiceClient: {
		togglePlanActModeProto: vi.fn(),
	},
}));

describe("MarkdownBlock Mermaid rendering", () => {
	it("routes fenced mermaid code blocks to the diagram renderer", async () => {
		render(
			<MarkdownBlock
				markdown={`Visual plan:

\`\`\`mermaid
flowchart TD
  A[Explore] --> B[Plan]
  B --> C[Patch]
\`\`\``}
			/>,
		);

		const diagram = await screen.findByTestId("mermaid-block");
		expect(diagram).toHaveTextContent("flowchart TD");
		expect(diagram).toHaveTextContent("A[Explore] --> B[Plan]");
		expect(screen.queryByText(/flowchart TD/)).toBe(diagram);
	});
});
