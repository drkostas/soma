// Expo config plugin: a network-security-config that allows cleartext HTTP to the Android
// emulator's host alias (10.0.2.2) and localhost only. Release builds stay cleartext-free
// for every real host; this exists so `verify-device.sh` can run a release build against the
// Mac's dev server (which serves the working tree) on the emulator. (soma#678, T3a.5)
const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">10.0.2.2</domain>
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
  </domain-config>
</network-security-config>
`;

function withEmulatorCleartext(config) {
  config = withDangerousMod(config, ["android", async (cfg) => {
    const dir = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "network_security_config.xml"), XML);
    return cfg;
  }]);
  config = withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) app.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    return cfg;
  });
  return config;
}
module.exports = withEmulatorCleartext;
