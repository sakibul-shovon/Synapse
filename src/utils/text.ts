export function truncateDiscord(text: string, maxLength = 1900): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 20).trimEnd()}\n...`;
}

