import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const functions = getFunctions(app);
export { onAuthStateChanged };

const appCheckSiteKey = import.meta.env.VITE_RECAPTCHA_V3_SITE_KEY;
if (typeof window !== "undefined" && appCheckSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true
  });
}

export async function registerUser(
  email: string,
  password: string,
  context?: { managementId?: string | null; unitId?: string | null }
): Promise<import("firebase/auth").User> {
  const cred = await createUserWithEmailAndPassword(auth, email, password);

  const configRef = doc(db, "system", "config");
  const configSnap = await getDoc(configRef);

  let role: 'admin' | 'resident' = 'resident';

  if (!configSnap.exists()) {
    role = 'admin';
    await setDoc(configRef, { adminCreated: true });
  }

  await setDoc(doc(db, "users", cred.user.uid), {
    email,
    role,
    managementIds: [],
    managementId: context?.managementId ?? null,
    unitId: context?.unitId ?? null,
    createdAt: Date.now()
  });

  return cred.user;
}

export async function loginUser(email: string, password: string): Promise<import("firebase/auth").User> {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logoutUser(): Promise<void> {
  await signOut(auth);
}
