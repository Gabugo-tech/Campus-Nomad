import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// Initialize App Check with local preview support via the Debug Provider
if (typeof window !== 'undefined') {
  try {
    // Preserve any existing debug token (injected by automated testing frameworks/harnesses)
    const existingToken = (window as any).FIREBASE_APPCHECK_DEBUG_TOKEN || (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN;
    if (!existingToken) {
      // Fallback to true (which lets SDK generate a temporary one for development console)
      (window as any).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider((firebaseConfig as any).recaptchaSiteKey || '6Ld_placeholder_site_key_needed_for_app_check'),
      isTokenAutoRefreshEnabled: true
    });
    console.log("Firebase App Check initialized successfully.");
  } catch (error) {
    console.warn("Failed to initialize Firebase App Check (App Check might not be enabled/enforced on project):", error);
  }
}

export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true
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
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
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
