export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(Math.floor((bytes / 1024) * 10) / 10).toFixed(1)} KB`
  return `${(Math.floor((bytes / 1048576) * 10) / 10).toFixed(1)} MB`
}
