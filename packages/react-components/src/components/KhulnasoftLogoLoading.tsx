import React, { FC } from 'react';

import './KhulnasoftLogoLoading.css';
import KhulnasoftLogo from './icons/KhulnasoftLogo';

const KhulnasoftLogoLoading: FC<{ hidden?: boolean }> = ({ hidden }) => {
    return (
        <div className="khulnasoft-logo-loading-container" hidden={hidden}>
            <div className="khulnasoft-logo-loading-svg">
                <KhulnasoftLogo remSize={5} />
            </div>
        </div>
    );
};

export default KhulnasoftLogoLoading;
