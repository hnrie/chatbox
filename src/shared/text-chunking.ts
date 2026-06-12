export async function recursiveChunk(
  text: string,
  options: { maxSize?: number; overlap?: number } = {}
): Promise<Array<{ text: string }>> {
  const maxSize = options.maxSize ?? 1200
  const overlap = options.overlap ?? 150
  if (!text.trim()) {
    return []
  }
  if (text.length <= maxSize) {
    return [{ text }]
  }

  const chunks: Array<{ text: string }> = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + maxSize, text.length)
    chunks.push({ text: text.slice(start, end) })
    if (end >= text.length) {
      break
    }
    start = Math.max(end - overlap, start + 1)
  }
  return chunks
}
