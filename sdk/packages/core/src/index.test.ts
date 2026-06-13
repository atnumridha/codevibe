import { describe, expect, it } from "vitest";
import {
	ClineAccountService,
	ClineCore,
	completeClineDeviceAuth,
	completeCodieDeviceAuth,
	CodieAccountService,
	CodieCore,
	createClineOAuthProvider,
	createClineTelemetryServiceConfig,
	createClineTelemetryServiceMetadata,
	createCodieOAuthProvider,
	createCodieTelemetryServiceConfig,
	createCodieTelemetryServiceMetadata,
	executeClineAccountAction,
	executeCodieAccountAction,
	FALLBACK_CLINE_RECOMMENDED_MODELS,
	FALLBACK_CODIE_RECOMMENDED_MODELS,
	fetchClineRecommendedModels,
	fetchCodieRecommendedModels,
	getClineDefaultSystemPrompt,
	getCodieDefaultSystemPrompt,
	getValidClineCredentials,
	getValidCodieCredentials,
	isClineAccountActionRequest,
	isCodieAccountActionRequest,
	loginClineOAuth,
	loginCodieOAuth,
	refreshClineToken,
	refreshCodieToken,
	resolveLocalClineAuthToken,
	resolveLocalCodieAuthToken,
	RpcClineAccountService,
	RpcCodieAccountService,
	startClineDeviceAuth,
	startCodieDeviceAuth,
	type ClineAccountActionRequest,
	type ClineAccountBalance,
	type ClineAccountOperations,
	type ClineAccountOrganization,
	type ClineAccountOrganizationBalance,
	type ClineAccountOrganizationUsageTransaction,
	type ClineAccountPaymentTransaction,
	type ClineAccountServiceOptions,
	type ClineAccountUsageTransaction,
	type ClineAccountUser,
	type CodieCoreAutomationApi,
	type CodieCoreAutomationOptions,
	type CodieCoreListHistoryOptions,
	type CodieCoreOptions,
	type CodieCoreSettingsApi,
	type CodieCoreStartInput,
	type ClineCoreAutomationApi,
	type ClineCoreAutomationOptions,
	type ClineCoreListHistoryOptions,
	type ClineCoreOptions,
	type ClineCoreSettingsApi,
	type ClineCoreStartInput,
	type ClineOAuthCredentials,
	type ClineOAuthProviderOptions,
	type ClineOrganization,
	type ClineRecommendedModel,
	type ClineRecommendedModelsData,
	type ClineSystemPromptOptions,
	type ClineTelemetryServiceConfig,
	type ClineTokenResolution,
	type CodieAccountActionRequest,
	type CodieAccountBalance,
	type CodieAccountOperations,
	type CodieAccountOrganization,
	type CodieAccountOrganizationBalance,
	type CodieAccountOrganizationUsageTransaction,
	type CodieAccountPaymentTransaction,
	type CodieAccountServiceOptions,
	type CodieAccountUsageTransaction,
	type CodieAccountUser,
	type CodieOAuthCredentials,
	type CodieOAuthProviderOptions,
	type CodieOrganization,
	type CodieRecommendedModel,
	type CodieRecommendedModelsData,
	type CodieSystemPromptOptions,
	type CodieTelemetryServiceConfig,
	type CodieTokenResolution,
	type FetchClineRecommendedModelsOptions,
	type FetchCodieRecommendedModelsOptions,
} from "./index";
import { CodieCore as CodieCoreFromTypes } from "./types";
import type {
	CodieCoreAutomationApi as CodieCoreAutomationApiFromTypes,
	CodieCoreAutomationOptions as CodieCoreAutomationOptionsFromTypes,
	CodieCoreListHistoryOptions as CodieCoreListHistoryOptionsFromTypes,
	CodieCoreOptions as CodieCoreOptionsFromTypes,
	CodieCoreSettingsApi as CodieCoreSettingsApiFromTypes,
	CodieCoreStartInput as CodieCoreStartInputFromTypes,
} from "./types";

type Assert<T extends true> = T;
type IsSame<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
			? true
			: false
		: false;

