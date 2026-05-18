/** Generate a short random alphanumeric ID (8 characters) */
export function generateId(): string {
  return Math.random().toString(36).slice(2, 10)
}
