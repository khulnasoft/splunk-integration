import {
    APPLICATION_NAMESPACE,
    APP_NAME,
    KHULNASOFT_SAVED_SEARCH_NAME,
    KV_COLLECTION_KEY,
    KV_COLLECTION_NAME,
    KV_COLLECTION_VALUE,
    PasswordKeys,
    SEVERITY_SAVED_SEARCH_NAME,
    STORAGE_REALM,
} from '../models/constants';
import { Severity, SourceType, SourceTypeCategory, Tenant } from '../models/khulnasoft';
import {
    SplunkCollectionItem,
    SplunkRequestResponse,
    SplunkService,
    SplunkStoragePasswordAccessors,
} from '../models/splunk';
import { getConfigurationStanzaValue, updateConfigurationFile } from './configurationFileHelper';
import { promisify } from './util';

async function completeSetup(splunkService: SplunkService): Promise<void> {
    await updateConfigurationFile(splunkService, 'app', 'install', {
        is_configured: 'true',
    });
}

async function reloadApp(splunkService: SplunkService): Promise<void> {
    const splunkApps = splunkService.apps();
    await promisify(splunkApps.fetch)();

    const currentApp = splunkApps.item(APP_NAME);
    await promisify(currentApp.reload)();
}

function getRedirectUrl(): string {
    return `/app/${APP_NAME}`;
}

async function getKhulnasoftSearchDataUrl(): Promise<string> {
    const service = createService();
    const savedSearches = await promisify(service.savedSearches().fetch)();
    const savedSearch = savedSearches.item(KHULNASOFT_SAVED_SEARCH_NAME);
    return `/app/${APP_NAME}/@go?s=${savedSearch.qualifiedPath}`;
}

function redirectToHomepage(): void {
    window.location.href = getRedirectUrl();
}

function createService(): SplunkService {
    // The splunkjs is injected by Splunk
    // eslint-disable-next-line no-undef
    const http = new splunkjs.SplunkWebHttp();
    // eslint-disable-next-line no-undef
    const service = new splunkjs.Service(http, APPLICATION_NAMESPACE);

    return service;
}

function fetchApiKeyValidation(apiKey: string): Promise<boolean> {
    const service = createService();
    const data = { apiKey };
    return promisify(service.post)('/services/fetch_api_key_validation', data).then(
        (response: SplunkRequestResponse) => {
            return response.status === 200;
        }
    );
}

function fetchUserTenants(apiKey: string): Promise<Array<Tenant>> {
    const service = createService();
    const data = { apiKey };
    return promisify(service.post)('/services/fetch_user_tenants', data).then(
        (response: SplunkRequestResponse) => {
            return response.data.tenants;
        }
    );
}

function fetchSeverityFilters(apiKey: string): Promise<Array<Severity>> {
    const service = createService();
    const data = { apiKey };
    return promisify(service.post)('/services/fetch_severity_filters', data).then(
        (response: SplunkRequestResponse) => {
            return response.data.severities;
        }
    );
}

function fetchSourceTypeFilters(apiKey: string): Promise<Array<SourceTypeCategory>> {
    const service = createService();
    const data = { apiKey };
    return promisify(service.post)('/services/fetch_source_type_filters', data).then(
        (response: SplunkRequestResponse) => {
            return response.data.categories;
        }
    );
}

function doesPasswordExist(storage: SplunkStoragePasswordAccessors, key: string): boolean {
    const passwordId = `${STORAGE_REALM}:${key}:`;

    for (const password of storage.list()) {
        if (password.name === passwordId) {
            return true;
        }
    }
    return false;
}

async function savePassword(
    storage: SplunkStoragePasswordAccessors,
    key: string,
    value: string
): Promise<void> {
    const passwordExists = doesPasswordExist(storage, key);
    if (passwordExists) {
        const passwordId = `${STORAGE_REALM}:${key}:`;
        await storage.del(passwordId);
    }
    if (value.length > 0) {
        await promisify(storage.create)({
            name: key,
            realm: STORAGE_REALM,
            password: value,
        });
    }
}

