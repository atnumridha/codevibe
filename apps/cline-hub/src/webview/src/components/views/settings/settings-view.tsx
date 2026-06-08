"use client";

import {
	ArrowDown,
	ArrowUp,
	AlertTriangle,
	Camera,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Globe2,
	Keyboard,
	Link2,
	Loader2,
	MousePointerClick,
	Moon,
	Play,
	RefreshCw,
	Sun,
	X,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
	desktopClient,
	type BrowserAutomationStatus,
	type BrowserToolResult,
	type CursorAutomationIngestResponse,
	type CursorGitActionResponse,
	type CursorMcpInstallResponse,
	type CursorPluginAddResponse,
	type CursorRuleOpenResponse,
	type CursorUriLaunchResponse,
	type CursorUriPreviewResponse,
} from "@/lib/desktop-client";
import type {
	Provider,
	ProviderCatalogResponse,
	ProviderModelsResponse,
	ProviderSettingsUpdate,
} from "@/lib/provider-schema";
import { cn } from "@/lib/utils";
import { AccountView } from "./account-view";
import { AddProviderContent, type AddProviderPayload } from "./add-provider";
import { ChannelsContent } from "./channels-view";
import { RulesView } from "./extensions-view";
import { McpServersContent } from "./mcp-view";
import {
	ProviderDetailContent,
	ProviderListContent,
} from "./provider-list-view";
import { RoutineSchedulesContent } from "./routine-view";
import { toSettingsPatch } from "./settings-patch";

// -----------------------------------------------------------
// Settings nav categories
// -----------------------------------------------------------

const navCategories = [
	"General",
	"Providers",
	"Customizations",
	"MCP",
	"Cursor Links",
	"Channels",
	"Schedules",
	"Account",
] as const;

export type SettingsSection = (typeof navCategories)[number];
type Theme = "dark" | "light";
type GlobalSettingsResponse = {
	telemetryOptOut: boolean;
};
type CursorLaunchMode = "plan" | "act";
type CursorLaunchDelivery = "queue" | "steer";

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function recordString(
	record: Record<string, unknown> | undefined,
	key: string,
): string {
	const value = record?.[key];
	return typeof value === "string" ? value.trim() : "";
}

function recordBoolean(
	record: Record<string, unknown> | undefined,
	key: string,
): boolean | undefined {
	const value = record?.[key];
	return typeof value === "boolean" ? value : undefined;
}

function recordStringArray(
	record: Record<string, unknown> | undefined,
	key: string,
): string[] {
	const value = record?.[key];
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((entry) => (typeof entry === "string" ? entry.trim() : ""))
		.filter(Boolean);
}

function browserResultSummary(result: BrowserToolResult | undefined): string {
	if (!result) {
		return "";
	}
	if (!result.success) {
		return result.error ?? "Browser command failed.";
	}
	const payload = asRecord(result.result);
	const title = recordString(payload, "title");
	const url = recordString(payload, "url");
	const logs = recordString(payload, "logs");
	return [title, url, logs ? "logs" : ""].filter(Boolean).join(" | ");
}

function cursorSettingsSectionFromPreview(
	previewRecord: Record<string, unknown> | undefined,
): SettingsSection {
	const sourceParam = recordString(previewRecord, "sourceParam").toLowerCase();
	const query = recordString(previewRecord, "query").toLowerCase();
	const target = `${sourceParam} ${query}`;
	if (
		/\b(provider|model|api|apikey|api-key|api_provider|api-provider)\b/.test(
			target,
		)
	) {
		return "Providers";
	}
	if (/\b(mcp|server|servers|tool)\b/.test(target)) {
		return "MCP";
	}
	if (
		/\b(rule|rules|custom|customization|customizations|hook|hooks|skill|skills)\b/.test(
			target,
		)
	) {
		return "Customizations";
	}
	if (/\b(cursor.?link|deeplink|deep-link|uri|url)\b/.test(target)) {
		return "Cursor Links";
	}
	if (/\b(channel|connector|slack|outlook|sharepoint)\b/.test(target)) {
		return "Channels";
	}
	if (/\b(schedule|schedules|routine|cron|automation)\b/.test(target)) {
		return "Schedules";
	}
	if (/\b(account|auth|codex|login|sign.?in|oauth)\b/.test(target)) {
		return "Account";
	}
	return "General";
}

const PROVIDER_CATALOG_CACHE_TTL_MS = 60_000;

let providerCatalogCache: {
	providers: Provider[];
	fetchedAt: number;
} | null = null;

// -----------------------------------------------------------
// Component
// -----------------------------------------------------------

