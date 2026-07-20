/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "SomaWidget",
  // No App Group entitlement: a free Apple ID personal team can't sign it, and the
  // widget fetches its own data via URLSession (see token.swift / widgets.swift).
  entitlements: {},
  colors: {
    $accent: "#77c8d1",
    $widgetBackground: "#0a1720",
  },
});
