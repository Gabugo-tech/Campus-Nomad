import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from './firebase';

export function logActivity(action: string): Promise<void> {
  if (!auth.currentUser) return Promise.resolve();
  const path = 'activityLogs';
  
  // Fire-and-forget background log execution to keep user interface snappy
  addDoc(collection(db, path), {
    userEmail: auth.currentUser.email || 'unknown@campus.edu',
    displayName: auth.currentUser.displayName || 'Anonymous Student',
    action,
    timestamp: serverTimestamp()
  }).catch((err: any) => {
    console.warn("Background logActivity could not record event:", err?.message || err);
  });

  return Promise.resolve();
}
