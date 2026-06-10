import { StringRequest } from "@shared/proto/cline/common";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import mermaid from "mermaid";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { FileServiceClient } from "@/services/grpc-client";
import { useDebounceEffect } from "@/utils/useDebounceEffect";

const MERMAID_THEME = {
	background: "#1e1e1e", // VS Code dark theme background
	textColor: "#ffffff", // Main text color
	mainBkg: "#2d2d2d", // Background for nodes
	nodeBorder: "#888888", // Border color for nodes
	lineColor: "#cccccc", // Lines connecting nodes
	primaryColor: "#3c3c3c", // Primary color for highlights
	primaryTextColor: "#ffffff", // Text in primary colored elements
	primaryBorderColor: "#888888",
	secondaryColor: "#2d2d2d", // Secondary color for alternate elements
	tertiaryColor: "#454545", // Third color for special elements

	// Class diagram specific
	classText: "#ffffff",

	// State diagram specific
	labelColor: "#ffffff",

	// Sequence diagram specific
	actorLineColor: "#cccccc",
	actorBkg: "#2d2d2d",
	actorBorder: "#888888",
	actorTextColor: "#ffffff",

	// Flow diagram specific
	fillType0: "#2d2d2d",
	fillType1: "#3c3c3c",
	fillType2: "#454545",
};

mermaid.initialize({
	startOnLoad: false,
	securityLevel: "strict",
	theme: "dark",
	themeVariables: {
		...MERMAID_THEME,
		fontSize: "16px",
		fontFamily:
			"var(--vscode-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif)",

		// Additional styling
		noteTextColor: "#ffffff",
		noteBkgColor: "#454545",
		noteBorderColor: "#888888",

		// Improve contrast for special elements
		critBorderColor: "#ff9580",
		critBkgColor: "#803d36",

		// Task diagram specific
		taskTextColor: "#ffffff",
		taskTextOutsideColor: "#ffffff",
		taskTextLightColor: "#ffffff",

		// Numbers/sections
		sectionBkgColor: "#2d2d2d",
		sectionBkgColor2: "#3c3c3c",

		// Alt sections in sequence diagrams
		altBackground: "#2d2d2d",

		// Links
		linkColor: "#6cb6ff",

		// Borders and lines
		compositeBackground: "#2d2d2d",
		compositeBorder: "#888888",
		titleColor: "#ffffff",
	},
});

interface MermaidBlockProps {
	code: string;
}

let nextMermaidInstanceId = 0;

