import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { PublicPrivacy } from './Privacy';
import '@fontsource-variable/dm-sans';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import './styles.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode>{location.pathname==='/privacy'?<PublicPrivacy/>:<App/>}</React.StrictMode>);