type AliasAssertions = readonly [
	Assert<IsSame<CodieCoreOptions, ClineCoreOptions>>,
	Assert<IsSame<CodieCoreStartInput, ClineCoreStartInput>>,
	Assert<IsSame<CodieCoreListHistoryOptions, ClineCoreListHistoryOptions>>,
	Assert<IsSame<CodieCoreAutomationApi, ClineCoreAutomationApi>>,
	Assert<IsSame<CodieCoreAutomationOptions, ClineCoreAutomationOptions>>,
	Assert<IsSame<CodieCoreSettingsApi, ClineCoreSettingsApi>>,
	Assert<IsSame<CodieCoreOptionsFromTypes, ClineCoreOptions>>,
	Assert<IsSame<CodieCoreStartInputFromTypes, ClineCoreStartInput>>,
	Assert<IsSame<CodieCoreListHistoryOptionsFromTypes, ClineCoreListHistoryOptions>>,
	Assert<IsSame<CodieCoreAutomationApiFromTypes, ClineCoreAutomationApi>>,
	Assert<IsSame<CodieCoreAutomationOptionsFromTypes, ClineCoreAutomationOptions>>,
	Assert<IsSame<CodieCoreSettingsApiFromTypes, ClineCoreSettingsApi>>,
	Assert<IsSame<CodieSystemPromptOptions, ClineSystemPromptOptions>>,
	Assert<IsSame<CodieTelemetryServiceConfig, ClineTelemetryServiceConfig>>,
	Assert<IsSame<CodieAccountActionRequest, ClineAccountActionRequest>>,
	Assert<IsSame<CodieAccountOperations, ClineAccountOperations>>,
	Assert<IsSame<CodieAccountBalance, ClineAccountBalance>>,
	Assert<IsSame<CodieAccountOrganization, ClineAccountOrganization>>,
	Assert<IsSame<CodieAccountOrganizationBalance, ClineAccountOrganizationBalance>>,
	Assert<IsSame<CodieAccountOrganizationUsageTransaction, ClineAccountOrganizationUsageTransaction>>,
	Assert<IsSame<CodieAccountPaymentTransaction, ClineAccountPaymentTransaction>>,
	Assert<IsSame<CodieAccountServiceOptions, ClineAccountServiceOptions>>,
	Assert<IsSame<CodieAccountUsageTransaction, ClineAccountUsageTransaction>>,
	Assert<IsSame<CodieAccountUser, ClineAccountUser>>,
	Assert<IsSame<CodieOrganization, ClineOrganization>>,
	Assert<IsSame<CodieOAuthCredentials, ClineOAuthCredentials>>,
	Assert<IsSame<CodieOAuthProviderOptions, ClineOAuthProviderOptions>>,
	Assert<IsSame<CodieTokenResolution, ClineTokenResolution>>,
	Assert<IsSame<CodieRecommendedModel, ClineRecommendedModel>>,
	Assert<IsSame<CodieRecommendedModelsData, ClineRecommendedModelsData>>,
	Assert<IsSame<FetchCodieRecommendedModelsOptions, FetchClineRecommendedModelsOptions>>,
];

const aliasAssertions: AliasAssertions = [
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
];

describe("SDK Codie compatibility exports", () => {
	it("exports CodieCore as a runtime alias for ClineCore", () => {
		expect(CodieCore).toBe(ClineCore);
		expect(CodieCoreFromTypes).toBe(ClineCore);
		expect(aliasAssertions.every(Boolean)).toBe(true);
	});

	it("exports Codie-named runtime aliases for legacy compatibility symbols", () => {
		expect(getCodieDefaultSystemPrompt).toBe(getClineDefaultSystemPrompt);
		expect(createCodieTelemetryServiceConfig).toBe(createClineTelemetryServiceConfig);
		expect(createCodieTelemetryServiceMetadata).toBe(createClineTelemetryServiceMetadata);
		expect(CodieAccountService).toBe(ClineAccountService);
		expect(RpcCodieAccountService).toBe(RpcClineAccountService);
		expect(executeCodieAccountAction).toBe(executeClineAccountAction);
		expect(isCodieAccountActionRequest).toBe(isClineAccountActionRequest);
		expect(completeCodieDeviceAuth).toBe(completeClineDeviceAuth);
		expect(createCodieOAuthProvider).toBe(createClineOAuthProvider);
		expect(getValidCodieCredentials).toBe(getValidClineCredentials);
		expect(loginCodieOAuth).toBe(loginClineOAuth);
		expect(refreshCodieToken).toBe(refreshClineToken);
		expect(startCodieDeviceAuth).toBe(startClineDeviceAuth);
		expect(resolveLocalCodieAuthToken).toBe(resolveLocalClineAuthToken);
		expect(FALLBACK_CODIE_RECOMMENDED_MODELS).toBe(FALLBACK_CLINE_RECOMMENDED_MODELS);
		expect(fetchCodieRecommendedModels).toBe(fetchClineRecommendedModels);
	});
});
