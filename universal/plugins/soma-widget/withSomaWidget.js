const {
  withDangerousMod,
  withAndroidManifest,
  AndroidConfig,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const PKG = "dev.gkos.soma";
const WIDGET_PKG_DIR = PKG.replace(/\./g, "/") + "/widget";

function copyDir(src, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(destDir, f));
  }
}

function readSecrets(projectRoot) {
  const p = path.join(projectRoot, "plugins/soma-widget/secrets.json");
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  return {
    api: process.env.SOMA_WIDGET_API || "https://soma.gkos.dev",
    token: process.env.SOMA_WIDGET_TOKEN || "",
  };
}

// Copy the Kotlin sources + res files into the freshly-generated android project,
// and generate WidgetSecrets.kt from the gitignored secrets.json (or env vars).
const withSource = (config) =>
  withDangerousMod(config, [
    "android",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const androidRoot = cfg.modRequest.platformProjectRoot;
      const pluginAndroid = path.join(
        projectRoot,
        "plugins/soma-widget/android"
      );

      const javaDest = path.join(
        androidRoot,
        "app/src/main/java",
        WIDGET_PKG_DIR
      );
      copyDir(path.join(pluginAndroid, "kotlin"), javaDest);

      const s = readSecrets(projectRoot);
      const secretsKt =
        `package ${PKG}.widget\n\n` +
        `object WidgetSecrets {\n` +
        `    const val API = ${JSON.stringify(s.api)}\n` +
        `    const val TOKEN = ${JSON.stringify(s.token)}\n` +
        `}\n`;
      fs.writeFileSync(path.join(javaDest, "WidgetSecrets.kt"), secretsKt);

      const resSrc = path.join(pluginAndroid, "res");
      const resDest = path.join(androidRoot, "app/src/main/res");
      for (const sub of ["layout", "xml", "drawable"]) {
        const from = path.join(resSrc, sub);
        if (fs.existsSync(from)) copyDir(from, path.join(resDest, sub));
      }
      return cfg;
    },
  ]);

// Register the two AppWidget receivers in AndroidManifest.
const withReceivers = (config) =>
  withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(
      cfg.modResults
    );
    app.receiver = app.receiver || [];
    const mk = (name, info, label) => ({
      $: {
        "android:name": `.widget.${name}`,
        "android:exported": "true",
        "android:label": label,
      },
      "intent-filter": [
        {
          action: [
            {
              $: {
                "android:name": "android.appwidget.action.APPWIDGET_UPDATE",
              },
            },
          ],
        },
      ],
      "meta-data": [
        {
          $: {
            "android:name": "android.appwidget.provider",
            "android:resource": `@xml/${info}`,
          },
        },
      ],
    });
    const existing = app.receiver.map((r) => r.$ && r.$["android:name"]);
    if (!existing.includes(".widget.SomaTodayWidget")) {
      app.receiver.push(mk("SomaTodayWidget", "soma_today_info", "Soma Today"));
    }
    if (!existing.includes(".widget.SomaNutritionWidget")) {
      app.receiver.push(
        mk("SomaNutritionWidget", "soma_nutrition_info", "Soma Nutrition")
      );
    }
    return cfg;
  });

module.exports = (config) => withReceivers(withSource(config));