async function saveConfiguration(
    apiKey: string,
    tenantId: number,
    indexName: string,
    isIngestingFullEventData: boolean,
    severitiesFilter: string,
    sourceTypesFilter: string
): Promise<void> {
    const service = createService();
    const storagePasswords = await promisify(service.storagePasswords().fetch)();
    await savePassword(storagePasswords, PasswordKeys.API_KEY, apiKey);
    await savePassword(storagePasswords, PasswordKeys.TENANT_ID, `${tenantId}`);
    await savePassword(
        storagePasswords,
        PasswordKeys.INGEST_FULL_EVENT_DATA,
        `${isIngestingFullEventData}`
    );
    await savePassword(storagePasswords, PasswordKeys.SEVERITIES_FILTER, `${severitiesFilter}`);
    await savePassword(storagePasswords, PasswordKeys.SOURCE_TYPES_FILTER, `${sourceTypesFilter}`);
    await saveIndexForIngestion(service, indexName);
    const isFirstConfiguration = await fetchIsFirstConfiguration();
    if (isFirstConfiguration) {
        await updateEventIngestionCronJobInterval(service, '1');
    }
    await updateSavedSearchQuery(
        service,
        KHULNASOFT_SAVED_SEARCH_NAME,
        `source=${APP_NAME} index=${indexName} earliest=-24h latest=now`
    );
    await updateSavedSearchQuery(
        service,
        SEVERITY_SAVED_SEARCH_NAME,
        `source=${APP_NAME} index=${indexName} earliest=-24h latest=now | spath path=header.risk.score output=risk_score_str | eval risk_score = coalesce(tonumber(risk_score_str), 0)  | eval risk_label = case(risk_score == 1, "Info", risk_score == 2, "Low", risk_score == 3, "Medium", risk_score == 4, "High", risk_score == 5, "Critical")  | stats count by risk_label, risk_score | sort risk_score | fields - risk_score`
    );
    await completeSetup(service);
    await reloadApp(service);
    if (isFirstConfiguration) {
        await updateEventIngestionCronJobInterval(service, '* * * * *');
        await reloadApp(service);
    }
}

async function updateEventIngestionCronJobInterval(
    service: SplunkService,
    interval: string
): Promise<void> {
    await updateConfigurationFile(
        service,
        'inputs',
        'script://$SPLUNK_HOME/etc/apps/khulnasoft/bin/cron_job_ingest_events.py',
        {
            interval: `${interval}`,
        }
    );
}

async function updateSavedSearchQuery(
    service: SplunkService,
    savedSearchName: string,
    query: string
): Promise<void> {
    const savedSearches = await promisify(service.savedSearches().fetch)();
    const savedSearch = savedSearches.item(savedSearchName);
    if (savedSearch) {
        await savedSearch.update({
            search: query,
        });
    }
}

async function fetchCollectionItems(): Promise<SplunkCollectionItem[]> {
    const service = createService();
    return promisify(service.get)(
        `storage/collections/data/event_ingestion_collection/${KV_COLLECTION_NAME}`,
        {}
    )
        .then((response: SplunkRequestResponse) => {
            const items: SplunkCollectionItem[] = [];
            if (response.data) {
                response.data.forEach((element) => {
                    items.push({
                        key: element[KV_COLLECTION_KEY],
                        value: element[KV_COLLECTION_VALUE],
                        user: element._user,
                    });
                });
            }
            return items;
        })
        .catch(() => {
            return [];
        });
}

async function fetchPassword(passwordKey: string): Promise<string | undefined> {
    const service = createService();
    const storagePasswords = await promisify(service.storagePasswords().fetch)();
    const passwordId = `${STORAGE_REALM}:${passwordKey}:`;

    for (const password of storagePasswords.list()) {
        if (password.name === passwordId) {
            return password._properties.clear_password;
        }
    }
    return undefined;
}

async function fetchApiKey(): Promise<string> {
    return (await fetchPassword(PasswordKeys.API_KEY)) || '';
}

async function fetchTenantId(): Promise<number | undefined> {
    return fetchPassword(PasswordKeys.TENANT_ID).then((tenantId) => {
        if (tenantId) {
            return parseInt(tenantId, 10);
        }

        return undefined;
    });
}

async function fetchIngestFullEventData(): Promise<boolean> {
    return fetchPassword(PasswordKeys.INGEST_FULL_EVENT_DATA).then((isIngestingFullEventData) => {
        return isIngestingFullEventData === 'true';
    });
}

async function fetchSeveritiesFilter(): Promise<Array<string>> {
    const savedSeverities = await fetchPassword(PasswordKeys.SEVERITIES_FILTER);
    if (savedSeverities) {
        return savedSeverities.split(',');
    }

    return [];
}

async function fetchSourceTypesFilter(): Promise<Array<string>> {
    const savedSourceTypes = await fetchPassword(PasswordKeys.SOURCE_TYPES_FILTER);
    if (savedSourceTypes) {
        return savedSourceTypes.split(',');
    }

    return [];
}

async function createKhulnasoftIndex(): Promise<void> {
    const service = createService();
    const isFirstConfiguration = await fetchIsFirstConfiguration();
    if (isFirstConfiguration) {
        const currentIndexNames = await fetchAvailableIndexNames();
        if (!currentIndexNames.find((indexName) => indexName === APP_NAME)) {
            await service.indexes().create(APP_NAME, {});
        }
    }
}

async function saveIndexForIngestion(service: SplunkService, indexName: string): Promise<void> {
    await updateConfigurationFile(
        service,
        'inputs',
        'script://$SPLUNK_HOME/etc/apps/khulnasoft/bin/cron_job_ingest_events.py',
        {
            index: indexName,
        }
    );
}

async function fetchAvailableIndexNames(): Promise<Array<string>> {
    const service = createService();
    const indexes = await promisify(service.indexes().fetch)();
    const indexNames: string[] = [];
    const ignoredIndexNames = ['history', 'summary', 'splunklogger'];
    for (const { name: indexName } of indexes.list()) {
        if (!indexName.startsWith('_') && !ignoredIndexNames.includes(indexName)) {
            indexNames.push(indexName);
        }
    }
    return indexNames;
}

