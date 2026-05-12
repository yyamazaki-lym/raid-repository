#!/usr/bin/env bash
# UserPromptSubmit: 15 / 30 ターン経過で会話切替を促す system-reminder を Claude に inject。
# カウンタは session_id 単位で独立 (~/.claude/turn-counters/<session_id>.txt)。
set -u

INPUT=$(cat)
SESSION_ID=$(printf '%s' "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(j.session_id||'')}catch(e){}})" 2>/dev/null)

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

COUNTER_DIR="${HOME}/.claude/turn-counters"
mkdir -p "$COUNTER_DIR" 2>/dev/null
COUNTER_FILE="$COUNTER_DIR/$SESSION_ID.txt"

COUNT=0
if [ -f "$COUNTER_FILE" ]; then
  COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo 0)
fi
COUNT=$((COUNT + 1))
printf '%s' "$COUNT" > "$COUNTER_FILE"

# 15 ターン目で初回、30 ターン目で再リマインド (それ以降は出さない)
if [ "$COUNT" -eq 15 ] || [ "$COUNT" -eq 30 ]; then
  MSG="会話が長くなっています (現在 ${COUNT} ターン)。コンテキスト肥大化を避けるため、新規セッションへの移行を検討してください。"
  node -e "process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:process.argv[1]}}))" "$MSG"
fi

exit 0
