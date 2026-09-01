const { existsSync } = require('node:fs');
const { writeFile } = require('node:fs/promises');
const { join } = require('node:path');

const iconPath = join(__dirname, '..', 'icon.png');
const iconUrl = 'https://assets.rspack.rs/rstest/rstest-logo-512x512.png';

async function ensureIcon({
  path = iconPath,
  url = iconUrl,
  fetchIcon = globalThis.fetch,
} = {}) {
  if (existsSync(path)) {
    return false;
  }

  const response = await fetchIcon(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download the VS Code icon: ${response.status} ${response.statusText}`,
    );
  }

  await writeFile(path, Buffer.from(await response.arrayBuffer()));
  return true;
}

if (require.main === module) {
  ensureIcon().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { ensureIcon };
