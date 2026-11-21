const fs = require('node:fs');
function readLegacy(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.size > 10 * 1024 * 1024) return {};
    const parts = fs.readFileSync(file, 'utf8').split(/--mb-sep--\r?\n/),
      values = {};
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const key = parts[i].trim();
      if (
        !/^(?:xlgame_(?:info|settings)|\d+_(?:changdi_data|xlgamedata)|uobtkd_(?:equipment_v1|display_v1|court_layout|competition_setup_v1|keybindings_v1)|bristol_(?:audio_v1|free_training_v1))$/.test(
          key
        )
      )
        continue;
      JSON.parse(parts[i + 1]);
      values[key] = parts[i + 1];
    }
    return values;
  } catch {
    return {};
  }
}
module.exports = { readLegacy };
