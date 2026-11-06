/** Small runtime schemas for Server Function inputs; TypeScript alone does not validate JSON. */
export type Parser<T> = (value: unknown) => T
const invalid = (): never => { throw new Error('请求参数无效，请检查后重试。') }

export function text(max = 4096, min = 0): Parser<string> {
  return value => typeof value === 'string' && value.length >= min && value.length <= max ? value : invalid()
}
export const credential = text(16_384, 1)
export const boolean: Parser<boolean> = value => typeof value === 'boolean' ? value : invalid()
export const money = integer(0, Number.MAX_SAFE_INTEGER)
export function oneOf<const T extends readonly string[]>(values: T): Parser<T[number]> {
  return value => typeof value === 'string' && values.includes(value) ? value : invalid()
}
export function integer(min: number, max: number): Parser<number> {
  return value => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : invalid()
}
export function optional<T>(parse: Parser<T>): Parser<T | undefined> {
  return value => value === undefined ? undefined : parse(value)
}
export function nullable<T>(parse: Parser<T>): Parser<T | null> {
  return value => value === null ? null : parse(value)
}
export function array<T>(parse: Parser<T>, max: number): Parser<T[]> {
  return value => Array.isArray(value) && value.length <= max ? value.map(parse) : invalid()
}
export function object<T extends Record<string, Parser<unknown>>>(shape: T): Parser<{ [K in keyof T]: ReturnType<T[K]> }> {
  return value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
    const data = value as Record<string, unknown>
    return Object.fromEntries(Object.entries(shape).map(([key, parse]) => [key, parse(data[key])])) as { [K in keyof T]: ReturnType<T[K]> }
  }
}

export const channel = oneOf(['sms', 'email'])
export const contactFields = { channel, phone: optional(text(20)), phoneRegion: optional(text(8, 1)), email: optional(text(255)) }
export const contactInput = object(contactFields)
export const code = text(32, 1)
export const id = text(256, 1)
export const pageFields = { before: optional(id), limit: optional(integer(1, 100)) }
