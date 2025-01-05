import React, { FC, useEffect, useState } from 'react';
import {
    fetchTenantId,
    fetchUserTenants,
    getKhulnasoftSearchDataUrl,
} from '../utils/setupConfiguration';
import Button from './Button';
import ArrowRightIcon from './icons/ArrowRightIcon';

import { ConfigurationStep, Tenant } from '../models/khulnasoft';
import './ConfigurationGlobalStep.css';
import KhulnasoftLogoLoading from './KhulnasoftLogoLoading';

const ConfigurationCompletedStep: FC<{
    apiKey: string;
    configurationStep: ConfigurationStep;
    onEditConfigurationClick: () => void;
}> = ({ apiKey, configurationStep, onEditConfigurationClick }) => {
    const [isInitializingData, setIsInitializingData] = useState(true);
    const [khulnasoftSearchUrl, setKhulnasoftSearchUrl] = useState('');
    const [tenantName, setTenantName] = useState('');

    useEffect(() => {
        if (configurationStep === ConfigurationStep.Completed) {
            Promise.all([
                getKhulnasoftSearchDataUrl(),
                fetchTenantId(),
                fetchUserTenants(apiKey),
            ]).then(([url, tenantId, userTenants]) => {
                setKhulnasoftSearchUrl(url);
                setTenantName(
                    userTenants.find((tenant: Tenant) => tenant.id === tenantId)?.name || 'unknown'
                );
                setIsInitializingData(false);
            });
        } else {
            setIsInitializingData(true);
            setKhulnasoftSearchUrl('');
            setTenantName('');
        }
    }, [configurationStep, apiKey]);

    if (configurationStep !== ConfigurationStep.Completed) {
        return null;
    }

    if (isInitializingData) {
        return <KhulnasoftLogoLoading />;
    }

    return (
        <div>
            <h5>
                {`You can now access `}
                <b>{tenantName}</b>
                {`'s Khulnasoft Data in Splunk.`}
            </h5>
            <div className="form-group">
                <div className="button-group">
                    <Button onClick={(): void => onEditConfigurationClick()} isSecondary>
                        Edit Configuration
                    </Button>
                    <div className="link">
                        <a href={khulnasoftSearchUrl}>View Khulnasoft Data</a>
                        <ArrowRightIcon remSize={1} />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ConfigurationCompletedStep;
