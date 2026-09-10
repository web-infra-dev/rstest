export default function styleFallbackLoader(source, sourceMap, meta) {
  this.callback(null, source, sourceMap, meta);
}

export const raw = true;

export function pitch() {
  // Decide after rules have matched so plugins, inline loaders and resource
  // types retain their behavior.
  if (this.loaders.length === 1 && this._module.type === 'javascript/auto') {
    // Real CSS Modules detection follows cssModules configuration; this fallback
    // only uses the filename convention to choose the empty export shape.
    return /\.module\.(less|scss|sass)$/.test(this.resourcePath)
      ? 'module.exports = {};'
      : 'module.exports = "";';
  }
}
