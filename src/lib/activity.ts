import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from './firebase';

export async function logActivity(action: string) {
  if (!auth.currentUser) return;
  const path = 'activityLogs';
  try {
    await addDoc(collection(db, path), {
      userEmail: auth.currentUser.email || 'unknown@campus.edu',
      displayName: auth.currentUser.displayName || 'Anonymous Student',
      action,
      timestamp: serverTimestamp()
    });
  } catch (err: any) {
    console.error("Failed to log activity event:", err);
    if (err?.code === 'permission-denied' || err?.message?.includes('permission-denied') || err?.message?.includes('insufficient permissions')) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  }
}
