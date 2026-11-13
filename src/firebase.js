// esbuild 로 www/vendor/firebase.js 하나로 묶는다 (npm run vendor)
export { initializeApp } from 'firebase/app';
export { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, connectAuthEmulator } from 'firebase/auth';
export {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  connectFirestoreEmulator,
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  onSnapshot,
} from 'firebase/firestore';
