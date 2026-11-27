#!/usr/bin/env bash
# 안드로이드 SDK 설치 (클라우드 세션을 새로 열면 한 번). 사용: bash scripts/setup-android-sdk.sh <설치할 폴더>
set -euo pipefail
SDK="${1:?SDK 설치 폴더를 주세요 (예: \$HOME/android-sdk)}"
mkdir -p "$SDK" && cd "$SDK"
if [ ! -x cmdline-tools/latest/bin/sdkmanager ]; then
  curl -sSLo tools.zip https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip
  unzip -q tools.zip && mkdir -p cmdline-tools/latest
  mv cmdline-tools/{bin,lib,NOTICE.txt,source.properties} cmdline-tools/latest/ 2>/dev/null || true
fi
yes | ./cmdline-tools/latest/bin/sdkmanager --sdk_root="$SDK" --licenses >/dev/null 2>&1 || true
./cmdline-tools/latest/bin/sdkmanager --sdk_root="$SDK" "platform-tools" "platforms;android-36" "build-tools;36.0.0" "build-tools;35.0.0"
echo "완료: export ANDROID_HOME=$SDK"