async function fetchIsFirstConfiguration(): Promise<boolean> {
    const service = createService();
    return (
        (await getConfigurationStanzaValue(
            service,
            'app',
            'install',
            'is_configured',
            'unknown'
        )) !== '1'
    );
}

async function fetchCurrentIndexName(): Promise<string> {
    const service = createService();
    return getConfigurationStanzaValue(
        service,
        'inputs',
        'script://$SPLUNK_HOME/etc/apps/khulnasoft/bin/cron_job_ingest_events.py',
        'index',
        'main'
    );
}

async function fetchVersionName(defaultValue: string): Promise<string> {
    const service = createService();
    return getConfigurationStanzaValue(service, 'app', 'launcher', 'version', defaultValue);
}

function convertSeverityFilterToArray(
    severitiesFilter: string[],
    allSeverities: Severity[]
): Severity[] {
    // If no filter is specified, add every severities
    if (severitiesFilter.length === 0) {
        return [...allSeverities];
    }

    // Otherwise, find the matching severities from the filter
    const severities: Severity[] = [];
    severitiesFilter.forEach((severityValue) => {
        const severityMatch = allSeverities.find((severity) => severity.value === severityValue);
        if (severityMatch) {
            severities.push(severityMatch);
        }
    });
    return severities;
}

function getSeverityFilterValue(selectedSeverities: Severity[], allSeverities: Severity[]): string {
    let severitiesFilter = '';

    if (selectedSeverities.length === 0) {
        throw new Error('At least one severity must be selected');
    }

    // Only set a filter if the user did not select everything
    if (selectedSeverities.length !== allSeverities.length) {
        severitiesFilter = selectedSeverities.map((severity) => severity.value).join(',');
    }
    return severitiesFilter;
}

function convertSourceTypeFilterToArray(
    sourceTypesFilter: string[],
    allSourceTypeCategories: SourceTypeCategory[]
): SourceType[] {
    // If no filter is specified, add every sub source types
    if (sourceTypesFilter.length === 0) {
        return [...allSourceTypeCategories.flatMap((category) => category.types)];
    }

    // Otherwise, try to match the filter with the source type categories and subtypes
    const sourceTypes: SourceType[] = [];
    sourceTypesFilter.forEach((sourceTypeValue) => {
        // Check if the source type is actually a category and if so, add all of their subtypes
        const sourceTypeCategoryMatch = allSourceTypeCategories.find(
            (sourceTypeCategory) => sourceTypeCategory.value === sourceTypeValue
        );
        if (sourceTypeCategoryMatch) {
            sourceTypes.push(...sourceTypeCategoryMatch.types);
        }

        // Check if the source type is a sub type of a category and add it to the list if found
        const sourceTypeMatch = allSourceTypeCategories
            .flatMap((category) => category.types)
            .find((sourceType) => sourceType.value === sourceTypeValue);
        if (sourceTypeMatch) {
            sourceTypes.push(sourceTypeMatch);
        }
    });
    return sourceTypes;
}

function getSourceTypesFilterValue(
    selectedSourceTypes: SourceType[],
    allSourceTypeCategories: SourceTypeCategory[]
): string {
    let sourceTypesFilter = '';

    if (selectedSourceTypes.length === 0) {
        throw new Error('At least one source type must be selected');
    }

    // Only set a filter if the user did not select everything
    if (
        selectedSourceTypes.length !==
        allSourceTypeCategories.flatMap((category) => category.types).length
    ) {
        let remainingSourceTypes = [...selectedSourceTypes];
        allSourceTypeCategories.forEach((sourceTypeCategory) => {
            // If the user has selected every sub option, replace them by the parent
            if (sourceTypeCategory.types.every((type) => remainingSourceTypes.includes(type))) {
                remainingSourceTypes = remainingSourceTypes.filter(
                    (type) => !sourceTypeCategory.types.includes(type)
                );
                remainingSourceTypes.push(sourceTypeCategory);
            }
        });
        sourceTypesFilter = remainingSourceTypes.map((sourceType) => sourceType.value).join(',');
    }
    return sourceTypesFilter;
}

export {
    createKhulnasoftIndex,
    fetchApiKey,
    fetchApiKeyValidation,
    fetchAvailableIndexNames,
    fetchSeverityFilters,
    fetchCollectionItems,
    fetchCurrentIndexName,
    fetchIngestFullEventData,
    fetchSeveritiesFilter,
    fetchSourceTypeFilters,
    fetchSourceTypesFilter,
    fetchTenantId,
    fetchUserTenants,
    fetchVersionName,
    getKhulnasoftSearchDataUrl,
    getRedirectUrl,
    redirectToHomepage,
    saveConfiguration,
    getSeverityFilterValue,
    convertSeverityFilterToArray,
    getSourceTypesFilterValue,
    convertSourceTypeFilterToArray,
};
