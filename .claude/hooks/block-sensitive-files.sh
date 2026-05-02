#!/usr/bin/env bash
# PreToolUse(Edit|Write): .env / lock ファイルへの書き込みをブロック。
# .env.local.example はテンプレなので許可。
set -u

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(j.tool_input&&j.tool_input.file_path?j.tool_input.file_path:'')}catch(e){}})" 2>/dev/null)

if [ -z "$FILE" ]; then
  exit 0
fi

# basename で判定（パス区切りは / と \ 両方を考慮）
BASENAME=$(printf '%s' "$FILE" | sed 's#.*[\\/]##')

case "$BASENAME" in
  .env.local.example|.env.example) exit 0 ;;
  .env|.env.*|package-lock.json|pnpm-lock.yaml|yarn.lock|bun.lockb)
    echo "Blocked: '$BASENAME' は機密 / lock ファイルのため自動編集を禁止しています。手動で編集してください。" >&2
    exit 2
    ;;
esac

exit 0
