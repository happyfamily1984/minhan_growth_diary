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
// 월별 AI 분석 (Firebase AI Logic → Gemini 무료 등급)
export { getAI, getGenerativeModel, GoogleAIBackend, AIError } from 'firebase/ai';
