#!/bin/bash
# Launch Beat Link Trigger for PULSE
# BLT joins your Pioneer network as a virtual CDJ and forwards beat events to PULSE via OSC.

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
JAR="$DIR/beat-link-trigger.jar"

if [ ! -f "$JAR" ]; then
  echo "ERROR: beat-link-trigger.jar not found in $DIR"
  echo "Download it from: https://github.com/Deep-Symmetry/beat-link-trigger/releases"
  exit 1
fi

# Find Java — check common macOS locations
JAVA_BIN=""
for candidate in \
    "$(which java 2>/dev/null)" \
    "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin/java" \
    "/Library/Java/JavaVirtualMachines/temurin-26.jdk/Contents/Home/bin/java" \
    "$(find /Library/Java/JavaVirtualMachines -name java -path "*/bin/java" 2>/dev/null | head -1)" \
    "/opt/homebrew/opt/openjdk/bin/java"; do
  if [ -x "$candidate" ]; then
    JAVA_BIN="$candidate"
    break
  fi
done

if [ -z "$JAVA_BIN" ]; then
  echo "ERROR: Java not found."
  echo "Install it with: brew install --cask temurin"
  exit 1
fi

echo "[blt] Java: $JAVA_BIN"
echo "[blt] Starting Beat Link Trigger → OSC :9000"
"$JAVA_BIN" -jar "$JAR"
