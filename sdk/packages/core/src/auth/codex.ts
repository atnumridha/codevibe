/**
 * OpenAI Codex (ChatGPT OAuth) flow
 *
 * NOTE: This module uses Node.js crypto and http for the OAuth callback.
 * It is only intended for CLI use, not browser environments.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ITelemetryService } from "@cline/shared";
import { nanoid } from "nanoid";
import {
	captureAuthFailed,
	captureAuthLoggedOut,
	captureAuthStarted,
	captureAuthSucceeded,
	identifyAccount,
} from "../services/telemetry/core-events";
import { startLocalOAuthServer } from "./server";
import type {
	OAuthCredentials,
	OAuthLoginCallbacks,
	OAuthPrompt,
	OAuthProviderInterface,
} from "./types";
import {
	decodeJwtPayload,
	getProofKey,
	isCredentialLikelyExpired,
	parseAuthorizationInput,
	parseOAuthError,
	resolveAuthorizationCodeInput,
} from "./utils";

export const OPENAI_CODEX_OAUTH_CONFIG = {
	authorizationEndpoint: "https://auth.openai.com/oauth/authorize",
	tokenEndpoint: "https://auth.openai.com/oauth/token",
	clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
	redirectUri: "http://localhost:1455/auth/callback",
	scopes: "openid profile email offline_access",
	callbackPort: 1455,
	jwtClaimPath: "https://api.openai.com/auth",
	refreshBufferMs: 5 * 60 * 1000,
	retryableTokenGraceMs: 30 * 1000,
	httpTimeoutMs: 30 * 1000,
} as const;

export const OPENAI_CODEX_ORIGINATOR = "codie";

type CodexTokenSuccess = {
	type: "success";
	access: string;
	refresh: string;
	expires: number;
	email?: string;
	idToken?: string;
};
type CodexTokenFailure = { type: "failed" };
type CodexTokenResult = CodexTokenSuccess | CodexTokenFailure;
export type RefreshTokenResolution = {
	forceRefresh?: boolean;
	refreshBufferMs?: number;
	retryableTokenGraceMs?: number;
};

type JwtPayload = {
	[OPENAI_CODEX_OAUTH_CONFIG.jwtClaimPath]?: {
		chatgpt_account_id?: string;
	};
	[key: string]: unknown;
};

interface CodexHomeAuthJson {
	tokens?: {
		access_token?: string;
		refresh_token?: string;
		id_token?: string;
		account_id?: string;
	};
	auth_mode?: string;
}

interface CodexHomeModelsCacheJson {
	client_version?: string;
}

class OpenAICodexOAuthTokenError extends Error {
	public readonly status?: number;
	public readonly errorCode?: string;

	constructor(message: string, opts?: { status?: number; errorCode?: string }) {
		super(message);
		this.name = "OpenAICodexOAuthTokenError";
		this.status = opts?.status;
		this.errorCode = opts?.errorCode;
	}

	public isLikelyInvalidGrant(): boolean {
		if (this.errorCode && /invalid_grant/i.test(this.errorCode)) {
			return true;
		}
		if (this.status === 400 || this.status === 401 || this.status === 403) {
			return /invalid_grant|revoked|expired|invalid refresh/i.test(
				this.message,
			);
		}
		return false;
	}
}

function redactKnownSecret(text: string | undefined, secret: string): string | undefined {
	if (!text) {
		return undefined;
	}
	const trimmedSecret = secret.trim();
	if (!trimmedSecret) {
		return text;
	}
	return text.split(trimmedSecret).join("[REDACTED]");
}

async function exchangeAuthorizationCode(
	code: string,
	verifier: string,
	redirectUri: string = OPENAI_CODEX_OAUTH_CONFIG.redirectUri,
): Promise<CodexTokenResult> {
	const response = await fetch(OPENAI_CODEX_OAUTH_CONFIG.tokenEndpoint, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: OPENAI_CODEX_OAUTH_CONFIG.clientId,
			code,
			code_verifier: verifier,
			redirect_uri: redirectUri,
		}),
		signal: AbortSignal.timeout(OPENAI_CODEX_OAUTH_CONFIG.httpTimeoutMs),
	});

	if (!response.ok) {
		return { type: "failed" };
	}

	const json = (await response.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
		email?: string;
		id_token?: string;
	};

	if (
		!json.access_token ||
		!json.refresh_token ||
		typeof json.expires_in !== "number"
	) {
		return { type: "failed" };
	}

	return {
		type: "success",
		access: json.access_token,
		refresh: json.refresh_token,
		expires: Date.now() + json.expires_in * 1000,
		email: json.email,
		idToken: json.id_token,
	};
}

async function refreshAccessToken(
	refreshToken: string,
): Promise<CodexTokenResult> {
	try {
		const response = await fetch(OPENAI_CODEX_OAUTH_CONFIG.tokenEndpoint, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
				client_id: OPENAI_CODEX_OAUTH_CONFIG.clientId,
			}),
			signal: AbortSignal.timeout(OPENAI_CODEX_OAUTH_CONFIG.httpTimeoutMs),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			const details = parseOAuthError(text);
			const safeMessage = redactKnownSecret(details.message, refreshToken);
			throw new OpenAICodexOAuthTokenError(
				`Token refresh failed: ${response.status}${safeMessage ? ` - ${safeMessage}` : ""}`,
				{ status: response.status, errorCode: details.code },
			);
		}

		const json = (await response.json()) as {
			access_token?: string;
			refresh_token?: string;
			expires_in?: number;
			email?: string;
			id_token?: string;
		};

		if (
			!json.access_token ||
			!json.refresh_token ||
			typeof json.expires_in !== "number"
		) {
			return { type: "failed" };
		}

		return {
			type: "success",
			access: json.access_token,
			refresh: json.refresh_token,
			expires: Date.now() + json.expires_in * 1000,
			email: json.email,
			idToken: json.id_token,
		};
	} catch (error) {
		if (error instanceof OpenAICodexOAuthTokenError) {
			throw error;
		}
		return { type: "failed" };
	}
}

export async function createAuthorizationFlow(
	originator = OPENAI_CODEX_ORIGINATOR,
): Promise<{ verifier: string; state: string; url: string }> {
	const { verifier, challenge } = await getProofKey();
	const state = nanoid(32);

	const url = new URL(OPENAI_CODEX_OAUTH_CONFIG.authorizationEndpoint);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", OPENAI_CODEX_OAUTH_CONFIG.clientId);
	url.searchParams.set("redirect_uri", OPENAI_CODEX_OAUTH_CONFIG.redirectUri);
	url.searchParams.set("scope", OPENAI_CODEX_OAUTH_CONFIG.scopes);
	url.searchParams.set("code_challenge", challenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", state);
	url.searchParams.set("id_token_add_organizations", "true");
	url.searchParams.set("codex_cli_simplified_flow", "true");
	url.searchParams.set("originator", originator);

	return { verifier, state, url: url.toString() };
}

function resolveCallbackServerConfig(): {
	host: string;
	port: number;
	callbackPath: string;
	redirectUri: string;
} {
	try {
		const redirect = new URL(OPENAI_CODEX_OAUTH_CONFIG.redirectUri);
		const parsedPort =
			redirect.port.length > 0
				? Number.parseInt(redirect.port, 10)
				: OPENAI_CODEX_OAUTH_CONFIG.callbackPort;
		return {
			host: redirect.hostname || "localhost",
			port: Number.isFinite(parsedPort)
				? parsedPort
				: OPENAI_CODEX_OAUTH_CONFIG.callbackPort,
			callbackPath: redirect.pathname || "/auth/callback",
			redirectUri: redirect.toString(),
		};
	} catch {
		return {
			host: "localhost",
			port: OPENAI_CODEX_OAUTH_CONFIG.callbackPort,
			callbackPath: "/auth/callback",
			redirectUri: OPENAI_CODEX_OAUTH_CONFIG.redirectUri,
		};
	}
}

function getAccessTokenAccountId(accessToken: string): string | null {
	const accessPayload = decodeJwtPayload(accessToken) as JwtPayload | null;
	return getAccountIdFromPayload(accessPayload, {
		includeOrganizations: false,
	});
}

function getJwtFallbackAccountId(accessToken: string, idToken?: string): string | null {
	const accessPayload = decodeJwtPayload(accessToken) as JwtPayload | null;
	const idPayload = idToken ? (decodeJwtPayload(idToken) as JwtPayload | null) : null;

	const idAccountId = getAccountIdFromPayload(idPayload, {
		includeOrganizations: true,
	});
	if (idAccountId) {
		return idAccountId;
	}

	return getAccountIdFromPayload(accessPayload, {
		includeOrganizations: true,
	});
}

function getAccountId(accessToken: string, idToken?: string): string | null {
	return (
		getAccessTokenAccountId(accessToken) ??
		getJwtFallbackAccountId(accessToken, idToken)
	);
}

function getAccountIdFromPayload(
	payload: JwtPayload | null,
	options: { includeOrganizations: boolean },
): string | null {
	const auth = payload?.[OPENAI_CODEX_OAUTH_CONFIG.jwtClaimPath];
	const accountId = auth?.chatgpt_account_id;
	if (typeof accountId === "string" && accountId.length > 0) {
		return accountId;
	}

	const organizations = payload?.organizations;
	if (
		options.includeOrganizations &&
		Array.isArray(organizations) &&
		organizations.length > 0
	) {
		const first = organizations[0] as { id?: unknown } | undefined;
		if (typeof first?.id === "string" && first.id.length > 0) {
			return first.id;
		}
	}

	const rootAccountId = payload?.chatgpt_account_id;
	if (typeof rootAccountId === "string" && rootAccountId.length > 0) {
		return rootAccountId;
	}

	return null;
}

function toCodexCredentials(
	result: CodexTokenSuccess,
	fallback?: OAuthCredentials,
): OAuthCredentials {
	const accountId =
		getAccountId(result.access, result.idToken) ?? fallback?.accountId;
	if (!accountId) {
		throw new Error("Failed to extract accountId from token");
	}

	return {
		access: result.access,
		refresh: result.refresh || fallback?.refresh || "",
		expires: result.expires,
		accountId,
		email: result.email ?? fallback?.email,
		metadata: {
			...(fallback?.metadata ?? {}),
			provider: "openai-codex",
		},
	};
}

export type OpenAICodexHomeCredentialsOptions = {
	codexHome?: string;
	workspaceRoots?: readonly string[];
	now?: () => number;
};

function resolveCodexHomePathCandidates(
	options?: Pick<
		OpenAICodexHomeCredentialsOptions,
		"codexHome" | "workspaceRoots"
	>,
): string[] {
	const explicitCodexHome = options?.codexHome?.trim();
	if (explicitCodexHome) {
		return [resolve(explicitCodexHome)];
	}

	const envCodexHome = process.env.CODEX_HOME?.trim();
	if (envCodexHome) {
		return [resolve(envCodexHome)];
	}

	const candidates: string[] = [];
	const seen = new Set<string>();
	const addCandidate = (candidate: string | undefined): void => {
		const trimmed = candidate?.trim();
		if (!trimmed) {
			return;
		}
		const normalized = resolve(trimmed);
		if (seen.has(normalized)) {
			return;
		}
		seen.add(normalized);
		candidates.push(normalized);
	};

	for (const workspaceRoot of options?.workspaceRoots ?? []) {
		const trimmedRoot = workspaceRoot?.trim();
		if (trimmedRoot) {
			addCandidate(join(trimmedRoot, ".codex"));
		}
	}
	addCandidate(join(process.cwd(), ".codex"));
	addCandidate(join(homedir(), ".codex"));
	return candidates;
}

function readOptionalTextSync(filePath: string): string | undefined {
	if (!existsSync(filePath)) {
		return undefined;
	}
	return readFileSync(filePath, "utf8");
}

function parseJsonObject<T>(text: string): T {
	const parsed = JSON.parse(text) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Expected JSON object");
	}
	return parsed as T;
}

function parseOptionalJsonObject<T>(text: string | undefined): T | undefined {
	if (!text) {
		return undefined;
	}
	try {
		return parseJsonObject<T>(text);
	} catch {
		return undefined;
	}
}

function getJwtExpiryMs(accessToken: string, now: () => number): number {
	const payload = decodeJwtPayload(accessToken) as { exp?: unknown } | null;
	return typeof payload?.exp === "number" && Number.isFinite(payload.exp)
		? payload.exp * 1000
		: now() + 60 * 60 * 1000;
}

function getJwtEmail(accessToken: string, idToken?: string): string | undefined {
	for (const token of [idToken, accessToken]) {
		if (!token) continue;
		const payload = decodeJwtPayload(token) as { email?: unknown } | null;
		if (typeof payload?.email === "string" && payload.email.length > 0) {
			return payload.email;
		}
	}
	return undefined;
}

function loadOpenAICodexHomeCredentialsFromPathSync(
	codexHome: string,
	options?: Pick<OpenAICodexHomeCredentialsOptions, "now">,
): OAuthCredentials | null {
	const authText = readOptionalTextSync(join(codexHome, "auth.json"));
	if (!authText) {
		return null;
	}

	const authJson = parseJsonObject<CodexHomeAuthJson>(authText);
	const accessToken = authJson.tokens?.access_token?.trim();
	const refreshToken = authJson.tokens?.refresh_token?.trim();
	if (!accessToken || !refreshToken) {
		return null;
	}

	const idToken = authJson.tokens?.id_token?.trim() || undefined;
	const installationId =
		readOptionalTextSync(join(codexHome, "installation_id"))?.trim() ||
		undefined;
	const modelsCacheText = readOptionalTextSync(join(codexHome, "models_cache.json"));
	const modelsCache =
		parseOptionalJsonObject<CodexHomeModelsCacheJson>(modelsCacheText);
	const clientVersion =
		typeof modelsCache?.client_version === "string" &&
		modelsCache.client_version.trim().length > 0
			? modelsCache.client_version.trim()
			: undefined;
	const tokenAccountId = authJson.tokens?.account_id?.trim() || undefined;
	const accountId =
		getAccessTokenAccountId(accessToken) ??
		tokenAccountId ??
		getJwtFallbackAccountId(accessToken, idToken);

	return {
		access: accessToken,
		refresh: refreshToken,
		expires: getJwtExpiryMs(accessToken, options?.now ?? Date.now),
		accountId: accountId ?? tokenAccountId,
		email: getJwtEmail(accessToken, idToken),
		metadata: {
			provider: "openai-codex",
			tokenSource: "codex-home",
			...(installationId ? { installationId } : {}),
			...(clientVersion ? { clientVersion } : {}),
			...(authJson.auth_mode ? { authMode: authJson.auth_mode } : {}),
		},
	};
}

export function loadOpenAICodexHomeCredentialsSync(
	options?: OpenAICodexHomeCredentialsOptions,
): OAuthCredentials | null {
	for (const codexHome of resolveCodexHomePathCandidates(options)) {
		const credentials = loadOpenAICodexHomeCredentialsFromPathSync(
			codexHome,
			options,
		);
		if (credentials) {
			return credentials;
		}
	}
	return null;
}

export async function loginOpenAICodex(options: {
	onAuth: (info: { url: string; instructions?: string }) => void;
	onPrompt: (prompt: OAuthPrompt) => Promise<string>;
	onProgress?: (message: string) => void;
	onManualCodeInput?: () => Promise<string>;
	originator?: string;
	telemetry?: ITelemetryService;
}): Promise<OAuthCredentials> {
	captureAuthStarted(options.telemetry, "openai-codex");
	const callbackConfig = resolveCallbackServerConfig();
	const { verifier, state, url } = await createAuthorizationFlow(
		options.originator,
	);
	const server = await startLocalOAuthServer({
		host: callbackConfig.host,
		ports: [callbackConfig.port],
		callbackPath: callbackConfig.callbackPath,
		expectedState: state,
	});

	options.onAuth({
		url,
		instructions: "Continue the authentication process in your browser.",
	});

	let code: string | undefined;
	try {
		const authResult = await resolveAuthorizationCodeInput({
			waitForCallback: server.waitForCallback,
			cancelWait: server.cancelWait,
			onManualCodeInput: options.onManualCodeInput,
			parseOptions: { allowHashCodeState: true },
		});
		if (authResult.state && authResult.state !== state) {
			throw new Error("State mismatch");
		}
		code = authResult.code;

		// Fallback to onPrompt if still no code
		if (!code) {
			const input = await options.onPrompt({
				message: "Paste the authorization code (or full redirect URL):",
			});
			const parsed = parseAuthorizationInput(input, {
				allowHashCodeState: true,
			});
			if (parsed.state && parsed.state !== state) {
				throw new Error("State mismatch");
			}
			code = parsed.code;
		}

		if (!code) {
			throw new Error("Missing authorization code");
		}

		const tokenResult = await exchangeAuthorizationCode(
			code,
			verifier,
			callbackConfig.redirectUri,
		);
		if (tokenResult.type !== "success") {
			throw new Error("Token exchange failed");
		}

		const credentials = toCodexCredentials(tokenResult);
		captureAuthSucceeded(options.telemetry, "openai-codex");
		identifyAccount(options.telemetry, {
			id: credentials.accountId,
			email: credentials.email,
			provider: "openai-codex",
		});
		return credentials;
	} catch (error) {
		captureAuthFailed(
			options.telemetry,
			"openai-codex",
			error instanceof Error ? error.message : String(error),
		);
		throw error;
	} finally {
		server.close();
	}
}

export async function refreshOpenAICodexToken(
	refreshToken: string,
	fallback?: OAuthCredentials,
): Promise<OAuthCredentials> {
	const result = await refreshAccessToken(refreshToken);
	if (result.type !== "success") {
		throw new Error("Failed to refresh OpenAI Codex token");
	}

	const normalized = toCodexCredentials(result, fallback);
	if (!normalized.refresh) {
		throw new Error(
			"Failed to refresh OpenAI Codex token: missing refresh token",
		);
	}
	return normalized;
}

export async function getValidOpenAICodexCredentials(
	currentCredentials: OAuthCredentials | null,
	options?: RefreshTokenResolution & { telemetry?: ITelemetryService },
): Promise<OAuthCredentials | null> {
	if (!currentCredentials) {
		return null;
	}

	const refreshBufferMs =
		options?.refreshBufferMs ?? OPENAI_CODEX_OAUTH_CONFIG.refreshBufferMs;
	const retryableTokenGraceMs =
		options?.retryableTokenGraceMs ??
		OPENAI_CODEX_OAUTH_CONFIG.retryableTokenGraceMs;
	const forceRefresh = options?.forceRefresh === true;

	if (
		!forceRefresh &&
		!isCredentialLikelyExpired(currentCredentials, refreshBufferMs)
	) {
		return currentCredentials;
	}

	try {
		const refreshed = await refreshOpenAICodexToken(
			currentCredentials.refresh,
			currentCredentials,
		);
		return refreshed;
	} catch (error) {
		if (
			error instanceof OpenAICodexOAuthTokenError &&
			error.isLikelyInvalidGrant()
		) {
			captureAuthLoggedOut(options?.telemetry, "openai-codex", "invalid_grant");
			return null;
		}
		if (currentCredentials.expires - Date.now() > retryableTokenGraceMs) {
			return currentCredentials;
		}
		return null;
	}
}

export function isOpenAICodexTokenExpired(
	credentials: OAuthCredentials,
	refreshBufferMs: number = OPENAI_CODEX_OAUTH_CONFIG.refreshBufferMs,
): boolean {
	return isCredentialLikelyExpired(credentials, refreshBufferMs);
}

export function normalizeOpenAICodexCredentials(
	credentials: OAuthCredentials,
): OAuthCredentials {
	const idToken =
		typeof credentials.metadata?.idToken === "string"
			? credentials.metadata.idToken
			: undefined;
	const accountId =
		credentials.accountId ?? getAccountId(credentials.access, idToken);
	if (!accountId) {
		throw new Error("Failed to extract accountId from token");
	}
	const metadata = { ...(credentials.metadata ?? {}) };
	delete metadata.idToken;
	return {
		...credentials,
		accountId,
		metadata: {
			...metadata,
			provider: "openai-codex",
		},
	};
}

export const openaiCodexOAuthProvider: OAuthProviderInterface = {
	id: "openai-codex",
	name: "Codie",
	usesCallbackServer: true,

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		return loginOpenAICodex({
			onAuth: callbacks.onAuth,
			onPrompt: callbacks.onPrompt,
			onProgress: callbacks.onProgress,
			onManualCodeInput: callbacks.onManualCodeInput,
			originator: OPENAI_CODEX_ORIGINATOR,
		});
	},

	async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
		return refreshOpenAICodexToken(credentials.refresh, credentials);
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},
};