export default function MermaidBlock({ code }: MermaidBlockProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const copyTimerRef = useRef<number | undefined>(undefined);
	const instanceIdRef = useRef<number | undefined>(undefined);
	const [isLoading, setIsLoading] = useState(false);
	const [renderError, setRenderError] = useState<string | undefined>(undefined);
	const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
		"idle",
	);

	if (instanceIdRef.current === undefined) {
		instanceIdRef.current = nextMermaidInstanceId++;
	}

	// 1) Whenever `code` changes, mark that we need to re-render a new chart
	useEffect(() => {
		setIsLoading(true);
		setRenderError(undefined);
		setCopyStatus("idle");
	}, [code]);

	useEffect(() => {
		return () => {
			if (copyTimerRef.current) {
				window.clearTimeout(copyTimerRef.current);
			}
		};
	}, []);

	// 2) Debounce the actual parse/render
	useDebounceEffect(
		() => {
			if (containerRef.current) {
				containerRef.current.innerHTML = "";
			}
			mermaid
				.parse(code, { suppressErrors: true })
				.then((isValid) => {
					if (!isValid) {
						throw new Error("Invalid or incomplete Mermaid code");
					}
					const id = getMermaidRenderId(code, instanceIdRef.current ?? 0);
					return mermaid.render(id, code);
				})
				.then(({ svg }) => {
					if (containerRef.current) {
						containerRef.current.innerHTML = svg;
					}
					setRenderError(undefined);
				})
				.catch((err) => {
					console.warn("Mermaid parse/render failed:", err);
					if (containerRef.current) {
						containerRef.current.innerHTML = `<pre class="mermaid-source-fallback">${escapeHtml(code)}</pre>`;
					}
					setRenderError("Unable to render diagram. Showing source.");
				})
				.finally(() => {
					setIsLoading(false);
				});
		},
		500, // Delay 500ms
		[code], // Dependencies for scheduling
	);

	/**
	 * Called when user clicks the rendered diagram.
	 * Converts the <svg> to a PNG and sends it to the extension.
	 */
	const handleOpenImage = async () => {
		if (!containerRef.current) {
			return;
		}
		const svgEl = containerRef.current.querySelector("svg");
		if (!svgEl) {
			return;
		}

		try {
			const pngDataUrl = await svgToPng(svgEl);
			FileServiceClient.openImage(
				StringRequest.create({ value: pngDataUrl }),
			).catch((err) => console.error("Failed to open image:", err));
		} catch (err) {
			console.error("Error converting SVG to PNG:", err);
		}
	};

	const handleCopyCode = async () => {
		try {
			await navigator.clipboard.writeText(code);
			setCopyStatus("copied");
		} catch (err) {
			console.error("Copy failed", err);
			setCopyStatus("failed");
		} finally {
			if (copyTimerRef.current) {
				window.clearTimeout(copyTimerRef.current);
			}
			copyTimerRef.current = window.setTimeout(
				() => setCopyStatus("idle"),
				1_500,
			);
		}
	};

	return (
		<MermaidBlockContainer data-testid="codevibe-mermaid-block">
			<DiagramHeader>
				<DiagramTitle>
					<span className="codicon codicon-type-hierarchy-sub" />
					<span>Plan diagram</span>
				</DiagramTitle>
				<ButtonContainer aria-label="Diagram actions">
					<StyledVSCodeButton
						aria-label={
							copyStatus === "copied"
								? "Mermaid source copied"
								: "Copy Mermaid source"
						}
						onClick={handleCopyCode}
						title={
							copyStatus === "copied"
								? "Copied"
								: copyStatus === "failed"
									? "Copy failed"
									: "Copy Mermaid source"
						}
					>
						<span className="codicon codicon-copy"></span>
					</StyledVSCodeButton>
					<StyledVSCodeButton
						aria-label="Open Mermaid diagram as image"
						onClick={handleOpenImage}
						title="Open Mermaid diagram as image"
					>
						<span className="codicon codicon-open-preview"></span>
					</StyledVSCodeButton>
				</ButtonContainer>
			</DiagramHeader>
			{isLoading && (
				<LoadingMessage aria-live="polite">Rendering diagram...</LoadingMessage>
			)}
			{renderError && <ErrorMessage role="status">{renderError}</ErrorMessage>}
			<SvgContainer
				$isLoading={isLoading}
				aria-label="Rendered CodeVibe plan diagram"
				onClick={handleOpenImage}
				ref={containerRef}
				role="img"
			/>
		</MermaidBlockContainer>
	);
}

function getMermaidRenderId(code: string, instanceId: number): string {
	return `codevibe-mermaid-${instanceId}-${hashMermaidCode(code)}`;
}

function hashMermaidCode(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

async function svgToPng(svgEl: SVGElement): Promise<string> {
	// Clone the SVG to avoid modifying the original
	const svgClone = svgEl.cloneNode(true) as SVGElement;

	// Get the original viewBox
	const viewBox =
		svgClone.getAttribute("viewBox")?.split(" ").map(Number) || [];
	const originalWidth = viewBox[2] || svgClone.clientWidth;
	const originalHeight = viewBox[3] || svgClone.clientHeight;

	// Calculate the scale factor to fit editor width while maintaining aspect ratio

	// Unless we can find a way to get the actual editor window dimensions through the VS Code API (which might be possible but would require changes to the extension side),
	// the fixed width seems like a reliable approach.
	const editorWidth = 3_600;

	const scale = editorWidth / originalWidth;
	const scaledHeight = originalHeight * scale;

	// Update SVG dimensions
	svgClone.setAttribute("width", `${editorWidth}`);
	svgClone.setAttribute("height", `${scaledHeight}`);

	const serializer = new XMLSerializer();
	const svgString = serializer.serializeToString(svgClone);
	const encoder = new TextEncoder();
	const bytes = encoder.encode(svgString);
	const base64 = btoa(
		Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""),
	);
	const svgDataUrl = `data:image/svg+xml;base64,${base64}`;

	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => {
			const canvas = document.createElement("canvas");
			canvas.width = editorWidth;
			canvas.height = scaledHeight;

			const ctx = canvas.getContext("2d");
			if (!ctx) {
				return reject("Canvas context not available");
			}

			// Fill background with Mermaid's dark theme background color
			ctx.fillStyle = MERMAID_THEME.background;
			ctx.fillRect(0, 0, canvas.width, canvas.height);

			ctx.imageSmoothingEnabled = true;
			ctx.imageSmoothingQuality = "high";

			ctx.drawImage(img, 0, 0, editorWidth, scaledHeight);
			resolve(canvas.toDataURL("image/png", 1.0));
		};
		img.onerror = reject;
		img.src = svgDataUrl;
	});
}

