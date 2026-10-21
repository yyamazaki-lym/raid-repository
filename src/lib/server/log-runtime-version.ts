/**
 * 動いている Node の版をログに出す (`src/instrumentation.ts` が Node の
 * サーバーの起動時に一度だけ呼ぶ)。
 */
export function logRuntimeVersion(): void {
  console.info(`[runtime] node ${process.version}`);
}
