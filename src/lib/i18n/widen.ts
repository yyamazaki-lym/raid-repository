/**
 * `as const` で literal 化した ja の型を、en が別の文字列を入れられる形に
 * 広げる (文字列 literal → string、関数はそのまま)。辞書ファイル共通。
 */
export type DeepWiden<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => R
    : { [K in keyof T]: DeepWiden<T[K]> };
