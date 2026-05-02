#!/usr/bin/env bash
# PostToolUse: Edit/Write 直後に対象ファイルだけ eslint --fix を回す。
# 失敗してもユーザー操作はブロックしない（exit 0）。
set -u

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(j.tool_input&&j.tool_input.file_path?j.tool_input.file_path:'')}catch(e){}})" 2>/dev/null)

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  exit 0
fi

case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
npx --no-install eslint --fix "$FILE" >/dev/null 2>&1 || true
exit 0
