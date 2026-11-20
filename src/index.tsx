/**
 * CE.SDK Video Moderation Editor Starterkit - React Entry Point
 *
 * Demonstrates video moderation by checking every video clip, image and
 * text for inappropriate content with the IMG.LY Gateway.
 *
 * @see https://img.ly/docs/cesdk/js/get-started/overview-e18f40/
 */

import type { Configuration } from '@cesdk/cesdk-js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './app/App';

const config: Configuration = {
  userId: 'starterkit-video-moderation-user',

  // Local assets for development

  role: 'Creator',
};

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <App config={config} />
  </StrictMode>
);
