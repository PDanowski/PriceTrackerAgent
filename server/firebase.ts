import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { AgentServerState } from './agentTask';

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Pass custom firestoreDatabaseId if provided in config
export const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

const STATE_DOC_REF = doc(db, 'agent_state', 'main');

/**
 * Loads AgentServerState from Firestore. Returns null if not found or on error.
 */
export async function loadFirestoreState(): Promise<Partial<AgentServerState> | null> {
  try {
    const snap = await getDoc(STATE_DOC_REF);
    if (snap.exists()) {
      const data = snap.data();
      console.log('✅ Successfully loaded state from Firebase Firestore cloud database.');
      return data as Partial<AgentServerState>;
    }
    console.log('ℹ️ No previous state found in Firestore. A new cloud state will be saved.');
    return null;
  } catch (err) {
    console.warn('⚠️ Could not load state from Firestore (will use local fallback):', err);
    return null;
  }
}

/**
 * Saves current AgentServerState to Firestore.
 */
export async function saveFirestoreState(state: AgentServerState): Promise<boolean> {
  try {
    // Sanitize state for Firestore (no undefined values)
    const sanitizedState = JSON.parse(JSON.stringify(state));
    await setDoc(STATE_DOC_REF, {
      ...sanitizedState,
      updatedAt: new Date().toISOString(),
    });
    return true;
  } catch (err) {
    console.warn('⚠️ Could not save state to Firestore:', err);
    return false;
  }
}