const MermaidBlockContainer = styled.div`
	position: relative;
	box-sizing: border-box;
	margin: 10px 0;
	border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
	border-radius: 8px;
	background: color-mix(
		in srgb,
		var(--vscode-editor-background) 88%,
		var(--vscode-sideBar-background)
	);
	overflow: hidden;
`;

const DiagramHeader = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 7px 8px 7px 10px;
	border-bottom: 1px solid
		color-mix(in srgb, var(--vscode-panel-border) 72%, transparent);
	background: color-mix(
		in srgb,
		var(--vscode-editorWidget-background) 72%,
		var(--vscode-editor-background)
	);
`;

const DiagramTitle = styled.div`
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
	color: var(--vscode-foreground);
	font-size: 12px;
	font-weight: 600;

	.codicon {
		color: var(--vscode-charts-blue);
		font-size: 14px;
	}
`;

const ButtonContainer = styled.div`
	display: flex;
	flex: 0 0 auto;
	gap: 4px;
`;

const LoadingMessage = styled.div`
	padding: 9px 12px 0;
	color: var(--vscode-descriptionForeground);
	font-size: 12px;
`;

const ErrorMessage = styled.div`
	margin: 8px 10px 0;
	padding: 7px 9px;
	border: 1px solid var(--vscode-inputValidation-warningBorder);
	border-radius: 6px;
	background: color-mix(
		in srgb,
		var(--vscode-inputValidation-warningBackground) 34%,
		transparent
	);
	color: var(--vscode-inputValidation-warningForeground);
	font-size: 12px;
`;

interface SvgContainerProps {
	$isLoading: boolean;
}

const SvgContainer = styled.div<SvgContainerProps>`
	opacity: ${(props) => (props.$isLoading ? 0.35 : 1)};
	min-height: 96px;
	max-width: 100%;
	padding: 14px 12px 16px;
	overflow: auto;
	transition: opacity 0.2s ease;
	cursor: zoom-in;
	display: flex;
	justify-content: center;

	svg {
		max-width: 100%;
		height: auto;
	}

	.mermaid-source-fallback {
		box-sizing: border-box;
		width: 100%;
		margin: 0;
		padding: 10px 12px;
		overflow: auto;
		border: 1px solid var(--vscode-inputValidation-warningBorder);
		border-radius: 6px;
		background: var(--vscode-textCodeBlock-background);
		color: var(--vscode-editor-foreground);
		white-space: pre-wrap;
	}
`;

const StyledVSCodeButton = styled(VSCodeButton)`
	box-sizing: border-box;
	padding: 0;
	height: 24px;
	width: 24px;
	min-width: unset;
	background-color: var(--vscode-button-secondaryBackground);
	color: var(--vscode-button-secondaryForeground);
	border: 1px solid var(--vscode-button-border);
	border-radius: 3px;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: all 0.2s ease;

	.codicon {
		font-size: 14px;
	}

	&:hover {
		background-color: var(--vscode-button-secondaryHoverBackground);
		border-color: var(--vscode-button-border);
		transform: translateY(-1px);
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
	}

	&:active {
		transform: translateY(0);
		box-shadow: none;
	}
`;
