// Firebase 프로젝트 설정 (google-services.json 에서 가져옴). 공개되어도 괜찮은 값이고,
// 실제 보호는 비밀번호 로그인 + firestore.rules 가 한다.
export const firebaseConfig = {
  apiKey: 'AIzaSyASJgfGdlxzfGPm9mmwqMtu_c7NF0iiwfk',
  authDomain: 'minhan-diary.firebaseapp.com',
  projectId: 'minhan-diary',
  storageBucket: 'minhan-diary.firebasestorage.app',
  messagingSenderId: '345102420961',
  appId: '1:345102420961:android:c9461efeea49042ad760a0',
};

// 가족 계정: 화면에는 비밀번호(숫자)만 입력하고, 아이디는 여기 고정
export const FAMILY_ID = 'happyfamily';
export const FAMILY_EMAIL = `${FAMILY_ID}@minhan-diary.app`;
// Firebase 는 비밀번호가 6자 이상이어야 해서, 입력한 숫자 앞뒤에 글자를 붙여 쓴다
export const toFirebasePassword = (pin) => `mh-${pin}-diary`;
