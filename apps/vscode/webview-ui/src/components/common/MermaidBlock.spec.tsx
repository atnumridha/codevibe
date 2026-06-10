import { act, render, screen } from "@testing-library/react";
import mermaid from "mermaid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MermaidBlock from "./MermaidBlock";

vi.mock("mermaid", () => ({
	default: {
		initialize: vi.fn(),
		parse: vi.fn(),
		render: vi.fn(),
	},
}));

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {
		openImage: vi.fn(),
	},
}));

const mermaidMock = vi.mocked(mermaid);

describe("MermaidBlock", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		mermaidMock.parse.mockResolvedValue(true);
		mermaidMock.render.mockResolvedValue({
			svg: '<svg viewBox="0 0 100 40"><text>Explore</text></svg>',
			bindFunctions: undefined,
			diagramType: "flowchart",
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("renders a CodeVibe plan diagram with a deterministic Mermaid id", async () => {
		render(
			<MermaidBlock
				code={`flowchart TD
  A[Explore] --> B[Plan]
  B --> C[Patch]`}
			/>,
		);

		expect(screen.getByText("Plan diagram")).toBeInTheDocument();

		await flushMermaidRender();

		expect(mermaidMock.render).toHaveBeenCalledTimes(1);
		const [renderId, renderedCode] = mermaidMock.render.mock.calls[0];
		expect(renderId).toMatch(/^codevibe-mermaid-\d+-[a-z0-9]+$/);
		expect(renderedCode).toContain("A[Explore] --> B[Plan]");

		const diagram = screen.getByLabelText("Rendered CodeVibe plan diagram");
		expect(diagram.querySelector("svg")).not.toBeNull();
		expect(diagram).toHaveTextContent("Explore");
	});

	it("falls back to escaped source when Mermaid cannot render", async () => {
		mermaidMock.parse.mockResolvedValue(false);

		const { container } = render(
			<MermaidBlock code={'flowchart TD\n  A["<script>"] --> B'} />,
		);

		await flushMermaidRender();

		expect(screen.getByRole("status")).toHaveTextContent(
			"Unable to render diagram. Showing source.",
		);

		const fallback = container.querySelector(".mermaid-source-fallback");
		expect(fallback).not.toBeNull();
		expect(fallback).toHaveTextContent('A["<script>"] --> B');
		expect(container.innerHTML).not.toContain("<script>");
	});
});

async function flushMermaidRender() {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(500);
	});
}