export function SettingsView({
	initialCursorUri,
	initialSection = "General",
	onClose,
	onNavigateSection,
	onThemeChange,
	theme,
}: {
	initialCursorUri?: string;
	initialSection?: SettingsSection;
	onClose: () => void;
	onNavigateSection?: (section: SettingsSection) => void;
	onThemeChange: (theme: Theme) => void;
	theme: Theme;
}) {
	const [activeNav, setActiveNav] = useState<SettingsSection>(
		initialCursorUri ? "Cursor Links" : initialSection,
	);
	const [providersExpanded, setProvidersExpanded] = useState(true);
	const [providers, setProviders] = useState<Provider[]>(
		() => providerCatalogCache?.providers ?? [],
	);
	const [providersLoading, setProvidersLoading] = useState(
		() => !providerCatalogCache,
	);
	const [providerCatalogError, setProviderCatalogError] = useState<
		string | null
	>(null);
	const [modelsLoadingByProvider, setModelsLoadingByProvider] = useState<
		Record<string, boolean>
	>({});
	const [modelsErrorByProvider, setModelsErrorByProvider] = useState<
		Record<string, string | null>
	>({});
	const [oauthSigningProviderId, setOauthSigningProviderId] = useState<
		string | null
	>(null);
	const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
		null,
	);
	const [addingProvider, setAddingProvider] = useState(false);

	const setProvidersWithCache = useCallback(
		(next: Provider[] | ((prev: Provider[]) => Provider[])) => {
			setProviders((prev) => {
				const resolved =
					typeof next === "function"
						? (next as (prev: Provider[]) => Provider[])(prev)
						: next;
				providerCatalogCache = {
					providers: resolved,
					fetchedAt: Date.now(),
				};
				return resolved;
			});
		},
		[],
	);

	const loadProviderCatalog = useCallback(async () => {
		const now = Date.now();
		if (
			providerCatalogCache &&
			now - providerCatalogCache.fetchedAt < PROVIDER_CATALOG_CACHE_TTL_MS
		) {
			setProviders(providerCatalogCache.providers);
			setProvidersLoading(false);
			setProviderCatalogError(null);
			return;
		}

		setProvidersLoading(true);
		setProviderCatalogError(null);
		try {
			const payload = await desktopClient.invoke<ProviderCatalogResponse>(
				"list_provider_catalog",
			);
			setProvidersWithCache(payload.providers);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setProviderCatalogError(message);
			setProviders([]);
		} finally {
			setProvidersLoading(false);
		}
	}, [setProvidersWithCache]);

	useEffect(() => {
		const timeoutId = window.setTimeout(() => {
			void loadProviderCatalog();
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [loadProviderCatalog]);

	const persistProviderSettings = useCallback(
		async (
			id: string,
			updates: {
				enabled?: boolean;
				apiKey?: string;
				baseUrl?: string;
				configValues?: ProviderSettingsUpdate["configValues"];
			},
		) => {
			try {
				await desktopClient.invoke("save_provider_settings", {
					provider: id,
					enabled: updates.enabled,
					api_key: updates.apiKey,
					base_url: updates.baseUrl,
					settings: updates.configValues
						? toSettingsPatch(updates.configValues)
						: undefined,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				window.alert(`Failed to save provider settings for ${id}: ${message}`);
			}
		},
		[],
	);

	const toggleProvider = useCallback(
		(id: string) => {
			setProvidersWithCache((prev) =>
				prev.map((p) => {
					if (p.id !== id) {
						return p;
					}
					const nextEnabled = !p.enabled;
					void persistProviderSettings(id, { enabled: nextEnabled });
					return { ...p, enabled: nextEnabled };
				}),
			);
		},
		[persistProviderSettings, setProvidersWithCache],
	);

	const updateProvider = useCallback(
		(id: string, updates: ProviderSettingsUpdate) => {
			setProvidersWithCache((prev) =>
				prev.map((p) =>
					p.id === id
						? {
								...p,
								...updates,
								configValues: updates.configValues
									? {
											...(p.configValues ?? {}),
											...updates.configValues,
										}
									: p.configValues,
							}
						: p,
				),
			);
			void persistProviderSettings(id, {
				apiKey: updates.apiKey,
				baseUrl: updates.baseUrl,
				configValues: updates.configValues,
			});
		},
		[persistProviderSettings, setProvidersWithCache],
	);

	const loadProviderModels = useCallback(
		async (id: string) => {
			setModelsLoadingByProvider((prev) => ({ ...prev, [id]: true }));
			setModelsErrorByProvider((prev) => ({ ...prev, [id]: null }));
			try {
				const payload = await desktopClient.invoke<ProviderModelsResponse>(
					"list_provider_models",
					{
						provider: id,
					},
				);
				setProvidersWithCache((prev) =>
					prev.map((provider) =>
						provider.id === id
							? {
									...provider,
									modelList: payload.models,
									models: payload.models.length,
								}
							: provider,
					),
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setModelsErrorByProvider((prev) => ({ ...prev, [id]: message }));
			} finally {
				setModelsLoadingByProvider((prev) => ({ ...prev, [id]: false }));
			}
		},
		[setProvidersWithCache],
	);

	const enabledProviders = providers.filter((p) => p.enabled);
	const selectedProvider = selectedProviderId
		? (providers.find((p) => p.id === selectedProviderId) ?? null)
		: null;

	const isOAuthProvider = (id: string) =>
		id === "cline" || id === "oca" || id === "openai-codex";

	const runOAuthProviderLogin = async (id: string) => {
		setOauthSigningProviderId(id);
		try {
			const result = await desktopClient.invoke<{
				provider: string;
				accessTokenPresent: boolean;
			}>("run_provider_oauth_login", {
				provider: id,
			});
			setProvidersWithCache((prev) =>
				prev.map((provider) =>
					provider.id === id
						? {
								...provider,
								enabled: true,
								oauthAccessTokenPresent: result.accessTokenPresent,
							}
						: provider,
				),
			);
			setSelectedProviderId(id);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			window.alert(`Failed to sign in to ${id}: ${message}`);
		} finally {
			setOauthSigningProviderId(null);
		}
	};

	const openProviderDetail = (id: string) => {
		setActiveNav("Providers");
		onNavigateSection?.("Providers");
		setSelectedProviderId(id);
	};

	useEffect(() => {
		if (!selectedProviderId) {
			return;
		}
		const selected = providers.find(
			(provider) => provider.id === selectedProviderId,
		);
		if (!selected || (selected.modelList?.length ?? 0) > 0) {
			return;
		}
		const timeoutId = window.setTimeout(() => {
			void loadProviderModels(selectedProviderId);
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [loadProviderModels, providers, selectedProviderId]);

	const backToProviderList = () => {
		onNavigateSection?.("Providers");
		setSelectedProviderId(null);
		setAddingProvider(false);
	};

	const saveNewProvider = useCallback(
		async (payload: AddProviderPayload) => {
			await desktopClient.invoke("add_provider", {
				provider_id: payload.providerId,
				name: payload.name,
				base_url: payload.baseUrl,
				api_key: payload.apiKey,
				headers: payload.headers,
				timeout_ms: payload.timeoutMs,
				models: payload.models,
				default_model_id: payload.defaultModelId,
				models_source_url: payload.modelsSourceUrl,
				capabilities: payload.capabilities,
			});
			await loadProviderCatalog();
			setAddingProvider(false);
			setSelectedProviderId(payload.providerId);
		},
		[loadProviderCatalog],
	);

	const openAddProvider = () => {
		onNavigateSection?.("Providers");
		setSelectedProviderId(null);
		setAddingProvider(true);
	};

	const selectSection = (section: SettingsSection) => {
		setActiveNav(section);
		onNavigateSection?.(section);
		setSelectedProviderId(null);
		setAddingProvider(false);
	};

	return (
		<div className="flex h-full flex-col overflow-hidden bg-background">
			{/* Header bar */}
			<div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-3">
				<h1 className="text-lg font-semibold text-foreground">Settings</h1>
				<Button
					aria-label="Close settings"
					className="justify-start"
					onClick={onClose}
					variant="ghost"
				>
					<X className="size-3" />
				</Button>
			</div>

			{/* Body */}
			<div className="flex flex-1 overflow-hidden">
				{/* Settings sidebar nav */}
				<nav className="w-56 shrink-0 border-r border-border">
					<ScrollArea className="h-full">
						<div className="flex flex-col gap-0.5 p-3">
							{navCategories.map((cat) => {
								if (cat === "Providers") {
									return (
										<div key={cat}>
											<Button
												className={cn(
													"flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors",
													activeNav === "Providers"
														? "bg-accent text-accent-foreground font-medium"
														: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
												)}
												onClick={() => {
													selectSection("Providers");
													setProvidersExpanded((p) => !p);
												}}
												variant="ghost"
											>
												<span>Providers</span>
												{providersExpanded ? (
													<ChevronDown className="size-3" />
												) : (
													<ChevronRight className="size-3" />
												)}
											</Button>
											{providersExpanded && (
												<div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-border pl-2">
													{enabledProviders.map((prov) => (
														<Button
															className={cn(
																"justify-start",
																selectedProviderId === prov.id
																	? "bg-accent/80 text-foreground"
																	: "text-muted-foreground hover:text-foreground hover:bg-accent/30",
															)}
															disabled={oauthSigningProviderId === prov.id}
															key={prov.id}
															onClick={() => openProviderDetail(prov.id)}
															variant="ghost"
														>
															<span className="truncate">{prov.name}</span>
														</Button>
													))}
												</div>
											)}
										</div>
									);
								}
								return (
									<Button
										className={cn(
											"justify-start",
											activeNav === cat && !selectedProviderId
												? "bg-accent text-accent-foreground font-medium"
												: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
										)}
										key={cat}
										onClick={() => {
											selectSection(cat);
										}}
										variant="ghost"
									>
										{cat}
									</Button>
								);
							})}
						</div>
					</ScrollArea>
				</nav>

				{/* Content area */}
				<div className="flex-1 overflow-hidden">
					{activeNav === "Providers" && selectedProvider ? (
						<ProviderDetailContent
							modelsError={modelsErrorByProvider[selectedProvider.id] ?? null}
							modelsLoading={
								modelsLoadingByProvider[selectedProvider.id] ?? false
							}
							oauthLoginPending={oauthSigningProviderId === selectedProvider.id}
							onBack={backToProviderList}
							onLoadModels={() => void loadProviderModels(selectedProvider.id)}
							onOAuthLogin={
								isOAuthProvider(selectedProvider.id)
									? () => void runOAuthProviderLogin(selectedProvider.id)
									: undefined
							}
							onUpdate={(updates) =>
								updateProvider(selectedProvider.id, updates)
							}
							provider={selectedProvider}
						/>
					) : activeNav === "Providers" ? (
						addingProvider ? (
							<AddProviderContent
								existingProviderIds={providers.map((provider) => provider.id)}
								onBack={backToProviderList}
								onSave={saveNewProvider}
							/>
						) : providersLoading ? (
							<div className="flex h-full items-center justify-center">
								<p className="text-sm text-muted-foreground">
									Loading providers...
								</p>
							</div>
						) : providerCatalogError ? (
							<div className="flex h-full items-center justify-center">
								<p className="max-w-xl px-4 text-center text-sm text-destructive">
									Failed to load providers: {providerCatalogError}
								</p>
							</div>
						) : (
							<ProviderListContent
								onAddProvider={openAddProvider}
								onConfigure={openProviderDetail}
								onToggle={toggleProvider}
								providers={providers}
							/>
						)
					) : activeNav === "MCP" ? (
						<McpServersContent />
					) : activeNav === "Cursor Links" ? (
						<CursorLinksContent
							initialCursorUri={initialCursorUri}
							onOpenSettings={selectSection}
						/>
					) : activeNav === "Channels" ? (
						<ChannelsContent />
					) : activeNav === "Schedules" ? (
						<RoutineSchedulesContent />
					) : activeNav === "Customizations" ? (
						<RulesView />
					) : activeNav === "Account" ? (
						<AccountView />
					) : activeNav === "General" ? (
						<GeneralSettingsContent
							onThemeChange={onThemeChange}
							theme={theme}
						/>
					) : (
						<div className="flex h-full items-center justify-center">
							<p className="text-sm text-muted-foreground">
								{activeNav} settings coming soon.
							</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

const DEFAULT_CURSOR_URI =
	"vscode://cline.cline/createchat?prompt=Review%20the%20diff";
const CURSOR_LINK_ROUTE_LABELS = [
	{ label: "Chat", path: "/createchat" },
	{ label: "MCP", path: "/mcp/install" },
	{ label: "Background", path: "/background-agent" },
	{ label: "Settings", path: "/settings" },
	{ label: "Prompt", path: "/prompt" },
	{ label: "Command", path: "/command" },
	{ label: "Rule", path: "/rule" },
	{ label: "PR Review", path: "/pr-review" },
	{ label: "Plugin", path: "/plugin/add" },
	{ label: "Glass", path: "/glass" },
	{ label: "NDJSON", path: "/automation/ingest" },
	{ label: "Checkout", path: "/git/checkout" },
	{ label: "Branch", path: "/git/branch" },
	{ label: "Commit", path: "/git/commit" },
] as const;
const CURSOR_LINK_ROUTE_PATHS = new Set<string>(
	CURSOR_LINK_ROUTE_LABELS.map((route) => route.path),
);
const CURSOR_LINK_SURFACES = [
	"Codex auth",
	"Composer",
	"MCP install",
	"Browser",
	"Retrieval",
	"Background agents",
	"Rules",
	"Sandbox",
	"Git helpers",
	"NDJSON ingest",
	"Plugins",
] as const;
const CURSOR_LINK_EXAMPLES = [
	{
		label: "Chat",
		uri: DEFAULT_CURSOR_URI,
	},
	{
		label: "MCP",
		uri: "vscode://cline.cline/mcp/install?name=docs&url=https%3A%2F%2Fmcp.example.com",
	},
	{
		label: "Background",
		uri: "codevibe://background-agent?prompt=Investigate%20flaky%20tests&repo=owner%2Frepo",
	},
	{
		label: "NDJSON",
		uri: `vscode://cline.cline/automation/ingest?ndjson=${encodeURIComponent(
			JSON.stringify({ eventId: "evt-1", eventType: "cursor.demo" }),
		)}`,
	},
	{
		label: "Git",
		uri: "codevibe://git/checkout?branch=feature%2Fdemo",
	},
	{
		label: "Plugin",
		uri: "codevibe://plugin/add?id=docs-helper&replace=true",
	},
] as const;
const CURSOR_SECRET_KEY_PATTERN =
	/(authorization|api[-_]?key|cookie|credential|id[-_]?token|jwt|password|refresh[-_]?token|secret|session|token)/i;
const CURSOR_BEARER_SECRET_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const CURSOR_URI_PREVIEW_VALUE_LIMIT = 512;
const CURSOR_LAUNCHABLE_AGENT_PATHS = new Set([
	"/createchat",
	"/background-agent",
	"/prompt",
	"/command",
	"/pr-review",
	"/glass",
	"/git/checkout",
	"/git/branch",
	"/git/commit",
]);

function truncateCursorPreviewValue(value: string): string {
	const normalized = value.replace(/[\r\n\t]+/g, " ").trim();
	if (normalized.length <= CURSOR_URI_PREVIEW_VALUE_LIMIT) {
		return normalized;
	}
	return `${normalized.slice(0, CURSOR_URI_PREVIEW_VALUE_LIMIT)}...`;
}

function isCursorSecretKey(key: string): boolean {
	return CURSOR_SECRET_KEY_PATTERN.test(key);
}

function redactCursorSecretLikeString(value: string): {
	redacted: boolean;
	value: string;
} {
	const replaced = value.replace(CURSOR_BEARER_SECRET_PATTERN, "Bearer [REDACTED]");
	return { value: replaced, redacted: replaced !== value };
}

function redactCursorSecretBearingUrl(value: string): {
	redacted: boolean;
	value: string;
} {
	try {
		const parsed = new URL(value);
		let redacted = false;
		for (const key of [...new Set(parsed.searchParams.keys())]) {
			if (isCursorSecretKey(key)) {
				parsed.searchParams.set(key, "[REDACTED]");
				redacted = true;
			}
		}
		return redacted
			? { value: parsed.toString(), redacted }
			: { value, redacted: false };
	} catch {
		return { value, redacted: false };
	}
}

function redactCursorJsonValue(
	value: unknown,
	parentKey = "",
): { redacted: boolean; value: unknown } {
	if (isCursorSecretKey(parentKey)) {
		return { value: "[REDACTED]", redacted: true };
	}

	if (typeof value === "string") {
		const urlRedaction = redactCursorSecretBearingUrl(value);
		const bearerRedaction = redactCursorSecretLikeString(urlRedaction.value);
		return {
			value: bearerRedaction.value,
			redacted: urlRedaction.redacted || bearerRedaction.redacted,
		};
	}

	if (Array.isArray(value)) {
		let redacted = false;
		const next = value.map((entry) => {
			const result = redactCursorJsonValue(entry);
			redacted ||= result.redacted;
			return result.value;
		});
		return { value: next, redacted };
	}

	if (value && typeof value === "object") {
		let redacted = false;
		const next: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			const result = redactCursorJsonValue(entry, key);
			redacted ||= result.redacted;
			next[key] = result.value;
		}
		return { value: next, redacted };
	}

	return { value, redacted: false };
}

function redactCursorParamValue(
	key: string,
	value: string,
): { redacted: boolean; value: string } {
	if (isCursorSecretKey(key)) {
		return { value: "[REDACTED]", redacted: true };
	}

	if (key === "config") {
		try {
			const parsed = parseCursorConfigPreviewValue(value);
			const result = redactCursorJsonValue(parsed);
			return {
				value: truncateCursorPreviewValue(JSON.stringify(result.value)),
				redacted: result.redacted,
			};
		} catch {
			const fallback = redactCursorSecretLikeString(value);
			return {
				value: truncateCursorPreviewValue(fallback.value),
				redacted: fallback.redacted,
			};
		}
	}

	const urlRedaction = redactCursorSecretBearingUrl(value);
	const bearerRedaction = redactCursorSecretLikeString(urlRedaction.value);
	return {
		value: truncateCursorPreviewValue(bearerRedaction.value),
		redacted: urlRedaction.redacted || bearerRedaction.redacted,
	};
}

function parseCursorConfigPreviewValue(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
		const padded = normalized.padEnd(
			Math.ceil(normalized.length / 4) * 4,
			"=",
		);
		return JSON.parse(atob(padded));
	}
}

function inferCursorRoute(parsed: URL): string {
	const directPath = parsed.pathname || "/";
	if (CURSOR_LINK_ROUTE_PATHS.has(directPath)) {
		return directPath;
	}

	const hostPath = parsed.hostname
		? `/${parsed.hostname}${directPath === "/" ? "" : directPath}`
		: directPath;
	if (CURSOR_LINK_ROUTE_PATHS.has(hostPath)) {
		return hostPath;
	}

	if (parsed.hostname === "anysphere.cursor-mcp" && directPath === "/install") {
		return "/mcp/install";
	}

	return directPath;
}

function buildCursorUriLocalPreview(input: string): {
	paramKeys: string[];
	redacted: boolean;
	route?: string;
	text: string;
} {
	const trimmed = input.trim();
	if (!trimmed) {
		return {
			paramKeys: [],
			redacted: false,
			text: "Enter a Cursor or CodeVibe URI.",
		};
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return {
			paramKeys: [],
			redacted: false,
			text: "URI is not valid.",
		};
	}

	const route = inferCursorRoute(parsed);
	const paramKeys = [...new Set(parsed.searchParams.keys())].sort();
	let redacted = false;
	const lines = [
		`scheme: ${parsed.protocol.replace(/:$/, "")}`,
		`host: ${parsed.hostname || "(none)"}`,
		`route: ${route}`,
	];

	if (paramKeys.length === 0) {
		lines.push("params: none");
	} else {
		lines.push("params:");
		for (const key of paramKeys) {
			const values = parsed.searchParams.getAll(key);
			for (const value of values) {
				const result = redactCursorParamValue(key, value);
				redacted ||= result.redacted;
				lines.push(`  ${key}: ${result.value}`);
			}
		}
	}

	return {
		paramKeys,
		redacted,
		route,
		text: lines.join("\n"),
	};
}

function CursorLinksContent({
	initialCursorUri,
	onOpenSettings,
}: {
	initialCursorUri?: string;
	onOpenSettings?: (section: SettingsSection) => void;
}) {
	const [cursorUri, setCursorUri] = useState(
		initialCursorUri ?? DEFAULT_CURSOR_URI,
	);
	const [preview, setPreview] = useState<
		CursorUriPreviewResponse | undefined
	>();
	const [previewError, setPreviewError] = useState<string | null>(null);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [settingsResult, setSettingsResult] = useState<{
		query?: string;
		section: SettingsSection;
		sourceParam?: string;
	} | null>(null);
	const [launchResult, setLaunchResult] = useState<
		CursorUriLaunchResponse | undefined
	>();
	const [launchError, setLaunchError] = useState<string | null>(null);
	const [launchLoading, setLaunchLoading] = useState(false);
	const [installResult, setInstallResult] = useState<
		CursorMcpInstallResponse | undefined
	>();
	const [installError, setInstallError] = useState<string | null>(null);
	const [installLoading, setInstallLoading] = useState(false);
	const [ingestResult, setIngestResult] = useState<
		CursorAutomationIngestResponse | undefined
	>();
	const [ingestError, setIngestError] = useState<string | null>(null);
	const [ingestLoading, setIngestLoading] = useState(false);
	const [ruleResult, setRuleResult] = useState<
		CursorRuleOpenResponse | undefined
	>();
	const [ruleError, setRuleError] = useState<string | null>(null);
	const [ruleLoading, setRuleLoading] = useState(false);
	const [pluginResult, setPluginResult] = useState<
		CursorPluginAddResponse | undefined
	>();
	const [pluginError, setPluginError] = useState<string | null>(null);
	const [pluginLoading, setPluginLoading] = useState(false);
	const [pluginForce, setPluginForce] = useState(false);
	const [launchMode, setLaunchMode] = useState<CursorLaunchMode>("plan");
	const [launchDelivery, setLaunchDelivery] =
		useState<CursorLaunchDelivery>("queue");
	const [launchToolsEnabled, setLaunchToolsEnabled] = useState(true);
	const [launchAutoApproveTools, setLaunchAutoApproveTools] = useState(false);
	const [backgroundWorktreesEnabled, setBackgroundWorktreesEnabled] =
		useState(true);
	const [gitResult, setGitResult] = useState<
		CursorGitActionResponse | undefined
	>();
	const [gitError, setGitError] = useState<string | null>(null);
	const [gitLoading, setGitLoading] = useState(false);
	const localPreview = useMemo(
		() => buildCursorUriLocalPreview(cursorUri),
		[cursorUri],
	);

	const previewRecord = asRecord(preview);
	const route = recordString(previewRecord, "route");
	const path = recordString(previewRecord, "path");
	const taskPrompt = recordString(previewRecord, "taskPrompt");
	const requiresConfirmation = recordBoolean(
		previewRecord,
		"requiresConfirmation",
	);
	const paramKeys = recordStringArray(previewRecord, "paramKeys");
	const configKeys = recordStringArray(previewRecord, "configKeys");
	const canOpenSettings = route === "settings" && Boolean(onOpenSettings);
	const settingsSection = cursorSettingsSectionFromPreview(previewRecord);
	const canLaunchRuleReview =
		route === "rule" && recordString(previewRecord, "kind") === "review";
	const canLaunchCursorUri =
		canLaunchRuleReview ||
		(Boolean(taskPrompt) &&
			Boolean(path) &&
			(CURSOR_LAUNCHABLE_AGENT_PATHS.has(path ?? "") ||
				(route === "command-file" && path === "/command")));
	const backgroundLaunchPreview =
		route === "background-agent" || path === "/background-agent";
	const effectiveLaunchMode: CursorLaunchMode = backgroundLaunchPreview
		? "plan"
		: launchMode;
	const effectiveLaunchDelivery: CursorLaunchDelivery = backgroundLaunchPreview
		? "queue"
		: launchDelivery;
	const effectiveLaunchToolsEnabled = backgroundLaunchPreview
		? true
		: launchToolsEnabled;
	const effectiveLaunchAutoApproveTools = backgroundLaunchPreview
		? false
		: launchAutoApproveTools;
	const effectiveBackgroundWorktreesEnabled = backgroundLaunchPreview
		? backgroundWorktreesEnabled
		: false;
	const canIngestAutomation =
		route === "automation-ingest" &&
		recordBoolean(previewRecord, "requiresConfirmation") === true &&
		recordBoolean(previewRecord, "valid") !== false;
	const canInstallMcp = route === "mcp-install";
	const canOpenRule =
		route === "rule" && recordString(previewRecord, "kind") === "file";
	const pluginSource = recordString(previewRecord, "source");
	const pluginRequiresReview =
		recordBoolean(previewRecord, "requiresReview") === true;
	const canAddPlugin =
		route === "plugin-add" &&
		!pluginRequiresReview &&
		Boolean(pluginSource);
	const canRunGit =
		route === "git-checkout" ||
		route === "git-branch" ||
		route === "git-commit";
	const launchBackgroundDetails = asRecord(launchResult?.backgroundAgentDetails);

	const runPreview = async (inputUri = cursorUri) => {
		const uri = inputUri.trim();
		if (!uri) {
			setPreview(undefined);
			setPreviewError("URI is required.");
			setSettingsResult(null);
			setLaunchResult(undefined);
			setLaunchError(null);
			setInstallResult(undefined);
			setInstallError(null);
			setIngestResult(undefined);
			setIngestError(null);
			setRuleResult(undefined);
			setRuleError(null);
			setPluginResult(undefined);
			setPluginError(null);
			setGitResult(undefined);
			setGitError(null);
			return;
		}
		setPreviewLoading(true);
		setPreviewError(null);
		setPreview(undefined);
		setSettingsResult(null);
		setLaunchResult(undefined);
		setLaunchError(null);
		setInstallResult(undefined);
		setInstallError(null);
		setIngestResult(undefined);
		setIngestError(null);
		setRuleResult(undefined);
		setRuleError(null);
		setPluginResult(undefined);
		setPluginError(null);
		setGitResult(undefined);
		setGitError(null);
		try {
			const result = await desktopClient.previewCursorUri({
				uri,
				maxCommandFileBytes: 64 * 1024,
				maxRuleFileBytes: 64 * 1024,
			});
			setPreview(result);
		} catch (error) {
			setPreviewError(error instanceof Error ? error.message : String(error));
		} finally {
			setPreviewLoading(false);
		}
	};

	const updateCursorUri = (value: string) => {
		setCursorUri(value);
		setPreview(undefined);
		setPreviewError(null);
		setSettingsResult(null);
		setLaunchResult(undefined);
		setLaunchError(null);
		setInstallResult(undefined);
		setInstallError(null);
		setIngestResult(undefined);
		setIngestError(null);
		setRuleResult(undefined);
		setRuleError(null);
		setPluginResult(undefined);
		setPluginError(null);
		setGitResult(undefined);
		setGitError(null);
	};

	useEffect(() => {
		if (!initialCursorUri) {
			return;
		}
		updateCursorUri(initialCursorUri);
		const timeoutId = window.setTimeout(() => {
			void runPreview(initialCursorUri);
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [initialCursorUri]);

	const runMcpInstall = async () => {
		const uri = cursorUri.trim();
		if (!uri || !canInstallMcp) {
			return;
		}
		setInstallLoading(true);
		setInstallError(null);
		setInstallResult(undefined);
		try {
			const result = await desktopClient.installCursorMcp({
				uri,
				confirmed: true,
				maxCommandFileBytes: 64 * 1024,
				maxRuleFileBytes: 64 * 1024,
			});
			setInstallResult(result);
		} catch (error) {
			setInstallError(error instanceof Error ? error.message : String(error));
		} finally {
			setInstallLoading(false);
		}
	};

	const runOpenSettings = () => {
		if (!canOpenSettings) {
			return;
		}
		onOpenSettings?.(settingsSection);
		setSettingsResult({
			section: settingsSection,
			...(recordString(previewRecord, "query")
				? { query: recordString(previewRecord, "query") }
				: {}),
			...(recordString(previewRecord, "sourceParam")
				? { sourceParam: recordString(previewRecord, "sourceParam") }
				: {}),
		});
	};

	const runCursorLaunch = async () => {
		const uri = cursorUri.trim();
		if (!uri || !canLaunchCursorUri) {
			return;
		}
		setLaunchLoading(true);
		setLaunchError(null);
		setLaunchResult(undefined);
		try {
			const result = await desktopClient.launchCursorUri({
				uri,
				confirmed: true,
				mode: effectiveLaunchMode,
				delivery: effectiveLaunchDelivery,
				enableTools: effectiveLaunchToolsEnabled,
				enableSpawn: false,
				enableTeams: false,
				autoApproveTools: effectiveLaunchAutoApproveTools,
				enableWorktrees: effectiveBackgroundWorktreesEnabled,
				maxCommandFileBytes: 64 * 1024,
				maxRuleFileBytes: 64 * 1024,
			});
			setLaunchResult(result);
		} catch (error) {
			setLaunchError(error instanceof Error ? error.message : String(error));
		} finally {
			setLaunchLoading(false);
		}
	};

	const runAutomationIngest = async () => {
		const uri = cursorUri.trim();
		if (!uri || !canIngestAutomation) {
			return;
		}
		setIngestLoading(true);
		setIngestError(null);
		setIngestResult(undefined);
		try {
			const result = await desktopClient.ingestCursorAutomation({
				uri,
				confirmed: true,
				maxCommandFileBytes: 64 * 1024,
				maxRuleFileBytes: 64 * 1024,
			});
			setIngestResult(result);
		} catch (error) {
			setIngestError(error instanceof Error ? error.message : String(error));
		} finally {
			setIngestLoading(false);
		}
	};

	const runRuleOpen = async () => {
		const uri = cursorUri.trim();
		if (!uri || !canOpenRule) {
			return;
		}
		setRuleLoading(true);
		setRuleError(null);
		setRuleResult(undefined);
		try {
			const result = await desktopClient.openCursorRule({
				uri,
				confirmed: true,
				open: true,
				maxCommandFileBytes: 64 * 1024,
				maxRuleFileBytes: 64 * 1024,
			});
			setRuleResult(result);
		} catch (error) {
			setRuleError(error instanceof Error ? error.message : String(error));
		} finally {
			setRuleLoading(false);
		}
	};

	const runPluginAdd = async () => {
		const uri = cursorUri.trim();
		if (!uri || !canAddPlugin) {
			return;
		}
		setPluginLoading(true);
		setPluginError(null);
		setPluginResult(undefined);
		try {
			const result = await desktopClient.addCursorPlugin({
				uri,
				confirmed: true,
				force: pluginForce,
				maxCommandFileBytes: 64 * 1024,
				maxRuleFileBytes: 64 * 1024,
			});
			setPluginResult(result);
		} catch (error) {
			setPluginError(error instanceof Error ? error.message : String(error));
		} finally {
			setPluginLoading(false);
		}
	};

	const runGitAction = async () => {
		const uri = cursorUri.trim();
		if (!uri || !canRunGit) {
			return;
		}
		setGitLoading(true);
		setGitError(null);
		setGitResult(undefined);
		try {
			const result = await desktopClient.runCursorGitAction({
				uri,
				confirmed: true,
				maxCommandFileBytes: 64 * 1024,
				maxRuleFileBytes: 64 * 1024,
			});
			setGitResult(result);
		} catch (error) {
			setGitError(error instanceof Error ? error.message : String(error));
		} finally {
			setGitLoading(false);
		}
	};

	return (
		<ScrollArea className="h-full">
			<div className="mx-auto max-w-3xl px-8 py-6">
				<div className="mb-6 flex items-center gap-2">
					<Link2 className="size-4 text-muted-foreground" />
					<h2 className="text-lg font-semibold text-foreground">
						Cursor Links
					</h2>
					{initialCursorUri ? (
						<Badge variant="secondary">Standalone URL</Badge>
					) : null}
				</div>
				<section className="rounded-lg border border-border p-5">
					<div className="flex flex-col gap-3">
						<div className="flex flex-wrap gap-1.5">
							{CURSOR_LINK_ROUTE_LABELS.map((item) => (
								<Badge
									key={item.path}
									variant={
										localPreview.route === item.path ? "secondary" : "outline"
									}
								>
									{item.label}: {item.path}
								</Badge>
							))}
						</div>
						<div className="flex flex-wrap gap-1.5">
							{CURSOR_LINK_SURFACES.map((surface) => (
								<Badge key={surface} variant="outline">
									{surface}
								</Badge>
							))}
						</div>
						<div className="flex flex-wrap gap-2">
							{CURSOR_LINK_EXAMPLES.map((example) => (
								<Button
									key={example.label}
									onClick={() => updateCursorUri(example.uri)}
									size="sm"
									type="button"
									variant="outline"
								>
									{example.label}
								</Button>
							))}
						</div>
						<Textarea
							aria-label="Cursor-compatible URI"
							className="min-h-28 resize-y font-mono text-xs"
							onChange={(event) => updateCursorUri(event.target.value)}
							placeholder="vscode://cline.cline/createchat?prompt=..."
							value={cursorUri}
						/>
						<div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2">
							<div className="mb-2 flex flex-wrap items-center gap-2">
								<p className="text-xs font-medium text-muted-foreground">
									Redacted URI Preview
								</p>
								{localPreview.route ? (
									<Badge variant="outline">{localPreview.route}</Badge>
								) : null}
								{localPreview.redacted ? (
									<Badge variant="outline">redacted</Badge>
								) : null}
							</div>
							<pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground">
								{localPreview.text}
							</pre>
						</div>
						{canLaunchCursorUri ? (
							<div className="flex flex-wrap items-center gap-2">
								<div className="flex rounded-md border border-border/70 p-0.5">
									{(["plan", "act"] as const).map((mode) => (
										<Button
											aria-pressed={effectiveLaunchMode === mode}
											className="h-7 px-2 text-xs"
											disabled={launchLoading || backgroundLaunchPreview}
											key={mode}
											onClick={() => setLaunchMode(mode)}
											size="sm"
											type="button"
											variant={
												effectiveLaunchMode === mode
													? "secondary"
													: "ghost"
											}
										>
											{mode === "plan" ? "Plan" : "Act"}
										</Button>
									))}
								</div>
								<div className="flex rounded-md border border-border/70 p-0.5">
									{(["queue", "steer"] as const).map((delivery) => (
										<Button
											aria-pressed={effectiveLaunchDelivery === delivery}
											className="h-7 px-2 text-xs"
											disabled={launchLoading || backgroundLaunchPreview}
											key={delivery}
											onClick={() => setLaunchDelivery(delivery)}
											size="sm"
											type="button"
											variant={
												effectiveLaunchDelivery === delivery
													? "secondary"
													: "ghost"
											}
										>
											{delivery === "queue" ? "Queue" : "Steer"}
										</Button>
									))}
								</div>
								<div className="flex items-center gap-2 rounded-md border border-border/70 px-2.5 py-1.5">
									<Switch
										aria-label="Enable launch tools"
										checked={effectiveLaunchToolsEnabled}
										disabled={launchLoading || backgroundLaunchPreview}
										onCheckedChange={setLaunchToolsEnabled}
									/>
									<span className="text-xs text-muted-foreground">Tools</span>
								</div>
								<div className="flex items-center gap-2 rounded-md border border-border/70 px-2.5 py-1.5">
									<Switch
										aria-label="Auto approve launch tools"
										checked={effectiveLaunchAutoApproveTools}
										disabled={launchLoading || backgroundLaunchPreview}
										onCheckedChange={setLaunchAutoApproveTools}
									/>
									<span className="text-xs text-muted-foreground">
										Auto approve
									</span>
								</div>
								{backgroundLaunchPreview ? (
									<div className="flex items-center gap-2 rounded-md border border-border/70 px-2.5 py-1.5">
										<Switch
											aria-label="Create background-agent worktree"
											checked={effectiveBackgroundWorktreesEnabled}
											disabled={launchLoading}
											onCheckedChange={setBackgroundWorktreesEnabled}
										/>
										<span className="text-xs text-muted-foreground">
											Worktree
										</span>
									</div>
								) : null}
								{backgroundLaunchPreview ? (
									<Badge variant="outline">Safe background defaults</Badge>
								) : null}
							</div>
						) : null}
						<div className="flex flex-wrap gap-2">
							<Button
								disabled={previewLoading}
								onClick={() => void runPreview()}
								type="button"
							>
								{previewLoading ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Link2 className="size-4" />
								)}
								Preview
							</Button>
							{canLaunchCursorUri ? (
								<Button
									disabled={launchLoading}
									onClick={() => void runCursorLaunch()}
									type="button"
									variant="outline"
								>
									{launchLoading ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Play className="size-4" />
									)}
									Launch
								</Button>
							) : null}
							{canOpenSettings ? (
								<Button
									onClick={runOpenSettings}
									type="button"
									variant="outline"
								>
									<CheckCircle2 className="size-4" />
									Open Settings
								</Button>
							) : null}
							{canInstallMcp ? (
								<Button
									disabled={installLoading}
									onClick={() => void runMcpInstall()}
									type="button"
									variant="outline"
								>
									{installLoading ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<CheckCircle2 className="size-4" />
									)}
									Install MCP
								</Button>
							) : null}
							{canIngestAutomation ? (
								<Button
									disabled={ingestLoading}
									onClick={() => void runAutomationIngest()}
									type="button"
									variant="outline"
								>
									{ingestLoading ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<CheckCircle2 className="size-4" />
									)}
									Ingest
								</Button>
							) : null}
							{canOpenRule ? (
								<Button
									disabled={ruleLoading}
									onClick={() => void runRuleOpen()}
									type="button"
									variant="outline"
								>
									{ruleLoading ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<CheckCircle2 className="size-4" />
									)}
									Open Rule
								</Button>
							) : null}
							{canAddPlugin ? (
								<div className="flex items-center gap-2 rounded-md border border-border/70 px-2.5 py-1.5">
									<Switch
										aria-label="Replace existing Cursor plugin"
										checked={pluginForce}
										disabled={pluginLoading}
										onCheckedChange={setPluginForce}
									/>
									<span className="text-xs text-muted-foreground">
										Replace existing
									</span>
								</div>
							) : null}
							{canAddPlugin ? (
								<Button
									disabled={pluginLoading}
									onClick={() => void runPluginAdd()}
									type="button"
									variant="outline"
								>
									{pluginLoading ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<CheckCircle2 className="size-4" />
									)}
									Add Plugin
								</Button>
							) : null}
							{canRunGit ? (
								<Button
									disabled={gitLoading}
									onClick={() => void runGitAction()}
									type="button"
									variant="outline"
								>
									{gitLoading ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<CheckCircle2 className="size-4" />
									)}
									Run Git
								</Button>
							) : null}
						</div>
					</div>
				</section>

				{previewError ? (
					<Alert className="mt-4" variant="destructive">
						<AlertTriangle className="size-4" />
						<AlertTitle>Preview failed</AlertTitle>
						<AlertDescription>{previewError}</AlertDescription>
					</Alert>
				) : null}

				{launchError ? (
					<Alert className="mt-4" variant="destructive">
						<AlertTriangle className="size-4" />
						<AlertTitle>Launch failed</AlertTitle>
						<AlertDescription>{launchError}</AlertDescription>
					</Alert>
				) : null}

				{launchResult ? (
					<Alert className="mt-4">
						<CheckCircle2 className="size-4" />
						<AlertTitle>Cursor session launched</AlertTitle>
						<AlertDescription>
							{[
								launchResult.sessionId,
								launchResult.route,
								launchResult.backgroundAgent ? "background" : "",
								launchResult.glass ? "glass" : "",
								`${launchResult.provider}/${launchResult.model}`,
								launchResult.mode,
								launchResult.queued ? "queued" : "steered",
								recordString(launchBackgroundDetails, "launchMode"),
								recordString(launchBackgroundDetails, "worktreeBranch"),
								recordString(launchBackgroundDetails, "fallbackReason"),
							]
								.filter(Boolean)
								.join(" | ")}
						</AlertDescription>
					</Alert>
				) : null}

				{settingsResult ? (
					<Alert className="mt-4">
						<CheckCircle2 className="size-4" />
						<AlertTitle>Settings opened</AlertTitle>
						<AlertDescription>
							{[
								settingsResult.section,
								settingsResult.sourceParam
									? `from ${settingsResult.sourceParam}`
									: "",
								settingsResult.query,
							]
								.filter(Boolean)
								.join(" | ")}
						</AlertDescription>
					</Alert>
				) : null}

				{installError ? (
					<Alert className="mt-4" variant="destructive">
						<AlertTriangle className="size-4" />
						<AlertTitle>MCP install failed</AlertTitle>
						<AlertDescription>{installError}</AlertDescription>
					</Alert>
				) : null}

				{installResult ? (
					<Alert className="mt-4">
						<CheckCircle2 className="size-4" />
						<AlertTitle>
							{installResult.replaced
								? "MCP server replaced"
								: "MCP server installed"}
						</AlertTitle>
						<AlertDescription>
							{[
								installResult.serverName,
								installResult.transportType,
								installResult.urlOrigin,
								installResult.command,
								installResult.envKeys?.length
									? `env: ${installResult.envKeys.join(", ")}`
									: "",
								installResult.headerKeys?.length
									? `headers: ${installResult.headerKeys.join(", ")}`
									: "",
								installResult.settingsPath,
							]
								.filter(Boolean)
								.join(" | ")}
						</AlertDescription>
					</Alert>
				) : null}

				{ingestError ? (
					<Alert className="mt-4" variant="destructive">
						<AlertTriangle className="size-4" />
						<AlertTitle>Automation ingest failed</AlertTitle>
						<AlertDescription>{ingestError}</AlertDescription>
					</Alert>
				) : null}

				{ingestResult ? (
					<Alert
						className="mt-4"
						variant={ingestResult.ingested ? "default" : "destructive"}
					>
						{ingestResult.ingested ? (
							<CheckCircle2 className="size-4" />
						) : (
							<AlertTriangle className="size-4" />
						)}
						<AlertTitle>
							{ingestResult.ingested
								? "Automation events ingested"
								: "Automation ingest blocked"}
						</AlertTitle>
						<AlertDescription>
							{ingestResult.ingested
								? [
										`${ingestResult.queuedRunCount} queued run(s)`,
										`${ingestResult.duplicateCount} duplicate(s)`,
										ingestResult.matchedSpecIds.length
											? `specs: ${ingestResult.matchedSpecIds.join(", ")}`
											: "",
									]
											.filter(Boolean)
											.join(" | ")
								: `${ingestResult.eventCount} event(s), ${ingestResult.rejectedCount} rejected`}
						</AlertDescription>
					</Alert>
				) : null}

				{ruleError ? (
					<Alert className="mt-4" variant="destructive">
						<AlertTriangle className="size-4" />
						<AlertTitle>Rule action failed</AlertTitle>
						<AlertDescription>{ruleError}</AlertDescription>
					</Alert>
				) : null}

				{ruleResult ? (
					<Alert className="mt-4">
						<CheckCircle2 className="size-4" />
						<AlertTitle>
							{ruleResult.created ? "Cursor rule created" : "Cursor rule opened"}
						</AlertTitle>
						<AlertDescription>
							{[
								ruleResult.relativePath,
								ruleResult.opened ? "opened" : "",
								ruleResult.workspaceRoot,
							]
								.filter(Boolean)
								.join(" | ")}
						</AlertDescription>
					</Alert>
				) : null}

				{pluginError ? (
					<Alert className="mt-4" variant="destructive">
						<AlertTriangle className="size-4" />
						<AlertTitle>Plugin install failed</AlertTitle>
						<AlertDescription>{pluginError}</AlertDescription>
					</Alert>
				) : null}

				{pluginResult ? (
					<Alert
						className="mt-4"
						variant={pluginResult.installed ? "default" : "destructive"}
					>
						{pluginResult.installed ? (
							<CheckCircle2 className="size-4" />
						) : (
							<AlertTriangle className="size-4" />
						)}
						<AlertTitle>
							{pluginResult.installed
								? "Cursor plugin installed"
								: "Cursor plugin blocked"}
						</AlertTitle>
						<AlertDescription>
							{pluginResult.installed
								? [
										pluginResult.sourceLabel,
										pluginResult.force ? "replace requested" : "",
										pluginResult.entryCount !== undefined
											? `${pluginResult.entryCount} entry file(s)`
											: "",
										pluginResult.installPath,
									]
											.filter(Boolean)
											.join(" | ")
								: (pluginResult.reason ??
									pluginResult.detail ??
									"Review required.")}
						</AlertDescription>
					</Alert>
				) : null}

				{gitError ? (
					<Alert className="mt-4" variant="destructive">
						<AlertTriangle className="size-4" />
						<AlertTitle>Git action failed</AlertTitle>
						<AlertDescription>{gitError}</AlertDescription>
					</Alert>
				) : null}

				{gitResult ? (
					<Alert
						className="mt-4"
						variant={gitResult.executed ? "default" : "destructive"}
					>
						{gitResult.executed ? (
							<CheckCircle2 className="size-4" />
						) : (
							<AlertTriangle className="size-4" />
						)}
						<AlertTitle>
							{gitResult.executed ? `Ran ${gitResult.kind}` : "Git action blocked"}
						</AlertTitle>
						<AlertDescription>
							{gitResult.executed
								? (gitResult.commitHash ??
									gitResult.currentBranch ??
									gitResult.target ??
									gitResult.branch ??
									"done")
								: (gitResult.reason ?? "Review repository state first.")}
						</AlertDescription>
					</Alert>
				) : null}

				{preview ? (
					<section className="mt-4 rounded-lg border border-border p-5">
						<div className="flex flex-wrap items-center gap-2">
							<Badge variant={preview.handled ? "default" : "outline"}>
								{preview.handled ? "Handled" : "Unhandled"}
							</Badge>
							{route ? <Badge variant="outline">{route}</Badge> : null}
							{path ? <Badge variant="outline">{path}</Badge> : null}
							{requiresConfirmation !== undefined ? (
								<Badge variant="outline">
									{requiresConfirmation
										? "Confirmation required"
										: "No confirmation"}
								</Badge>
							) : null}
						</div>
						{taskPrompt ? (
							<div className="mt-4 rounded-md border border-border/70 bg-muted/30 px-3 py-2">
								<p className="text-xs font-medium text-muted-foreground">
									Task Prompt
								</p>
								<p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
									{taskPrompt}
								</p>
							</div>
						) : null}
						{paramKeys.length > 0 || configKeys.length > 0 ? (
							<div className="mt-4 grid gap-3 md:grid-cols-2">
								{paramKeys.length > 0 ? (
									<div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2">
										<p className="text-xs font-medium text-muted-foreground">
											Params
										</p>
										<p className="mt-1 break-words font-mono text-xs text-foreground">
											{paramKeys.join(", ")}
										</p>
									</div>
								) : null}
								{configKeys.length > 0 ? (
									<div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2">
										<p className="text-xs font-medium text-muted-foreground">
											Config Keys
										</p>
										<p className="mt-1 break-words font-mono text-xs text-foreground">
											{configKeys.join(", ")}
										</p>
									</div>
								) : null}
							</div>
						) : null}
						<div className="mt-4">
							<p className="mb-2 text-xs font-medium text-muted-foreground">
								Preview Payload
							</p>
							<pre className="max-h-80 overflow-auto rounded-md border border-border/70 bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words text-foreground">
								{JSON.stringify(preview, null, 2)}
							</pre>
						</div>
					</section>
				) : null}
			</div>
		</ScrollArea>
	);
}

function GeneralSettingsContent({
	onThemeChange,
	theme,
}: {
	onThemeChange: (theme: Theme) => void;
	theme: Theme;
}) {
	const [telemetryOptOut, setTelemetryOptOut] = useState(false);
	const [telemetryLoading, setTelemetryLoading] = useState(true);
	const [telemetrySaving, setTelemetrySaving] = useState(false);
	const [telemetryError, setTelemetryError] = useState<string | null>(null);
	const [browserStatus, setBrowserStatus] = useState<
		BrowserAutomationStatus | undefined
	>();
	const [browserStatusError, setBrowserStatusError] = useState<string | null>(
		null,
	);
	const [browserStatusLoading, setBrowserStatusLoading] = useState(false);
	const [browserUrl, setBrowserUrl] = useState("http://127.0.0.1:3000");
	const [browserCoordinate, setBrowserCoordinate] = useState("200,200");
	const [browserText, setBrowserText] = useState("");
	const [browserEvaluateText, setBrowserEvaluateText] =
		useState("document.title");
	const [browserRunning, setBrowserRunning] = useState(false);
	const [browserResult, setBrowserResult] = useState<
		BrowserToolResult | undefined
	>();
	const browserAvailable = browserStatus?.available === true;
	const browserResultPayload = asRecord(browserResult?.result);
	const browserScreenshot = recordString(browserResultPayload, "screenshot");
	const browserSummary = browserResultSummary(browserResult);
	const browserEvaluateEnabled =
		browserStatus?.safeBrowserEvaluateEnabled === true;

	const loadGlobalSettings = useCallback(async () => {
		setTelemetryLoading(true);
		setTelemetryError(null);
		try {
			const settings = await desktopClient.invoke<GlobalSettingsResponse>(
				"get_global_settings",
			);
			setTelemetryOptOut(settings.telemetryOptOut);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setTelemetryError(message);
		} finally {
			setTelemetryLoading(false);
		}
	}, []);

	useEffect(() => {
		const timeoutId = window.setTimeout(() => {
			void loadGlobalSettings();
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [loadGlobalSettings]);

	const loadBrowserStatus = useCallback(async () => {
		setBrowserStatusLoading(true);
		setBrowserStatusError(null);
		try {
			const status = await desktopClient.getBrowserAutomationStatus();
			setBrowserStatus(status);
		} catch (error) {
			setBrowserStatus(undefined);
			setBrowserStatusError(error instanceof Error ? error.message : String(error));
		} finally {
			setBrowserStatusLoading(false);
		}
	}, []);

	useEffect(() => {
		const timeoutId = window.setTimeout(() => {
			void loadBrowserStatus();
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [loadBrowserStatus]);

	const updateTelemetryEnabled = async (enabled: boolean) => {
		const nextValue = !enabled;
		const previousValue = telemetryOptOut;
		setTelemetryOptOut(nextValue);
		setTelemetrySaving(true);
		setTelemetryError(null);
		try {
			const settings = await desktopClient.invoke<GlobalSettingsResponse>(
				"set_telemetry_opt_out",
				{
					telemetry_opt_out: nextValue,
				},
			);
			setTelemetryOptOut(settings.telemetryOptOut);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setTelemetryOptOut(previousValue);
			setTelemetryError(message);
		} finally {
			setTelemetrySaving(false);
		}
	};

	const runBrowserLaunch = async () => {
		const url = browserUrl.trim();
		if (!url) {
			setBrowserResult({
				query: "browser_action:launch",
				result: "",
				error: "URL is required.",
				success: false,
			});
			return;
		}
		setBrowserRunning(true);
		try {
			const result = await desktopClient.browserAction({
				action: "launch",
				url,
			});
			setBrowserResult(result);
			await loadBrowserStatus();
		} catch (error) {
			setBrowserResult({
				query: "browser_action:launch",
				result: "",
				error: error instanceof Error ? error.message : String(error),
				success: false,
			});
		} finally {
			setBrowserRunning(false);
		}
	};

	const runBrowserSnapshot = async () => {
		setBrowserRunning(true);
		try {
			const result = await desktopClient.browserSnapshot({
				include_logs: true,
				include_screenshot: true,
			});
			setBrowserResult(result);
		} catch (error) {
			setBrowserResult({
				query: "browser_snapshot",
				result: "",
				error: error instanceof Error ? error.message : String(error),
				success: false,
			});
		} finally {
			setBrowserRunning(false);
		}
	};

	const runBrowserScreenshot = async () => {
		setBrowserRunning(true);
		try {
			const result = await desktopClient.browserScreenshot();
			setBrowserResult(result);
		} catch (error) {
			setBrowserResult({
				query: "browser_screenshot",
				result: "",
				error: error instanceof Error ? error.message : String(error),
				success: false,
			});
		} finally {
			setBrowserRunning(false);
		}
	};

	const runBrowserClick = async () => {
		const coordinate = browserCoordinate.trim();
		if (!coordinate) {
			setBrowserResult({
				query: "browser_action:click",
				result: "",
				error: "Coordinate is required.",
				success: false,
			});
			return;
		}
		setBrowserRunning(true);
		try {
			const result = await desktopClient.browserAction({
				action: "click",
				coordinate,
			});
			setBrowserResult(result);
		} catch (error) {
			setBrowserResult({
				query: "browser_action:click",
				result: "",
				error: error instanceof Error ? error.message : String(error),
				success: false,
			});
		} finally {
			setBrowserRunning(false);
		}
	};

	const runBrowserType = async () => {
		if (!browserText) {
			setBrowserResult({
				query: "browser_action:type",
				result: "",
				error: "Text is required.",
				success: false,
			});
			return;
		}
		setBrowserRunning(true);
		try {
			const result = await desktopClient.browserAction({
				action: "type",
				text: browserText,
			});
			setBrowserResult(result);
		} catch (error) {
			setBrowserResult({
				query: "browser_action:type",
				result: "",
				error: error instanceof Error ? error.message : String(error),
				success: false,
			});
		} finally {
			setBrowserRunning(false);
		}
	};

	const runBrowserEvaluate = async () => {
		const text = browserEvaluateText.trim();
		if (!browserEvaluateEnabled) {
			setBrowserResult({
				query: "browser_action:evaluate",
				result: "",
				error: "Safe browser evaluate is disabled.",
				success: false,
			});
			return;
		}
		if (!text) {
			setBrowserResult({
				query: "browser_action:evaluate",
				result: "",
				error: "JavaScript text is required.",
				success: false,
			});
			return;
		}
		setBrowserRunning(true);
		try {
			const result = await desktopClient.browserAction({
				action: "evaluate",
				text,
			});
			setBrowserResult(result);
		} catch (error) {
			setBrowserResult({
				query: "browser_action:evaluate",
				result: "",
				error: error instanceof Error ? error.message : String(error),
				success: false,
			});
		} finally {
			setBrowserRunning(false);
		}
	};

	const runBrowserScroll = async (action: "scroll_down" | "scroll_up") => {
		setBrowserRunning(true);
		try {
			const result = await desktopClient.browserAction({ action });
			setBrowserResult(result);
		} catch (error) {
			setBrowserResult({
				query: `browser_action:${action}`,
				result: "",
				error: error instanceof Error ? error.message : String(error),
				success: false,
			});
		} finally {
			setBrowserRunning(false);
		}
	};

	const runBrowserClose = async () => {
		setBrowserRunning(true);
		try {
			const result = await desktopClient.browserAction({ action: "close" });
			setBrowserResult(result);
		} catch (error) {
			setBrowserResult({
				query: "browser_action:close",
				result: "",
				error: error instanceof Error ? error.message : String(error),
				success: false,
			});
		} finally {
			setBrowserRunning(false);
		}
	};

	return (
		<ScrollArea className="h-full">
			<div className="mx-auto max-w-3xl px-8 py-6">
				<div className="mb-6">
					<h2 className="text-lg font-semibold text-foreground">General</h2>
				</div>
				<section className="rounded-lg border border-border p-5">
					<div className="flex items-center justify-between gap-5 max-[720px]:flex-col max-[720px]:items-stretch">
						<div>
							<p className="text-sm font-medium text-foreground">Theme</p>
							<p className="mt-1 text-xs text-muted-foreground">
								Use the light or dark CodeVibe Hub interface.
							</p>
						</div>
						<div className="flex items-center gap-2 max-[720px]:justify-start">
							<Button
								onClick={() => onThemeChange("dark")}
								type="button"
								variant={theme === "dark" ? "default" : "outline"}
							>
								<Moon className="size-4" />
								Dark
							</Button>
							<Button
								onClick={() => onThemeChange("light")}
								type="button"
								variant={theme === "light" ? "default" : "outline"}
							>
								<Sun className="size-4" />
								Light
							</Button>
						</div>
					</div>
				</section>
				<section className="mt-4 rounded-lg border border-border p-5">
					<div className="flex items-center justify-between gap-5 max-[720px]:flex-col max-[720px]:items-stretch">
						<div>
							<p className="text-sm font-medium text-foreground">Telemetry</p>
							<p className="mt-1 text-xs text-muted-foreground">
								Enable error and usage report to help us improve Cline.
							</p>
							{telemetryError ? (
								<p className="mt-2 text-xs text-destructive">
									Failed to update telemetry setting: {telemetryError}
								</p>
							) : null}
						</div>
						<Switch
							aria-label="Enable telemetry"
							checked={!telemetryOptOut}
							disabled={telemetryLoading || telemetrySaving}
							onCheckedChange={(checked) => void updateTelemetryEnabled(checked)}
						/>
					</div>
				</section>
				<section className="mt-4 rounded-lg border border-border p-5">
					<div className="flex flex-col gap-4">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<div className="flex min-w-0 items-center gap-2">
								<Globe2 className="size-4 text-muted-foreground" />
								<p className="text-sm font-medium text-foreground">
									Browser Automation
								</p>
							</div>
							<div className="flex items-center gap-2">
								<Badge variant={browserAvailable ? "default" : "outline"}>
									{browserAvailable ? "Available" : "Unavailable"}
								</Badge>
								<Button
									aria-label="Refresh browser status"
									disabled={browserStatusLoading}
									onClick={() => void loadBrowserStatus()}
									size="icon"
									type="button"
									variant="ghost"
								>
									{browserStatusLoading ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<RefreshCw className="size-4" />
									)}
								</Button>
							</div>
						</div>
						<div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
							<span className="rounded-md border bg-background px-1.5 py-0.5">
								Host: {browserStatus?.host ?? "cline-hub"}
							</span>
							<span className="rounded-md border bg-background px-1.5 py-0.5">
								Evaluate:{" "}
								{browserStatus?.safeBrowserEvaluateEnabled ? "on" : "off"}
							</span>
							<span className="rounded-md border bg-background px-1.5 py-0.5">
								Tools: {browserStatus?.toolNames?.length ?? 0}
							</span>
						</div>
						{browserStatusError || browserStatus?.reason ? (
							<div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
								{browserStatusError ?? browserStatus?.reason}
								{browserStatus?.nextStep ? ` ${browserStatus.nextStep}` : ""}
							</div>
						) : null}
						<div className="flex flex-col gap-2 md:flex-row">
							<Input
								aria-label="Browser URL"
								onChange={(event) => setBrowserUrl(event.target.value)}
								placeholder="http://127.0.0.1:3000"
								value={browserUrl}
							/>
							<div className="flex shrink-0 flex-wrap gap-2">
								<Button
									disabled={!browserAvailable || browserRunning}
									onClick={() => void runBrowserLaunch()}
									type="button"
									variant="outline"
								>
									{browserRunning ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Play className="size-4" />
									)}
									Launch
								</Button>
								<Button
									disabled={!browserAvailable || browserRunning}
									onClick={() => void runBrowserSnapshot()}
									type="button"
									variant="outline"
								>
									<Globe2 className="size-4" />
									Snapshot
								</Button>
								<Button
									disabled={!browserAvailable || browserRunning}
									onClick={() => void runBrowserScreenshot()}
									type="button"
									variant="outline"
								>
									<Camera className="size-4" />
									Screenshot
								</Button>
								<Button
									disabled={!browserAvailable || browserRunning}
									onClick={() => void runBrowserScroll("scroll_up")}
									type="button"
									variant="outline"
								>
									<ArrowUp className="size-4" />
									Scroll Up
								</Button>
								<Button
									disabled={!browserAvailable || browserRunning}
									onClick={() => void runBrowserScroll("scroll_down")}
									type="button"
									variant="outline"
								>
									<ArrowDown className="size-4" />
									Scroll Down
								</Button>
								<Button
									disabled={browserRunning}
									onClick={() => void runBrowserClose()}
									type="button"
									variant="outline"
								>
									<XCircle className="size-4" />
									Close
								</Button>
							</div>
						</div>
						<div className="grid gap-2 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto_auto]">
							<Input
								aria-label="Browser click coordinate"
								onChange={(event) => setBrowserCoordinate(event.target.value)}
								placeholder="x,y"
								value={browserCoordinate}
							/>
							<Input
								aria-label="Browser text input"
								onChange={(event) => setBrowserText(event.target.value)}
								placeholder="Text to type"
								value={browserText}
							/>
							<Button
								disabled={!browserAvailable || browserRunning}
								onClick={() => void runBrowserClick()}
								type="button"
								variant="outline"
							>
								<MousePointerClick className="size-4" />
								Click
							</Button>
							<Button
								disabled={!browserAvailable || browserRunning}
								onClick={() => void runBrowserType()}
								type="button"
								variant="outline"
							>
								<Keyboard className="size-4" />
								Type
							</Button>
						</div>
						<div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
							<Input
								aria-label="Browser evaluate JavaScript"
								disabled={!browserEvaluateEnabled}
								onChange={(event) => setBrowserEvaluateText(event.target.value)}
								placeholder="document.title"
								value={browserEvaluateText}
							/>
							<Button
								disabled={
									!browserAvailable || browserRunning || !browserEvaluateEnabled
								}
								onClick={() => void runBrowserEvaluate()}
								type="button"
								variant="outline"
							>
								<Keyboard className="size-4" />
								Evaluate
							</Button>
						</div>
						{browserResult ? (
							<Alert variant={browserResult.success ? "default" : "destructive"}>
								{browserResult.success ? (
									<CheckCircle2 className="size-4" />
								) : (
									<AlertTriangle className="size-4" />
								)}
								<AlertTitle>{browserResult.query}</AlertTitle>
								<AlertDescription>
									{browserSummary || (browserResult.success ? "done" : "failed")}
								</AlertDescription>
							</Alert>
						) : null}
						{browserScreenshot ? (
							<img
								alt="Browser automation screenshot"
								className="max-h-72 rounded-md border border-border object-contain"
								src={browserScreenshot}
							/>
						) : null}
					</div>
				</section>
			</div>
		</ScrollArea>
	);
}
