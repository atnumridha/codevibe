"use client";

import {
	AlertTriangle,
	Camera,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Globe2,
	Link2,
	Loader2,
	Moon,
	Play,
	RefreshCw,
	Sun,
	X,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
	type CursorMcpInstallResponse,
	type CursorRuleOpenResponse,
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

const PROVIDER_CATALOG_CACHE_TTL_MS = 60_000;

let providerCatalogCache: {
	providers: Provider[];
	fetchedAt: number;
} | null = null;

// -----------------------------------------------------------
// Component
// -----------------------------------------------------------

export function SettingsView({
	initialSection = "General",
	onClose,
	onNavigateSection,
	onThemeChange,
	theme,
}: {
	initialSection?: SettingsSection;
	onClose: () => void;
	onNavigateSection?: (section: SettingsSection) => void;
	onThemeChange: (theme: Theme) => void;
	theme: Theme;
}) {
	const [activeNav, setActiveNav] = useState<SettingsSection>(initialSection);
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
				accessToken: string;
			}>("run_provider_oauth_login", {
				provider: id,
			});
			setProvidersWithCache((prev) =>
				prev.map((provider) =>
					provider.id === id
						? {
								...provider,
								enabled: true,
								oauthAccessTokenPresent: result.accessToken.trim().length > 0,
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
						<CursorLinksContent />
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

function CursorLinksContent() {
	const [cursorUri, setCursorUri] = useState(DEFAULT_CURSOR_URI);
	const [preview, setPreview] = useState<
		CursorUriPreviewResponse | undefined
	>();
	const [previewError, setPreviewError] = useState<string | null>(null);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [installResult, setInstallResult] = useState<
		CursorMcpInstallResponse | undefined
	>();
	const [installError, setInstallError] = useState<string | null>(null);
	const [installLoading, setInstallLoading] = useState(false);
	const [ruleResult, setRuleResult] = useState<
		CursorRuleOpenResponse | undefined
	>();
	const [ruleError, setRuleError] = useState<string | null>(null);
	const [ruleLoading, setRuleLoading] = useState(false);

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
	const canInstallMcp = route === "mcp-install";
	const canOpenRule =
		route === "rule" && recordString(previewRecord, "kind") === "file";

	const runPreview = async () => {
		const uri = cursorUri.trim();
		if (!uri) {
			setPreview(undefined);
			setPreviewError("URI is required.");
			setInstallResult(undefined);
			setInstallError(null);
			setRuleResult(undefined);
			setRuleError(null);
			return;
		}
		setPreviewLoading(true);
		setPreviewError(null);
		setPreview(undefined);
		setInstallResult(undefined);
		setInstallError(null);
		setRuleResult(undefined);
		setRuleError(null);
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
		setInstallResult(undefined);
		setInstallError(null);
		setRuleResult(undefined);
		setRuleError(null);
	};

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

	return (
		<ScrollArea className="h-full">
			<div className="mx-auto max-w-3xl px-8 py-6">
				<div className="mb-6 flex items-center gap-2">
					<Link2 className="size-4 text-muted-foreground" />
					<h2 className="text-lg font-semibold text-foreground">
						Cursor Links
					</h2>
				</div>
				<section className="rounded-lg border border-border p-5">
					<div className="flex flex-col gap-3">
						<div className="flex flex-wrap gap-1.5">
							{[
								"/createchat",
								"/background-agent",
								"/mcp/install",
								"/settings",
								"/prompt",
								"/command",
								"/rule",
								"/plugin/add",
								"/glass",
							].map((item) => (
								<Badge key={item} variant="outline">
									{item}
								</Badge>
							))}
						</div>
						<Textarea
							aria-label="Cursor-compatible URI"
							className="min-h-28 resize-y font-mono text-xs"
							onChange={(event) => updateCursorUri(event.target.value)}
							placeholder="vscode://cline.cline/createchat?prompt=..."
							value={cursorUri}
						/>
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
	const [browserRunning, setBrowserRunning] = useState(false);
	const [browserResult, setBrowserResult] = useState<
		BrowserToolResult | undefined
	>();
	const browserAvailable = browserStatus?.available === true;
	const browserResultPayload = asRecord(browserResult?.result);
	const browserScreenshot = recordString(browserResultPayload, "screenshot");
	const browserSummary = browserResultSummary(browserResult);

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

	const updateTelemetryOptOut = async (nextValue: boolean) => {
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
								Use the light or dark Cline Hub interface.
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
							aria-label="Telemetry opt-out"
							checked={!telemetryOptOut} // If opt-out is true, the switch should be off (unchecked)
							disabled={telemetryLoading || telemetrySaving}
							onCheckedChange={(checked) => void updateTelemetryOptOut(checked)}
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
									onClick={() => void runBrowserScreenshot()}
									type="button"
									variant="outline"
								>
									<Camera className="size-4" />
									Screenshot
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
