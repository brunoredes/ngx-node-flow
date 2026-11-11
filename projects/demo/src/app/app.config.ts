import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideNodeFlow } from 'ngx-node-flow';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideNodeFlow({ grid: { size: 24 }, node: { color: '#2d3748' }, edge: { color: '#63b3ed' } }),
  ],
};
