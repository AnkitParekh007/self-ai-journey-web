import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { AppStore } from './state/store';
import { IdbLocalStore } from './storage/idb';
import { StoreContext, ToastHost } from './ui/components';
import { localBridgeAvailable } from '@core/remote-http';
import { connectLocalRepo } from './state/session';

const store = new AppStore(new IdbLocalStore());
(window as unknown as { __store?: AppStore }).__store = import.meta.env.DEV ? store : undefined;

store.init().then(async () => {
  // In the private dev server, offer the local repository automatically (no token involved).
  if (!__PUBLIC_SHELL__ && import.meta.env.DEV && (await localBridgeAvailable())) {
    const pref = await store.local.getMeta<string>('autoLocalRepo');
    if (pref !== 'off') connectLocalRepo(store);
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreContext.Provider value={store}>
      <ToastHost>
        <App />
      </ToastHost>
    </StoreContext.Provider>
  </StrictMode>,
);
