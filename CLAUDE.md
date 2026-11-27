# 민한이 성장일기 — 작업 안내 (새 세션용)

사용자는 민한이 아빠이고 한국어로 대화한다. 엄마·아빠 두 폰에서 쓰는 가족 앱이다.
설명·커밋 메시지·주석도 한국어. 결과물은 **APK 파일**로 보내 준다 (`민한이성장일기-v<버전>.apk`).
이 저장소는 **공개** 저장소다: 가족 비밀번호(PIN)·서명 키·비밀값은 절대 커밋하지 않는다.

## 구조
- Capacitor 8 안드로이드 앱. 웹 코드는 `www/` (번들러 없음, ES 모듈). `npm run vendor` 가 `www/vendor/` 를 만든다
  (Tesseract OCR + 한/영 사전, 글꼴, `src/firebase.js` → esbuild 로 `www/vendor/firebase.js`).
- 주요 파일: `www/app.js`(화면 전부), `www/store.js`(Firestore), `www/ai.js`(월별 AI 분석), `www/saju.js`(사주),
  `www/bubbles.js`·`www/ocr-prep.js`·`www/parse.js`(텔레그램 캡쳐/붙여넣기 인식), `www/photo.js`, `www/kv.js`(임시저장 IndexedDB).
- 안드로이드 네이티브: `android/app/src/main/java/com/happyfamily/minhandiary/`
  - `MainActivity.java`: 공유 받기(AndroidShare), 알림 브리지(AndroidNotify), 상단바/하단바 여백, 글꼴 확대 115% 제한
  - `NewEntryWorker.java`: 15분마다 Firestore REST 로 새 글·AI 분석·결석을 찾아 알림 (내가 쓴 건 제외)

## Firebase (프로젝트 minhan-diary, Spark 무료 요금제)
- 로그인: 가족 비밀번호(PIN)만 입력 → 가족 계정 하나로 로그인 (`www/firebase-config.js` 참고). PIN 은 사용자가 알고 있다.
- 데이터: `families/happyfamily/` 아래 `entries`, `photos`, `photoData`, `people`(사주 가족), `analyses`(월별 AI 분석, 문서=YYYY-MM),
  `absences`(결석, 문서=YYYY-MM-DD, type normal/excused/outside), `absenceYears`(학년도별 결석 가능 일수, 문서=2026).
- 규칙: `firestore.rules` (가족 계정만 읽기/쓰기).
- **월별 AI 분석**은 Firebase AI Logic(Gemini Developer API 무료 등급)을 쓴다. 모델 `gemini-3.6-flash` 우선 (없어지면 다음 모델로).
  - ⚠️ **2027-01-21 부터 AI Logic 에 App Check 가 강제**된다. 우리 앱은 APK 직접 설치라 Play Integrity 를 못 써서 그때 AI 분석이 막힌다.
    그 전에 대책 필요 (예: App Check 디버그 토큰 방식, 또는 다른 무료 AI). 12월쯤 사용자에게 알려 주기로 함.

## 빌드 (APK)
1. `npm ci && npm run vendor`
2. 안드로이드 SDK: `bash scripts/setup-android-sdk.sh <스크래치 폴더>/android-sdk` 후 `export ANDROID_HOME=...`
3. **서명 키**: `android/minhan-release.keystore` + `android/keystore.properties` 는 저장소에 없다 (gitignore).
   사용자가 보관 중인 `민한이성장일기-서명키-백업.zip` 을 올려 달라고 해서 `android/` 에 푼다.
   **이 키 없이 만든 APK 는 기존 앱 위에 업데이트 설치가 안 된다** (지우고 새로 깔아야 함 → 폰에만 있던 임시저장·설정이 사라짐).
   키 SHA-256: `A2:7E:24:69:73:B6:BA:CF:1A:51:80:65:26:70:F5:9D:C2:7B:7B:6D:9A:E0:9A:78:DF:7D:1F:09:09:B9:42:38`
4. 버전 올리기: `android/app/build.gradle` 의 versionCode/versionName (지금 32 / 6.1), `www/sw.js` 의 캐시 이름(minhan-vNN)
5. `npx cap sync android && (cd android && ./gradlew assembleRelease --no-daemon -q)`
   → `android/app/build/outputs/apk/release/app-release.apk`

## 시험
- 단위: `npm test`
- 화면(Playwright, Chromium 설치돼 있음): Firebase 에뮬레이터 + 로컬 서버로 두 폰(엄마/아빠)을 흉내 낸다.
  에뮬레이터에는 시험용 PIN `0000` 으로 가족 계정을 만든다 (실제 PIN 아님).
  ```
  npx firebase emulators:start --only auth,firestore --project minhan-diary &
  node scripts/serve.mjs &        # http://localhost:5173 , 주소에 ?emu=1 을 붙이면 에뮬레이터에 연결
  # 에뮬레이터 REST(accounts:signUp)로 가족 이메일 + 비밀번호 mh-0000-diary 계정 만들기
  NODE_PATH=$(npm root -g) node test/e2e/absence.cjs
  ```
  `test/e2e/ai-analysis.cjs` 는 Gemini 응답을 가짜로 돌려준다. 실데이터를 건드리지 않게 실제 시험은 에뮬레이터로만.
- 화면 깨짐 점검: `scripts/layout-check.cjs`

## 사용자 취향 / 지난 결정
- 디자인: 사용자 시안 기반 (페이지별 배너 `www/img/banner-*.webp`, 글꼴 주아·고운돋움). 작은 폰·큰 글꼴에서도 줄바꿈 깨짐 없게.
- 기록자(아빠/엄마/기타)는 카드 오른쪽 아래에 **아주 작게**. 사진 설명은 사진 **아래**.
- 사주 궁합·AI 분석은 **긍정적인 내용 위주**.
- 종류: 💬 한 말 / 😂 웃긴 말 / 🌱 한 일. 사진은 따로 넣거나 글에 붙일 수 있음.
- 하단 메뉴: 오늘 · 달력 · ✏️ · 사진 · 전체보기. 텔레그램 가져오기는 설정 안에 숨김.
- 달력 맨 아래: 이달의 AI 분석 카드, 결석 기록 카드. 결석은 학년도(3월~다음 해 2월) 단위, 일반결석만 셈.
- 다른 사람이 쓴 글/AI 분석/결석은 알림 + 빨간 N.
- 돈이 드는 기능은 원하지 않음 (AI 도 무료로 바꿔 달라고 함).

## 아직 확인 못 한 것
- 진짜 폰에서 백그라운드 알림(15분 확인)이 잘 오는지 — 사용자 확인 대기.
