import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, doc, getDocFromServer, persistentLocalCache, persistentMultipleTabManager, onSnapshot as firebaseOnSnapshot, Unsubscribe } from 'firebase/firestore';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import firebaseConfigImport from '../../firebase-applet-config.json';

// Helper to pull from environment or fallback placeholder
const getEnvValue = (key: string, importVal: string): string => {
  const envVal = (import.meta.env as any)[key] || (process.env as any)[key];
  if (envVal) return envVal;
  // Fallbacks for direct local developer sandboxing if keys are still present in previous active memory
  if (importVal && importVal !== key) return importVal;
  
  // Real active credential defaults
  if (key === 'VITE_FIREBASE_PROJECT_ID') return 'gen-lang-client-0036951224';
  if (key === 'VITE_FIREBASE_APP_ID') return '1:694854753485:web:b4749d6c12d0d986021d84';
  if (key === 'VITE_FIREBASE_API_KEY') return 'AIzaSyAq7wTJmbTobk-hI3CvKhYlt9_YGpGY3uY';
  if (key === 'VITE_FIREBASE_AUTH_DOMAIN') return 'gen-lang-client-0036951224.firebaseapp.com';
  if (key === 'VITE_FIREBASE_FIRESTORE_DATABASE_ID') return 'ai-studio-a816fe72-4c23-410e-a34a-ce4eb1f0f56d';
  if (key === 'VITE_FIREBASE_STORAGE_BUCKET') return 'gen-lang-client-0036951224.firebasestorage.app';
  if (key === 'VITE_FIREBASE_MESSAGING_SENDER_ID') return '694854753485';
  if (key === 'VITE_FIREBASE_MEASUREMENT_ID') return 'G-3V5XQHGNGX';

  return '';
};

const firebaseConfig = {
  projectId: getEnvValue('VITE_FIREBASE_PROJECT_ID', firebaseConfigImport.projectId),
  appId: getEnvValue('VITE_FIREBASE_APP_ID', firebaseConfigImport.appId),
  apiKey: getEnvValue('VITE_FIREBASE_API_KEY', firebaseConfigImport.apiKey),
  authDomain: getEnvValue('VITE_FIREBASE_AUTH_DOMAIN', firebaseConfigImport.authDomain),
  firestoreDatabaseId: getEnvValue('VITE_FIREBASE_FIRESTORE_DATABASE_ID', firebaseConfigImport.firestoreDatabaseId),
  storageBucket: getEnvValue('VITE_FIREBASE_STORAGE_BUCKET', firebaseConfigImport.storageBucket),
  messagingSenderId: getEnvValue('VITE_FIREBASE_MESSAGING_SENDER_ID', firebaseConfigImport.messagingSenderId),
  measurementId: getEnvValue('VITE_FIREBASE_MEASUREMENT_ID', firebaseConfigImport.measurementId)
};

const app = initializeApp(firebaseConfig);

// Initialize App Check only if a valid reCAPTCHA site key is present in the environment
const recaptchaKey = (import.meta.env as any).VITE_FIREBASE_RECAPTCHA_SITE_KEY || (process.env as any).VITE_FIREBASE_RECAPTCHA_SITE_KEY;

if (typeof window !== 'undefined' && recaptchaKey) {
  try {
    // Preserve any existing debug token (injected by automated testing frameworks/harnesses)
    const existingToken = (window as any).FIREBASE_APPCHECK_DEBUG_TOKEN || (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN;
    if (!existingToken) {
      // Fallback to true (which lets SDK generate a temporary one for development console)
      (window as any).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(recaptchaKey),
      isTokenAutoRefreshEnabled: true
    });
    console.log("Firebase App Check initialized successfully with environment key.");
  } catch (error) {
    console.warn("Failed to initialize Firebase App Check:", error);
  }
} else {
  console.log("App Check skipped (no VITE_FIREBASE_RECAPTCHA_SITE_KEY found). Firestore will connect directly.");
}

let localCacheConfig;
try {
  // In iframe environments (like AI Studio previews), multi-tab synchronization
  // causes severe IndexedDB lock contention and state synchronization bugs,
  // particularly when quota is hit and connections reset.
  // We fall back to standard persistentLocalCache without the multi-tab manager.
  const isIframe = typeof window !== 'undefined' && window.self !== window.top;
  if (isIframe) {
    localCacheConfig = persistentLocalCache({});
  } else {
    localCacheConfig = persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    });
  }
} catch (e) {
  console.warn("Could not initialize local cache config, using default:", e);
}

export const db = initializeFirestore(app, {
  ...(localCacheConfig ? { localCache: localCacheConfig } : {}),
  experimentalAutoDetectLongPolling: true
}, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errStr = error instanceof Error ? error.message : String(error);
  
  if (
    errStr.toLowerCase().includes('quota') || 
    errStr.toLowerCase().includes('exhausted') || 
    errStr.toLowerCase().includes('resource-exhausted')
  ) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('firestore-quota-exceeded'));
    }
  }

  const errInfo: FirestoreErrorInfo = {
    error: errStr,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Connection verification probe removed to boost initialization speed and prevent startup permission errors.

export function onSnapshot(
  ref: any,
  ...args: any[]
): Unsubscribe {
  const isQuotaExceeded = typeof window !== 'undefined' && localStorage.getItem('campus_connect_quota_exceeded') === 'true';
  
  // Find the callback functions in args
  let onNext: any = null;
  let onError: any = null;
  
  args.forEach(arg => {
    if (typeof arg === 'function') {
      if (!onNext) {
        onNext = arg;
      } else if (!onError) {
        onError = arg;
      }
    }
  });

  if (isQuotaExceeded) {
    console.warn("onSnapshot bypassed: Cloud Database Daily Quota Exceeded.");
    if (onError) {
      setTimeout(() => {
        try {
          onError(new Error("FirebaseError: [code=resource-exhausted]: Quota limit exceeded (cached bypass)"));
        } catch (_) {}
      }, 0);
    }
    return () => {};
  }

  // Intercept onError to detect quota exceeded
  const wrappedOnError = (error: any) => {
    const errStr = error ? error.message : '';
    if (
      errStr.toLowerCase().includes('quota') || 
      errStr.toLowerCase().includes('exhausted') || 
      errStr.toLowerCase().includes('resource-exhausted')
    ) {
      if (typeof window !== 'undefined') {
        localStorage.setItem('campus_connect_quota_exceeded', 'true');
        window.dispatchEvent(new CustomEvent('firestore-quota-exceeded'));
      }
    }
    if (onError) {
      try {
        onError(error);
      } catch (_) {}
    }
  };

  // Modify the args to include our wrapped callback
  const finalArgs = args.map(arg => {
    if (arg === onError && onError) {
      return wrappedOnError;
    }
    return arg;
  });

  // If there wasn't an onError callback, let's append our wrapped one so we always catch the quota event
  if (!onError) {
    finalArgs.push(wrappedOnError);
  }

  try {
    return firebaseOnSnapshot(ref, ...finalArgs);
  } catch (error: any) {
    console.warn("onSnapshot failed to initialize:", error);
    if (onError) {
      try {
        onError(error);
      } catch (_) {}
    }
    return () => {};
  }
}
