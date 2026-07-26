import { initializeApp, getApps } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User, 
  signOut 
} from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

// Reuse initialized app if it exists
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(app);

export const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/spreadsheets');
provider.addScope('https://www.googleapis.com/auth/gmail.send');
provider.addScope('https://www.googleapis.com/auth/drive.file');

const TOKEN_KEY = 'google_access_token';
const EXPIRY_KEY = 'google_access_token_expires_at';

let isSigningIn = false;

const isTokenExpired = (): boolean => {
  try {
    const expiry = localStorage.getItem(EXPIRY_KEY);
    if (!expiry) return false;
    return Date.now() >= parseInt(expiry, 10);
  } catch {
    return false;
  }
};

let cachedAccessToken: string | null = ((): string | null => {
  try {
    if (isTokenExpired()) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(EXPIRY_KEY);
      return null;
    }
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
})();

export const saveToken = (token: string | null, expiresInSeconds: number = 3000) => {
  cachedAccessToken = token;
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      // Set expiration time with safety margin (default 50 mins = 3000s)
      const expiresAt = Date.now() + expiresInSeconds * 1000;
      localStorage.setItem(EXPIRY_KEY, expiresAt.toString());
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(EXPIRY_KEY);
    }
  } catch (err) {
    console.error('Failed to save access token:', err);
  }
};

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      const token = cachedAccessToken || localStorage.getItem(TOKEN_KEY) || '';
      if (onAuthSuccess) onAuthSuccess(user, token);
    } else {
      saveToken(null);
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  if (isSigningIn) {
    console.warn('Sign-in popup is already open.');
    return null;
  }
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Google Auth credential');
    }

    saveToken(credential.accessToken);
    return { user: result.user, accessToken: credential.accessToken };
  } catch (error: any) {
    if (
      error?.code === 'auth/cancelled-popup-request' ||
      error?.code === 'auth/popup-closed-by-user' ||
      error?.message?.includes('cancelled-popup-request')
    ) {
      console.warn('Google sign-in popup was cancelled or closed:', error.message);
      return null;
    }
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  if (isTokenExpired()) {
    saveToken(null);
    return null;
  }
  if (cachedAccessToken) return cachedAccessToken;
  try {
    const stored = localStorage.getItem(TOKEN_KEY);
    return stored;
  } catch {
    return null;
  }
};

export const logout = async () => {
  await signOut(auth);
  saveToken(null);
};
