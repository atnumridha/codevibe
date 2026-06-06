"use client";

import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { desktopClient } from "@/lib/desktop-client";
import type {
	Provider,
	ProviderCatalogResponse,
	ProviderModelsResponse,
	ProviderSettingsUpdate,
} from "@/lib/provider-schema";
import { cn } from "@/lib/utils";
import { AccountView } from "./account-view";
import { AddProviderContent, type AddProviderPayload } from "./add-provider";
import {
	CursorUriView,
	type CursorSettingsOpenRequest,
	type CursorUriIntent,
} from "./cursor-uri-view";
import {
	primeExtensionsListsCache,
	RulesView,
	type ExtensionTabIntent,
	type ShortcutTab,
} from "./extensions-view";
import { McpServersContent } from "./mcp-view";
import {
	ProviderDetailContent,
	ProviderListContent,
	toSettingsPatch,
} from "./provider-list-view";
import {
	primeRoutineOverviewCache,
	RoutineSchedulesContent,
} from "./routine-view";

// -----------------------------------------------------------
// Settings nav categories
// -----------------------------------------------------------

const navCategories = [
	"General",
	"Providers",
	"Extensions",
	"MCP",
	"Routine",
	"Features",
	"Account",
] as const;

type NavCategory = (typeof navCategories)[number];

const PROVIDER_CATALOG_CACHE_TTL_MS = 60_000;

let providerCatalogCache: {
	providers: Provider[];
	fetchedAt: number;
} | null = null;

function normalizeCursorSettingsValue(value: string | undefined): string {
	return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function valueMatchesAny(value: string, needles: string[]): boolean {
	return needles.some((needle) => value.includes(needle));
}

function findProviderForSettingsQuery(
	query: string,
	providers: Provider[],
): Provider | undefined {
	if (!query) {
		return undefined;
	}
	return providers.find((provider) => {
		const providerId = normalizeCursorSettingsValue(provider.id);
		const providerName = normalizeCursorSettingsValue(provider.name);
		return (
			providerId.includes(query) ||
			providerName.includes(query) ||
			query.includes(providerId)
		);
	});
}

function extensionTabForSettingsQuery(
	query: string,
): ShortcutTab | undefined {
	if (
		valueMatchesAny(query, ["customization", "customizations", "rule", "rules"])
	) {
		return "Rules";
	}
	if (valueMatchesAny(query, ["hook", "hooks"])) {
		return "Hooks";
	}
	if (valueMatchesAny(query, ["skill", "skills", "workflow", "workflows"])) {
		return "Skills";
	}
	if (valueMatchesAny(query, ["agent", "agents", "subagent", "subagents"])) {
		return "Agents";
	}
	if (valueMatchesAny(query, ["plugin", "plugins"])) {
		return "Plugins";
	}
	if (valueMatchesAny(query, ["tool", "tools"])) {
		return "Tools";
	}
	return undefined;
}

function resolveCursorSettingsTarget(
	request: CursorSettingsOpenRequest,
	providers: Provider[],
): {
	nav: NavCategory;
	providerId?: string;
	extensionTab?: ShortcutTab;
} {
	const query = normalizeCursorSettingsValue(request.query);
	if (!query) {
		return { nav: "General" };
	}

	const provider = findProviderForSettingsQuery(query, providers);
	if (provider) {
		return { nav: "Providers", providerId: provider.id };
	}
	if (valueMatchesAny(query, ["mcp", "modelcontextprotocol"])) {
		return { nav: "MCP" };
	}
	if (
		valueMatchesAny(query, ["account", "auth", "login", "signin", "codexauth"])
	) {
		return { nav: "Account" };
	}
	if (valueMatchesAny(query, ["routine", "routines", "schedule", "schedules"])) {
		return { nav: "Routine" };
	}
	if (valueMatchesAny(query, ["extension", "extensions"])) {
		return { nav: "Extensions", extensionTab: "Rules" };
	}

	const extensionTab = extensionTabForSettingsQuery(query);
	if (extensionTab) {
		return { nav: "Extensions", extensionTab };
	}
	if (valueMatchesAny(query, ["provider", "providers", "model", "models"])) {
		return { nav: "Providers" };
	}
	if (
		valueMatchesAny(query, ["feature", "features", "cursor", "uri", "deeplink"])
	) {
		return { nav: "Features" };
	}
	if (valueMatchesAny(query, ["general", "settings", "preferences"])) {
		return { nav: "General" };
	}
	return { nav: "General" };
}

// -----------------------------------------------------------
// Component
// -----------------------------------------------------------

export function SettingsView({
	onClose,
	incomingCursorUri,
}: {
	onClose: () => void;
	incomingCursorUri?: CursorUriIntent | null;
}) {
	const [activeNav, setActiveNav] = useState<NavCategory>("Providers");
	const [providersExpanded, setProvidersExpanded] = useState(true);
	const settingsIntentSequenceRef = useRef(0);
	const [extensionTabIntent, setExtensionTabIntent] =
		useState<ExtensionTabIntent | null>(null);
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
		void loadProviderCatalog();
		void primeRoutineOverviewCache().catch(() => {
			// Keep settings responsive even if routine prefetch fails.
		});
		void primeExtensionsListsCache().catch(() => {
			// Keep settings responsive even if extension prefetch fails.
		});
	}, [loadProviderCatalog]);

	useEffect(() => {
		if (!incomingCursorUri) {
			return;
		}
		setActiveNav("Features");
		setSelectedProviderId(null);
		setAddingProvider(false);
	}, [incomingCursorUri]);

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
		setSelectedProviderId(id);
	};

	const openCursorSettingsTarget = useCallback(
		(request: CursorSettingsOpenRequest) => {
			const target = resolveCursorSettingsTarget(request, providers);
			setActiveNav(target.nav);
			setAddingProvider(false);
			if (target.nav === "Providers") {
				setProvidersExpanded(true);
				setSelectedProviderId(target.providerId ?? null);
			} else {
				setSelectedProviderId(null);
			}
			if (target.nav === "Extensions" && target.extensionTab) {
				settingsIntentSequenceRef.current += 1;
				setExtensionTabIntent({
					id: settingsIntentSequenceRef.current,
					tab: target.extensionTab,
				});
			}
		},
		[providers],
	);

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
		void loadProviderModels(selectedProviderId);
	}, [loadProviderModels, providers, selectedProviderId]);

	const backToProviderList = () => {
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
		setSelectedProviderId(null);
		setAddingProvider(true);
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
													setActiveNav("Providers");
													setSelectedProviderId(null);
													setAddingProvider(false);
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
											setActiveNav(cat);
											setSelectedProviderId(null);
											setAddingProvider(false);
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
					) : activeNav === "Routine" ? (
						<RoutineSchedulesContent />
					) : activeNav === "Extensions" ? (
						<RulesView activeTabIntent={extensionTabIntent} />
					) : activeNav === "Features" ? (
						<CursorUriView
							incomingUri={incomingCursorUri}
							onOpenSettings={openCursorSettingsTarget}
						/>
					) : activeNav === "Account" ? (
						<AccountView />
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
